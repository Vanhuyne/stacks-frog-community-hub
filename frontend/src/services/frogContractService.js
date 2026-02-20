let connectModulePromise;
let transactionsModulePromise;

const loadConnectModule = async () => {
  if (!connectModulePromise) connectModulePromise = import('@stacks/connect');
  return connectModulePromise;
};

const loadTransactionsModule = async () => {
  if (!transactionsModulePromise) transactionsModulePromise = import('@stacks/transactions');
  return transactionsModulePromise;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitedError = (err) => {
  const message = String(err?.message || err || '').toLowerCase();
  return message.includes('429') || message.includes('too many requests') || message.includes('rate limit');
};

const unwrapResponse = (cv, cvToValue) => {
  const value = cvToValue(cv);
  if (value && typeof value === 'object' && 'type' in value) {
    if (value.type === 'ok') return value.value;
    if (value.type === 'err') throw new Error(`Contract error: ${value.value}`);
  }
  return value;
};

const stringifyClarityValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object' && 'value' in value) return stringifyClarityValue(value.value);
  return JSON.stringify(value);
};

const normalizeClarityValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeClarityValue(item));
  if (typeof value === 'object') {
    if ('type' in value && 'value' in value) return normalizeClarityValue(value.value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeClarityValue(v)]));
  }
  return value;
};

export const createFrogContractService = ({ contractAddress, contractName, network, readOnlyBaseUrl }) => {
  const BALANCE_CACHE_TTL_MS = 3000;
  const NEXT_CLAIM_CACHE_TTL_MS = 3000;

  let tokenMetadataCache;
  let faucetConfigCache;
  let faucetConfigCacheExpiresAt = 0;
  let faucetConfigInFlight;

  const balanceCacheByAddress = new Map();
  const nextClaimBlockCacheByAddress = new Map();
  const readOnlyInFlightByKey = new Map();

  const getStoredAddress = async () => {
    const { getLocalStorage } = await loadConnectModule();
    const data = getLocalStorage();
    return data?.addresses?.stx?.[0]?.address || '';
  };

  const connectWallet = async (appDetails) => {
    const { connect } = await loadConnectModule();
    const response = await connect({ appDetails });
    const storedAddress = await getStoredAddress();
    return (
      response?.addresses?.stx?.[0]?.address ||
      response?.addresses?.find?.((item) => item?.address?.startsWith?.('S'))?.address ||
      storedAddress
    );
  };

  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    const { cvToValue, fetchCallReadOnlyFunction } = await loadTransactionsModule();
    const client = readOnlyBaseUrl ? { baseUrl: readOnlyBaseUrl } : undefined;

    const maxAttempts = 4;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await fetchCallReadOnlyFunction({
          contractAddress,
          contractName,
          functionName,
          functionArgs,
          senderAddress,
          network,
          client
        });
        return unwrapResponse(result, cvToValue);
      } catch (err) {
        const isLastAttempt = attempt === maxAttempts - 1;
        if (!isRateLimitedError(err) || isLastAttempt) throw err;
        await sleep(1000 * (2 ** attempt));
      }
    }

    throw new Error('Read-only request failed unexpectedly.');
  };

  const readOnlyWithAddressCache = async ({ addressKey, inFlightKey, cacheMap, ttlMs, loader }) => {
    const now = Date.now();
    const cached = cacheMap.get(addressKey);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    if (cached && cached.expiresAt <= now) {
      cacheMap.delete(addressKey);
    }

    const inFlight = readOnlyInFlightByKey.get(inFlightKey);
    if (inFlight) {
      return inFlight;
    }

    const requestPromise = (async () => {
      const value = await loader();
      cacheMap.set(addressKey, {
        value,
        expiresAt: Date.now() + ttlMs
      });
      return value;
    })();

    readOnlyInFlightByKey.set(inFlightKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      readOnlyInFlightByKey.delete(inFlightKey);
    }
  };

  const getFaucetConfigCached = async (address) => {
    const now = Date.now();

    if (faucetConfigCache && faucetConfigCacheExpiresAt > now) {
      return faucetConfigCache;
    }

    if (faucetConfigInFlight) {
      return faucetConfigInFlight;
    }

    faucetConfigInFlight = (async () => {
      const config = await readOnly(address, 'get-faucet-config', []);
      const parsedConfig = normalizeClarityValue(config) || {};
      faucetConfigCache = parsedConfig;
      faucetConfigCacheExpiresAt = Date.now() + 5000;
      return parsedConfig;
    })();

    try {
      return await faucetConfigInFlight;
    } finally {
      faucetConfigInFlight = undefined;
    }
  };

  const fetchTokenMetadata = async (address) => {
    if (tokenMetadataCache !== undefined) return tokenMetadataCache;

    try {
      const tokenUriCv = await readOnly(address, 'get-token-uri', []);
      const tokenUri = stringifyClarityValue(tokenUriCv);
      if (!tokenUri) {
        tokenMetadataCache = {};
        return tokenMetadataCache;
      }

      const response = await fetch(tokenUri);
      if (!response.ok) throw new Error(`Fetch metadata failed: ${response.status}`);
      const metadata = await response.json();

      tokenMetadataCache = {
        tokenUri,
        tokenImage: typeof metadata?.image === 'string' ? metadata.image : '',
        tokenDisplayName: typeof metadata?.name === 'string' ? metadata.name : ''
      };
      return tokenMetadataCache;
    } catch (_) {
      tokenMetadataCache = {};
      return tokenMetadataCache;
    }
  };

  const fetchFaucetSnapshot = async (address) => {
    const { principalCV } = await loadTransactionsModule();
    const targetPrincipal = principalCV(address);

    const [balResult, nextResult, canResult, configResult, metadataResult] = await Promise.allSettled([
      readOnlyWithAddressCache({
        addressKey: address,
        inFlightKey: `get-balance:${address}`,
        cacheMap: balanceCacheByAddress,
        ttlMs: BALANCE_CACHE_TTL_MS,
        loader: () => readOnly(address, 'get-balance', [targetPrincipal])
      }),
      readOnlyWithAddressCache({
        addressKey: address,
        inFlightKey: `get-next-claim-block:${address}`,
        cacheMap: nextClaimBlockCacheByAddress,
        ttlMs: NEXT_CLAIM_CACHE_TTL_MS,
        loader: () => readOnly(address, 'get-next-claim-block', [targetPrincipal])
      }),
      readOnly(address, 'can-claim?', [targetPrincipal]),
      getFaucetConfigCached(address),
      fetchTokenMetadata(address)
    ]);

    const parsedConfig = configResult.status === 'fulfilled'
      ? (configResult.value || {})
      : (faucetConfigCache || {});

    const metadata = metadataResult.status === 'fulfilled' ? metadataResult.value : {};

    return {
      balance: stringifyClarityValue(balResult.status === 'fulfilled' ? balResult.value : ''),
      nextClaimBlock: stringifyClarityValue(nextResult.status === 'fulfilled' ? nextResult.value : ''),
      canClaim: canResult.status === 'fulfilled' ? Boolean(canResult.value) : false,
      owner: stringifyClarityValue(parsedConfig.owner),
      faucetAmount: stringifyClarityValue(parsedConfig.amount),
      cooldownBlocks: stringifyClarityValue(parsedConfig.cooldown),
      faucetPaused: Boolean(parsedConfig.paused),
      tokenImage: metadata?.tokenImage || '',
      tokenDisplayName: metadata?.tokenDisplayName || '',
      tokenUri: metadata?.tokenUri || ''
    };
  };

  const claim = async () => {
    const { request } = await loadConnectModule();
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'claim',
      functionArgs: [],
      network
    });
  };

  const transfer = async ({ amount, sender, recipient }) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'transfer',
      functionArgs: [
        Cl.uint(BigInt(amount)),
        Cl.standardPrincipal(sender),
        Cl.standardPrincipal(recipient),
        Cl.none()
      ],
      network
    });
  };

  const setFaucetPaused = async (paused) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'set-faucet-paused',
      functionArgs: [Cl.bool(Boolean(paused))],
      network
    });
  };

  const setFaucetAmount = async (amount) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'set-faucet-amount',
      functionArgs: [Cl.uint(BigInt(amount))],
      network
    });
  };

  const setCooldownBlocks = async (blocks) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'set-cooldown-blocks',
      functionArgs: [Cl.uint(BigInt(blocks))],
      network
    });
  };

  return {
    connectWallet,
    disconnectWallet: async () => {
      const { disconnect } = await loadConnectModule();
      disconnect();
    },
    getStoredAddress,
    fetchFaucetSnapshot,
    claim,
    transfer,
    setFaucetPaused,
    setFaucetAmount,
    setCooldownBlocks
  };
};

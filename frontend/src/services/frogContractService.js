import { connect, disconnect, getLocalStorage, request } from '@stacks/connect';
import { Cl, cvToValue, fetchCallReadOnlyFunction, principalCV } from '@stacks/transactions';

const unwrapResponse = (cv) => {
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
  let tokenMetadataCache;

  const getStoredAddress = () => {
    const data = getLocalStorage();
    return data?.addresses?.stx?.[0]?.address || '';
  };

  const connectWallet = async (appDetails) => {
    const response = await connect({ appDetails });
    return (
      response?.addresses?.stx?.[0]?.address ||
      response?.addresses?.find?.((item) => item?.address?.startsWith?.('S'))?.address ||
      getStoredAddress()
    );
  };

  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    const client = readOnlyBaseUrl ? { baseUrl: readOnlyBaseUrl } : undefined;

    const result = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderAddress,
      network,
      client
    });
    return unwrapResponse(result);
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
    const bal = await readOnly(address, 'get-balance', [principalCV(address)]);
    const next = await readOnly(address, 'get-next-claim-block', [principalCV(address)]);
    const can = await readOnly(address, 'can-claim?', [principalCV(address)]);
    const config = await readOnly(address, 'get-faucet-config', []);
    const parsedConfig = normalizeClarityValue(config) || {};
    const metadata = await fetchTokenMetadata(address);

    return {
      balance: stringifyClarityValue(bal),
      nextClaimBlock: stringifyClarityValue(next),
      canClaim: Boolean(can),
      owner: stringifyClarityValue(parsedConfig.owner),
      faucetAmount: stringifyClarityValue(parsedConfig.amount),
      cooldownBlocks: stringifyClarityValue(parsedConfig.cooldown),
      faucetPaused: Boolean(parsedConfig.paused),
      tokenImage: metadata.tokenImage || '',
      tokenDisplayName: metadata.tokenDisplayName || '',
      tokenUri: metadata.tokenUri || ''
    };
  };

  const claim = async () => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'claim',
      functionArgs: [],
      network
    });
  };

  const transfer = async ({ amount, sender, recipient }) => {
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
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'set-faucet-paused',
      functionArgs: [Cl.bool(Boolean(paused))],
      network
    });
  };

  const setFaucetAmount = async (amount) => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'set-faucet-amount',
      functionArgs: [Cl.uint(BigInt(amount))],
      network
    });
  };

  const setCooldownBlocks = async (blocks) => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'set-cooldown-blocks',
      functionArgs: [Cl.uint(BigInt(blocks))],
      network
    });
  };

  return {
    connectWallet,
    disconnectWallet: disconnect,
    getStoredAddress,
    fetchFaucetSnapshot,
    claim,
    transfer,
    setFaucetPaused,
    setFaucetAmount,
    setCooldownBlocks
  };
};

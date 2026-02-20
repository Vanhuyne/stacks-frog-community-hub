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

const unwrapOptional = (value) => {
  if (value === null || value === undefined) return null;

  if (typeof value === 'object' && value) {
    if (value.type === 'some') return value.value;
    if (value.type === 'none') return null;
    if (value.type === 'optional') return unwrapOptional(value.value);
    if ('value' in value && value.value !== undefined && value.value !== null) {
      return unwrapOptional(value.value);
    }
  }

  return value;
};

const normalizeObject = (value) => {
  if (value === null || value === undefined) return null;

  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }

  if (typeof value === 'object') {
    if (typeof value.type === 'string' && (value.type === 'tuple' || value.type.startsWith('(tuple')) && value.value) {
      return normalizeObject(value.value);
    }

    if ('value' in value && value.value instanceof Map) {
      return Object.fromEntries(value.value.entries());
    }

    return value;
  }

  return null;
};

const getTupleField = (tupleLike, keys) => {
  const tuple = normalizeObject(tupleLike);
  if (!tuple || typeof tuple !== 'object') return undefined;

  for (const key of keys) {
    if (key in tuple) return tuple[key];
  }

  const tupleKeys = Object.keys(tuple);
  if (tupleKeys.length === 1) return tuple[tupleKeys[0]];
  return undefined;
};

const stringifyClarityValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Map) return JSON.stringify(Object.fromEntries(value.entries()));
  if (typeof value === 'object' && 'value' in value) return stringifyClarityValue(value.value);
  return JSON.stringify(value);
};

export const createFrogDaoNftService = ({ contractAddress, contractName, network, readOnlyBaseUrl }) => {
  const isLikelyPrincipal = (value) => /^S[PT][A-Z0-9]{39}$/.test(String(value || '').trim());

  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    const { cvToValue, fetchCallReadOnlyFunction } = await loadTransactionsModule();
    const client = readOnlyBaseUrl ? { baseUrl: readOnlyBaseUrl } : undefined;
    const normalizedSender = String(senderAddress || '').trim();
    const safeSender = isLikelyPrincipal(normalizedSender)
      ? normalizedSender
      : String(contractAddress || '').trim();

    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await fetchCallReadOnlyFunction({
          contractAddress,
          contractName,
          functionName,
          functionArgs,
          senderAddress: safeSender,
          network,
          client
        });
        return unwrapResponse(result, cvToValue);
      } catch (err) {
        const isLastAttempt = attempt === maxAttempts - 1;
        if (!isRateLimitedError(err) || isLastAttempt) throw err;
        await sleep(250 * (2 ** attempt));
      }
    }

    throw new Error('Read-only request failed unexpectedly.');
  };

  const toSafePrincipal = async (value) => {
    const { principalCV } = await loadTransactionsModule();
    const safeAddress = isLikelyPrincipal(value)
      ? String(value).trim()
      : String(contractAddress || '').trim();
    return principalCV(safeAddress);
  };

  const fetchDaoSnapshot = async (address) => {
    const targetPrincipal = await toSafePrincipal(address);

    const [frogBalanceResult, usernameResult, passResult, eligibleResult] = await Promise.allSettled([
      readOnly(address, 'get-frog-balance', [targetPrincipal]),
      readOnly(address, 'get-username', [targetPrincipal]),
      readOnly(address, 'get-pass-id', [targetPrincipal]),
      readOnly(address, 'is-eligible-to-mint?', [targetPrincipal])
    ]);

    const frogBalanceRaw = frogBalanceResult.status === 'fulfilled' ? frogBalanceResult.value : '';
    const usernameRaw = usernameResult.status === 'fulfilled' ? usernameResult.value : null;
    const passRaw = passResult.status === 'fulfilled' ? passResult.value : null;
    const eligibleRaw = eligibleResult.status === 'fulfilled' ? eligibleResult.value : false;

    const usernameTuple = unwrapOptional(usernameRaw);
    const passTuple = unwrapOptional(passRaw);

    const usernameField = getTupleField(usernameTuple, ['name', 'username']);
    const passIdField = getTupleField(passTuple, ['token-id', 'token_id', 'tokenId']);

    const username = stringifyClarityValue(usernameField ?? usernameTuple);
    const passId = stringifyClarityValue(passIdField ?? passTuple);

    return {
      frogBalance: stringifyClarityValue(frogBalanceRaw),
      username,
      hasPass: passTuple !== null && passTuple !== undefined,
      passId,
      eligible: Boolean(eligibleRaw)
    };
  };

  const fetchTreasurySnapshot = async (senderAddress) => {
    const [treasuryResult, mintFeeResult] = await Promise.allSettled([
      readOnly(senderAddress, 'get-dao-treasury', []),
      readOnly(senderAddress, 'get-pass-mint-fee', [])
    ]);

    const treasuryAddress = treasuryResult.status === 'fulfilled'
      ? stringifyClarityValue(treasuryResult.value)
      : '';
    const mintFee = mintFeeResult.status === 'fulfilled'
      ? stringifyClarityValue(mintFeeResult.value)
      : '';

    if (!treasuryAddress) {
      return {
        treasuryAddress: '',
        treasuryBalance: '',
        mintFee
      };
    }

    const treasuryPrincipal = await toSafePrincipal(treasuryAddress);
    const treasuryBalanceResult = await Promise.allSettled([
      readOnly(senderAddress, 'get-frog-balance', [treasuryPrincipal])
    ]);

    const treasuryBalance = treasuryBalanceResult[0].status === 'fulfilled'
      ? stringifyClarityValue(treasuryBalanceResult[0].value)
      : '';

    return {
      treasuryAddress,
      treasuryBalance,
      mintFee
    };
  };

  const getOwnerByUsername = async (senderAddress, name) => {
    const { Cl } = await loadTransactionsModule();
    const ownerRaw = await readOnly(senderAddress, 'get-owner-by-username', [Cl.stringAscii(name)]);
    const ownerTuple = unwrapOptional(ownerRaw);
    const ownerField = getTupleField(ownerTuple, ['owner']);
    return stringifyClarityValue(ownerField ?? ownerTuple);
  };

  const registerUsername = async (name) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'register-username',
      functionArgs: [Cl.stringAscii(name)],
      network
    });
  };

  const mintPass = async () => {
    const { request } = await loadConnectModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'mint-pass',
      functionArgs: [],
      postConditionMode: 'allow',
      network
    });
  };

  return {
    fetchDaoSnapshot,
    fetchTreasurySnapshot,
    getOwnerByUsername,
    registerUsername,
    mintPass
  };
};

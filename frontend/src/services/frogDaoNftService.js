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

const READONLY_CACHE_TTL_MS = 5000;
const READONLY_CACHE_FUNCTIONS = new Set(['get-proposal', 'get-proposal-result']);

const serializeCacheArg = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => serializeCacheArg(item)).join(',')}]`;
  if (typeof value === 'object') {
    if ('type' in value && 'value' in value) {
      return `${String(value.type)}:${serializeCacheArg(value.value)}`;
    }
    return Object.keys(value)
      .sort()
      .map((key) => `${key}:${serializeCacheArg(value[key])}`)
      .join('|');
  }
  return String(value);
};

const getReadOnlyCacheKey = (safeSender, functionName, functionArgs) => {
  const argsKey = (functionArgs || []).map((arg) => serializeCacheArg(arg)).join('||');
  return `${safeSender}::${functionName}::${argsKey}`;
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

const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (value && typeof value === 'object' && 'value' in value) return toBool(value.value);
  return Boolean(value);
};

const parseProposalTuple = (raw) => {
  const tuple = unwrapOptional(raw);
  if (!tuple) return null;

  return {
    creator: stringifyClarityValue(getTupleField(tuple, ['creator'])),
    title: stringifyClarityValue(getTupleField(tuple, ['title'])),
    detailsUri: stringifyClarityValue(getTupleField(tuple, ['details-uri', 'details_uri', 'detailsUri'])),
    startBlock: stringifyClarityValue(getTupleField(tuple, ['start-block', 'start_block', 'startBlock'])),
    endBlock: stringifyClarityValue(getTupleField(tuple, ['end-block', 'end_block', 'endBlock'])),
    yesVotes: stringifyClarityValue(getTupleField(tuple, ['yes-votes', 'yes_votes', 'yesVotes'])),
    noVotes: stringifyClarityValue(getTupleField(tuple, ['no-votes', 'no_votes', 'noVotes'])),
    abstainVotes: stringifyClarityValue(getTupleField(tuple, ['abstain-votes', 'abstain_votes', 'abstainVotes'])),
    executed: toBool(getTupleField(tuple, ['executed'])),
    canceled: toBool(getTupleField(tuple, ['canceled']))
  };
};

const parseProposalResultTuple = (raw) => {
  const tuple = normalizeObject(raw);
  if (!tuple) return null;

  return {
    yesVotes: stringifyClarityValue(getTupleField(tuple, ['yes-votes', 'yes_votes', 'yesVotes'])),
    noVotes: stringifyClarityValue(getTupleField(tuple, ['no-votes', 'no_votes', 'noVotes'])),
    abstainVotes: stringifyClarityValue(getTupleField(tuple, ['abstain-votes', 'abstain_votes', 'abstainVotes'])),
    totalVotes: stringifyClarityValue(getTupleField(tuple, ['total-votes', 'total_votes', 'totalVotes'])),
    quorum: stringifyClarityValue(getTupleField(tuple, ['quorum'])),
    passed: toBool(getTupleField(tuple, ['passed'])),
    executed: toBool(getTupleField(tuple, ['executed'])),
    canceled: toBool(getTupleField(tuple, ['canceled'])),
    active: toBool(getTupleField(tuple, ['active']))
  };
};

const toSafeInt = (value) => {
  try {
    const next = Number.parseInt(String(value || '0'), 10);
    if (Number.isNaN(next) || next < 0) return 0;
    return next;
  } catch (_) {
    return 0;
  }
};

export const createFrogDaoNftService = ({ contractAddress, contractName, network, readOnlyBaseUrl }) => {
  const isLikelyPrincipal = (value) => /^S[PT][A-Z0-9]{39}$/.test(String(value || '').trim());
  const readOnlyCache = new Map();
  const readOnlyInFlight = new Map();

  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    const { cvToValue, fetchCallReadOnlyFunction } = await loadTransactionsModule();
    const client = readOnlyBaseUrl ? { baseUrl: readOnlyBaseUrl } : undefined;
    const normalizedSender = String(senderAddress || '').trim();
    const safeSender = isLikelyPrincipal(normalizedSender)
      ? normalizedSender
      : String(contractAddress || '').trim();

    const shouldCache = READONLY_CACHE_FUNCTIONS.has(functionName);
    const cacheKey = shouldCache
      ? getReadOnlyCacheKey(safeSender, functionName, functionArgs)
      : '';

    if (shouldCache) {
      const cached = readOnlyCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
      if (cached && cached.expiresAt <= Date.now()) {
        readOnlyCache.delete(cacheKey);
      }

      const inFlight = readOnlyInFlight.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }
    }

    const executeReadOnly = async () => {
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

    if (!shouldCache) {
      return executeReadOnly();
    }

    const requestPromise = (async () => {
      const value = await executeReadOnly();
      readOnlyCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + READONLY_CACHE_TTL_MS
      });
      return value;
    })();

    readOnlyInFlight.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      readOnlyInFlight.delete(cacheKey);
    }
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

  const fetchGovernanceSnapshot = async (senderAddress, proposalId) => {
    const { Cl } = await loadTransactionsModule();
    const safeSenderPrincipal = await toSafePrincipal(senderAddress);

    const [configResult, proposalResult, resultResult, voteResult, canVoteResult] = await Promise.allSettled([
      readOnly(senderAddress, 'get-governance-config', []),
      proposalId ? readOnly(senderAddress, 'get-proposal', [Cl.uint(proposalId)]) : Promise.resolve(null),
      proposalId ? readOnly(senderAddress, 'get-proposal-result', [Cl.uint(proposalId)]) : Promise.resolve(null),
      proposalId ? readOnly(senderAddress, 'get-vote', [Cl.uint(proposalId), safeSenderPrincipal]) : Promise.resolve(null),
      proposalId ? readOnly(senderAddress, 'can-vote?', [Cl.uint(proposalId), safeSenderPrincipal]) : Promise.resolve(false)
    ]);

    const configTuple = configResult.status === 'fulfilled' ? normalizeObject(configResult.value) : null;
    const voteTuple = voteResult.status === 'fulfilled' ? unwrapOptional(voteResult.value) : null;
    const voteChoice = voteTuple ? stringifyClarityValue(getTupleField(voteTuple, ['choice'])) : '';

    return {
      governanceConfig: {
        votingPeriodBlocks: stringifyClarityValue(getTupleField(configTuple, ['voting-period-blocks', 'voting_period_blocks', 'votingPeriodBlocks'])),
        minVotesQuorum: stringifyClarityValue(getTupleField(configTuple, ['min-votes-quorum', 'min_votes_quorum', 'minVotesQuorum'])),
        lastProposalId: stringifyClarityValue(getTupleField(configTuple, ['last-proposal-id', 'last_proposal_id', 'lastProposalId']))
      },
      proposal: proposalResult.status === 'fulfilled' ? parseProposalTuple(proposalResult.value) : null,
      proposalResult: resultResult.status === 'fulfilled' ? parseProposalResultTuple(resultResult.value) : null,
      voteChoice,
      canVote: canVoteResult.status === 'fulfilled' ? toBool(canVoteResult.value) : false
    };
  };

  const fetchProposalBoard = async (senderAddress, limit = 8) => {
    const governanceBase = await fetchGovernanceSnapshot(senderAddress, null);
    const lastId = toSafeInt(governanceBase.governanceConfig.lastProposalId);

    if (lastId === 0) {
      return {
        governanceConfig: governanceBase.governanceConfig,
        proposals: []
      };
    }

    const safeLimit = Math.min(8, Math.max(1, limit));
    const fromId = Math.max(1, lastId - safeLimit + 1);
    const ids = [];
    for (let id = lastId; id >= fromId; id -= 1) ids.push(id);

    const { Cl } = await loadTransactionsModule();
    const rows = [];

    for (const id of ids) {
      try {
        const proposalRaw = await readOnly(senderAddress, 'get-proposal', [Cl.uint(BigInt(id))]);
        const proposalResultRaw = await readOnly(senderAddress, 'get-proposal-result', [Cl.uint(BigInt(id))]);

        const proposal = parseProposalTuple(proposalRaw);
        if (!proposal) continue;

        const result = parseProposalResultTuple(proposalResultRaw);
        rows.push({
          id: String(id),
          ...proposal,
          result,
          voteChoice: '',
          canVote: Boolean(result?.active)
        });
      } catch (_) {
        // Skip this proposal if one of the reads is rate-limited or missing.
      }
    }

    return {
      governanceConfig: governanceBase.governanceConfig,
      proposals: rows
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

  const createProposal = async (title, detailsUri) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'create-proposal',
      functionArgs: [Cl.stringAscii(title), Cl.stringAscii(detailsUri)],
      network
    });
  };

  const vote = async (proposalId, choice) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'vote',
      functionArgs: [Cl.uint(proposalId), Cl.uint(choice)],
      network
    });
  };

  const executeProposal = async (proposalId) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'execute-proposal',
      functionArgs: [Cl.uint(proposalId)],
      network
    });
  };

  const cancelProposal = async (proposalId) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'cancel-proposal',
      functionArgs: [Cl.uint(proposalId)],
      network
    });
  };

  return {
    fetchDaoSnapshot,
    fetchTreasurySnapshot,
    fetchGovernanceSnapshot,
    fetchProposalBoard,
    getOwnerByUsername,
    registerUsername,
    mintPass,
    createProposal,
    vote,
    executeProposal,
    cancelProposal
  };
};

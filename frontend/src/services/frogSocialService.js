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

const parseRateLimitWaitMs = (err) => {
  const message = String(err?.message || err || '');
  const match = message.match(/try again in\s+(\d+)\s+seconds?/i);
  const seconds = Number.parseInt(match?.[1] || '', 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(30_000, seconds * 1000);
  return 1_500;
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
  if (typeof value === 'object' && 'value' in value) return stringifyClarityValue(value.value);
  return JSON.stringify(value);
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

export const createFrogSocialService = ({
  contractAddress,
  contractName,
  tipsContractAddress,
  tipsContractName,
  network,
  readOnlyBaseUrl
}) => {
  const isLikelyPrincipal = (value) => /^S[PT][A-Z0-9]{39}$/.test(String(value || '').trim());
  const socialAddress = String(contractAddress || '').trim();
  const socialName = String(contractName || '').trim();
  const tipsAddress = String(tipsContractAddress || contractAddress || '').trim();
  const tipsName = String(tipsContractName || 'frog-social-tips-v1').trim();

  const cachedPostsById = new Map();
  const cachedHasLikedByKey = new Map();
  const cachedTipStatsByPostId = new Map();
  const inFlightPostById = new Map();
  const inFlightHasLikedByKey = new Map();
  const inFlightTipStatsByPostId = new Map();
  const hasLikedCacheTtlMs = 30_000;
  const postCacheTtlMs = 8_000;
  const tipStatsCacheTtlMs = 6_000;
  let tipsUnavailable = false;

  const minReadIntervalMs = 120;
  let nextReadSlotAt = 0;

  const waitForReadSlot = async () => {
    const now = Date.now();
    if (now < nextReadSlotAt) {
      await sleep(nextReadSlotAt - now);
    }
    nextReadSlotAt = Date.now() + minReadIntervalMs;
  };

  const readOnlyCall = async ({ targetAddress, targetName, senderAddress, functionName, functionArgs = [] }) => {
    const { cvToValue, fetchCallReadOnlyFunction } = await loadTransactionsModule();
    const client = readOnlyBaseUrl ? { baseUrl: readOnlyBaseUrl } : undefined;
    const normalizedSender = String(senderAddress || '').trim();
    const safeSender = isLikelyPrincipal(normalizedSender)
      ? normalizedSender
      : String(targetAddress || '').trim();

    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await waitForReadSlot();

        const result = await fetchCallReadOnlyFunction({
          contractAddress: targetAddress,
          contractName: targetName,
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

        const jitterMs = Math.floor(Math.random() * 120);
        await sleep(parseRateLimitWaitMs(err) + jitterMs);
      }
    }

    throw new Error('Read-only request failed unexpectedly.');
  };

  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    return readOnlyCall({
      targetAddress: socialAddress,
      targetName: socialName,
      senderAddress,
      functionName,
      functionArgs
    });
  };

  const tipReadOnly = async (senderAddress, functionName, functionArgs = []) => {
    return readOnlyCall({
      targetAddress: tipsAddress,
      targetName: tipsName,
      senderAddress,
      functionName,
      functionArgs
    });
  };

  const fetchConfig = async (senderAddress) => {
    const configRaw = await readOnly(senderAddress, 'get-social-config', []);
    const configTuple = normalizeObject(configRaw);

    return {
      treasury: stringifyClarityValue(getTupleField(configTuple, ['treasury'])),
      postFee: stringifyClarityValue(getTupleField(configTuple, ['post-fee', 'post_fee', 'postFee'])),
      likeFee: stringifyClarityValue(getTupleField(configTuple, ['like-fee', 'like_fee', 'likeFee'])),
      lastPostId: stringifyClarityValue(getTupleField(configTuple, ['last-post-id', 'last_post_id', 'lastPostId']))
    };
  };

  const fetchLastPostId = async (senderAddress) => {
    const config = await fetchConfig(senderAddress);
    return String(config.lastPostId || '0');
  };

  const fetchPost = async (senderAddress, postId) => {
    const cacheKey = String(postId);
    const cached = cachedPostsById.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const inFlight = inFlightPostById.get(cacheKey);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      const { Cl } = await loadTransactionsModule();
      const postRaw = await readOnly(senderAddress, 'get-post', [Cl.uint(BigInt(postId))]);
      const postTuple = normalizeObject(unwrapOptional(postRaw));
      if (!postTuple) return null;

      const post = {
        id: String(postId),
        author: stringifyClarityValue(getTupleField(postTuple, ['author'])),
        contentHash: stringifyClarityValue(getTupleField(postTuple, ['content-hash', 'content_hash', 'contentHash'])).toLowerCase(),
        createdAtBlock: stringifyClarityValue(getTupleField(postTuple, ['created-at', 'created_at', 'createdAt'])),
        likeCount: stringifyClarityValue(getTupleField(postTuple, ['like-count', 'like_count', 'likeCount']))
      };
      cachedPostsById.set(cacheKey, { value: post, expiresAt: Date.now() + postCacheTtlMs });
      return post;
    })();

    inFlightPostById.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      inFlightPostById.delete(cacheKey);
    }
  };

  const hasLiked = async (senderAddress, postId, who) => {
    if (!isLikelyPrincipal(who)) return false;

    const cacheKey = `${String(who)}:${String(postId)}`;
    const cached = cachedHasLikedByKey.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const inFlight = inFlightHasLikedByKey.get(cacheKey);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      const { Cl } = await loadTransactionsModule();
      const liked = await readOnly(senderAddress, 'has-liked', [Cl.uint(BigInt(postId)), Cl.standardPrincipal(who)]);
      const value = Boolean(liked);
      cachedHasLikedByKey.set(cacheKey, { value, expiresAt: Date.now() + hasLikedCacheTtlMs });
      return value;
    })();

    inFlightHasLikedByKey.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      inFlightHasLikedByKey.delete(cacheKey);
    }
  };

  const fetchPostTipStats = async (senderAddress, postId) => {
    if (tipsUnavailable) return { totalTipMicroStx: '0', tipCount: '0' };

    const cacheKey = String(postId);
    const cached = cachedTipStatsByPostId.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const inFlight = inFlightTipStatsByPostId.get(cacheKey);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      const { Cl } = await loadTransactionsModule();
      let statsRaw;
      try {
        statsRaw = await tipReadOnly(senderAddress, 'get-post-tip-stats', [Cl.uint(BigInt(postId))]);
      } catch (err) {
        const message = String(err?.message || err || '').toLowerCase();
        if (message.includes('contract') && message.includes('not')) {
          tipsUnavailable = true;
          return { totalTipMicroStx: '0', tipCount: '0' };
        }
        throw err;
      }

      const tuple = normalizeObject(statsRaw);
      const value = {
        totalTipMicroStx: stringifyClarityValue(getTupleField(tuple, ['total-tip-ustx', 'total_tip_ustx', 'totalTipUstx'])),
        tipCount: stringifyClarityValue(getTupleField(tuple, ['tip-count', 'tip_count', 'tipCount']))
      };
      cachedTipStatsByPostId.set(cacheKey, { value, expiresAt: Date.now() + tipStatsCacheTtlMs });
      return value;
    })();

    inFlightTipStatsByPostId.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      inFlightTipStatsByPostId.delete(cacheKey);
    }
  };

  const fetchUserBalance = async (senderAddress, who) => {
    if (!isLikelyPrincipal(who)) return '';
    const { Cl } = await loadTransactionsModule();
    const value = await readOnly(senderAddress, 'get-frog-balance', [Cl.standardPrincipal(who)]);
    return stringifyClarityValue(value);
  };

  const fetchFeed = async ({ senderAddress, viewerAddress, limit = 10 }) => {
    const config = await fetchConfig(senderAddress);
    const lastId = toSafeInt(config.lastPostId);

    if (lastId === 0) {
      const viewerBalance = viewerAddress ? await fetchUserBalance(senderAddress, viewerAddress) : '';
      return { config, viewerBalance, posts: [] };
    }

    const safeLimit = Math.min(15, Math.max(1, limit));
    const fromId = Math.max(1, lastId - safeLimit + 1);
    const posts = [];

    for (let id = lastId; id >= fromId; id -= 1) {
      try {
        const post = await fetchPost(senderAddress, id);
        if (!post) continue;

        let hasLikedByViewer = false;
        if (viewerAddress && isLikelyPrincipal(viewerAddress)) {
          try {
            hasLikedByViewer = await hasLiked(senderAddress, id, viewerAddress);
          } catch (_) {
            hasLikedByViewer = false;
          }
        }

        let tipStats = { totalTipMicroStx: '0', tipCount: '0' };
        try {
          tipStats = await fetchPostTipStats(senderAddress, id);
        } catch (_) {
          tipStats = { totalTipMicroStx: '0', tipCount: '0' };
        }

        posts.push({
          ...post,
          likeCount: String(post.likeCount || '0'),
          hasLikedByViewer,
          totalTipMicroStx: String(tipStats.totalTipMicroStx || '0'),
          tipCount: String(tipStats.tipCount || '0')
        });
      } catch (err) {
        if (isRateLimitedError(err)) break;
        // Skip failed post reads to keep feed responsive.
      }
    }

    const viewerBalance = viewerAddress ? await fetchUserBalance(senderAddress, viewerAddress) : '';

    return {
      config,
      viewerBalance,
      posts
    };
  };

  const publishPost = async (contentHash) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    const response = await request('stx_callContract', {
      contract: `${socialAddress}.${socialName}`,
      functionName: 'publish-post',
      functionArgs: [Cl.stringAscii(contentHash)],
      postConditionMode: 'allow',
      network
    });

    cachedPostsById.clear();
    cachedHasLikedByKey.clear();
    cachedTipStatsByPostId.clear();
    inFlightPostById.clear();
    inFlightHasLikedByKey.clear();
    inFlightTipStatsByPostId.clear();
    return response;
  };

  const likePost = async (postId) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    const response = await request('stx_callContract', {
      contract: `${socialAddress}.${socialName}`,
      functionName: 'like-post',
      functionArgs: [Cl.uint(BigInt(postId))],
      postConditionMode: 'allow',
      network
    });

    cachedPostsById.delete(String(postId));
    cachedHasLikedByKey.clear();
    inFlightHasLikedByKey.clear();
    return response;
  };

  const tipPostStx = async ({ postId, amountMicroStx }) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    const response = await request('stx_callContract', {
      contract: `${tipsAddress}.${tipsName}`,
      functionName: 'tip-post',
      functionArgs: [Cl.uint(BigInt(postId)), Cl.uint(BigInt(amountMicroStx))],
      postConditionMode: 'allow',
      network
    });

    cachedTipStatsByPostId.delete(String(postId));
    inFlightTipStatsByPostId.delete(String(postId));
    return response;
  };

  return {
    fetchFeed,
    fetchLastPostId,
    publishPost,
    likePost,
    tipPostStx
  };
};

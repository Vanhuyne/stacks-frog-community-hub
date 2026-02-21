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

export const createFrogSocialService = ({ contractAddress, contractName, network, readOnlyBaseUrl }) => {
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
        await sleep(300 * (2 ** attempt));
      }
    }

    throw new Error('Read-only request failed unexpectedly.');
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
    const { Cl } = await loadTransactionsModule();
    const postRaw = await readOnly(senderAddress, 'get-post', [Cl.uint(BigInt(postId))]);
    const postTuple = normalizeObject(unwrapOptional(postRaw));
    if (!postTuple) return null;

    return {
      id: String(postId),
      author: stringifyClarityValue(getTupleField(postTuple, ['author'])),
      contentHash: stringifyClarityValue(getTupleField(postTuple, ['content-hash', 'content_hash', 'contentHash'])).toLowerCase(),
      createdAtBlock: stringifyClarityValue(getTupleField(postTuple, ['created-at', 'created_at', 'createdAt'])),
      likeCount: stringifyClarityValue(getTupleField(postTuple, ['like-count', 'like_count', 'likeCount']))
    };
  };

  const hasLiked = async (senderAddress, postId, who) => {
    if (!isLikelyPrincipal(who)) return false;
    const { Cl } = await loadTransactionsModule();
    const liked = await readOnly(senderAddress, 'has-liked', [Cl.uint(BigInt(postId)), Cl.standardPrincipal(who)]);
    return Boolean(liked);
  };

  const fetchUserBalance = async (senderAddress, who) => {
    if (!isLikelyPrincipal(who)) return '';
    const { Cl } = await loadTransactionsModule();
    const value = await readOnly(senderAddress, 'get-frog-balance', [Cl.standardPrincipal(who)]);
    return stringifyClarityValue(value);
  };

  const fetchFeed = async ({ senderAddress, viewerAddress, limit = 20 }) => {
    const config = await fetchConfig(senderAddress);
    const lastId = toSafeInt(config.lastPostId);

    if (lastId === 0) {
      const viewerBalance = viewerAddress ? await fetchUserBalance(senderAddress, viewerAddress) : '';
      return { config, viewerBalance, posts: [] };
    }

    const safeLimit = Math.min(30, Math.max(1, limit));
    const fromId = Math.max(1, lastId - safeLimit + 1);
    const posts = [];

    for (let id = lastId; id >= fromId; id -= 1) {
      try {
        const post = await fetchPost(senderAddress, id);
        if (!post) continue;

        let hasLikedByViewer = false;
        if (viewerAddress && isLikelyPrincipal(viewerAddress)) {
          hasLikedByViewer = await hasLiked(senderAddress, id, viewerAddress);
        }

        posts.push({
          ...post,
          likeCount: String(post.likeCount || '0'),
          hasLikedByViewer
        });
      } catch (_) {
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
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'publish-post',
      functionArgs: [Cl.stringAscii(contentHash)],
      postConditionMode: 'allow',
      network
    });
  };

  const likePost = async (postId) => {
    const { request } = await loadConnectModule();
    const { Cl } = await loadTransactionsModule();
    return request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'like-post',
      functionArgs: [Cl.uint(BigInt(postId))],
      postConditionMode: 'allow',
      network
    });
  };

  return {
    fetchFeed,
    fetchLastPostId,
    publishPost,
    likePost
  };
};

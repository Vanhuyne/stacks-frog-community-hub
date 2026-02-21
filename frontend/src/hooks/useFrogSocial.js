import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createFrogSocialService } from '../services/frogSocialService';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asciiRegex = /^[\x20-\x7E\n\r\t]+$/;
const linkRegex = /https?:\/\/[^\s)]+/gi;

const initialState = {
  postFee: '50',
  likeFee: '5',
  treasury: '',
  lastPostId: '0',
  viewerBalance: '',
  posts: [],
  status: '',
  isRefreshing: false,
  isPublishing: false,
  likingPostId: ''
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.payload };
    default:
      return state;
  }
};

const parseLinksFromText = (text) => {
  const links = String(text || '').match(linkRegex) || [];
  return [...new Set(links.map((item) => item.trim()))].slice(0, 10);
};

const joinHashesForQuery = (hashes) => {
  return hashes
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => item.length === 64)
    .join(',');
};

export const useFrogSocial = ({ contractAddress, contractName, network, readOnlyBaseUrl, address, enabled, apiBaseUrl }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const service = useMemo(
    () => createFrogSocialService({ contractAddress, contractName, network, readOnlyBaseUrl }),
    [contractAddress, contractName, network, readOnlyBaseUrl]
  );

  const ready = useMemo(
    () => enabled && contractAddress.length > 0 && contractName.length > 0,
    [enabled, contractAddress, contractName]
  );

  const fetchOffchainPostsByHashes = useCallback(async (hashes) => {
    if (!apiBaseUrl) return {};

    const hashesQuery = joinHashesForQuery(hashes);
    if (!hashesQuery) return {};

    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/posts/by-hash?hashes=${encodeURIComponent(hashesQuery)}`);
    if (!response.ok) throw new Error(`Off-chain post lookup failed (${response.status})`);

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !payload.posts || typeof payload.posts !== 'object') {
      return {};
    }
    return payload.posts;
  }, [apiBaseUrl]);

  const hydrateFeedWithOffchain = useCallback(async (feed) => {
    const hashes = (feed.posts || []).map((post) => post.contentHash);
    const postsByHash = await fetchOffchainPostsByHashes(hashes);

    const posts = (feed.posts || []).map((post) => {
      const offchain = postsByHash[String(post.contentHash || '').toLowerCase()];
      if (!offchain) {
        return {
          ...post,
          text: '[Off-chain content unavailable]',
          links: []
        };
      }

      return {
        ...post,
        text: String(offchain.text || ''),
        links: Array.isArray(offchain.links) ? offchain.links : []
      };
    });

    return {
      ...feed,
      posts
    };
  }, [fetchOffchainPostsByHashes]);

  const refresh = useCallback(async (limit = 20) => {
    if (!ready) return;

    const sender = address || contractAddress;
    dispatch({ type: 'merge', payload: { isRefreshing: true } });

    try {
      const feed = await service.fetchFeed({ senderAddress: sender, viewerAddress: address, limit });
      const hydrated = await hydrateFeedWithOffchain(feed);
      dispatch({
        type: 'merge',
        payload: {
          postFee: hydrated.config.postFee || '50',
          likeFee: hydrated.config.likeFee || '5',
          treasury: hydrated.config.treasury || '',
          lastPostId: hydrated.config.lastPostId || '0',
          viewerBalance: hydrated.viewerBalance || '',
          posts: hydrated.posts
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Social feed read failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isRefreshing: false } });
    }
  }, [address, contractAddress, hydrateFeedWithOffchain, ready, service]);

  const waitForFeedUpdate = useCallback(async (nextExpectedLastId = '') => {
    if (!ready) return;

    const sender = address || contractAddress;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const feed = await service.fetchFeed({ senderAddress: sender, viewerAddress: address, limit: 20 });
        const currentLastId = feed.config.lastPostId || '0';

        const shouldStop = nextExpectedLastId
          ? currentLastId === nextExpectedLastId || Number(currentLastId) >= Number(nextExpectedLastId)
          : true;

        if (shouldStop) {
          const hydrated = await hydrateFeedWithOffchain(feed);
          dispatch({
            type: 'merge',
            payload: {
              postFee: hydrated.config.postFee || '50',
              likeFee: hydrated.config.likeFee || '5',
              treasury: hydrated.config.treasury || '',
              lastPostId: currentLastId,
              viewerBalance: hydrated.viewerBalance || '',
              posts: hydrated.posts
            }
          });
          return;
        }
      } catch (_) {
        // Keep polling.
      }

      await sleep(3000);
    }

    await refresh(20);
  }, [address, contractAddress, hydrateFeedWithOffchain, ready, refresh, service]);

  const createOffchainPost = useCallback(async (text) => {
    if (!apiBaseUrl) {
      throw new Error('Missing VITE_SOCIAL_API_BASE_URL for off-chain post storage.');
    }

    const links = parseLinksFromText(text);
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, links })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Off-chain post create failed (${response.status}): ${body || 'unknown error'}`);
    }

    const payload = await response.json();
    const contentHash = String(payload?.contentHash || '').toLowerCase();
    if (!contentHash || contentHash.length !== 64) {
      throw new Error('Off-chain service returned invalid content hash.');
    }

    return contentHash;
  }, [apiBaseUrl]);

  const publish = useCallback(async (content) => {
    const text = String(content || '').trim();

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Connect wallet to publish a post.' } });
      return false;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing social contract configuration.' } });
      return false;
    }

    if (!text) {
      dispatch({ type: 'merge', payload: { status: 'Post content cannot be empty.' } });
      return false;
    }

    if (!asciiRegex.test(text)) {
      dispatch({ type: 'merge', payload: { status: 'Post content must use ASCII characters only.' } });
      return false;
    }

    if (text.length > 500) {
      dispatch({ type: 'merge', payload: { status: 'Post content is too long (max 500 chars).' } });
      return false;
    }

    const postFeeNum = Number(state.postFee || '50');
    const balanceNum = Number(state.viewerBalance || '0');
    if (Number.isFinite(postFeeNum) && Number.isFinite(balanceNum) && balanceNum < postFeeNum) {
      dispatch({ type: 'merge', payload: { status: `Not enough FROG. Publish requires ${state.postFee} FROG.` } });
      return false;
    }

    let expectedNextId = '';
    try {
      expectedNextId = (BigInt(state.lastPostId || '0') + 1n).toString();
    } catch (_) {
      expectedNextId = '';
    }

    dispatch({ type: 'merge', payload: { isPublishing: true, status: `Preparing off-chain content and submitting publish (fee ${state.postFee} FROG)...` } });

    try {
      const contentHash = await createOffchainPost(text);
      await service.publishPost(contentHash);
      dispatch({ type: 'merge', payload: { status: 'Publish submitted. Waiting for on-chain update...' } });
      await waitForFeedUpdate(expectedNextId);
      dispatch({ type: 'merge', payload: { status: 'Post published successfully.' } });
      return true;
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Publish failed: ${err?.message || err}` } });
      return false;
    } finally {
      dispatch({ type: 'merge', payload: { isPublishing: false } });
    }
  }, [address, createOffchainPost, ready, service, state.lastPostId, state.postFee, state.viewerBalance, waitForFeedUpdate]);

  const like = useCallback(async (postId) => {
    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Connect wallet to like a post.' } });
      return false;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing social contract configuration.' } });
      return false;
    }

    if (!postId) {
      dispatch({ type: 'merge', payload: { status: 'Invalid post ID.' } });
      return false;
    }

    const existing = state.posts.find((item) => item.id === String(postId));
    if (existing?.hasLikedByViewer) {
      dispatch({ type: 'merge', payload: { status: 'You already liked this post.' } });
      return false;
    }

    const likeFeeNum = Number(state.likeFee || '5');
    const balanceNum = Number(state.viewerBalance || '0');
    if (Number.isFinite(likeFeeNum) && Number.isFinite(balanceNum) && balanceNum < likeFeeNum) {
      dispatch({ type: 'merge', payload: { status: `Not enough FROG. Like requires ${state.likeFee} FROG.` } });
      return false;
    }

    dispatch({ type: 'merge', payload: { likingPostId: String(postId), status: `Submitting like transaction (fee ${state.likeFee} FROG)...` } });

    try {
      await service.likePost(postId);
      dispatch({ type: 'merge', payload: { status: 'Like submitted. Refreshing feed...' } });
      await waitForFeedUpdate();
      dispatch({ type: 'merge', payload: { status: 'Like recorded successfully.' } });
      return true;
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Like failed: ${err?.message || err}` } });
      return false;
    } finally {
      dispatch({ type: 'merge', payload: { likingPostId: '' } });
    }
  }, [address, ready, service, state.likeFee, state.posts, state.viewerBalance, waitForFeedUpdate]);

  useEffect(() => {
    refresh(20);
  }, [refresh]);

  return {
    ...state,
    ready,
    refresh,
    publish,
    like
  };
};

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { toast } from 'react-hot-toast';
import { createFrogSocialService } from '../services/frogSocialService';

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
  return 10_000;
};
const linkRegex = /https?:\/\/[^\s)]+/gi;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

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

const resolveOffchainImageUrl = (value, apiBaseUrl) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('/')) return '';

  const baseUrl = String(apiBaseUrl || '').trim().replace(/\/$/, '');
  return baseUrl ? `${baseUrl}${raw}` : raw;
};

const normalizeOffchainImages = (images, apiBaseUrl) => {
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => resolveOffchainImageUrl(item, apiBaseUrl))
    .filter((item) => item.length > 0)
    .slice(0, 1);
};

const joinHashesForQuery = (hashes) => {
  return hashes
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => item.length === 64)
    .join(',');
};

export const useFrogSocial = ({ contractAddress, contractName, network, readOnlyBaseUrl, address, enabled, apiBaseUrl, hasDaoPass = false }) => {
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
          links: [],
          images: [],
          createdAtIso: ''
        };
      }

      return {
        ...post,
        text: String(offchain.text || ''),
        links: Array.isArray(offchain.links) ? offchain.links : [],
        images: normalizeOffchainImages(offchain.images, apiBaseUrl),
        createdAtIso: String(offchain.createdAt || '')
      };
    });

    return {
      ...feed,
      posts
    };
  }, [fetchOffchainPostsByHashes]);

  const refresh = useCallback(async (limit = 10) => {
    if (!ready) return;

    const sender = address || contractAddress;
    dispatch({ type: 'merge', payload: { isRefreshing: true } });

    try {
      let attempt = 0;
      const maxAttempts = 2;

      while (attempt < maxAttempts) {
        try {
          const feedLimit = attempt === 0 ? limit : Math.min(limit, 6);
          const feed = await service.fetchFeed({ senderAddress: sender, viewerAddress: address, limit: feedLimit });
          const hydrated = await hydrateFeedWithOffchain(feed);
          dispatch({
            type: 'merge',
            payload: {
              postFee: hydrated.config.postFee || '50',
              likeFee: hydrated.config.likeFee || '5',
              treasury: hydrated.config.treasury || '',
              lastPostId: hydrated.config.lastPostId || '0',
              viewerBalance: hydrated.viewerBalance || '',
              posts: hydrated.posts,
              status: attempt > 0 ? 'Social feed synced after rate-limit cooldown.' : ''
            }
          });
          return;
        } catch (err) {
          const isLastAttempt = attempt === maxAttempts - 1;
          if (!isRateLimitedError(err) || isLastAttempt) {
            if (isRateLimitedError(err)) {
              const waitMs = parseRateLimitWaitMs(err);
              const waitSec = Math.max(1, Math.round(waitMs / 1000));
              dispatch({
                type: 'merge',
                payload: { status: `Hiro API đang quá tải (429). Vui lòng thử lại sau khoảng ${waitSec} giây.` }
              });
            } else {
              dispatch({ type: 'merge', payload: { status: `Social feed read failed: ${err?.message || err}` } });
            }
            return;
          }

          const waitMs = parseRateLimitWaitMs(err);
          const waitSec = Math.max(1, Math.round(waitMs / 1000));
          dispatch({
            type: 'merge',
            payload: { status: `Hiro API đang giới hạn request. Tự động thử lại sau ${waitSec} giây...` }
          });
          await sleep(waitMs);
        }

        attempt += 1;
      }
    } finally {
      dispatch({ type: 'merge', payload: { isRefreshing: false } });
    }
  }, [address, contractAddress, hydrateFeedWithOffchain, ready, service]);

  const waitForFeedUpdate = useCallback(async (nextExpectedLastId = '') => {
    if (!ready) return;

    const sender = address || contractAddress;

    if (!nextExpectedLastId) {
      await refresh(10);
      return true;
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const currentLastId = await service.fetchLastPostId(sender);
        const shouldStop = currentLastId === nextExpectedLastId || Number(currentLastId) >= Number(nextExpectedLastId);
        if (shouldStop) {
          await refresh(10);
          return true;
        }
      } catch (_) {
        // Keep polling the light read-only endpoint.
      }

      await sleep(5000);
    }

    await refresh(10);
    return false;
  }, [address, contractAddress, ready, refresh, service]);

  const createOffchainPost = useCallback(async (text, imageFile = null) => {
    if (!apiBaseUrl) {
      throw new Error('Missing VITE_SOCIAL_API_BASE_URL for off-chain post storage.');
    }

    if (imageFile) {
      const mime = String(imageFile.type || '').toLowerCase();
      if (!mime.startsWith('image/')) {
        throw new Error('Only image files are allowed.');
      }
      if (Number(imageFile.size || 0) > MAX_IMAGE_SIZE) {
        throw new Error('Image is too large (max 5MB).');
      }
    }

    const links = parseLinksFromText(text);
    const formData = new FormData();
    formData.append('text', text);
    formData.append('links', JSON.stringify(links));
    if (imageFile) {
      formData.append('image', imageFile);
    }

    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/posts`, {
      method: 'POST',
      body: formData
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

  const deleteOffchainPost = useCallback(async (contentHash) => {
    if (!apiBaseUrl) return;
    const hash = String(contentHash || '').toLowerCase();
    if (hash.length !== 64) return;

    try {
      await fetch(`${apiBaseUrl.replace(/\/$/, '')}/posts/${encodeURIComponent(hash)}`, { method: 'DELETE' });
    } catch (_) {
      // Best-effort cleanup for failed on-chain publish.
    }
  }, [apiBaseUrl]);

  const publish = useCallback(async (content, imageFile = null) => {
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

    if (!hasDaoPass) {
      const message = 'DAO Pass is required to publish posts. Go to the Frog DAO Pass tab to mint your pass first.';
      dispatch({ type: 'merge', payload: { status: message } });
      toast.error('DAO Pass required. Open Frog DAO Pass tab first.');
      return false;
    }

    if (text.length > 500) {
      dispatch({ type: 'merge', payload: { status: 'Post content is too long (max 500 chars).' } });
      return false;
    }

    const postFeeNum = Number(state.postFee || '50');
    const balanceNum = Number(state.viewerBalance || '0');
    if (Number.isFinite(postFeeNum) && Number.isFinite(balanceNum) && balanceNum < postFeeNum) {
      const message = `Not enough FROG. Publish requires ${state.postFee} FROG. Go to the Faucet tab to claim more FROG.`;
      dispatch({ type: 'merge', payload: { status: message } });
      toast.error('Not enough FROG. Open Faucet tab to claim more.');
      return false;
    }

    let expectedNextId = '';
    try {
      expectedNextId = (BigInt(state.lastPostId || '0') + 1n).toString();
    } catch (_) {
      expectedNextId = '';
    }

    dispatch({ type: 'merge', payload: { isPublishing: true, status: `Preparing off-chain content and submitting publish (fee ${state.postFee} FROG)...` } });

    let contentHash = '';

    try {
      contentHash = await createOffchainPost(text, imageFile);
      await service.publishPost(contentHash);
      dispatch({ type: 'merge', payload: { status: 'Publish submitted. Waiting for on-chain update...' } });
      const synced = await waitForFeedUpdate(expectedNextId);
      const nextStatus = synced
        ? 'Post published successfully.'
        : 'Transaction submitted. Testnet confirmation may take a few minutes. Use Refresh to sync.';

      dispatch({
        type: 'merge',
        payload: { status: nextStatus }
      });

      if (synced) {
        toast.success('Post published successfully.');
      } else {
        toast('Transaction submitted. Confirmation may take a few minutes.');
      }

      return true;
    } catch (err) {
      if (contentHash) await deleteOffchainPost(contentHash);
      const errorMessage = String(err?.message || err || 'Unknown error');
      dispatch({ type: 'merge', payload: { status: `Publish failed: ${errorMessage}` } });
      toast.error('Post publish failed. Please try again.');
      return false;
    } finally {
      dispatch({ type: 'merge', payload: { isPublishing: false } });
    }
  }, [address, createOffchainPost, deleteOffchainPost, hasDaoPass, ready, service, state.lastPostId, state.postFee, state.viewerBalance, waitForFeedUpdate]);

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

    if (!hasDaoPass) {
      const message = 'DAO Pass is required to like posts. Go to the Frog DAO Pass tab to mint your pass first.';
      dispatch({ type: 'merge', payload: { status: message } });
      toast.error('DAO Pass required. Open Frog DAO Pass tab first.');
      return false;
    }

    const existing = state.posts.find((item) => item.id === String(postId));
    if (existing && String(existing.author || '') === String(address)) {
      dispatch({ type: 'merge', payload: { status: 'You cannot like your own post.' } });
      return false;
    }
    if (existing?.hasLikedByViewer) {
      dispatch({ type: 'merge', payload: { status: 'You already liked this post.' } });
      return false;
    }

    const likeFeeNum = Number(state.likeFee || '5');
    const balanceNum = Number(state.viewerBalance || '0');
    if (Number.isFinite(likeFeeNum) && Number.isFinite(balanceNum) && balanceNum < likeFeeNum) {
      const message = `Not enough FROG. Like requires ${state.likeFee} FROG. Go to the Faucet tab to claim more FROG.`;
      dispatch({ type: 'merge', payload: { status: message } });
      toast.error('Not enough FROG. Open Faucet tab to claim more.');
      return false;
    }

    dispatch({ type: 'merge', payload: { likingPostId: String(postId), status: `Submitting like transaction (fee ${state.likeFee} FROG)...` } });

    try {
      await service.likePost(postId);
      dispatch({ type: 'merge', payload: { status: 'Like submitted. Refreshing feed...' } });
      const synced = await waitForFeedUpdate();
      dispatch({
        type: 'merge',
        payload: {
          status: synced
            ? 'Like recorded successfully.'
            : 'Like submitted. Testnet confirmation may take a few minutes. Use Refresh to sync.'
        }
      });
      return true;
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Like failed: ${err?.message || err}` } });
      return false;
    } finally {
      dispatch({ type: 'merge', payload: { likingPostId: '' } });
    }
  }, [address, hasDaoPass, ready, service, state.likeFee, state.posts, state.viewerBalance, waitForFeedUpdate]);

  useEffect(() => {
    refresh(10);
  }, [refresh]);

  return {
    ...state,
    ready,
    refresh,
    publish,
    like
  };
};

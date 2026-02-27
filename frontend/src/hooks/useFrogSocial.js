import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
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
const isDocumentHidden = () => typeof document !== 'undefined' && Boolean(document.hidden);
const REFRESH_DEBOUNCE_MS = 1500;
const FEED_POLL_INTERVAL_MS = 30000;
const VISIBILITY_REFRESH_STALE_MS = 25000;
const VISIBILITY_REFRESH_JITTER_MAX_MS = 400;

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
  likingPostId: '',
  tippingPostId: ''
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

const toMicroStx = (amountStx) => {
  const raw = String(amountStx || '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return null;

  const [whole, frac = ''] = raw.split('.');
  const wholePart = BigInt(whole || '0') * 1000000n;
  const fracPart = BigInt((frac + '000000').slice(0, 6));
  const micro = wholePart + fracPart;
  return micro > 0n ? micro.toString() : null;
};

const addMicroStx = (left, right) => {
  try {
    const a = BigInt(String(left || '0'));
    const b = BigInt(String(right || '0'));
    return (a + b).toString();
  } catch (_) {
    return String(left || '0');
  }
};

const normalizeTxId = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : '';
};

const extractTxId = (result) => {
  const candidates = [
    result?.txid,
    result?.txId,
    result?.tx_id,
    result?.result?.txid,
    result?.result?.txId,
    result?.result?.tx_id,
    result
  ];

  for (const value of candidates) {
    const txid = normalizeTxId(value);
    if (txid) return txid;
  }

  return '';
};

export const useFrogSocial = ({ contractAddress, contractName, tipsContractAddress, tipsContractName, network, readOnlyBaseUrl, address, enabled, apiBaseUrl, hasDaoPass = false, tipAmountStx = '0.1' }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const refreshInFlightRef = useRef(null);
  const lastRefreshAtRef = useRef(0);
  const lastSuccessfulRefreshAtRef = useRef(0);
  const optimisticLikedPostIdsRef = useRef(new Set());

  const service = useMemo(
    () => createFrogSocialService({ contractAddress, contractName, tipsContractAddress, tipsContractName, network, readOnlyBaseUrl }),
    [contractAddress, contractName, tipsContractAddress, tipsContractName, network, readOnlyBaseUrl]
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

  const applyOptimisticLikes = useCallback((posts) => {
    const list = Array.isArray(posts) ? posts : [];
    const optimisticSet = optimisticLikedPostIdsRef.current;

    if (!(optimisticSet instanceof Set) || optimisticSet.size === 0) return list;

    let changed = false;

    const next = list.map((post) => {
      const id = String(post?.id || '');
      if (!optimisticSet.has(id)) return post;

      if (post?.hasLikedByViewer) {
        optimisticSet.delete(id);
        return post;
      }

      changed = true;
      const likeCountNum = Number.parseInt(String(post?.likeCount || '0'), 10) || 0;
      return {
        ...post,
        hasLikedByViewer: true,
        likeCount: String(likeCountNum + 1)
      };
    });

    return changed ? next : list;
  }, []);

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
          createdAtIso: '',
          totalTipMicroStx: '0',
          tipCount: 0
        };
      }

      return {
        ...post,
        text: String(offchain.text || ''),
        links: Array.isArray(offchain.links) ? offchain.links : [],
        images: normalizeOffchainImages(offchain.images, apiBaseUrl),
        createdAtIso: String(offchain.createdAt || ''),
        totalTipMicroStx: String(post.totalTipMicroStx || '0'),
        tipCount: Number.parseInt(String(post.tipCount || 0), 10) || 0
      };
    });

    return {
      ...feed,
      posts
    };
  }, [fetchOffchainPostsByHashes]);

  const refresh = useCallback(async (limit = 10) => {
    if (!ready) return;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const sender = address || contractAddress;

    const runRefresh = (async () => {
      dispatch({ type: 'merge', payload: { isRefreshing: true } });

      try {
        let attempt = 0;
        const maxAttempts = 2;

        while (attempt < maxAttempts) {
          try {
            const feedLimit = attempt === 0 ? limit : Math.min(limit, 6);
            const feed = await service.fetchFeed({ senderAddress: sender, viewerAddress: address, limit: feedLimit });
            const hydrated = await hydrateFeedWithOffchain(feed);
            const posts = applyOptimisticLikes(hydrated.posts);
            dispatch({
              type: 'merge',
              payload: {
                postFee: hydrated.config.postFee || '50',
                likeFee: hydrated.config.likeFee || '5',
                treasury: hydrated.config.treasury || '',
                lastPostId: hydrated.config.lastPostId || '0',
                viewerBalance: hydrated.viewerBalance || '',
                posts,
                status: attempt > 0 ? 'Social feed synced after rate-limit cooldown.' : ''
              }
            });
            return { ...hydrated, posts };
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
              return null;
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
    })();

    refreshInFlightRef.current = runRefresh;
    try {
      return await runRefresh;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [address, applyOptimisticLikes, contractAddress, hydrateFeedWithOffchain, ready, service]);

  const hasPendingSocialAction = state.isPublishing || Boolean(state.likingPostId) || Boolean(state.tippingPostId);

  const refreshSmart = useCallback(async (limit = 10, { force = false, minStaleMs = 0, skipIfActionLocked = false } = {}) => {
    if (skipIfActionLocked && hasPendingSocialAction) return null;

    const now = Date.now();

    if (!force) {
      const elapsed = now - lastRefreshAtRef.current;
      if (elapsed < REFRESH_DEBOUNCE_MS) return null;

      if (minStaleMs > 0) {
        const elapsedSinceSuccess = now - lastSuccessfulRefreshAtRef.current;
        if (elapsedSinceSuccess < minStaleMs) return null;
      }
    }

    lastRefreshAtRef.current = now;
    const result = await refresh(limit);
    if (result) lastSuccessfulRefreshAtRef.current = Date.now();
    return result;
  }, [hasPendingSocialAction, refresh]);

  const waitForFeedUpdate = useCallback(async (nextExpectedLastId = '') => {
    if (!ready) return;

    const sender = address || contractAddress;

    if (!nextExpectedLastId) {
      await refresh(10);
      return true;
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (isDocumentHidden()) {
        await sleep(3000);
        continue;
      }

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

  const createOffchainTipReceipt = useCallback(async ({ contentHash, postId, amountMicroStx, txid }) => {
    if (!apiBaseUrl) {
      throw new Error('Missing VITE_SOCIAL_API_BASE_URL for off-chain tip sync.');
    }

    const baseUrl = apiBaseUrl.replace(/\/$/, '');
    const response = await fetch(baseUrl + '/tips', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contentHash: String(contentHash || '').toLowerCase(),
        postId: String(postId || ''),
        amountMicroStx: String(amountMicroStx || ''),
        txid: String(txid || '').toLowerCase()
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error('Off-chain tip sync failed (' + response.status + '): ' + (body || 'unknown error'));
    }

    return response.json();
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
      const message = 'Post vượt quá 500 ký tự (tối đa 500).';
      dispatch({ type: 'merge', payload: { status: message } });
      toast.error('Post vượt quá 500 ký tự.');
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
      const isPostTooLongError = /max length is 500|text max length is 500|too long|max 500 chars|500 characters/i.test(errorMessage);

      if (isPostTooLongError) {
        dispatch({ type: 'merge', payload: { status: 'Post vượt quá 500 ký tự (tối đa 500).' } });
        toast.error('Post vượt quá 500 ký tự.');
      } else {
        dispatch({ type: 'merge', payload: { status: `Publish failed: ${errorMessage}` } });
        toast.error('Post publish failed. Please try again.');
      }
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
    const optimisticLiked = optimisticLikedPostIdsRef.current.has(String(postId));
    if (existing?.hasLikedByViewer || optimisticLiked) {
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
      optimisticLikedPostIdsRef.current.add(String(postId));

      const optimisticPosts = state.posts.map((item) => {
        if (String(item.id) !== String(postId)) return item;
        const currentLike = Number.parseInt(String(item.likeCount || '0'), 10) || 0;
        return {
          ...item,
          hasLikedByViewer: true,
          likeCount: String(item.hasLikedByViewer ? currentLike : currentLike + 1)
        };
      });

      const likeFeeNumForBalance = Number(state.likeFee || '0');
      const viewerBalanceNum = Number(state.viewerBalance || '0');
      const optimisticViewerBalance = (Number.isFinite(likeFeeNumForBalance) && Number.isFinite(viewerBalanceNum))
        ? String(Math.max(0, viewerBalanceNum - likeFeeNumForBalance))
        : state.viewerBalance;

      dispatch({
        type: 'merge',
        payload: {
          posts: optimisticPosts,
          viewerBalance: optimisticViewerBalance,
          status: 'Like submitted. Syncing feed...'
        }
      });

      let synced = false;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const feed = await refresh(10);
        const target = (feed?.posts || []).find((item) => String(item.id) === String(postId));
        if (target?.hasLikedByViewer) {
          synced = true;
          break;
        }
        await sleep(3000);
      }

      dispatch({
        type: 'merge',
        payload: {
          status: synced
            ? 'Like recorded successfully.'
            : 'Like submitted. Indexer sync may take a bit; pull-to-refresh if needed.'
        }
      });
      return true;
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Like failed: ${err?.message || err}` } });
      return false;
    } finally {
      dispatch({ type: 'merge', payload: { likingPostId: '' } });
    }
  }, [address, hasDaoPass, ready, refresh, service, state.likeFee, state.posts, state.viewerBalance]);

  const tipPost = useCallback(async (postId, recipient) => {
    if (!address) {
      return { ok: false, tone: 'error', message: 'Connect wallet to tip a post.' };
    }

    if (!ready) {
      return { ok: false, tone: 'error', message: 'Missing social contract configuration.' };
    }

    if (!postId || !recipient) {
      return { ok: false, tone: 'error', message: 'Invalid tip target.' };
    }

    if (!hasDaoPass) {
      toast.error('DAO Pass required. Open Frog DAO Pass tab first.');
      return {
        ok: false,
        tone: 'error',
        message: 'DAO Pass is required to tip posts. Go to the Frog DAO Pass tab to mint your pass first.'
      };
    }

    if (String(recipient) === String(address)) {
      return { ok: false, tone: 'error', message: 'You cannot tip your own post.' };
    }

    const targetPost = state.posts.find((item) => String(item.id) === String(postId));
    const contentHash = String(targetPost?.contentHash || '').toLowerCase();
    if (!targetPost || !/^[0-9a-f]{64}$/.test(contentHash)) {
      return { ok: false, tone: 'error', message: 'Post data unavailable for tip sync. Please refresh and try again.' };
    }

    const microAmount = toMicroStx(tipAmountStx);
    if (!microAmount) {
      toast.error('Invalid tip amount configuration.');
      return { ok: false, tone: 'error', message: 'Invalid tip amount configuration.' };
    }

    dispatch({
      type: 'merge',
      payload: {
        tippingPostId: String(postId)
      }
    });

    try {
      const onchainResult = await service.tipPostStx({ postId, amountMicroStx: microAmount });
      const txid = extractTxId(onchainResult);
      if (!txid) {
        throw new Error('Tip tx submitted but frontend could not extract txid for /tips sync.');
      }

      let offchainReceipt = null;
      let offchainSyncError = '';
      try {
        offchainReceipt = await createOffchainTipReceipt({
          contentHash,
          postId: String(postId),
          amountMicroStx: microAmount,
          txid
        });
      } catch (err) {
        offchainSyncError = String(err?.message || err || 'Unknown off-chain sync error');
      }

      dispatch({
        type: 'merge',
        payload: {
          posts: state.posts.map((item) => {
            if (String(item.id) !== String(postId)) return item;

            if (offchainReceipt && offchainReceipt.totalTipMicroStx !== undefined) {
              return {
                ...item,
                totalTipMicroStx: String(offchainReceipt.totalTipMicroStx || '0'),
                tipCount: String(offchainReceipt.tipCount || '0')
              };
            }

            return {
              ...item,
              totalTipMicroStx: addMicroStx(item.totalTipMicroStx || '0', microAmount),
              tipCount: String((Number.parseInt(String(item.tipCount || '0'), 10) || 0) + 1)
            };
          })
        }
      });

      if (offchainSyncError) {
        toast.success('Tip sent: ' + tipAmountStx + ' STX');
        return {
          ok: true,
          tone: 'warning',
          message: 'Tip sent (' + tipAmountStx + ' STX). On-chain success, off-chain sync pending.'
        };
      }

      toast.success('Tip sent and synced: ' + tipAmountStx + ' STX');
      return { ok: true, tone: 'success', message: 'Tip sent (' + tipAmountStx + ' STX) and synced.' };
    } catch (err) {
      const message = String(err?.message || err || 'Unknown error');
      toast.error('Tip transaction failed.');
      return { ok: false, tone: 'error', message: 'Tip failed: ' + message };
    } finally {
      dispatch({ type: 'merge', payload: { tippingPostId: '' } });
    }
  }, [address, createOffchainTipReceipt, hasDaoPass, ready, service, state.posts, tipAmountStx]);

  useEffect(() => {
    if (isDocumentHidden()) return;
    refreshSmart(10, { force: true });
  }, [refreshSmart]);

  useEffect(() => {
    optimisticLikedPostIdsRef.current.clear();
  }, [address, contractAddress, contractName, network]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    let visibilityTimer = null;

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (hasPendingSocialAction) return;

      if (visibilityTimer) clearTimeout(visibilityTimer);
      const jitterMs = Math.floor(Math.random() * VISIBILITY_REFRESH_JITTER_MAX_MS);

      visibilityTimer = setTimeout(() => {
        refreshSmart(10, {
          minStaleMs: VISIBILITY_REFRESH_STALE_MS,
          skipIfActionLocked: true
        });
      }, jitterMs);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (visibilityTimer) clearTimeout(visibilityTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasPendingSocialAction, refreshSmart]);

  useEffect(() => {
    if (!ready) return undefined;

    const interval = setInterval(() => {
      if (isDocumentHidden()) return;
      refreshSmart(10, { skipIfActionLocked: true });
    }, FEED_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [ready, refreshSmart]);

  return {
    ...state,
    ready,
    refresh,
    publish,
    like,
    tipPost
  };
};

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createFrogSocialService } from '../services/frogSocialService';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asciiRegex = /^[\x20-\x7E\n\r\t]+$/;

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

export const useFrogSocial = ({ contractAddress, contractName, network, readOnlyBaseUrl, address, enabled }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const service = useMemo(
    () => createFrogSocialService({ contractAddress, contractName, network, readOnlyBaseUrl }),
    [contractAddress, contractName, network, readOnlyBaseUrl]
  );

  const ready = useMemo(
    () => enabled && contractAddress.length > 0 && contractName.length > 0,
    [enabled, contractAddress, contractName]
  );

  const refresh = useCallback(async (limit = 20) => {
    if (!ready) return;

    const sender = address || contractAddress;
    dispatch({ type: 'merge', payload: { isRefreshing: true } });

    try {
      const feed = await service.fetchFeed({ senderAddress: sender, viewerAddress: address, limit });
      dispatch({
        type: 'merge',
        payload: {
          postFee: feed.config.postFee || '50',
          likeFee: feed.config.likeFee || '5',
          treasury: feed.config.treasury || '',
          lastPostId: feed.config.lastPostId || '0',
          viewerBalance: feed.viewerBalance || '',
          posts: feed.posts
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Social feed read failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isRefreshing: false } });
    }
  }, [address, contractAddress, ready, service]);

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
          dispatch({
            type: 'merge',
            payload: {
              postFee: feed.config.postFee || '50',
              likeFee: feed.config.likeFee || '5',
              treasury: feed.config.treasury || '',
              lastPostId: currentLastId,
              viewerBalance: feed.viewerBalance || '',
              posts: feed.posts
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
  }, [address, contractAddress, ready, refresh, service]);

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

    dispatch({ type: 'merge', payload: { isPublishing: true, status: `Submitting publish transaction (fee ${state.postFee} FROG)...` } });

    try {
      await service.publishPost(text);
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
  }, [address, ready, service, state.lastPostId, state.postFee, state.viewerBalance, waitForFeedUpdate]);

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

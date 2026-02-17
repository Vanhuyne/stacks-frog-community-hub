import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createFrogDaoNftService } from '../services/frogDaoNftService';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asciiRegex = /^[\x20-\x7E]+$/;

const initialState = {
  frogBalance: '',
  username: '',
  usernameInput: '',
  hasPass: false,
  passId: '',
  eligible: false,
  status: ''
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.payload };
    default:
      return state;
  }
};

export const useFrogDaoNft = ({ contractAddress, contractName, network, readOnlyBaseUrl, address, enabled }) => {
  const debug = import.meta.env.DEV;
  const [state, dispatch] = useReducer(reducer, initialState);

  const service = useMemo(
    () => createFrogDaoNftService({ contractAddress, contractName, network, readOnlyBaseUrl }),
    [contractAddress, contractName, network, readOnlyBaseUrl]
  );

  const ready = useMemo(
    () => enabled && contractAddress.length > 0 && contractName.length > 0,
    [enabled, contractAddress, contractName]
  );

  const refresh = useCallback(async () => {
    if (!ready || !address) return;
    try {
      const snapshot = await service.fetchDaoSnapshot(address);
      if (debug) console.log('[DAO NFT] snapshot:', snapshot);
      dispatch({ type: 'merge', payload: snapshot });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Read data failed: ${err?.message || err}` } });
    }
  }, [address, ready, service, debug]);

  const syncUntil = useCallback(
    async (predicate) => {
      if (!ready || !address) return false;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const snapshot = await service.fetchDaoSnapshot(address);
          if (debug) console.log('[DAO NFT] snapshot:', snapshot);
          dispatch({ type: 'merge', payload: snapshot });
          if (predicate(snapshot)) return true;
        } catch (_) {
          // keep polling
        }

        await sleep(4000);
      }

      return false;
    },
    [address, ready, service, debug]
  );

  const setUsernameInput = useCallback((usernameInput) => {
    dispatch({ type: 'merge', payload: { usernameInput } });
  }, []);

  const registerUsername = useCallback(async () => {
    const name = (state.usernameInput || '').trim();

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    if (!name) {
      dispatch({ type: 'merge', payload: { status: 'Username is required.' } });
      return;
    }

    if (!asciiRegex.test(name)) {
      dispatch({ type: 'merge', payload: { status: 'Username must contain ASCII characters only.' } });
      return;
    }

    if (name.length > 32) {
      dispatch({ type: 'merge', payload: { status: 'Username must be 32 characters or fewer.' } });
      return;
    }

    if (state.username) {
      dispatch({ type: 'merge', payload: { status: `This wallet already registered username: ${state.username}` } });
      return;
    }

    try {
      const owner = await service.getOwnerByUsername(address, name);
      if (owner && owner !== address) {
        dispatch({ type: 'merge', payload: { status: `Username "${name}" is already taken.` } });
        return;
      }
      if (owner && owner === address) {
        dispatch({ type: 'merge', payload: { status: `Username "${name}" is already owned by this wallet.` } });
        await refresh();
        return;
      }
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Cannot verify username availability: ${err?.message || err}` } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting username registration...' } });
    try {
      await service.registerUsername(name);
      dispatch({ type: 'merge', payload: { status: 'Transaction submitted. Waiting for confirmation...' } });

      const synced = await syncUntil((snapshot) => snapshot.username.length > 0);
      dispatch({
        type: 'merge',
        payload: {
          status: synced ? 'Username registered.' : 'Username submitted. On-chain data is still syncing.'
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Register username failed: ${err?.message || err}` } });
    }
  }, [address, ready, refresh, service, state.username, state.usernameInput, syncUntil]);

  const mintPass = useCallback(async () => {
    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting DAO pass mint...' } });
    try {
      await service.mintPass();
      dispatch({ type: 'merge', payload: { status: 'Transaction submitted. Waiting for confirmation...' } });

      const synced = await syncUntil((snapshot) => snapshot.hasPass === true);
      dispatch({
        type: 'merge',
        payload: {
          status: synced ? 'DAO pass minted.' : 'Mint submitted. On-chain data is still syncing.'
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Mint failed: ${err?.message || err}` } });
    }
  }, [address, ready, service, syncUntil]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state.username) return;

    console.log('[DAO NFT] username:', state.username);
  }, [state.username]);

  return {
    ...state,
    ready,
    refresh,
    setUsernameInput,
    registerUsername,
    mintPass
  };
};

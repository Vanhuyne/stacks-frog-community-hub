import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createFrogContractService } from '../services/frogContractService';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LAST_CONNECTED_WALLET_KEY = 'frog:last-connected-wallet';

const initialState = {
  address: '',
  balance: '',
  nextClaimBlock: '',
  canClaim: true,
  owner: '',
  faucetAmount: '1000',
  cooldownBlocks: '144',
  faucetPaused: false,
  tokenImage: '',
  tokenDisplayName: '',
  tokenUri: '',
  status: '',
  recipient: '',
  amount: '',
  adminAmountInput: '',
  adminCooldownInput: '',
  isConnecting: false,
  isClaiming: false,
  isTransferring: false,
  isUpdatingAdmin: false
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.payload };
    case 'resetWallet':
      return {
        ...state,
        address: '',
        balance: '',
        nextClaimBlock: '',
        canClaim: true,
        owner: '',
        faucetAmount: '1000',
        cooldownBlocks: '144',
        faucetPaused: false,
        tokenImage: '',
        tokenDisplayName: '',
        tokenUri: '',
        adminAmountInput: '',
        adminCooldownInput: '',
        isConnecting: false,
        isClaiming: false,
        isTransferring: false,
        isUpdatingAdmin: false
      };
    default:
      return state;
  }
};

export const useFrogFaucet = ({ contractAddress, contractName, network, readOnlyBaseUrl, appName }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const service = useMemo(
    () => createFrogContractService({ contractAddress, contractName, network, readOnlyBaseUrl }),
    [contractAddress, contractName, network, readOnlyBaseUrl]
  );

  const ready = useMemo(() => contractAddress.length > 0, [contractAddress]);

  const refreshData = useCallback(
    async (targetAddress = state.address) => {
      if (!ready || !targetAddress) return;
      try {
        const snapshot = await service.fetchFaucetSnapshot(targetAddress);
        dispatch({ type: 'merge', payload: snapshot });
      } catch (err) {
        dispatch({ type: 'merge', payload: { status: `Read data failed: ${err?.message || err}` } });
      }
    },
    [ready, service, state.address]
  );

  const syncAfterClaim = useCallback(
    async (targetAddress) => {
      if (!ready || !targetAddress) return false;

      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const snapshot = await service.fetchFaucetSnapshot(targetAddress);
          dispatch({ type: 'merge', payload: snapshot });
          if (snapshot.canClaim === false) {
            return true;
          }
        } catch (_) {
          // Keep polling until transaction result is reflected on-chain.
        }

        await sleep(4000);
      }

      return false;
    },
    [ready, service]
  );

  const connectWallet = useCallback(async () => {
    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing contract configuration.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Connecting wallet...', isConnecting: true } });
    try {
      const address = await service.connectWallet({ name: appName });
      if (!address) {
        dispatch({ type: 'merge', payload: { status: 'Could not load wallet address.' } });
        return;
      }

      try {
        localStorage.setItem(LAST_CONNECTED_WALLET_KEY, address);
      } catch (_) {
        // Ignore storage write errors (private mode, disabled storage, etc.).
      }

      dispatch({ type: 'merge', payload: { address, status: 'Wallet connected.' } });
      await refreshData(address);
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Connection failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isConnecting: false } });
    }
  }, [appName, ready, refreshData, service]);

  const disconnectWallet = useCallback(() => {
    service.disconnectWallet();
    try {
      localStorage.removeItem(LAST_CONNECTED_WALLET_KEY);
    } catch (_) {
      // Ignore storage remove errors.
    }
    dispatch({ type: 'resetWallet' });
    dispatch({ type: 'merge', payload: { status: 'Disconnected.' } });
  }, [service]);

  const claim = useCallback(async () => {
    if (state.isClaiming) return;

    if (state.faucetPaused) {
      dispatch({ type: 'merge', payload: { status: 'Faucet is paused by admin. Please try again later.' } });
      return;
    }

    if (!state.canClaim) {
      dispatch({
        type: 'merge',
        payload: {
          status: `Cooldown not reached yet. Wait until block ${state.nextClaimBlock || '-'}.`
        }
      });
      return;
    }

    if (!state.address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting claim...', isClaiming: true } });
    try {
      await service.claim();
      dispatch({
        type: 'merge',
        payload: {
          canClaim: false,
          status: 'Claim transaction submitted. Waiting for confirmation...'
        }
      });

      const synced = await syncAfterClaim(state.address);
      dispatch({
        type: 'merge',
        payload: {
          status: synced
            ? 'Claim confirmed. 24h cooldown started.'
            : 'Claim submitted. On-chain data is still syncing.'
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Claim failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isClaiming: false } });
    }
  }, [service, state.address, state.canClaim, state.faucetPaused, state.isClaiming, state.nextClaimBlock, syncAfterClaim]);

  const transfer = useCallback(async () => {
    if (state.isTransferring || !state.address || !state.recipient || !state.amount) return;

    dispatch({ type: 'merge', payload: { status: 'Submitting transfer...', isTransferring: true } });
    try {
      await service.transfer({
        amount: state.amount,
        sender: state.address,
        recipient: state.recipient
      });
      dispatch({ type: 'merge', payload: { status: 'Transfer transaction submitted.' } });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Transfer failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isTransferring: false } });
    }
  }, [service, state.address, state.amount, state.recipient, state.isTransferring]);

  const setRecipient = useCallback((recipient) => {
    dispatch({ type: 'merge', payload: { recipient } });
  }, []);

  const setAmount = useCallback((amount) => {
    dispatch({ type: 'merge', payload: { amount } });
  }, []);

  const setAdminAmountInput = useCallback((adminAmountInput) => {
    dispatch({ type: 'merge', payload: { adminAmountInput } });
  }, []);

  const setAdminCooldownInput = useCallback((adminCooldownInput) => {
    dispatch({ type: 'merge', payload: { adminCooldownInput } });
  }, []);

  const setPauseState = useCallback(async (paused) => {
    if (state.isUpdatingAdmin || !state.address) return;

    dispatch({ type: 'merge', payload: { isUpdatingAdmin: true, status: `Submitting ${paused ? 'pause' : 'unpause'}...` } });
    try {
      await service.setFaucetPaused(paused);
      dispatch({ type: 'merge', payload: { status: `Admin transaction submitted (${paused ? 'paused' : 'active'}).` } });
      await sleep(3500);
      await refreshData(state.address);
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Admin action failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isUpdatingAdmin: false } });
    }
  }, [refreshData, service, state.address, state.isUpdatingAdmin]);

  const updateFaucetAmount = useCallback(async () => {
    if (state.isUpdatingAdmin || !state.address || !state.adminAmountInput) return;
    const nextAmount = Number(state.adminAmountInput);
    if (!Number.isInteger(nextAmount) || nextAmount <= 0) {
      dispatch({ type: 'merge', payload: { status: 'Amount must be a positive integer.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { isUpdatingAdmin: true, status: 'Submitting faucet amount update...' } });
    try {
      await service.setFaucetAmount(state.adminAmountInput);
      dispatch({ type: 'merge', payload: { status: 'Amount update submitted.' } });
      await sleep(3500);
      await refreshData(state.address);
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Set amount failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isUpdatingAdmin: false } });
    }
  }, [refreshData, service, state.address, state.adminAmountInput, state.isUpdatingAdmin]);

  const updateCooldownBlocks = useCallback(async () => {
    if (state.isUpdatingAdmin || !state.address || !state.adminCooldownInput) return;
    const nextCooldown = Number(state.adminCooldownInput);
    if (!Number.isInteger(nextCooldown) || nextCooldown <= 0) {
      dispatch({ type: 'merge', payload: { status: 'Cooldown must be a positive integer.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { isUpdatingAdmin: true, status: 'Submitting cooldown update...' } });
    try {
      await service.setCooldownBlocks(state.adminCooldownInput);
      dispatch({ type: 'merge', payload: { status: 'Cooldown update submitted.' } });
      await sleep(3500);
      await refreshData(state.address);
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Set cooldown failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isUpdatingAdmin: false } });
    }
  }, [refreshData, service, state.address, state.adminCooldownInput, state.isUpdatingAdmin]);

  useEffect(() => {
    if (!ready) return;

    let mounted = true;

    const restoreAddress = async () => {
      try {
        const localAddress = localStorage.getItem(LAST_CONNECTED_WALLET_KEY) || '';
        if (mounted && localAddress) {
          dispatch({ type: 'merge', payload: { address: localAddress } });
          return;
        }
      } catch (_) {
        // skip local fallback and continue with connector storage
      }

      try {
        const storedAddress = await service.getStoredAddress();
        if (mounted && storedAddress) {
          try {
            localStorage.setItem(LAST_CONNECTED_WALLET_KEY, storedAddress);
          } catch (_) {
            // Ignore storage write errors.
          }
          dispatch({ type: 'merge', payload: { address: storedAddress } });
        }
      } catch (_) {
        // skip: wallet state is unavailable until user connects
      }
    };

    restoreAddress();

    return () => {
      mounted = false;
    };
  }, [ready, service]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return {
    ...state,
    ready,
    connectWallet,
    disconnectWallet,
    claim,
    transfer,
    setRecipient,
    setAmount,
    setPauseState,
    updateFaucetAmount,
    updateCooldownBlocks,
    setAdminAmountInput,
    setAdminCooldownInput
  };
};

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { isConnected } from '@stacks/connect';
import { createFrogContractService } from '../services/frogContractService';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const initialState = {
  address: '',
  balance: '',
  nextClaimBlock: '',
  canClaim: true,
  faucetAmount: '1000',
  cooldownBlocks: '144',
  faucetPaused: false,
  status: '',
  recipient: '',
  amount: '',
  isConnecting: false,
  isClaiming: false,
  isTransferring: false
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
        faucetAmount: '1000',
        cooldownBlocks: '144',
        faucetPaused: false,
        isConnecting: false,
        isClaiming: false,
        isTransferring: false
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

  useEffect(() => {
    if (!ready) return;
    if (isConnected()) {
      const storedAddress = service.getStoredAddress();
      if (storedAddress) {
        dispatch({ type: 'merge', payload: { address: storedAddress } });
      }
    }
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
    setAmount
  };
};

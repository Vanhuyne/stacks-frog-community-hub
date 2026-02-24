import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createFrogContractService } from '../services/frogContractService';
import toast from 'react-hot-toast';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LAST_CONNECTED_WALLET_KEY = 'frog:last-connected-wallet';

const isAddressCompatibleWithNetwork = (address, network) => {
  const value = String(address || '').trim();
  if (!value) return false;

  const normalizedNetwork = String(network || '').toLowerCase();
  if (normalizedNetwork === 'mainnet') return value.startsWith('SP') || value.startsWith('SM');
  if (normalizedNetwork === 'testnet') return value.startsWith('ST') || value.startsWith('SN');
  return true;
};

const ESTIMATED_SECONDS_PER_STACKS_BLOCK = 600;
const cooldownTargetMsByKey = new Map();

const parseNonNegativeInt = (value) => {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch (_) {
    return null;
  }
};

const makeCooldownTargetKey = ({ network, address, nextClaimBlock }) => {
  const net = String(network || '').toLowerCase() || 'unknown';
  const who = String(address || '').trim();
  const next = String(nextClaimBlock || '').trim();
  return net + ':' + who + ':' + next;
};

const clearCooldownTargetsForWallet = ({ network, address }) => {
  const net = String(network || '').toLowerCase() || 'unknown';
  const who = String(address || '').trim();
  const prefix = net + ':' + who + ':';
  for (const key of cooldownTargetMsByKey.keys()) {
    if (key.startsWith(prefix)) cooldownTargetMsByKey.delete(key);
  }
};

const withCooldownEta = ({ snapshot, address, network }) => {
  const canClaim = Boolean(snapshot?.canClaim);
  if (canClaim) {
    clearCooldownTargetsForWallet({ network, address });
    return { ...snapshot, cooldownEtaSeconds: 0 };
  }

  const nextClaimBlock = parseNonNegativeInt(snapshot?.nextClaimBlock);
  const currentBlockHeight = parseNonNegativeInt(snapshot?.currentBlockHeight);
  if (nextClaimBlock === null || currentBlockHeight === null || nextClaimBlock <= currentBlockHeight) {
    return { ...snapshot, cooldownEtaSeconds: 0 };
  }

  const remainingBlocks = nextClaimBlock - currentBlockHeight;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const safeRemainingBlocks = remainingBlocks > maxSafe ? Number.MAX_SAFE_INTEGER : Number(remainingBlocks);
  const estimatedSeconds = safeRemainingBlocks * ESTIMATED_SECONDS_PER_STACKS_BLOCK;

  const key = makeCooldownTargetKey({ network, address, nextClaimBlock: snapshot?.nextClaimBlock });
  const nowMs = Date.now();
  const existingTargetMs = cooldownTargetMsByKey.get(key);
  const targetMs = typeof existingTargetMs === 'number' && existingTargetMs > nowMs
    ? existingTargetMs
    : (nowMs + (estimatedSeconds * 1000));

  cooldownTargetMsByKey.set(key, targetMs);

  return {
    ...snapshot,
    cooldownEtaSeconds: Math.max(0, Math.ceil((targetMs - nowMs) / 1000))
  };
};

const initialState = {
  address: '',
  balance: '',
  nextClaimBlock: '',
  currentBlockHeight: '',
  cooldownEtaSeconds: 0,
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
    case 'tickCooldown':
      return {
        ...state,
        cooldownEtaSeconds: state.cooldownEtaSeconds > 0 ? state.cooldownEtaSeconds - 1 : 0
      };
    case 'resetWallet':
      return {
        ...state,
        address: '',
        balance: '',
        nextClaimBlock: '',
        currentBlockHeight: '',
        cooldownEtaSeconds: 0,
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
        dispatch({ type: 'merge', payload: withCooldownEta({ snapshot, address: targetAddress, network }) });
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
          dispatch({ type: 'merge', payload: withCooldownEta({ snapshot, address: targetAddress, network }) });
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
      toast.success('Claim submitted. Waiting for confirmation...');

      const synced = await syncAfterClaim(state.address);
      dispatch({
        type: 'merge',
        payload: {
          status: synced
            ? 'Claim confirmed. 24h cooldown started.'
            : 'Claim submitted. On-chain data is still syncing.'
        }
      });
      if (synced) {
        toast.success('Claim confirmed. Cooldown started.');
      }
    } catch (err) {
      const message = String(err?.message || err || 'Unknown error');
      dispatch({ type: 'merge', payload: { status: `Claim failed: ${message}` } });
      toast.error(`Claim failed: ${message}`);
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
        if (mounted && localAddress && isAddressCompatibleWithNetwork(localAddress, network)) {
          dispatch({ type: 'merge', payload: { address: localAddress } });
          return;
        }

        if (localAddress && !isAddressCompatibleWithNetwork(localAddress, network)) {
          localStorage.removeItem(LAST_CONNECTED_WALLET_KEY);
        }
      } catch (_) {
        // skip local fallback and continue with connector storage
      }

      try {
        const storedAddress = await service.getStoredAddress();
        if (mounted && storedAddress && isAddressCompatibleWithNetwork(storedAddress, network)) {
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
  }, [network, ready, service]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (state.canClaim || state.cooldownEtaSeconds <= 0) return undefined;

    const timer = setInterval(() => {
      dispatch({ type: 'tickCooldown' });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.canClaim, state.cooldownEtaSeconds]);

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

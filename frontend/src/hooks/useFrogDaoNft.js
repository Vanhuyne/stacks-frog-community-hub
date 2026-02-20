import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createFrogDaoNftService } from '../services/frogDaoNftService';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asciiRegex = /^[\x20-\x7E]+$/;
const numberRegex = /^\d+$/;

const initialState = {
  frogBalance: '',
  username: '',
  usernameInput: '',
  hasPass: false,
  passId: '',
  eligible: false,
  treasuryAddress: '',
  treasuryBalance: '',
  mintFee: '',
  status: '',
  governanceVotingPeriodBlocks: '',
  governanceMinVotesQuorum: '',
  governanceLastProposalId: '',
  proposalIdInput: '',
  proposalTitleInput: '',
  proposalDetailsInput: '',
  proposalList: [],
  proposal: null,
  proposalResult: null,
  proposalVoteChoice: '',
  proposalCanVote: false,
  isRegistering: false,
  isMinting: false,
  isCreatingProposal: false,
  isVoting: false,
  isExecutingProposal: false,
  isCancelingProposal: false,
  isRefreshingProposal: false
};

const reducer = (state, action) => {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.payload };
    default:
      return state;
  }
};

const toUint = (raw) => {
  const value = (raw || '').trim();
  if (!numberRegex.test(value)) return null;
  try {
    const asBigInt = BigInt(value);
    if (asBigInt <= 0n) return null;
    return asBigInt;
  } catch (_) {
    return null;
  }
};

const pickSelected = (list, wantedId) => {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (wantedId) {
    const found = list.find((item) => item.id === wantedId);
    if (found) return found;
  }
  return list[0];
};

const mapSelectedPayload = (selected) => {
  if (!selected) {
    return {
      proposal: null,
      proposalResult: null,
      proposalVoteChoice: '',
      proposalCanVote: false
    };
  }

  return {
    proposal: {
      creator: selected.creator,
      title: selected.title,
      detailsUri: selected.detailsUri,
      startBlock: selected.startBlock,
      endBlock: selected.endBlock,
      yesVotes: selected.yesVotes,
      noVotes: selected.noVotes,
      abstainVotes: selected.abstainVotes,
      executed: selected.executed,
      canceled: selected.canceled
    },
    proposalResult: selected.result || null,
    proposalVoteChoice: selected.voteChoice || '',
    proposalCanVote: Boolean(selected.canVote)
  };
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
    if (!ready) return;

    const readSender = address || contractAddress;

    try {
      const [snapshot, treasury, board] = await Promise.all([
        service.fetchDaoSnapshot(readSender),
        service.fetchTreasurySnapshot(readSender),
        service.fetchProposalBoard(readSender, 12)
      ]);

      const selected = pickSelected(board.proposals, board.governanceConfig.lastProposalId || '');

      const recentSummary = board.proposals
        .map((p) => String(p.id) + ':' + (p.title || 'untitled'))
        .join(' | ');
      console.log('[DAO GOV] Recent Proposals:', board.proposals);
      if (debug) console.log('[DAO GOV] Recent Proposal Summary:', recentSummary);

      if (debug) console.log('[DAO NFT] snapshot:', snapshot);
      dispatch({
        type: 'merge',
        payload: {
          ...snapshot,
          ...treasury,
          governanceVotingPeriodBlocks: board.governanceConfig.votingPeriodBlocks,
          governanceMinVotesQuorum: board.governanceConfig.minVotesQuorum,
          governanceLastProposalId: board.governanceConfig.lastProposalId,
          proposalList: board.proposals,
          proposalIdInput: selected?.id || board.governanceConfig.lastProposalId || '',
          ...mapSelectedPayload(selected)
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Read data failed: ${err?.message || err}` } });
    }
  }, [address, contractAddress, ready, service, debug]);

  const refreshProposal = useCallback(async (proposalIdInput) => {
    if (!ready) return;

    const readSender = address || contractAddress;

    const parsedProposalId = toUint(proposalIdInput);
    if (!parsedProposalId) {
      dispatch({ type: 'merge', payload: { status: 'Valid proposal ID is required.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { isRefreshingProposal: true, status: 'Refreshing proposal data...' } });

    try {
      const governance = await service.fetchGovernanceSnapshot(readSender, parsedProposalId);

      dispatch({
        type: 'merge',
        payload: {
          proposalIdInput: String(parsedProposalId),
          proposal: governance.proposal,
          proposalResult: governance.proposalResult,
          proposalVoteChoice: governance.voteChoice,
          proposalCanVote: governance.canVote
        }
      });
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Read proposal data failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isRefreshingProposal: false } });
    }
  }, [address, contractAddress, ready, service, debug]);

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

  const syncProposalUntil = useCallback(
    async (proposalIdInput, predicate) => {
      if (!ready || !address) return false;

      const parsedProposalId = toUint(proposalIdInput);
      if (!parsedProposalId) return false;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const governance = await service.fetchGovernanceSnapshot(address, parsedProposalId);
          if (predicate(governance)) {
            await refreshProposal(String(parsedProposalId));
            return true;
          }
        } catch (_) {
          // keep polling
        }

        await sleep(4000);
      }

      return false;
    },
    [address, ready, refreshProposal, service]
  );

  const setUsernameInput = useCallback((usernameInput) => {
    dispatch({ type: 'merge', payload: { usernameInput } });
  }, []);

  const setProposalIdInput = useCallback((proposalIdInput) => {
    dispatch({ type: 'merge', payload: { proposalIdInput } });
  }, []);

  const selectProposal = useCallback((proposalItem) => {
    if (!proposalItem) return;

    const proposalIdInput = String(proposalItem.id || '');
    dispatch({
      type: 'merge',
      payload: {
        proposalIdInput,
        ...mapSelectedPayload(proposalItem)
      }
    });
  }, []);

  const setProposalTitleInput = useCallback((proposalTitleInput) => {
    dispatch({ type: 'merge', payload: { proposalTitleInput } });
  }, []);

  const setProposalDetailsInput = useCallback((proposalDetailsInput) => {
    dispatch({ type: 'merge', payload: { proposalDetailsInput } });
  }, []);

  const registerUsername = useCallback(async () => {
    if (state.isRegistering) return;

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

    dispatch({ type: 'merge', payload: { status: 'Submitting username registration...', isRegistering: true } });
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
      await refresh();
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Register username failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isRegistering: false } });
    }
  }, [address, ready, refresh, service, state.isRegistering, state.username, state.usernameInput, syncUntil]);

  const mintPass = useCallback(async () => {
    if (state.isMinting) return;

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting DAO pass mint...', isMinting: true } });
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
      await refresh();
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Mint failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isMinting: false } });
    }
  }, [address, ready, refresh, service, state.isMinting, syncUntil]);

  const createProposal = useCallback(async () => {
    if (state.isCreatingProposal) return;

    const title = (state.proposalTitleInput || '').trim();
    const details = (state.proposalDetailsInput || '').trim();

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    if (!state.hasPass) {
      dispatch({ type: 'merge', payload: { status: 'DAO pass required to create a proposal.' } });
      return;
    }

    if (!title || !details) {
      dispatch({ type: 'merge', payload: { status: 'Proposal title and details are required.' } });
      return;
    }

    if (!asciiRegex.test(title) || !asciiRegex.test(details)) {
      dispatch({ type: 'merge', payload: { status: 'Proposal title/details must contain ASCII characters only.' } });
      return;
    }

    if (title.length > 64 || details.length > 160) {
      dispatch({ type: 'merge', payload: { status: 'Title max 64 chars and details max 160 chars.' } });
      return;
    }

    let expectedNextId = '';
    try {
      expectedNextId = (BigInt(state.governanceLastProposalId || '0') + 1n).toString();
    } catch (_) {
      expectedNextId = '';
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting proposal...', isCreatingProposal: true } });
    try {
      await service.createProposal(title, details);

      if (expectedNextId) {
        dispatch({
          type: 'merge',
          payload: {
            proposalIdInput: expectedNextId,
            status: `Transaction submitted. Waiting for proposal #${expectedNextId}...`
          }
        });

        const syncedExpected = await syncProposalUntil(expectedNextId, (next) => Boolean(next.proposal));
        if (syncedExpected) {
          dispatch({ type: 'merge', payload: { status: `Proposal #${expectedNextId} is now available.` } });
          await refresh();
          return;
        }
      } else {
        dispatch({ type: 'merge', payload: { status: 'Transaction submitted. Waiting for confirmation...' } });
      }

      await refresh();
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Create proposal failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isCreatingProposal: false } });
    }
  }, [
    address,
    ready,
    refresh,
    service,
    state.governanceLastProposalId,
    state.hasPass,
    state.isCreatingProposal,
    state.proposalDetailsInput,
    state.proposalTitleInput,
    syncProposalUntil
  ]);

  const vote = useCallback(async (choice) => {
    if (state.isVoting) return;

    const proposalId = toUint(state.proposalIdInput);

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    if (!proposalId) {
      dispatch({ type: 'merge', payload: { status: 'Valid proposal ID is required.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting vote...', isVoting: true } });
    try {
      await service.vote(proposalId, BigInt(choice));
      dispatch({ type: 'merge', payload: { status: 'Vote submitted. Waiting for confirmation...' } });

      const synced = await syncProposalUntil(state.proposalIdInput, (governance) => governance.voteChoice !== '');
      dispatch({
        type: 'merge',
        payload: {
          status: synced ? 'Vote confirmed.' : 'Vote submitted. Proposal state is still syncing.'
        }
      });
      await refresh();
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Vote failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isVoting: false } });
    }
  }, [address, ready, refresh, service, state.isVoting, state.proposalIdInput, syncProposalUntil]);

  const executeProposal = useCallback(async () => {
    if (state.isExecutingProposal) return;

    const proposalId = toUint(state.proposalIdInput);

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    if (!proposalId) {
      dispatch({ type: 'merge', payload: { status: 'Valid proposal ID is required.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting execute proposal...', isExecutingProposal: true } });
    try {
      await service.executeProposal(proposalId);
      dispatch({ type: 'merge', payload: { status: 'Execute submitted. Waiting for confirmation...' } });

      const synced = await syncProposalUntil(state.proposalIdInput, (governance) => governance.proposalResult?.executed === true);
      dispatch({
        type: 'merge',
        payload: {
          status: synced ? 'Proposal executed.' : 'Execute submitted. Proposal state is still syncing.'
        }
      });
      await refresh();
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Execute failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isExecutingProposal: false } });
    }
  }, [address, ready, refresh, service, state.isExecutingProposal, state.proposalIdInput, syncProposalUntil]);

  const cancelProposal = useCallback(async () => {
    if (state.isCancelingProposal) return;

    const proposalId = toUint(state.proposalIdInput);

    if (!address) {
      dispatch({ type: 'merge', payload: { status: 'Please connect wallet first.' } });
      return;
    }

    if (!ready) {
      dispatch({ type: 'merge', payload: { status: 'Missing DAO contract configuration.' } });
      return;
    }

    if (!proposalId) {
      dispatch({ type: 'merge', payload: { status: 'Valid proposal ID is required.' } });
      return;
    }

    dispatch({ type: 'merge', payload: { status: 'Submitting cancel proposal...', isCancelingProposal: true } });
    try {
      await service.cancelProposal(proposalId);
      dispatch({ type: 'merge', payload: { status: 'Cancel submitted. Waiting for confirmation...' } });

      const synced = await syncProposalUntil(state.proposalIdInput, (governance) => governance.proposalResult?.canceled === true);
      dispatch({
        type: 'merge',
        payload: {
          status: synced ? 'Proposal canceled.' : 'Cancel submitted. Proposal state is still syncing.'
        }
      });
      await refresh();
    } catch (err) {
      dispatch({ type: 'merge', payload: { status: `Cancel failed: ${err?.message || err}` } });
    } finally {
      dispatch({ type: 'merge', payload: { isCancelingProposal: false } });
    }
  }, [address, ready, refresh, service, state.isCancelingProposal, state.proposalIdInput, syncProposalUntil]);

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
    refreshProposal,
    selectProposal,
    setUsernameInput,
    setProposalIdInput,
    setProposalTitleInput,
    setProposalDetailsInput,
    registerUsername,
    mintPass,
    createProposal,
    vote,
    executeProposal,
    cancelProposal
  };
};

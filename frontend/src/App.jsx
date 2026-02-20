import { useEffect, useMemo, useState } from 'react';
import { ecosystemCategories, highlightedApps, tabs } from './data/ecosystemData';
import { useFrogFaucet } from './hooks/useFrogFaucet';
import { useFrogDaoNft } from './hooks/useFrogDaoNft';

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token-v3';

const daoContractAddress = import.meta.env.VITE_DAO_CONTRACT_ADDRESS || contractAddress;
const daoContractName = import.meta.env.VITE_DAO_CONTRACT_NAME || 'frog-dao-nft-v4';

const network = (import.meta.env.VITE_STACKS_NETWORK || 'testnet').toLowerCase();
const defaultHiroApiBaseUrl = network === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
// In dev we can proxy via /hiro to avoid CORS; in production call Hiro API directly unless overridden.
const readOnlyBaseUrl = import.meta.env.VITE_HIRO_API_BASE_URL || (import.meta.env.DEV ? '/hiro' : defaultHiroApiBaseUrl);
const primaryButtonClass =
  'rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-900/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const ghostButtonClass =
  'rounded-full border border-emerald-700/35 bg-transparent px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-900/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const SOCIAL_POSTS_STORAGE_KEY = 'frog-community-social-posts-v1';
const shortenAddress = (address) => {
  if (!address) return '';
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export default function App() {
  const initialTab = (() => {
    const candidate = new URLSearchParams(window.location.search).get('tab');
    if (candidate === 'dao-nft' || candidate === 'governance' || candidate === 'social' || candidate === 'ecosystem' || candidate === 'faucet' || candidate === 'admin') return candidate;
    return 'faucet';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');
  const [showCreateProposalModal, setShowCreateProposalModal] = useState(false);
  const [socialPostInput, setSocialPostInput] = useState('');
  const [socialStatus, setSocialStatus] = useState('');
  const [socialPosts, setSocialPosts] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SOCIAL_POSTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  });

  const faucet = useFrogFaucet({
    contractAddress,
    contractName,
    network,
    readOnlyBaseUrl,
    appName: 'FROG Community Hub'
  });

  const dao = useFrogDaoNft({
    contractAddress: daoContractAddress,
    contractName: daoContractName,
    network,
    readOnlyBaseUrl,
    address: faucet.address,
    enabled: activeTab === 'dao-nft' || activeTab === 'governance' || activeTab === 'admin'
  });

  const ecosystemApps = useMemo(() => {
    if (ecosystemCategory === 'Highlighted Apps') return highlightedApps;
    return highlightedApps.filter((app) => app.tags.includes(ecosystemCategory));
  }, [ecosystemCategory]);
  const isOwner = useMemo(
    () => Boolean(faucet.address && faucet.owner && faucet.address === faucet.owner),
    [faucet.address, faucet.owner]
  );

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => tab.id !== 'admin' || (Boolean(faucet.address) && isOwner)),
    [faucet.address, isOwner]
  );

  useEffect(() => {
    if (activeTab === 'admin' && !(Boolean(faucet.address) && isOwner)) {
      setActiveTab('faucet');
    }
  }, [activeTab, faucet.address, isOwner]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SOCIAL_POSTS_STORAGE_KEY, JSON.stringify(socialPosts));
  }, [socialPosts]);

  const socialFeed = useMemo(
    () => [...socialPosts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [socialPosts]
  );

  const topSocialPosts = useMemo(
    () => [...socialPosts].sort((a, b) => (b.likeCount - a.likeCount) || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())).slice(0, 3),
    [socialPosts]
  );

  const createSocialPost = () => {
    if (!faucet.address) {
      setSocialStatus('Connect wallet to create a post.');
      return;
    }
    const content = socialPostInput.trim();
    if (!content) {
      setSocialStatus('Post content cannot be empty.');
      return;
    }
    if (content.length > 500) {
      setSocialStatus('Post is too long (max 500 characters).');
      return;
    }

    const nextPost = {
      id: String(Date.now()),
      author: faucet.address,
      content,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedBy: []
    };

    setSocialPosts((prev) => [nextPost, ...prev]);
    setSocialPostInput('');
    setSocialStatus('Post created. Share it with the community.');
  };

  const likeSocialPost = (postId) => {
    if (!faucet.address) {
      setSocialStatus('Connect wallet to like posts.');
      return;
    }

    let alreadyLiked = false;
    setSocialPosts((prev) => prev.map((post) => {
      if (post.id !== postId) return post;
      if ((post.likedBy || []).includes(faucet.address)) {
        alreadyLiked = true;
        return post;
      }
      return {
        ...post,
        likeCount: Number(post.likeCount || 0) + 1,
        likedBy: [...(post.likedBy || []), faucet.address]
      };
    }));

    setSocialStatus(alreadyLiked ? 'You can only like each post once.' : 'Like recorded.');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#ffffff_0%,#eaf5ef_45%,#d9efe4_100%)] text-emerald-950">
      <header className="sticky top-0 z-40 border-b border-emerald-950/10 bg-white/85 backdrop-blur">
        <div className="flex items-center gap-4 px-[6vw] py-3.5">
          <div className="shrink-0 rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
            FROG Community Hub
          </div>
          <nav className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto" aria-label="Frontend tabs">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold capitalize transition ${
                  activeTab === tab.id
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-emerald-700/25 bg-white text-emerald-700 hover:-translate-y-0.5 hover:shadow-md hover:shadow-emerald-900/10'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {faucet.address ? (
              <>
                <span className="hidden rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-2 font-mono text-xs text-emerald-800 md:inline">
                  {shortenAddress(faucet.address)}
                </span>
                <button
                  className={ghostButtonClass}
                  onClick={faucet.disconnectWallet}
                  disabled={
                    faucet.isClaiming ||
                    faucet.isTransferring ||
                    faucet.isUpdatingAdmin ||
                    dao.isMinting ||
                    dao.isRegistering ||
                    dao.isCreatingProposal ||
                    dao.isVoting ||
                    dao.isExecutingProposal ||
                    dao.isCancelingProposal
                  }
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className={primaryButtonClass} onClick={faucet.connectWallet} disabled={!faucet.ready || faucet.isConnecting}>
                {faucet.isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="px-[6vw] pb-20 pt-8">

      {activeTab === 'faucet' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,360px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG Community Hub</p>
              <h1 className="text-4xl leading-tight md:text-5xl">24h Faucet for FROG Token</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Claim FROG on a configurable cooldown. Connect your wallet, claim tokens, and transfer to friends.
              </p>
              <div className="frog-mascot" aria-hidden="true">
                <div className="frog-shadow" />
                <div className="frog-body">
                  <div className="frog-eye left"><span className="frog-pupil" /></div>
                  <div className="frog-eye right"><span className="frog-pupil" /></div>
                  <div className="frog-mouth" />
                  <div className="frog-cheek left" />
                  <div className="frog-cheek right" />
                  <div className="frog-leg left" />
                  <div className="frog-leg right" />
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Wallet</span>
                <strong className="break-all font-mono text-xs">{faucet.address || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Balance</span>
                <strong>{faucet.balance || '-'} FROG</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Token avatar</span>
                {faucet.tokenImage ? (
                  <img
                    src={faucet.tokenImage}
                    alt={faucet.tokenDisplayName || 'FROG token'}
                    className="h-8 w-8 rounded-full border border-emerald-950/15 object-cover"
                  />
                ) : (
                  <strong>-</strong>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Faucet status</span>
                <strong>{faucet.faucetPaused ? 'Paused' : 'Active'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span>Next claim (block)</span>
                <strong>{faucet.nextClaimBlock || '-'}</strong>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {!faucet.address ? (
                  <button className={primaryButtonClass} onClick={faucet.connectWallet} disabled={!faucet.ready || faucet.isConnecting}>
                    {faucet.isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </button>
                ) : (
                  <>
                    <button className={primaryButtonClass} onClick={faucet.claim} disabled={faucet.faucetPaused || !faucet.canClaim || faucet.isClaiming}>
                      {faucet.isClaiming
                        ? 'Processing claim...'
                        : faucet.faucetPaused
                          ? 'Faucet paused'
                          : faucet.canClaim
                            ? `Claim ${faucet.faucetAmount || '0'} FROG`
                            : 'Cooldown'}
                    </button>
                    <button className={ghostButtonClass} onClick={faucet.disconnectWallet} disabled={faucet.isClaiming || faucet.isTransferring}>
                      Disconnect
                    </button>
                  </>
                )}
              </div>
              {faucet.status && <p className="mt-3 text-sm text-emerald-900/60">{faucet.status}</p>}
              {!faucet.faucetPaused && !faucet.canClaim && (
                <p className="mt-3 text-sm text-emerald-900/60">Faucet cooldown in effect. Wait until block {faucet.nextClaimBlock} to claim again.</p>
              )}
              {faucet.faucetPaused && (
                <p className="mt-3 text-sm text-emerald-900/60">Claims are temporarily paused by contract admin.</p>
              )}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Transfer</h2>
              <label className="mb-3 block text-base text-emerald-900/60">
                Recipient wallet
                <input
                  className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  value={faucet.recipient}
                  onChange={(e) => faucet.setRecipient(e.target.value)}
                  placeholder="SP..."
                />
              </label>
              <label className="mb-3 block text-base text-emerald-900/60">
                Amount
                <input
                  className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  type="number"
                  min="1"
                  value={faucet.amount}
                  onChange={(e) => faucet.setAmount(e.target.value)}
                  placeholder="100"
                />
              </label>
              <button className={primaryButtonClass} onClick={faucet.transfer} disabled={!faucet.address || !faucet.recipient || !faucet.amount || faucet.isTransferring}>
                {faucet.isTransferring ? 'Submitting...' : 'Send'}
              </button>
              <p className="mt-3 text-xs text-emerald-900/60">
                {!dao.hasPass
                  ? 'Creating proposals requires DAO Pass in this v5 contract. Go to Frog DAO Pass tab to register username and mint pass first.'
                  : 'You are eligible to submit proposals when title and details are filled.'}
              </p>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Contract details</h2>
              <ul className="space-y-2.5">
                <li className="flex items-center justify-between gap-3"><span>Contract</span> <strong className="break-all font-mono text-xs">{contractAddress}.{contractName}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Network</span> <strong>{network}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Decimals</span> <strong>0</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Claim amount</span> <strong>{faucet.faucetAmount || '-'} FROG</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Cooldown</span> <strong>{faucet.cooldownBlocks || '-'} blocks</strong></li>
              </ul>
            </div>
          </section>
        </>
      ) : activeTab === 'dao-nft' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,360px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG DAO</p>
              <h1 className="text-4xl leading-tight md:text-5xl">DAO Membership Pass</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Register your on-chain username and mint one non-transferable DAO pass to unlock governance.
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Wallet</span>
                <strong className="break-all font-mono text-xs">{faucet.address || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>FROG balance</span>
                <strong>{dao.frogBalance || faucet.balance || '-'} FROG</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Username</span>
                <strong>{dao.username || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span>DAO pass</span>
                <strong>
                  {dao.hasPass
                    ? (dao.passId ? `Minted (#${dao.passId})` : 'Minted')
                    : 'Not minted'}
                </strong>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {!faucet.address ? (
                  <button className={primaryButtonClass} onClick={faucet.connectWallet} disabled={!faucet.ready || faucet.isConnecting}>
                    {faucet.isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </button>
                ) : (
                  <>
                    <button className={ghostButtonClass} onClick={dao.refresh} disabled={!dao.ready || dao.isMinting || dao.isRegistering}>Refresh</button>
                    <button className={ghostButtonClass} onClick={faucet.disconnectWallet} disabled={dao.isMinting || dao.isRegistering}>Disconnect</button>
                  </>
                )}
              </div>
              {(dao.status || faucet.status) && <p className="mt-3 text-sm text-emerald-900/60">{dao.status || faucet.status}</p>}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Register Username</h2>
              <label className="block text-base text-emerald-900/60">
                Username (ASCII, max 32 chars)
                <input
                  className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base text-emerald-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-emerald-50"
                  value={dao.usernameInput}
                  onChange={(e) => dao.setUsernameInput(e.target.value)}
                  placeholder="froggovernor"
                  disabled={Boolean(dao.username) || dao.isRegistering}
                />
              </label>
              <button
                className={primaryButtonClass}
                onClick={dao.registerUsername}
                disabled={!faucet.address || !dao.ready || Boolean(dao.username) || !dao.usernameInput.trim() || dao.isRegistering}
              >
                {dao.isRegistering ? 'Registering...' : dao.username ? 'Username already set' : 'Register'}
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Mint DAO Pass</h2>
              <p className="mb-3 text-base text-emerald-900/60">
                Requirement: username registered + hold at least 1,000 FROG (mint fee: 99 FROG).
              </p>
              <button
                className={primaryButtonClass}
                onClick={dao.mintPass}
                disabled={!faucet.address || !dao.ready || dao.hasPass || !dao.eligible || dao.isMinting}
              >
                {dao.isMinting ? 'Minting...' : dao.hasPass ? 'Already minted' : dao.eligible ? 'Mint pass' : 'Not eligible'}
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">DAO Contract</h2>
              <ul className="space-y-2.5">
                <li className="flex items-center justify-between gap-3"><span>Contract</span> <strong className="break-all font-mono text-xs">{daoContractAddress}.{daoContractName}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Network</span> <strong>{network}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Mint rule</span> <strong>1 pass per address</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Transfer</span> <strong>Disabled</strong></li>
              </ul>
            </div>
          </section>
        </>
      ) : activeTab === 'governance' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(320px,1fr)_minmax(280px,420px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG GOVERNANCE</p>
              <h1 className="text-4xl leading-tight md:text-5xl">Proposal & Voting Board</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Governance-style workspace for proposing upgrades, tracking vote counts, and executing results.
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Overview</h2>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl border border-emerald-950/10 bg-emerald-50/60 p-3">
                  <p className="text-xs uppercase tracking-wide text-emerald-800/60">Voting Period</p>
                  <p className="text-xl font-bold">{dao.governanceVotingPeriodBlocks || '-'} <span className="text-sm font-medium">blocks</span></p>
                </div>
                <div className="rounded-2xl border border-emerald-950/10 bg-emerald-50/60 p-3">
                  <p className="text-xs uppercase tracking-wide text-emerald-800/60">Quorum</p>
                  <p className="text-xl font-bold">{dao.governanceMinVotesQuorum || '-'}</p>
                </div>
                <div className="rounded-2xl border border-emerald-950/10 bg-emerald-50/60 p-3">
                  <p className="text-xs uppercase tracking-wide text-emerald-800/60">Last Proposal</p>
                  <p className="text-xl font-bold">#{dao.governanceLastProposalId || '-'}</p>
                </div>
                <div className="rounded-2xl border border-emerald-950/10 bg-emerald-50/60 p-3">
                  <p className="text-xs uppercase tracking-wide text-emerald-800/60">Membership</p>
                  <p className="text-xl font-bold">{dao.hasPass ? 'Eligible' : 'No pass'}</p>
                </div>
              </div>
              {(dao.status || faucet.status) && <p className="mt-3 text-sm text-emerald-900/60">{dao.status || faucet.status}</p>}
            </div>
          </header>

          <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(300px,420px)_minmax(420px,1fr)]">
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-emerald-800/60">Recent Proposals</p>
                  <p className="mt-1 text-sm text-emerald-900/60">Live governance feed from newest to oldest.</p>
                </div>
                <button
                  className={primaryButtonClass}
                  type="button"
                  onClick={() => setShowCreateProposalModal(true)}
                  disabled={!faucet.address || !dao.ready || dao.isCreatingProposal}
                >
                  New Proposal
                </button>
              </div>

              {dao.proposalList.length > 0 ? (
                <div className="relative max-h-[540px] overflow-auto pr-1">
                  <div className="absolute bottom-0 left-[13px] top-1 w-px bg-emerald-900/12" aria-hidden="true" />
                  <div className="space-y-3">
                    {dao.proposalList.map((item) => (
                      <article key={item.id} className="relative pl-8">
                        <span
                          className={dao.proposalIdInput === item.id
                            ? 'absolute left-0 top-3 h-3 w-3 rounded-full border border-emerald-700 bg-emerald-700'
                            : 'absolute left-0 top-3 h-3 w-3 rounded-full border border-emerald-700/40 bg-white'}
                        />
                        <button
                          type="button"
                          className={dao.proposalIdInput === item.id
                            ? 'w-full rounded-2xl border border-emerald-700 bg-emerald-50 px-3.5 py-3 text-left transition'
                            : 'w-full rounded-2xl border border-emerald-950/10 bg-white px-3.5 py-3 text-left transition hover:border-emerald-700/50 hover:bg-emerald-50/40'}
                          onClick={() => {
                            dao.selectProposal(item);
                            dao.refreshProposal(item.id);
                          }}
                        >
                          <div className="flex items-center justify-between gap-3 text-xs text-emerald-900/60">
                            <span>Proposal #{item.id}</span>
                            <span>{item.result?.active ? 'Active' : item.result?.executed ? 'Executed' : item.result?.canceled ? 'Canceled' : 'Closed'}</span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-emerald-950">{item.title || 'Untitled'}</p>
                          <p className="mt-1 text-xs text-emerald-900/65">Yes {item.result?.yesVotes || '0'} · No {item.result?.noVotes || '0'} · Abstain {item.result?.abstainVotes || '0'}</p>
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-emerald-900/25 bg-emerald-50/40 px-3 py-3 text-sm text-emerald-900/70">
                  No proposals found yet.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="min-w-[180px] flex-1 text-sm text-emerald-900/70">
                  Proposal ID
                  <input
                    className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                    value={dao.proposalIdInput}
                    onChange={(e) => dao.setProposalIdInput(e.target.value)}
                    placeholder="1"
                  />
                </label>
                <button
                  className={ghostButtonClass}
                  onClick={() => dao.refreshProposal(dao.proposalIdInput)}
                  disabled={!faucet.address || !dao.ready || !dao.proposalIdInput.trim() || dao.isRefreshingProposal}
                >
                  {dao.isRefreshingProposal ? 'Loading...' : 'Load'}
                </button>
              </div>

              {dao.proposal ? (
                <>
                  {dao.isRefreshingProposal && (
                    <p className="mb-3 text-xs text-emerald-900/60">Refreshing proposal details...</p>
                  )}
                  <div className="rounded-2xl border border-emerald-950/10 bg-emerald-50/50 p-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-800/60">Active Record</p>
                    <h3 className="mt-1 text-xl font-semibold leading-tight">{dao.proposal.title || '-'}</h3>
                    <p className="mt-2 break-all font-mono text-xs text-emerald-900/70">{dao.proposal.detailsUri || '-'}</p>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="flex items-center justify-between gap-3"><span>Creator</span> <strong className="break-all font-mono text-xs">{dao.proposal.creator || '-'}</strong></div>
                      <div className="flex items-center justify-between gap-3"><span>Status</span> <strong>{dao.proposalResult?.active ? 'Active' : dao.proposalResult?.executed ? 'Executed' : dao.proposalResult?.canceled ? 'Canceled' : 'Closed'}</strong></div>
                      <div className="flex items-center justify-between gap-3"><span>Start / End</span> <strong>{dao.proposal.startBlock || '-'} / {dao.proposal.endBlock || '-'}</strong></div>
                      <div className="flex items-center justify-between gap-3"><span>Your vote</span> <strong>{dao.proposalVoteChoice || '-'}</strong></div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-950/10 p-4">
                      <p className="text-xs uppercase tracking-wide text-emerald-800/60">Vote Stats</p>
                      <p className="mt-2 text-sm">Yes: <strong>{dao.proposalResult?.yesVotes || '0'}</strong></p>
                      <p className="text-sm">No: <strong>{dao.proposalResult?.noVotes || '0'}</strong></p>
                      <p className="text-sm">Abstain: <strong>{dao.proposalResult?.abstainVotes || '0'}</strong></p>
                      <p className="mt-2 text-sm">Total: <strong>{dao.proposalResult?.totalVotes || '-'}</strong></p>
                      <p className="text-sm">Quorum: <strong>{dao.proposalResult?.quorum || '-'}</strong></p>
                      <p className="text-sm">Result: <strong>{dao.proposalResult?.passed ? 'Passed' : 'Pending/Failed'}</strong></p>
                    </div>
                    <div className="rounded-2xl border border-emerald-950/10 p-4">
                      <p className="text-xs uppercase tracking-wide text-emerald-800/60">Actions</p>
                      <div className="mt-2 flex flex-wrap gap-2.5">
                        <button className={primaryButtonClass} onClick={() => dao.vote(1)} disabled={!faucet.address || !dao.ready || !dao.proposalIdInput.trim() || dao.isVoting}>
                          {dao.isVoting ? 'Submitting...' : 'Vote Yes'}
                        </button>
                        <button className={ghostButtonClass} onClick={() => dao.vote(2)} disabled={!faucet.address || !dao.ready || !dao.proposalIdInput.trim() || dao.isVoting}>Vote No</button>
                        <button className={ghostButtonClass} onClick={() => dao.vote(3)} disabled={!faucet.address || !dao.ready || !dao.proposalIdInput.trim() || dao.isVoting}>Abstain</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2.5">
                        <button className={primaryButtonClass} onClick={dao.executeProposal} disabled={!faucet.address || !dao.ready || !dao.proposalIdInput.trim() || dao.isExecutingProposal}>
                          {dao.isExecutingProposal ? 'Executing...' : 'Execute'}
                        </button>
                        <button className={ghostButtonClass} onClick={dao.cancelProposal} disabled={!faucet.address || !dao.ready || !dao.proposalIdInput.trim() || dao.isCancelingProposal}>
                          {dao.isCancelingProposal ? 'Canceling...' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-emerald-900/25 bg-emerald-50/40 p-5 text-sm text-emerald-900/70">
                  {dao.isRefreshingProposal
                    ? 'Loading proposal details...'
                    : 'Load a proposal ID to display the governance board.'}
                </div>
              )}
            </div>
          </section>

          {showCreateProposalModal && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-emerald-950/40 px-4 py-8 backdrop-blur-sm">
              <div className="w-full max-w-xl rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_24px_50px_rgba(14,35,24,0.2)]">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Create Proposal</h2>
                    <p className="mt-1 text-sm text-emerald-900/60">Submit an upgrade proposal in governance format.</p>
                  </div>
                  <button className={ghostButtonClass} type="button" onClick={() => setShowCreateProposalModal(false)} disabled={dao.isCreatingProposal}>
                    Close
                  </button>
                </div>

                <label className="mb-3 block text-sm text-emerald-900/70">
                  Title
                  <input
                    className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-emerald-50"
                    value={dao.proposalTitleInput}
                    onChange={(e) => dao.setProposalTitleInput(e.target.value)}
                    placeholder="Reduce faucet cooldown to 120 blocks"
                    disabled={dao.isCreatingProposal}
                  />
                </label>

                <label className="mb-3 block text-sm text-emerald-900/70">
                  Details (URI/hash/text)
                  <textarea
                    className="mt-1.5 min-h-[120px] w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-emerald-50"
                    value={dao.proposalDetailsInput}
                    onChange={(e) => dao.setProposalDetailsInput(e.target.value)}
                    placeholder="ipfs://Qm..."
                    disabled={dao.isCreatingProposal}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={primaryButtonClass}
                    onClick={dao.createProposal}
                    disabled={!faucet.address || !dao.ready || !dao.hasPass || !dao.proposalTitleInput.trim() || !dao.proposalDetailsInput.trim() || dao.isCreatingProposal}
                  >
                    {dao.isCreatingProposal ? 'Submitting...' : !dao.hasPass ? 'Mint DAO Pass First' : 'Submit Proposal'}
                  </button>
                  <button className={ghostButtonClass} type="button" onClick={() => setShowCreateProposalModal(false)} disabled={dao.isCreatingProposal}>
                    Cancel
                  </button>
                </div>

                <p className="mt-3 text-xs text-emerald-900/60">
                  {!dao.hasPass
                    ? 'Creating proposals requires DAO Pass in this v5 contract. Go to Frog DAO Pass tab to register username and mint pass first.'
                    : 'You are eligible to submit proposals when title and details are filled.'}
                </p>
              </div>
            </div>
          )}
        </>
      ) : activeTab === 'social' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(300px,1fr)_minmax(260px,360px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG SOCIAL</p>
              <h1 className="text-4xl leading-tight md:text-5xl">Community Feed</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Publish short posts, collect likes, and prepare for weekly FROG rewards for top creators.
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Reward Snapshot</h2>
              <p className="text-sm text-emerald-900/65">Top posts by likes in current feed.</p>
              <div className="mt-4 space-y-2.5">
                {topSocialPosts.length > 0 ? topSocialPosts.map((post, index) => (
                  <div key={post.id} className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-950/10 bg-emerald-50/60 px-3 py-2">
                    <span className="text-sm font-semibold text-emerald-900">#{index + 1} {shortenAddress(post.author)}</span>
                    <strong>{post.likeCount || 0} likes</strong>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-emerald-900/25 bg-emerald-50/40 px-3 py-2 text-sm text-emerald-900/70">
                    No posts yet. Create the first one.
                  </div>
                )}
              </div>
              <p className="mt-4 text-xs text-emerald-900/60">Reward distribution will be added in step 2.</p>
            </div>
          </header>

          <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(320px,420px)_minmax(420px,1fr)]">
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Create Post</h2>
              <p className="mb-3 text-sm text-emerald-900/60">1 wallet = 1 like per post. Keep posts concise (max 500 chars).</p>
              <textarea
                className="min-h-[170px] w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                value={socialPostInput}
                onChange={(event) => setSocialPostInput(event.target.value)}
                placeholder="Share an update with the FROG community..."
                maxLength={500}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-emerald-900/60">
                <span>Connected: {faucet.address ? shortenAddress(faucet.address) : 'No wallet'}</span>
                <span>{socialPostInput.length}/500</span>
              </div>
              <button className={primaryButtonClass + ' mt-4'} onClick={createSocialPost}>Publish Post</button>
              {socialStatus && <p className="mt-3 text-sm text-emerald-900/60">{socialStatus}</p>}
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Recent Posts</h2>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">{socialFeed.length} posts</span>
              </div>

              {socialFeed.length > 0 ? (
                <div className="max-h-[560px] space-y-3 overflow-auto pr-1">
                  {socialFeed.map((post) => {
                    const hasLiked = faucet.address ? (post.likedBy || []).includes(faucet.address) : false;
                    return (
                      <article key={post.id} className="rounded-2xl border border-emerald-950/10 bg-emerald-50/40 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-xs text-emerald-900/70">{shortenAddress(post.author)}</p>
                          <p className="text-xs text-emerald-900/60">{new Date(post.createdAt).toLocaleString()}</p>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-950">{post.content}</p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            className={hasLiked ? ghostButtonClass : primaryButtonClass}
                            type="button"
                            onClick={() => likeSocialPost(post.id)}
                            disabled={hasLiked}
                          >
                            {hasLiked ? 'Liked' : 'Like'}
                          </button>
                          <span className="text-sm text-emerald-900/70">{post.likeCount || 0} likes</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-emerald-900/25 bg-emerald-50/40 p-5 text-sm text-emerald-900/70">
                  Feed is empty. Publish the first post to start engagement.
                </div>
              )}
            </div>
          </section>
        </>
      ) : activeTab === 'admin' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,420px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG ADMIN</p>
              <h1 className="text-4xl leading-tight md:text-5xl">Faucet Admin Controls</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Owner-only controls for pause state, claim amount, and cooldown blocks.
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Connected wallet</span>
                <strong className="break-all font-mono text-xs">{faucet.address || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-emerald-950/10 py-2">
                <span>Contract owner</span>
                <strong className="break-all font-mono text-xs">{faucet.owner || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span>Permission</span>
                <strong>{isOwner ? 'Owner' : 'Read-only'}</strong>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {!faucet.address ? (
                  <button className={primaryButtonClass} onClick={faucet.connectWallet} disabled={!faucet.ready || faucet.isConnecting}>
                    {faucet.isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </button>
                ) : (
                  <button className={ghostButtonClass} onClick={faucet.disconnectWallet} disabled={faucet.isUpdatingAdmin}>
                    Disconnect
                  </button>
                )}
              </div>
              {faucet.status && <p className="mt-3 text-sm text-emerald-900/60">{faucet.status}</p>}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Pause / Unpause</h2>
              <p className="mb-4 text-base text-emerald-900/60">
                Current faucet state: <strong>{faucet.faucetPaused ? 'Paused' : 'Active'}</strong>
              </p>
              <div className="flex flex-wrap gap-3">
                <button className={primaryButtonClass} onClick={() => faucet.setPauseState(true)} disabled={!isOwner || faucet.isUpdatingAdmin || faucet.faucetPaused}>
                  Pause
                </button>
                <button className={ghostButtonClass} onClick={() => faucet.setPauseState(false)} disabled={!isOwner || faucet.isUpdatingAdmin || !faucet.faucetPaused}>
                  Unpause
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Set Claim Amount</h2>
              <p className="mb-3 text-base text-emerald-900/60">Current amount: <strong>{faucet.faucetAmount || '-'} FROG</strong></p>
              <label className="mb-3 block text-base text-emerald-900/60">
                New amount
                <input
                  className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  type="number"
                  min="1"
                  value={faucet.adminAmountInput}
                  onChange={(e) => faucet.setAdminAmountInput(e.target.value)}
                  placeholder="2000"
                  disabled={!isOwner || faucet.isUpdatingAdmin}
                />
              </label>
              <button className={primaryButtonClass} onClick={faucet.updateFaucetAmount} disabled={!isOwner || !faucet.adminAmountInput || faucet.isUpdatingAdmin}>
                {faucet.isUpdatingAdmin ? 'Submitting...' : 'Update amount'}
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Set Cooldown</h2>
              <p className="mb-3 text-base text-emerald-900/60">Current cooldown: <strong>{faucet.cooldownBlocks || '-'} blocks</strong></p>
              <label className="mb-3 block text-base text-emerald-900/60">
                New cooldown blocks
                <input
                  className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  type="number"
                  min="1"
                  value={faucet.adminCooldownInput}
                  onChange={(e) => faucet.setAdminCooldownInput(e.target.value)}
                  placeholder="144"
                  disabled={!isOwner || faucet.isUpdatingAdmin}
                />
              </label>
              <button className={primaryButtonClass} onClick={faucet.updateCooldownBlocks} disabled={!isOwner || !faucet.adminCooldownInput || faucet.isUpdatingAdmin}>
                {faucet.isUpdatingAdmin ? 'Submitting...' : 'Update cooldown'}
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">DAO Treasury</h2>
              <ul className="space-y-2.5">
                <li className="flex items-center justify-between gap-3"><span>Treasury wallet</span> <strong className="break-all font-mono text-xs">{dao.treasuryAddress || '-'}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Mint fee</span> <strong>{dao.mintFee || '-'} FROG</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Treasury balance</span> <strong>{dao.treasuryBalance || '-'} FROG</strong></li>
              </ul>
              <button className={ghostButtonClass} onClick={dao.refresh} disabled={!dao.ready || dao.isMinting || dao.isRegistering}>
                Refresh treasury
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-6">
          <header className="max-w-3xl">
            <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">EXPLORE ECOSYSTEM</p>
            <h1 className="text-4xl leading-tight md:text-5xl">Featured Stacks ecosystem</h1>
            <p className="mt-3 text-base text-emerald-900/60">
              Featured apps in a Stacks-style ecosystem layout for quick exploration.
            </p>
          </header>

          <div className="flex flex-wrap gap-2.5">
            {ecosystemCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={`rounded-full border px-3.5 py-2 text-xs font-bold transition ${
                  ecosystemCategory === category
                    ? 'border-emerald-900 bg-emerald-900 text-white'
                    : 'border-emerald-700/20 bg-white text-emerald-700 hover:-translate-y-0.5 hover:shadow-md hover:shadow-emerald-900/10'
                }`}
                onClick={() => setEcosystemCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ecosystemApps.map((app) => (
              <article className="flex flex-col gap-3 rounded-3xl border border-emerald-950/10 bg-white p-4 shadow-[0_18px_40px_rgba(14,35,24,0.12)]" key={app.name}>
                <div className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-2xl border border-emerald-950/10 bg-emerald-50">
                  <img src={app.image} alt={`${app.name} logo`} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <h2 className="text-3xl leading-none">{app.name}</h2>
                <p className="text-emerald-900/60">{app.summary}</p>
                <div className="flex flex-wrap gap-2">
                  {app.tags.map((tag) => (
                    <span key={`${app.name}-${tag}`} className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{tag}</span>
                  ))}
                </div>
                <a href={app.url} target="_blank" rel="noreferrer" className="w-fit font-bold text-emerald-900 transition hover:underline">
                  View on stacks.co
                </a>
              </article>
            ))}
          </div>
        </section>
      )}
      </main>
    </div>
  );
}

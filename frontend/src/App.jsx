import { useMemo, useState } from 'react';
import { ecosystemCategories, highlightedApps, tabs } from './data/ecosystemData';
import { useFrogFaucet } from './hooks/useFrogFaucet';
import { useFrogDaoNft } from './hooks/useFrogDaoNft';

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token';

const daoContractAddress = import.meta.env.VITE_DAO_CONTRACT_ADDRESS || contractAddress;
const daoContractName = import.meta.env.VITE_DAO_CONTRACT_NAME || 'frog-dao-nft';

const network = 'testnet';
// Read-only calls use a local proxy in dev to avoid CORS.
const readOnlyBaseUrl = import.meta.env.VITE_HIRO_PROXY || '/hiro';
const primaryButtonClass =
  'rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-900/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const ghostButtonClass =
  'rounded-full border border-emerald-700/35 bg-transparent px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-900/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';

export default function App() {
  const [activeTab, setActiveTab] = useState('faucet');
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');

  const faucet = useFrogFaucet({
    contractAddress,
    contractName,
    network,
    readOnlyBaseUrl,
    appName: 'FROG Faucet'
  });

  const dao = useFrogDaoNft({
    contractAddress: daoContractAddress,
    contractName: daoContractName,
    network,
    readOnlyBaseUrl,
    address: faucet.address,
    enabled: activeTab === 'dao-nft'
  });

  const ecosystemApps = useMemo(() => {
    if (ecosystemCategory === 'Highlighted Apps') return highlightedApps;
    return highlightedApps.filter((app) => app.tags.includes(ecosystemCategory));
  }, [ecosystemCategory]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#ffffff_0%,#eaf5ef_45%,#d9efe4_100%)] px-[6vw] pb-20 pt-10 text-emerald-950">
      <nav className="mb-7 flex flex-wrap gap-3" aria-label="Frontend tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rounded-full border px-4 py-2.5 text-sm font-bold capitalize transition ${
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

      {activeTab === 'faucet' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,360px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG FT + Faucet</p>
              <h1 className="text-4xl leading-tight md:text-5xl">24h Faucet for FROG Token</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Claim 1,000 FROG every 24h. Connect your wallet, claim tokens, and transfer to friends.
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
              <div className="flex items-center justify-between gap-3 py-2">
                <span>Next claim (block)</span>
                <strong>{faucet.nextClaimBlock || '-'}</strong>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {!faucet.address ? (
                  <button className={primaryButtonClass} onClick={faucet.connectWallet} disabled={!faucet.ready}>Connect Wallet</button>
                ) : (
                  <>
                    <button className={primaryButtonClass} onClick={faucet.claim} disabled={!faucet.canClaim}>
                      {faucet.canClaim ? 'Claim 1,000 FROG' : '24h cooldown'}
                    </button>
                    <button className={ghostButtonClass} onClick={faucet.disconnectWallet}>Disconnect</button>
                  </>
                )}
              </div>
              {faucet.status && <p className="mt-3 text-sm text-emerald-900/60">{faucet.status}</p>}
              {!faucet.canClaim && (
                <p className="mt-3 text-sm text-emerald-900/60">Faucet is limited to once every 24h. Wait until block {faucet.nextClaimBlock} to claim again.</p>
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
              <button className={primaryButtonClass} onClick={faucet.transfer} disabled={!faucet.address || !faucet.recipient || !faucet.amount}>
                Send
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Contract details</h2>
              <ul className="space-y-2.5">
                <li className="flex items-center justify-between gap-3"><span>Contract</span> <strong className="break-all font-mono text-xs">{contractAddress}.{contractName}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Network</span> <strong>{network}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Decimals</span> <strong>0</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Cooldown</span> <strong>24h (~144 blocks)</strong></li>
              </ul>
            </div>
          </section>
        </>
      ) : activeTab === 'dao-nft' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,360px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-emerald-800/65">FROG DAO</p>
              <h1 className="text-4xl leading-tight md:text-5xl">Mint DAO Pass NFT</h1>
              <p className="mt-3 max-w-2xl text-base text-emerald-900/60">
                Register a username and hold at least 1,000 FROG to mint a non-transferable DAO pass.
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
                  <button className={primaryButtonClass} onClick={faucet.connectWallet} disabled={!faucet.ready}>Connect Wallet</button>
                ) : (
                  <>
                    <button className={ghostButtonClass} onClick={dao.refresh} disabled={!dao.ready}>Refresh</button>
                    <button className={ghostButtonClass} onClick={faucet.disconnectWallet}>Disconnect</button>
                  </>
                )}
              </div>
              {(dao.status || faucet.status) && <p className="mt-3 text-sm text-emerald-900/60">{dao.status || faucet.status}</p>}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Register username</h2>
              <label className="block text-base text-emerald-900/60">
                Username (ASCII, max 32 chars)
                <input
                  className="mt-1.5 w-full rounded-xl border border-emerald-950/15 px-3 py-2.5 text-base text-emerald-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-emerald-50"
                  value={dao.usernameInput}
                  onChange={(e) => dao.setUsernameInput(e.target.value)}
                  placeholder="frogking"
                  disabled={Boolean(dao.username)}
                />
              </label>
              <button
                className={primaryButtonClass}
                onClick={dao.registerUsername}
                disabled={!faucet.address || !dao.ready || Boolean(dao.username) || !dao.usernameInput.trim()}
              >
                {dao.username ? 'Username already set' : 'Register'}
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">Mint DAO pass</h2>
              <p className="mb-3 text-base text-emerald-900/60">
                Requirement: username registered + hold at least 1,000 FROG.
              </p>
              <button
                className={primaryButtonClass}
                onClick={dao.mintPass}
                disabled={!faucet.address || !dao.ready || dao.hasPass || !dao.eligible}
              >
                {dao.hasPass ? 'Already minted' : dao.eligible ? 'Mint pass' : 'Not eligible'}
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-950/10 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-semibold">DAO contract</h2>
              <ul className="space-y-2.5">
                <li className="flex items-center justify-between gap-3"><span>Contract</span> <strong className="break-all font-mono text-xs">{daoContractAddress}.{daoContractName}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Network</span> <strong>{network}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Mint rule</span> <strong>1 pass per address</strong></li>
                <li className="flex items-center justify-between gap-3"><span>Transfer</span> <strong>Disabled</strong></li>
              </ul>
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
    </div>
  );
}

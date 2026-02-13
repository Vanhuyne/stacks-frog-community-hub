import { useMemo, useState } from 'react';
import { ecosystemCategories, highlightedApps, tabs } from './data/ecosystemData';
import { useFrogFaucet } from './hooks/useFrogFaucet';

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token';
const network = 'testnet';

export default function App() {
  const [activeTab, setActiveTab] = useState('faucet');
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');

  const {
    address,
    balance,
    nextClaimBlock,
    canClaim,
    status,
    recipient,
    amount,
    ready,
    connectWallet,
    disconnectWallet,
    claim,
    transfer,
    setRecipient,
    setAmount
  } = useFrogFaucet({
    contractAddress,
    contractName,
    network,
    appName: 'FROG Faucet'
  });

  const ecosystemApps = useMemo(() => {
    if (ecosystemCategory === 'Highlighted Apps') return highlightedApps;
    return highlightedApps.filter((app) => app.tags.includes(ecosystemCategory));
  }, [ecosystemCategory]);

  return (
    <div className="page">
      <nav className="tabs" aria-label="Frontend tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'faucet' ? (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">FROG FT + Faucet</p>
              <h1>24h Faucet for FROG Token</h1>
              <p className="subtext">
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
            <div className="panel">
              <div className="row">
                <span>Status</span>
                <strong>{address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="row">
                <span>Wallet</span>
                <strong className="mono">{address || '-'}</strong>
              </div>
              <div className="row">
                <span>Balance</span>
                <strong>{balance || '-'} FROG</strong>
              </div>
              <div className="row">
                <span>Next claim (block)</span>
                <strong>{nextClaimBlock || '-'}</strong>
              </div>
              <div className="actions">
                {!address ? (
                  <button onClick={connectWallet} disabled={!ready}>Connect Wallet</button>
                ) : (
                  <>
                    <button onClick={claim} disabled={!canClaim}>
                      {canClaim ? 'Claim 1,000 FROG' : '24h cooldown'}
                    </button>
                    <button className="ghost" onClick={disconnectWallet}>Disconnect</button>
                  </>
                )}
              </div>
              {status && <p className="status">{status}</p>}
              {!canClaim && (
                <p className="status">Faucet is limited to once every 24h. Wait until block {nextClaimBlock} to claim again.</p>
              )}
            </div>
          </header>

          <section className="grid">
            <div className="card">
              <h2>Transfer</h2>
              <label>
                Recipient wallet
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="SP..."
                />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                />
              </label>
              <button onClick={transfer} disabled={!address || !recipient || !amount}>
                Send
              </button>
            </div>

            <div className="card">
              <h2>Contract details</h2>
              <ul>
                <li><span>Contract</span> <strong className="mono">{contractAddress}.{contractName}</strong></li>
                <li><span>Network</span> <strong>{network}</strong></li>
                <li><span>Decimals</span> <strong>0</strong></li>
                <li><span>Cooldown</span> <strong>24h (~144 blocks)</strong></li>
              </ul>
            </div>
          </section>
        </>
      ) : (
        <section className="ecosystem">
          <header className="ecosystem-header">
            <p className="eyebrow">EXPLORE ECOSYSTEM</p>
            <h1>Featured Stacks ecosystem</h1>
            <p className="subtext">
              Featured apps in a Stacks-style ecosystem layout for quick exploration.
            </p>
          </header>

          <div className="ecosystem-toolbar">
            {ecosystemCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={`chip ${ecosystemCategory === category ? 'active' : ''}`}
                onClick={() => setEcosystemCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="app-grid">
            {ecosystemApps.map((app) => (
              <article className="app-card" key={app.name}>
                <div className="app-media">
                  <img src={app.image} alt={`${app.name} logo`} loading="lazy" />
                </div>
                <h2>{app.name}</h2>
                <p>{app.summary}</p>
                <div className="tag-row">
                  {app.tags.map((tag) => (
                    <span key={`${app.name}-${tag}`} className="app-tag">{tag}</span>
                  ))}
                </div>
                <a href={app.url} target="_blank" rel="noreferrer" className="app-link">
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

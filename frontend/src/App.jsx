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
const readOnlyNetwork = { coreApiUrl: import.meta.env.VITE_HIRO_PROXY || '/hiro' };

export default function App() {
  const [activeTab, setActiveTab] = useState('faucet');
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');

  const faucet = useFrogFaucet({
    contractAddress,
    contractName,
    network,
    readOnlyNetwork,
    appName: 'FROG Faucet'
  });

  const dao = useFrogDaoNft({
    contractAddress: daoContractAddress,
    contractName: daoContractName,
    network,
    readOnlyNetwork,
    address: faucet.address,
    enabled: activeTab === 'dao-nft'
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
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="row">
                <span>Wallet</span>
                <strong className="mono">{faucet.address || '-'}</strong>
              </div>
              <div className="row">
                <span>Balance</span>
                <strong>{faucet.balance || '-'} FROG</strong>
              </div>
              <div className="row">
                <span>Next claim (block)</span>
                <strong>{faucet.nextClaimBlock || '-'}</strong>
              </div>
              <div className="actions">
                {!faucet.address ? (
                  <button onClick={faucet.connectWallet} disabled={!faucet.ready}>Connect Wallet</button>
                ) : (
                  <>
                    <button onClick={faucet.claim} disabled={!faucet.canClaim}>
                      {faucet.canClaim ? 'Claim 1,000 FROG' : '24h cooldown'}
                    </button>
                    <button className="ghost" onClick={faucet.disconnectWallet}>Disconnect</button>
                  </>
                )}
              </div>
              {faucet.status && <p className="status">{faucet.status}</p>}
              {!faucet.canClaim && (
                <p className="status">Faucet is limited to once every 24h. Wait until block {faucet.nextClaimBlock} to claim again.</p>
              )}
            </div>
          </header>

          <section className="grid">
            <div className="card">
              <h2>Transfer</h2>
              <label>
                Recipient wallet
                <input
                  value={faucet.recipient}
                  onChange={(e) => faucet.setRecipient(e.target.value)}
                  placeholder="SP..."
                />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="1"
                  value={faucet.amount}
                  onChange={(e) => faucet.setAmount(e.target.value)}
                  placeholder="100"
                />
              </label>
              <button onClick={faucet.transfer} disabled={!faucet.address || !faucet.recipient || !faucet.amount}>
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
      ) : activeTab === 'dao-nft' ? (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">FROG DAO</p>
              <h1>Mint DAO Pass NFT</h1>
              <p className="subtext">
                Register a username and hold at least 1,000 FROG to mint a non-transferable DAO pass.
              </p>
            </div>
            <div className="panel">
              <div className="row">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="row">
                <span>Wallet</span>
                <strong className="mono">{faucet.address || '-'}</strong>
              </div>
              <div className="row">
                <span>FROG balance</span>
                <strong>{dao.frogBalance || faucet.balance || '-'} FROG</strong>
              </div>
              <div className="row">
                <span>Username</span>
                <strong>{dao.username || '-'}</strong>
              </div>
              <div className="row">
                <span>DAO pass</span>
                <strong>
                  {dao.hasPass
                    ? (dao.passId ? `Minted (#${dao.passId})` : 'Minted')
                    : 'Not minted'}
                </strong>
              </div>
              <div className="actions">
                {!faucet.address ? (
                  <button onClick={faucet.connectWallet} disabled={!faucet.ready}>Connect Wallet</button>
                ) : (
                  <>
                    <button className="ghost" onClick={dao.refresh} disabled={!dao.ready}>Refresh</button>
                    <button className="ghost" onClick={faucet.disconnectWallet}>Disconnect</button>
                  </>
                )}
              </div>
              {(dao.status || faucet.status) && <p className="status">{dao.status || faucet.status}</p>}
            </div>
          </header>

          <section className="grid">
            <div className="card">
              <h2>Register username</h2>
              <label>
                Username (ASCII, max 32 chars)
                <input
                  value={dao.usernameInput}
                  onChange={(e) => dao.setUsernameInput(e.target.value)}
                  placeholder="frogking"
                  disabled={Boolean(dao.username)}
                />
              </label>
              <button
                onClick={dao.registerUsername}
                disabled={!faucet.address || !dao.ready || Boolean(dao.username) || !dao.usernameInput.trim()}
              >
                {dao.username ? 'Username already set' : 'Register'}
              </button>
            </div>

            <div className="card">
              <h2>Mint DAO pass</h2>
              <p className="subtext" style={{ marginTop: 0 }}>
                Requirement: username registered + hold at least 1,000 FROG.
              </p>
              <button
                onClick={dao.mintPass}
                disabled={!faucet.address || !dao.ready || dao.hasPass || !dao.eligible}
              >
                {dao.hasPass ? 'Already minted' : dao.eligible ? 'Mint pass' : 'Not eligible'}
              </button>
            </div>

            <div className="card">
              <h2>DAO contract</h2>
              <ul>
                <li><span>Contract</span> <strong className="mono">{daoContractAddress}.{daoContractName}</strong></li>
                <li><span>Network</span> <strong>{network}</strong></li>
                <li><span>Mint rule</span> <strong>1 pass per address</strong></li>
                <li><span>Transfer</span> <strong>Disabled</strong></li>
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

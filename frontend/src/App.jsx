import { useEffect, useMemo, useState } from 'react';
import { connect, disconnect, getLocalStorage, isConnected, request } from '@stacks/connect';
import { Cl, cvToValue, fetchCallReadOnlyFunction, principalCV } from '@stacks/transactions';

const appDetails = {
  name: 'FROG Faucet'
};

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token';
const network = 'testnet';

const tabs = [
  { id: 'faucet', label: 'frog stack faucet' },
  { id: 'ecosystem', label: 'stacks ecosystem' }
];

const ecosystemCategories = [
  'Highlighted Apps',
  'DeFi',
  'Social',
  'DAO',
  'NFT',
  'Data',
  'Other',
  'App Development'
];

const highlightedApps = [
  {
    name: 'ALEX',
    summary: "Open-source DeFi protocol modeled on the world's financial markets.",
    tags: ['DeFi'],
    url: 'https://alexgo.io/'
  },
  {
    name: 'Arkadiko',
    summary: 'Open source protocol that mints a stablecoin and generates Bitcoin yield.',
    tags: ['DeFi'],
    url: 'https://arkadiko.finance/'
  },
  {
    name: 'BNS-V2',
    summary: 'Manage your decentralized identities on the Stacks blockchain.',
    tags: ['Social'],
    url: 'https://www.bnsv2.com/'
  },
  {
    name: 'BitFlow',
    summary: 'The decentralized exchange for Bitcoiners.',
    tags: ['DeFi'],
    url: 'https://www.bitflow.finance/'
  },
  {
    name: 'BlockSurvey',
    summary: 'Collect and share form data with guaranteed privacy.',
    tags: ['Other', 'Data'],
    url: 'https://blocksurvey.io/'
  },
  {
    name: 'Gamma',
    summary: 'Explore, collect, and sell NFTs secured by Bitcoin.',
    tags: ['NFT'],
    url: 'https://gamma.io/'
  },
  {
    name: 'GoSats',
    summary: 'Bitcoin cashback rewards app that helps you stack sats when you shop.',
    tags: ['Other'],
    url: 'https://gosats.io/'
  },
  {
    name: 'Granite',
    summary: 'Autonomous Bitcoin liquidity protocol for LPs, borrowers, and liquidators.',
    tags: ['DeFi'],
    url: 'https://docs.granite.world/'
  },
  {
    name: 'Hermetica',
    summary: 'A Bitcoin-backed, yield-bearing synthetic dollar protocol.',
    tags: ['DeFi'],
    url: 'https://www.hermetica.fi/'
  },
  {
    name: 'LunarCrush',
    summary: 'Social media analytics data provider and leaderboards.',
    tags: ['Data', 'Social'],
    url: 'https://lunarcrush.com/discover/stacks-ecosystem'
  },
  {
    name: 'Owl Link',
    summary: 'Decentralized bio links using .btc domains.',
    tags: ['Social'],
    url: 'https://owl.link'
  },
  {
    name: 'STX20',
    summary: 'A protocol for creating and sharing digital artifacts on Stacks.',
    tags: ['NFT', 'Other'],
    url: 'https://stx20.com/'
  },
  {
    name: 'Sigle',
    summary: 'Decentralized and open-source Web3 writing platform.',
    tags: ['Social', 'Other'],
    url: 'https://www.sigle.io/'
  },
  {
    name: 'Stacking DAO',
    summary: 'Liquidity for stacked tokens on Stacks.',
    tags: ['DAO', 'DeFi'],
    url: 'https://stackingdao.com/'
  },
  {
    name: 'Velar',
    summary: 'A multi-feature DeFi app with Bitcoin finality, built on Stacks.',
    tags: ['DeFi'],
    url: 'https://velar.co/'
  },
  {
    name: 'Zest Protocol',
    summary: 'A lending protocol built for Bitcoin.',
    tags: ['DeFi'],
    url: 'https://app.zestprotocol.com'
  }
];

const unwrapResponse = (cv) => {
  const value = cvToValue(cv);
  if (value && typeof value === 'object' && 'type' in value) {
    if (value.type === 'ok') return value.value;
    if (value.type === 'err') throw new Error(`Contract error: ${value.value}`);
  }
  return value;
};

const stringifyClarityValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object' && 'value' in value) {
    return stringifyClarityValue(value.value);
  }
  return JSON.stringify(value);
};

export default function App() {
  const [activeTab, setActiveTab] = useState('faucet');
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');
  const [nextClaimBlock, setNextClaimBlock] = useState('');
  const [canClaim, setCanClaim] = useState(true);
  const [status, setStatus] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  const ready = useMemo(() => contractAddress.length > 0, [contractAddress]);
  const ecosystemApps = useMemo(() => {
    if (ecosystemCategory === 'Highlighted Apps') return highlightedApps;
    return highlightedApps.filter((app) => app.tags.includes(ecosystemCategory));
  }, [ecosystemCategory]);

  const loadAddress = () => {
    const data = getLocalStorage();
    const stxAddress = data?.addresses?.stx?.[0]?.address || '';
    if (stxAddress) setAddress(stxAddress);
    return stxAddress;
  };

  const connectWallet = async () => {
    setStatus('Connecting wallet...');
    try {
      const response = await connect({ appDetails });
      const stxFromResponse =
        response?.addresses?.stx?.[0]?.address ||
        response?.addresses?.find?.((item) => item?.address?.startsWith?.('S'))?.address ||
        '';
      const stxAddress = stxFromResponse || loadAddress();
      if (!stxAddress) {
        setStatus('Could not load wallet address.');
        return;
      }
      setAddress(stxAddress);
      setStatus('Wallet connected.');
      await refreshData();
    } catch (err) {
      setStatus(`Connection failed: ${err?.message || err}`);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    setAddress('');
    setBalance('');
    setNextClaimBlock('');
    setStatus('Disconnected.');
  };

  const readOnly = async (functionName, functionArgs = []) => {
    const senderAddress = address || contractAddress;
    const result = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderAddress,
      network
    });
    return unwrapResponse(result);
  };

  const refreshData = async () => {
    if (!address || !ready) return;
    try {
      const bal = await readOnly('get-balance', [principalCV(address)]);
      const next = await readOnly('get-next-claim-block', [principalCV(address)]);
      const can = await readOnly('can-claim?', [principalCV(address)]);
      setBalance(stringifyClarityValue(bal));
      setNextClaimBlock(stringifyClarityValue(next));
      setCanClaim(Boolean(can));
    } catch (err) {
      setStatus(`Read data failed: ${err?.message || err}`);
    }
  };

  const claim = async () => {
    if (!canClaim) {
      setStatus('24h cooldown not reached yet. Please try again later.');
      return;
    }
    setStatus('Submitting claim...');
    try {
      await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'claim',
        functionArgs: [],
        network
      });
      setStatus('Claim transaction submitted.');
    } catch (err) {
      setStatus(`Claim failed: ${err?.message || err}`);
    }
  };

  const transfer = async () => {
    if (!recipient || !amount) return;
    setStatus('Submitting transfer...');
    try {
      await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'transfer',
        functionArgs: [
          Cl.uint(BigInt(amount)),
          Cl.standardPrincipal(address),
          Cl.standardPrincipal(recipient),
          Cl.none()
        ],
        network
      });
      setStatus('Transfer transaction submitted.');
    } catch (err) {
      setStatus(`Transfer failed: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    if (isConnected()) {
      loadAddress();
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [address]);

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

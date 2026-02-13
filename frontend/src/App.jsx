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
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/62b7a54730c30d0840766c4d_clarity%20favicon%20(1).avif',
    url: 'https://alexgo.io/'
  },
  {
    name: 'Arkadiko',
    summary: 'Open source protocol that mints a stablecoin and generates Bitcoin yield.',
    tags: ['DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/61935d03c4bb83f38a6f9d91_arkadiko_icon.avif',
    url: 'https://arkadiko.finance/'
  },
  {
    name: 'BNS-V2',
    summary: 'Manage your decentralized identities on the Stacks blockchain.',
    tags: ['Social'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/67291c2fc0a5f035d42b0f40_BNSLogo.svg',
    url: 'https://www.bnsv2.com/'
  },
  {
    name: 'BitFlow',
    summary: 'The decentralized exchange for Bitcoiners.',
    tags: ['DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/664914a6ca462a48650e646b_qFa1-Xvi_400x400.avif',
    url: 'https://www.bitflow.finance/'
  },
  {
    name: 'BlockSurvey',
    summary: 'Collect and share form data with guaranteed privacy.',
    tags: ['Other', 'Data'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/61937cdbf5dbb19c1e358e84_blocksurvey_icon.avif',
    url: 'https://blocksurvey.io/'
  },
  {
    name: 'Gamma',
    summary: 'Explore, collect, and sell NFTs secured by Bitcoin.',
    tags: ['NFT'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/62ba07d39bd10612749af267_5dDBxzBawicNRBFxdCJmiommOIk1X1mt-cQlaR9YhL1Zu9AcpyK4gWAMkxVN2A3zc.avif',
    url: 'https://gamma.io/'
  },
  {
    name: 'GoSats',
    summary: 'Bitcoin cashback rewards app that helps you stack sats when you shop.',
    tags: ['Other'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/6197ef08d950d74033c018f1_Group%205669.avif',
    url: 'https://gosats.io/'
  },
  {
    name: 'Granite',
    summary: 'Autonomous Bitcoin liquidity protocol for LPs, borrowers, and liquidators.',
    tags: ['DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/66f318118877da06fe1b04d7_Granite-protocol.avif',
    url: 'https://docs.granite.world/'
  },
  {
    name: 'Hermetica',
    summary: 'A Bitcoin-backed, yield-bearing synthetic dollar protocol.',
    tags: ['DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/65b129b88198f78918bda3c1_Hermetica%201000.avif',
    url: 'https://www.hermetica.fi/'
  },
  {
    name: 'LunarCrush',
    summary: 'Social media analytics data provider and leaderboards.',
    tags: ['Data', 'Social'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/67e46f1ad51db1d1e7344874_LunarCrush-Logo-IconTextVert-GreenBg.avif',
    url: 'https://lunarcrush.com/discover/stacks-ecosystem'
  },
  {
    name: 'Owl Link',
    summary: 'Decentralized bio links using .btc domains.',
    tags: ['Social'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/6234dbd26efb5213c6acd86b_owllink.svg',
    url: 'https://owl.link'
  },
  {
    name: 'STX20',
    summary: 'A protocol for creating and sharing digital artifacts on Stacks.',
    tags: ['NFT', 'Other'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/6599bcd57a5677c746dca724_NW2_SdJY_400x400.avif',
    url: 'https://stx20.com/'
  },
  {
    name: 'Sigle',
    summary: 'Decentralized and open-source Web3 writing platform.',
    tags: ['Social', 'Other'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/6193596a0cd7e07de5e1217f_sigle_icon.avif',
    url: 'https://www.sigle.io/'
  },
  {
    name: 'Stacking DAO',
    summary: 'Liquidity for stacked tokens on Stacks.',
    tags: ['DAO', 'DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/66103137cdbd08705e15e6b7_Discord%20emojis.avif',
    url: 'https://stackingdao.com/'
  },
  {
    name: 'Velar',
    summary: 'A multi-feature DeFi app with Bitcoin finality, built on Stacks.',
    tags: ['DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/67811238873399fa14b3dfa5_Velar%20Token%20Logo.avif',
    url: 'https://velar.co/'
  },
  {
    name: 'Zest Protocol',
    summary: 'A lending protocol built for Bitcoin.',
    tags: ['DeFi'],
    image: 'https://cdn.prod.website-files.com/618b0aafa4afde9048fe3926/66f3d21c45a572b711cfdde2_zest.avif',
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

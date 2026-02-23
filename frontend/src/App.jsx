import { useEffect, useMemo, useRef, useState } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { Toaster } from 'react-hot-toast';
import { ecosystemCategories, highlightedApps, tabs } from './data/ecosystemData';
import { useFrogFaucet } from './hooks/useFrogFaucet';
import { useFrogDaoNft } from './hooks/useFrogDaoNft';
import { useFrogSocial } from './hooks/useFrogSocial';

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token-v3';

const daoContractAddress = import.meta.env.VITE_DAO_CONTRACT_ADDRESS || contractAddress;
const daoContractName = import.meta.env.VITE_DAO_CONTRACT_NAME || 'frog-dao-nft-v5';
const socialContractAddress = import.meta.env.VITE_SOCIAL_CONTRACT_ADDRESS || contractAddress;
const socialContractName = import.meta.env.VITE_SOCIAL_CONTRACT_NAME || 'frog-social-v1';
const socialTipAmountStx = import.meta.env.VITE_SOCIAL_TIP_STX || '0.1';

const network = (import.meta.env.VITE_STACKS_NETWORK || 'testnet').toLowerCase();
const defaultHiroApiBaseUrl = network === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
// In dev we can proxy via /hiro to avoid CORS; in production call Hiro API directly unless overridden.
const readOnlyBaseUrl = import.meta.env.VITE_HIRO_API_BASE_URL || (import.meta.env.DEV ? '/hiro' : defaultHiroApiBaseUrl);
const primaryButtonClass =
  'rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-900/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const ghostButtonClass =
  'rounded-xl border border-emerald-700/35 bg-transparent px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-900/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const formatterButtonClass =
  'inline-flex items-center gap-1.5 border-r border-emerald-700/20 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50';
const emojiTriggerButtonClass =
  'inline-flex items-center rounded-xl border border-emerald-700/20 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50';
const mediaActionButtonClass =
  'inline-flex items-center rounded-xl border border-emerald-700/20 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50';
const shortenAddress = (address) => {
  if (!address) return '';
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const socialHandleFromAddress = (address) => {
  const raw = String(address || '').trim();
  if (!raw) return 'guest';
  return `frog-${raw.slice(2, 8).toLowerCase()}`;
};

const formatPostTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (/^\d+$/.test(raw)) return `Block #${raw}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const formatTipAmountFromMicroStx = (value) => {
  const raw = String(value || '0').trim();
  if (!/^\d+$/.test(raw)) return '0';

  try {
    const micro = BigInt(raw);
    const whole = micro / 1000000n;
    const frac = micro % 1000000n;
    if (frac === 0n) return whole.toString();

    const fracText = frac.toString().padStart(6, '0').replace(/0+$/, '');
    return `${whole.toString()}.${fracText}`;
  } catch (_) {
    return '0';
  }
};


const renderInlineFormatting = (text, keyPrefix = 'part') => {
  const chunks = String(text || '').split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^\)]+\))/g);
  return chunks.map((chunk, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^`[^`]+`$/.test(chunk)) {
      return <code key={key} className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[12px] text-emerald-900">{chunk.slice(1, -1)}</code>;
    }
    if (/^\[[^\]]+\]\([^\)]+\)$/.test(chunk)) {
      const match = chunk.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (!match) return <span key={key}>{chunk}</span>;
      const [, label, href] = match;
      return <a key={key} href={href} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline underline-offset-2">{label}</a>;
    }
    if (/^~~[^~]+~~$/.test(chunk)) {
      return <s key={key}>{chunk.slice(2, -2)}</s>;
    }
    if (/^\*\*[^*]+\*\*$/.test(chunk)) {
      return <strong key={key}>{chunk.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(chunk)) {
      return <em key={key}>{chunk.slice(1, -1)}</em>;
    }
    return <span key={key}>{chunk}</span>;
  });
};

const renderPostContent = (content) => {
  const lines = String(content || '').split('\n');
  return lines.map((line, index) => {
    const lineKey = `line-${index}`;

    if (/^#{1,3}\s+/.test(line)) {
      const level = Math.min(3, line.match(/^#+/)[0].length);
      const text = line.replace(/^#{1,3}\s+/, '');
      const className = level === 1
        ? 'text-lg font-bold'
        : level === 2
          ? 'text-base font-semibold'
          : 'text-sm font-semibold';
      return (
        <p key={lineKey} className={`${className} mt-1 text-emerald-950`}>
          {renderInlineFormatting(text, `${lineKey}-h`) }
        </p>
      );
    }

    if (/^>\s+/.test(line)) {
      const text = line.replace(/^>\s+/, '');
      return (
        <blockquote key={lineKey} className="mt-1 border-l-2 border-emerald-700/35 pl-3 text-[15px] italic leading-relaxed text-emerald-900/90">
          {renderInlineFormatting(text, `${lineKey}-q`) }
        </blockquote>
      );
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, '');
      return (
        <div key={lineKey} className="mt-1 flex items-start gap-2 text-[15px] leading-relaxed text-emerald-950">
          <span aria-hidden="true" className="mt-1 text-xs">•</span>
          <span>{renderInlineFormatting(text, `${lineKey}-b`)}</span>
        </div>
      );
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const marker = line.match(/^\s*\d+\./)?.[0] || '1.';
      const text = line.replace(/^\s*\d+\.\s+/, '');
      return (
        <div key={lineKey} className="mt-1 flex items-start gap-2 text-[15px] leading-relaxed text-emerald-950">
          <span className="text-xs font-semibold text-emerald-900/70">{marker}</span>
          <span>{renderInlineFormatting(text, `${lineKey}-n`)}</span>
        </div>
      );
    }

    if (!line.trim()) {
      return <div key={lineKey} className="h-3" aria-hidden="true" />;
    }

    return (
      <p key={lineKey} className="mt-1 text-[15px] leading-relaxed text-emerald-950">
        {renderInlineFormatting(line, `${lineKey}-p`) }
      </p>
    );
  });
};

export default function App() {
  const initialTab = (() => {
    const candidate = new URLSearchParams(window.location.search).get('tab');
    if (candidate === 'dao-nft' || candidate === 'social' || candidate === 'ecosystem' || candidate === 'faucet' || candidate === 'admin') return candidate;
    return 'social';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');
  const [socialPostInput, setSocialPostInput] = useState('');
  const [socialStatus, setSocialStatus] = useState('');
  const [socialSelection, setSocialSelection] = useState({ start: 0, end: 0 });
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [socialImageFile, setSocialImageFile] = useState(null);
  const [socialImagePreviewUrl, setSocialImagePreviewUrl] = useState('');
  const socialComposerRef = useRef(null);
  const socialImageInputRef = useRef(null);
  const emojiPickerRef = useRef(null);

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
    enabled: activeTab === 'dao-nft' || activeTab === 'admin' || activeTab === 'social'
  });

  const social = useFrogSocial({
    contractAddress: socialContractAddress,
    contractName: socialContractName,
    network,
    readOnlyBaseUrl,
    address: faucet.address,
    enabled: activeTab === 'social',
    apiBaseUrl: import.meta.env.VITE_SOCIAL_API_BASE_URL || '',
    hasDaoPass: dao.hasPass,
    tipAmountStx: socialTipAmountStx
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
    if (social.status) setSocialStatus(social.status);
  }, [social.status]);

  useEffect(() => {
    if (activeTab === 'admin' && !(Boolean(faucet.address) && isOwner)) {
      setActiveTab('faucet');
    }
  }, [activeTab, faucet.address, isOwner]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!isEmojiPickerOpen) return;
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setIsEmojiPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEmojiPickerOpen]);

  useEffect(() => {
    return () => {
      if (socialImagePreviewUrl) URL.revokeObjectURL(socialImagePreviewUrl);
    };
  }, [socialImagePreviewUrl]);

  const socialFeed = social.posts || [];

  const topCreatorsWeekly = useMemo(() => {
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const creators = new Map();

    for (const post of socialFeed) {
      const publishedAt = Date.parse(String(post.createdAtIso || ''));
      if (!Number.isFinite(publishedAt) || publishedAt < cutoffTime) continue;

      const key = String(post.author || '').trim();
      if (!key) continue;

      const current = creators.get(key) || { author: key, totalLikes: 0, postCount: 0 };
      current.totalLikes += Number(post.likeCount || '0');
      current.postCount += 1;
      creators.set(key, current);
    }

    return [...creators.values()]
      .sort((a, b) => b.totalLikes - a.totalLikes)
      .slice(0, 5);
  }, [socialFeed]);

  const updateSocialSelection = () => {
    const node = socialComposerRef.current;
    if (!node) return;
    setSocialSelection({
      start: node.selectionStart || 0,
      end: node.selectionEnd || 0
    });
  };

  const applyWrapFormat = (prefix, suffix = prefix) => {
    const node = socialComposerRef.current;
    if (!node) return;

    const start = node.selectionStart || 0;
    const end = node.selectionEnd || 0;
    if (start === end) return;

    const selected = socialPostInput.slice(start, end);
    const hasWrappedSelection = start >= prefix.length
      && end + suffix.length <= socialPostInput.length
      && socialPostInput.slice(start - prefix.length, start) === prefix
      && socialPostInput.slice(end, end + suffix.length) === suffix;

    const next = hasWrappedSelection
      ? `${socialPostInput.slice(0, start - prefix.length)}${selected}${socialPostInput.slice(end + suffix.length)}`
      : `${socialPostInput.slice(0, start)}${prefix}${selected}${suffix}${socialPostInput.slice(end)}`;

    setSocialPostInput(next);
    requestAnimationFrame(() => {
      node.focus();
      if (hasWrappedSelection) {
        node.setSelectionRange(start - prefix.length, end - prefix.length);
      } else {
        node.setSelectionRange(start + prefix.length, end + prefix.length);
      }
      updateSocialSelection();
    });
  };

  const applyLinePrefixFormat = (prefix) => {
    const node = socialComposerRef.current;
    if (!node) return;

    const start = node.selectionStart || 0;
    const end = node.selectionEnd || 0;
    if (start === end) return;

    const lineStart = socialPostInput.lastIndexOf('\n', start - 1) + 1;
    const lineEndSearch = socialPostInput.indexOf('\n', end);
    const lineEnd = lineEndSearch === -1 ? socialPostInput.length : lineEndSearch;
    const block = socialPostInput.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    const isFullyPrefixed = nonEmptyLines.length > 0
      && nonEmptyLines.every((line) => line.startsWith(prefix));
    const nextBlock = lines
      .map((line) => {
        if (!line.trim()) return line;
        return isFullyPrefixed && line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`;
      })
      .join('\n');

    const next = `${socialPostInput.slice(0, lineStart)}${nextBlock}${socialPostInput.slice(lineEnd)}`;

    setSocialPostInput(next);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(lineStart, lineStart + nextBlock.length);
      updateSocialSelection();
    });
  };

  const insertEmoji = (emoji) => {
    const node = socialComposerRef.current;
    if (!node) return;

    const start = node.selectionStart || 0;
    const end = node.selectionEnd || 0;
    const next = `${socialPostInput.slice(0, start)}${emoji}${socialPostInput.slice(end)}`;

    setSocialPostInput(next);
    setIsEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      const nextCaret = start + emoji.length;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
      updateSocialSelection();
    });
  };

  const clearSocialImage = () => {
    if (socialImagePreviewUrl) URL.revokeObjectURL(socialImagePreviewUrl);
    setSocialImagePreviewUrl('');
    setSocialImageFile(null);
    if (socialImageInputRef.current) {
      socialImageInputRef.current.value = '';
    }
  };

  const onSelectSocialImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!String(file.type || '').toLowerCase().startsWith('image/')) {
      setSocialStatus('Only image files are allowed.');
      if (socialImageInputRef.current) socialImageInputRef.current.value = '';
      return;
    }

    if (Number(file.size || 0) > 5 * 1024 * 1024) {
      setSocialStatus('Image is too large (max 5MB).');
      if (socialImageInputRef.current) socialImageInputRef.current.value = '';
      return;
    }

    if (socialImagePreviewUrl) URL.revokeObjectURL(socialImagePreviewUrl);
    setSocialStatus('');
    setSocialImageFile(file);
    setSocialImagePreviewUrl(URL.createObjectURL(file));
  };

  const createSocialPost = async () => {
    const content = socialPostInput.trim();
    if (!content) {
      setSocialStatus('Post content cannot be empty.');
      return;
    }

    const published = await social.publish(content, socialImageFile);
    if (published) {
      setSocialPostInput('');
      clearSocialImage();
      setSocialSelection({ start: 0, end: 0 });
    }
  };

  const likeSocialPost = async (postId) => {
    await social.like(postId);
  };

  const tipSocialPost = async (postId, recipient, contentHash) => {
    await social.tipPost(postId, recipient, contentHash);
  };


  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#ffffff_0%,#eaf5ef_45%,#d9efe4_100%)] text-emerald-950">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            border: '1px solid rgba(6, 78, 59, 0.15)',
            color: '#064e3b'
          }
        }}
      />
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
                className={`whitespace-nowrap rounded-xl border px-3.5 py-2 text-xs font-bold capitalize transition ${
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
                    dao.isRegistering
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
      ) : activeTab === 'social' ? (
        <>
          <header className="grid items-start gap-8 lg:grid-cols-[minmax(440px,1fr)_minmax(260px,340px)]">
            <div className="rounded-3xl border border-emerald-900/15 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-700 text-sm font-bold text-white">
                  {faucet.address ? socialHandleFromAddress(faucet.address).slice(0, 2).toUpperCase() : 'FG'}
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-950">{faucet.address ? `@${socialHandleFromAddress(faucet.address)}` : '@guest'}</p>
                  <p className="text-xs text-emerald-900/60">{faucet.address ? shortenAddress(faucet.address) : 'Connect wallet to publish and like posts'}</p>
                </div>
              </div>

              <textarea
                ref={socialComposerRef}
                className="mt-4 min-h-[150px] w-full resize-none rounded-2xl border border-emerald-900/15 bg-emerald-50/35 px-4 py-3 text-base outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                value={socialPostInput}
                onSelect={updateSocialSelection}
                onKeyUp={updateSocialSelection}
                onClick={updateSocialSelection}
                onChange={(event) => {
                  setSocialPostInput(event.target.value);
                  updateSocialSelection();
                }}
                placeholder="What is happening in FROG community today?"
                maxLength={500}
              />

              <div className="mt-3 space-y-2">
                <div className="inline-flex flex-wrap overflow-hidden rounded-xl border border-emerald-700/20 bg-white">
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('**')}><span>Bold</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('*')}><span>Italic</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('`')}><span>Code</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('~~')}><span>Strike</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('[', '](https://)')}><span>Link</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('# ')}><span>H1</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('## ')}><span>H2</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('> ')}><span>Quote</span></button>
                  <button type="button" className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('- ')}><span>List</span></button>
                </div>

                <div className="flex flex-wrap items-start gap-2">
                  <div ref={emojiPickerRef} className="relative inline-block">
                    <button
                      type="button"
                      className={emojiTriggerButtonClass}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
                    >
                      Add emoji
                    </button>
                    {isEmojiPickerOpen && (
                      <div className="absolute left-0 top-[calc(100%+8px)] z-20">
                        <EmojiPicker
                          onEmojiClick={(emojiData) => insertEmoji(emojiData.emoji)}
                          lazyLoadEmojis
                          previewConfig={{ showPreview: false }}
                          width={320}
                          height={380}
                        />
                      </div>
                    )}
                  </div>

                  <input
                    ref={socialImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onSelectSocialImage}
                  />
                  <button
                    type="button"
                    className={mediaActionButtonClass}
                    onClick={() => socialImageInputRef.current?.click()}
                    disabled={Boolean(socialImageFile)}
                  >
                    Upload image
                  </button>

                  {socialImageFile && socialImagePreviewUrl && (
                    <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-700/20 bg-white px-2 py-1.5">
                      <img src={socialImagePreviewUrl} alt="Selected upload preview" className="h-9 w-9 rounded-md object-cover" />
                      <div className="max-w-[150px]">
                        <p className="truncate text-xs font-semibold text-emerald-900">{socialImageFile.name}</p>
                        <p className="text-[11px] text-emerald-900/60">One image per post</p>
                      </div>
                      <button type="button" className="rounded-md border border-emerald-700/20 px-2 py-1 text-[11px] font-semibold text-emerald-800" onClick={clearSocialImage}>Remove</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-emerald-900/15 bg-emerald-50/40 px-4 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800/70">Live Preview</p>
                {socialPostInput.trim() || socialImagePreviewUrl
                  ? (
                    <div className="space-y-3 text-[15px] leading-relaxed text-emerald-950">
                      {socialPostInput.trim() ? renderPostContent(socialPostInput) : null}
                      {socialImagePreviewUrl && (
                        <img src={socialImagePreviewUrl} alt="Post image preview" className="max-h-72 w-full rounded-2xl border border-emerald-900/10 bg-emerald-100/40 object-contain" />
                      )}
                    </div>
                  )
                  : <p className="text-sm text-emerald-900/55">Your formatted preview will appear here as you type.</p>}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-emerald-900/60">{socialPostInput.length}/500 characters</p>
                <button className={primaryButtonClass} onClick={createSocialPost} disabled={!faucet.address || !social.ready || social.isPublishing}>
                  {social.isPublishing ? 'Publishing...' : `Publish (${social.postFee || '50'} FROG)`}
                </button>
              </div>
              {socialStatus && <p className="mt-3 text-sm text-emerald-900/65">{socialStatus}</p>}
              <p className="mt-1 text-xs text-emerald-900/55">Your balance: {social.viewerBalance || faucet.balance || '0'} FROG</p>
              {!social.ready && <p className="mt-1 text-xs text-emerald-900/55">Social contract is not configured.</p>}
            </div>

            <div className="rounded-3xl border border-emerald-900/15 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-800/65">Weekly Leaderboard (Last 7 Days)</p>
              <h2 className="mt-1 text-xl font-semibold">Top 5 Creators</h2>
              <div className="mt-4 space-y-2.5">
                {topCreatorsWeekly.length > 0 ? topCreatorsWeekly.map((creator, index) => (
                  <div key={creator.author} className="flex items-center justify-between rounded-2xl border border-emerald-900/10 bg-emerald-50/60 px-3 py-2">
                    <div>
                      <p className="text-xs text-emerald-900/60">Rank #{index + 1}</p>
                      <p className="text-sm font-semibold text-emerald-950">@{socialHandleFromAddress(creator.author)}</p>
                    </div>
                    <strong className="text-sm">{creator.totalLikes} likes</strong>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-emerald-900/25 bg-emerald-50/40 px-3 py-2 text-sm text-emerald-900/70">
                    No rankings this week.
                  </div>
                )}
              </div>
              <p className="mt-4 text-xs text-emerald-900/60">Fees: Publish {social.postFee || '50'} FROG, Like {social.likeFee || '5'} FROG. Tip: {socialTipAmountStx} STX. Treasury: {shortenAddress(social.treasury)}</p>
            </div>
          </header>

          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-800/65">Community Feed</p>
                <h2 className="text-2xl font-semibold">Latest Posts</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-emerald-700/20 bg-white px-3 py-1 text-xs font-bold text-emerald-800">{socialFeed.length} posts</span>
                <button className={ghostButtonClass} onClick={() => social.refresh(20)} disabled={!social.ready || social.isRefreshing || social.isPublishing || Boolean(social.likingPostId) || Boolean(social.tippingPostId)}>
                  {social.isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {socialFeed.length > 0 ? (
              <div className="mx-auto grid max-w-3xl gap-4">
                {socialFeed.map((post) => {
                  const hasLiked = Boolean(post.hasLikedByViewer);
                  const isOwnPost = Boolean(faucet.address && post.author === faucet.address);
                  const isTippingThisPost = social.tippingPostId === String(post.id);
                  return (
                    <article key={post.id} className="overflow-hidden rounded-3xl border border-emerald-900/15 bg-white shadow-[0_18px_38px_rgba(14,35,24,0.12)]">
                      <div className="flex items-center justify-between border-b border-emerald-900/10 px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                            {socialHandleFromAddress(post.author).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-emerald-950">@{socialHandleFromAddress(post.author)}</p>
                            <p className="font-mono text-[11px] text-emerald-900/60">{shortenAddress(post.author)}</p>
                          </div>
                        </div>
                        <p className="text-xs text-emerald-900/60">{formatPostTime(post.createdAtBlock)}</p>
                      </div>

                      <div className="px-4 py-4">
                        {renderPostContent(post.text || '')}
                        {Array.isArray(post.images) && post.images.length > 0 && (
                          <div className="mt-3 grid gap-2">
                            {post.images.map((imageUrl) => (
                              <a key={`${post.id}-${imageUrl}`} href={imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-emerald-900/10">
                                <img src={imageUrl} alt="Post attachment" className="max-h-[70vh] w-full bg-emerald-100/40 object-contain" loading="lazy" />
                              </a>
                            ))}
                          </div>
                        )}
                        {Array.isArray(post.links) && post.links.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {post.links.map((link) => (
                              <a key={`${post.id}-${link}`} href={link} target="_blank" rel="noreferrer" className="rounded-full border border-emerald-700/20 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:underline">
                                {link}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between border-t border-emerald-900/10 bg-emerald-50/40 px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-900/70">
                          <span aria-hidden="true">❤️</span>
                          <span>{post.likeCount || '0'} likes</span>
                          <span className="text-emerald-900/45">•</span>
                          <span>{formatTipAmountFromMicroStx(post.totalTipMicroStx || '0')} STX tipped</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            className={ghostButtonClass}
                            type="button"
                            onClick={() => tipSocialPost(post.id, post.author, post.contentHash)}
                            disabled={isOwnPost || isTippingThisPost || !faucet.address || social.isPublishing || social.likingPostId === String(post.id)}
                          >
                            {isTippingThisPost ? 'Tipping...' : isOwnPost ? 'Own post' : `Tip ${socialTipAmountStx} STX`}
                          </button>
                          <button
                            className={hasLiked ? ghostButtonClass : primaryButtonClass}
                            type="button"
                            onClick={() => likeSocialPost(post.id)}
                            disabled={hasLiked || isOwnPost || social.likingPostId === String(post.id) || !faucet.address || isTippingThisPost}
                          >
                            {social.likingPostId === String(post.id) ? 'Liking...' : hasLiked ? 'Liked' : isOwnPost ? 'Own post' : `Like (${social.likeFee || '5'} FROG)`}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-emerald-900/25 bg-emerald-50/40 p-6 text-sm text-emerald-900/70">
                Feed is empty. Publish the first post to kickstart community discussions.
              </div>
            )}
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
                className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
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

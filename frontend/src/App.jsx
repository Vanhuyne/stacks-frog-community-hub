import { useEffect, useMemo, useRef, useState } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { Toaster } from 'react-hot-toast';
import { Heart, Loader2 } from 'lucide-react';
import { ecosystemCategories, highlightedApps, tabs } from './data/ecosystemData';
import { useFrogFaucet } from './hooks/useFrogFaucet';
import { useFrogDaoNft } from './hooks/useFrogDaoNft';
import { useFrogSocial } from './hooks/useFrogSocial';
import { createFrogDaoNftService } from './services/frogDaoNftService';

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token-v3';

const daoContractAddress = import.meta.env.VITE_DAO_CONTRACT_ADDRESS || contractAddress;
const daoContractName = import.meta.env.VITE_DAO_CONTRACT_NAME || 'frog-dao-nft-v5';
const socialContractAddress = import.meta.env.VITE_SOCIAL_CONTRACT_ADDRESS || contractAddress;
const socialContractName = import.meta.env.VITE_SOCIAL_CONTRACT_NAME || 'frog-social-v1';

const isLikelyContractPrincipal = (value) => /^S[PMTN][A-Z0-9]{39}$/.test(String(value || '').trim());

const socialTipsContractId = String(import.meta.env.VITE_SOCIAL_TIPS_CONTRACT_ID || '').trim();
const socialTipsContractIdParts = socialTipsContractId.split('.');
const socialTipsAddressFromId =
  socialTipsContractIdParts.length === 2 && isLikelyContractPrincipal(socialTipsContractIdParts[0])
    ? socialTipsContractIdParts[0]
    : '';
const socialTipsAddressFallback = String(import.meta.env.VITE_SOCIAL_TIPS_CONTRACT_ADDRESS || '').trim();
const socialTipsContractAddress = socialTipsAddressFromId
  || (isLikelyContractPrincipal(socialTipsAddressFallback) ? socialTipsAddressFallback : socialContractAddress);
const socialTipsContractName =
  socialTipsContractIdParts.length === 2 && socialTipsContractIdParts[1]
    ? socialTipsContractIdParts[1]
    : (import.meta.env.VITE_SOCIAL_TIPS_CONTRACT_NAME || 'frog-social-tips-v1');
const socialTipAmountStx = import.meta.env.VITE_SOCIAL_TIP_STX || '0.1';

const network = (import.meta.env.VITE_STACKS_NETWORK || 'testnet').toLowerCase();
const effectiveSocialTipsContractName =
  network === 'mainnet' && socialTipsContractName === 'frog-social-tips-reputation-v1'
    ? 'frog-social-tips-v1'
    : socialTipsContractName;
const defaultHiroApiBaseUrl = network === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
const configuredHiroApiBaseUrl = String(import.meta.env.VITE_HIRO_API_BASE_URL || '').trim();
// In dev always use Vite proxy (/hiro) to avoid browser CORS with Hiro.
const readOnlyBaseUrl = import.meta.env.DEV
  ? '/hiro'
  : (configuredHiroApiBaseUrl || defaultHiroApiBaseUrl);
const configuredSocialApiBaseUrl = String(import.meta.env.VITE_SOCIAL_API_BASE_URL || '').trim();
const defaultSocialApiBaseUrl = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://stacks-frog-community-hub.onrender.com';
const socialApiBaseUrl = (!import.meta.env.DEV && (configuredSocialApiBaseUrl.startsWith('http://localhost') || configuredSocialApiBaseUrl.startsWith('https://localhost') || configuredSocialApiBaseUrl.startsWith('http://127.') || configuredSocialApiBaseUrl.startsWith('https://127.')))
  ? defaultSocialApiBaseUrl
  : (configuredSocialApiBaseUrl || defaultSocialApiBaseUrl);
const primaryButtonClass =
  'inline-flex w-full items-center justify-center rounded-none bg-[#3a10e5] px-6 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#10162f]/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const ghostButtonClass =
  'inline-flex w-full items-center justify-center rounded-none border border-[#10162f]/35 bg-transparent px-6 py-2.5 text-sm font-medium text-[#10162f] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#10162f]/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';
const formatterButtonClass =
  'inline-flex items-center gap-1.5 border-r border-[#10162f]/25 px-3 py-1.5 text-xs font-medium text-[#10162f] transition hover:bg-[#f5f3eb]';
const emojiTriggerButtonClass =
  'inline-flex items-center rounded-none border border-[#10162f]/25 bg-white px-3 py-1.5 text-xs font-medium text-[#10162f] transition hover:bg-[#f5f3eb]';
const mediaActionButtonClass =
  'inline-flex items-center rounded-none border border-[#10162f]/25 bg-white px-3 py-1.5 text-xs font-medium text-[#10162f] transition hover:bg-[#f5f3eb] disabled:cursor-not-allowed disabled:opacity-50';
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

const addMicroStxStrings = (left, right) => {
  try {
    const a = BigInt(String(left || '0'));
    const b = BigInt(String(right || '0'));
    return (a + b).toString();
  } catch (_) {
    return String(left || '0');
  }
};


const formatCooldownEta = (seconds) => {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return 'Ready now';

  const safe = Math.max(0, Math.floor(total));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}`;
};

const renderInlineFormatting = (text, keyPrefix = 'part') => {
  const chunks = String(text || '').split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^\)]+\))/g);
  return chunks.map((chunk, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^`[^`]+`$/.test(chunk)) {
      return <code key={key} className="rounded-none bg-[#e6ecff] px-1.5 py-0.5 font-mono text-[12px] text-[#10162f]">{chunk.slice(1, -1)}</code>;
    }
    if (/^\[[^\]]+\]\([^\)]+\)$/.test(chunk)) {
      const match = chunk.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (!match) return <span key={key}>{chunk}</span>;
      const [, label, href] = match;
      return <a key={key} href={href} target="_blank" rel="noreferrer" className="font-medium text-[#10162f] underline underline-offset-2">{label}</a>;
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
          ? 'text-base font-medium'
          : 'text-sm font-medium';
      return (
        <p key={lineKey} className={`${className} mt-1 text-[#10162f]`}>
          {renderInlineFormatting(text, `${lineKey}-h`) }
        </p>
      );
    }

    if (/^>\s+/.test(line)) {
      const text = line.replace(/^>\s+/, '');
      return (
        <blockquote key={lineKey} className="mt-1 border-l-2 border-[#10162f]/35 pl-3 text-[15px] italic leading-relaxed text-[#10162f]/95">
          {renderInlineFormatting(text, `${lineKey}-q`) }
        </blockquote>
      );
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, '');
      return (
        <div key={lineKey} className="mt-1 flex items-start gap-2 text-[15px] leading-relaxed text-[#10162f]">
          <span aria-hidden="true" className="mt-1 text-xs">•</span>
          <span>{renderInlineFormatting(text, `${lineKey}-b`)}</span>
        </div>
      );
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const marker = line.match(/^\s*\d+\./)?.[0] || '1.';
      const text = line.replace(/^\s*\d+\.\s+/, '');
      return (
        <div key={lineKey} className="mt-1 flex items-start gap-2 text-[15px] leading-relaxed text-[#10162f]">
          <span className="text-xs font-medium text-[#10162f]/75">{marker}</span>
          <span>{renderInlineFormatting(text, `${lineKey}-n`)}</span>
        </div>
      );
    }

    if (!line.trim()) {
      return <div key={lineKey} className="h-3" aria-hidden="true" />;
    }

    return (
      <p key={lineKey} className="mt-1 text-[15px] leading-relaxed text-[#10162f]">
        {renderInlineFormatting(line, `${lineKey}-p`) }
      </p>
    );
  });
};

export default function App() {
  const initialTab = (() => {
    const candidate = new URLSearchParams(window.location.search).get('tab');
    if (candidate === 'dao-nft' || candidate === 'social' || candidate === 'ecosystem' || candidate === 'faucet' || candidate === 'admin') return candidate;
    return 'ecosystem';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activePage, setActivePage] = useState("app");
  const [usernamesByAddress, setUsernamesByAddress] = useState({});
  const usernameLookupInFlightRef = useRef(new Set());
  const [ecosystemCategory, setEcosystemCategory] = useState('Highlighted Apps');
  const [socialPostInput, setSocialPostInput] = useState('');
  const [socialStatus, setSocialStatus] = useState('');
  const [socialSelection, setSocialSelection] = useState({ start: 0, end: 0 });
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [socialImageFile, setSocialImageFile] = useState(null);
  const [socialImagePreviewUrl, setSocialImagePreviewUrl] = useState('');
  const [tipStatusByPostId, setTipStatusByPostId] = useState({});
  const [leaderboardRange, setLeaderboardRange] = useState('weekly');
  const [socialLeaderboard, setSocialLeaderboard] = useState({
    loading: false,
    error: '',
    updatedAt: '',
    creatorTipperEnabled: false,
    posts: [],
    creators: [],
    tippers: []
  });
  const [leaderboardRefreshNonce, setLeaderboardRefreshNonce] = useState(0);
  const tipStatusTimeoutByPostIdRef = useRef(new Map());
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
    enabled: activeTab === 'dao-nft' || activeTab === 'admin' || (activeTab === 'social' && Boolean(faucet.address))
  });

  const daoLookupService = useMemo(
    () => createFrogDaoNftService({ contractAddress: daoContractAddress, contractName: daoContractName, network, readOnlyBaseUrl }),
    [daoContractAddress, daoContractName, network, readOnlyBaseUrl]
  );

  const social = useFrogSocial({
    contractAddress: socialContractAddress,
    contractName: socialContractName,
    tipsContractAddress: socialTipsContractAddress,
    tipsContractName: effectiveSocialTipsContractName,
    network,
    readOnlyBaseUrl,
    address: faucet.address,
    enabled: activeTab === 'social' || (activePage === "profile" && Boolean(faucet.address)),
    apiBaseUrl: socialApiBaseUrl,
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
    () => tabs.filter((tab) => tab.id !== 'ecosystem' && (tab.id !== 'admin' || (Boolean(faucet.address) && isOwner))),
    [faucet.address, isOwner]
  );

  const registeredUsername = String(dao.username || '').trim();
  const displayUserHandle = (address) => {
    const normalized = String(address || '').trim();
    if (!normalized) return 'guest';

    const mappedUsername = String(usernamesByAddress[normalized] || '').trim();
    if (mappedUsername) return mappedUsername;

    if (faucet.address && normalized === faucet.address && registeredUsername) return registeredUsername;
    return socialHandleFromAddress(normalized);
  };


  useEffect(() => {
    if (social.status) setSocialStatus(social.status);
  }, [social.status]);

  useEffect(() => {
    tipStatusTimeoutByPostIdRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    tipStatusTimeoutByPostIdRef.current.clear();
    setTipStatusByPostId({});
  }, [faucet.address]);

  useEffect(() => () => {
    tipStatusTimeoutByPostIdRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    tipStatusTimeoutByPostIdRef.current.clear();
  }, []);

  useEffect(() => {
    if (activeTab === 'admin' && !(Boolean(faucet.address) && isOwner)) {
      setActiveTab('faucet');
    }
  }, [activeTab, faucet.address, isOwner]);

  useEffect(() => {
    if (activePage === "profile" && !faucet.address) {
      setActivePage("app");
    }
  }, [activePage, faucet.address]);

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
  const isSocialFeedLoading = social.isRefreshing && socialFeed.length === 0;
  const isSocialActionLocked = social.isRefreshing || social.isPublishing || Boolean(social.likingPostId) || Boolean(social.tippingPostId);

  const userPosts = useMemo(() => {
    if (!faucet.address) return [];
    return socialFeed.filter((post) => post.author === faucet.address);
  }, [faucet.address, socialFeed]);

  const userPostCount = userPosts.length;

  useEffect(() => {
    if (activeTab !== 'social') return;

    const baseUrl = String(socialApiBaseUrl || '').replace(/\/$/, '');
    if (!baseUrl) return;

    const controller = new AbortController();
    let cancelled = false;

    setSocialLeaderboard((prev) => ({ ...prev, loading: true, error: '' }));

    const run = async () => {
      try {
        const response = await fetch(`${baseUrl}/leaderboard?range=${encodeURIComponent(leaderboardRange)}`, {
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `leaderboard request failed (${response.status})`);
        }

        const payload = await response.json();
        if (cancelled) return;

        setSocialLeaderboard({
          loading: false,
          error: '',
          updatedAt: String(payload?.updatedAt || ''),
          creatorTipperEnabled: Boolean(payload?.features?.creatorTipperEnabled),
          posts: Array.isArray(payload?.leaders?.posts) ? payload.leaders.posts : [],
          creators: Array.isArray(payload?.leaders?.creators) ? payload.leaders.creators : [],
          tippers: Array.isArray(payload?.leaders?.tippers) ? payload.leaders.tippers : []
        });
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;
        setSocialLeaderboard((prev) => ({
          ...prev,
          loading: false,
          error: String(error?.message || error || 'Failed to load leaderboard')
        }));
      }
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, leaderboardRange, leaderboardRefreshNonce, socialApiBaseUrl]);

  useEffect(() => {
    const currentAddress = String(faucet.address || '').trim();
    if (!currentAddress || !registeredUsername) return;

    setUsernamesByAddress((prev) => {
      if (prev[currentAddress] === registeredUsername) return prev;
      return { ...prev, [currentAddress]: registeredUsername };
    });
  }, [faucet.address, registeredUsername]);

  useEffect(() => {
    const addresses = new Set();
    const currentAddress = String(faucet.address || '').trim();
    if (currentAddress) addresses.add(currentAddress);

    for (const post of socialFeed) {
      const author = String(post?.author || '').trim();
      if (author) addresses.add(author);
    }

    for (const entry of socialLeaderboard.creators) {
      const address = String(entry?.address || '').trim();
      if (address) addresses.add(address);
    }

    for (const entry of socialLeaderboard.tippers) {
      const address = String(entry?.address || '').trim();
      if (address) addresses.add(address);
    }

    const targets = [...addresses].filter((addr) => !String(usernamesByAddress[addr] || '').trim());
    if (targets.length === 0) return;

    let cancelled = false;

    const run = async () => {
      const updates = {};

      await Promise.all(targets.map(async (addr) => {
        if (usernameLookupInFlightRef.current.has(addr)) return;
        usernameLookupInFlightRef.current.add(addr);

        try {
          const snapshot = await daoLookupService.fetchDaoSnapshot(addr, { force: false });
          const username = String(snapshot?.username || '').trim();
          if (username) updates[addr] = username;
        } catch (_) {
          // Ignore lookup errors and fallback to address handle.
        } finally {
          usernameLookupInFlightRef.current.delete(addr);
        }
      }));

      if (cancelled) return;
      const keys = Object.keys(updates);
      if (keys.length === 0) return;

      setUsernamesByAddress((prev) => ({ ...prev, ...updates }));
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [daoLookupService, faucet.address, socialFeed, socialLeaderboard.creators, socialLeaderboard.tippers, usernamesByAddress]);

  const authorDashboard = useMemo(() => {
    const authors = new Map();
    let totalLikes = 0;
    let totalTipsMicroStx = '0';

    for (const post of socialFeed) {
      const author = String(post.author || '').trim();
      if (!author) continue;

      const likes = Number.parseInt(String(post.likeCount || '0'), 10) || 0;
      const reputation = Number.parseInt(String(post.authorReputation || '0'), 10) || 0;
      const postTipsMicroStx = String(post.totalTipMicroStx || '0');

      totalLikes += likes;
      totalTipsMicroStx = addMicroStxStrings(totalTipsMicroStx, postTipsMicroStx);

      const current = authors.get(author) || {
        author,
        postCount: 0,
        totalLikes: 0,
        totalTipsMicroStx: '0',
        reputation: 0
      };

      current.postCount += 1;
      current.totalLikes += likes;
      current.totalTipsMicroStx = addMicroStxStrings(current.totalTipsMicroStx, postTipsMicroStx);
      current.reputation = Math.max(current.reputation, reputation);
      authors.set(author, current);
    }

    const rankedAuthors = [...authors.values()].sort((a, b) => {
      if (b.reputation !== a.reputation) return b.reputation - a.reputation;
      if (b.totalLikes !== a.totalLikes) return b.totalLikes - a.totalLikes;
      return b.postCount - a.postCount;
    });

    const topAuthors = rankedAuthors.slice(0, 5);
    const currentAuthor = faucet.address ? authors.get(faucet.address) || null : null;
    const currentAuthorRank = currentAuthor
      ? (rankedAuthors.findIndex((item) => item.author === faucet.address) + 1)
      : 0;

    return {
      authorCount: authors.size,
      totalPosts: socialFeed.length,
      totalLikes,
      totalTipsMicroStx,
      topAuthors,
      currentAuthor,
      currentAuthorRank
    };
  }, [faucet.address, socialFeed]);

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

  const tipSocialPost = async (postId, recipient) => {
    const result = await social.tipPost(postId, recipient);
    if (!result || !result.message) return;

    const key = String(postId);
    const tone = result.tone || (result.ok ? 'success' : 'error');
    const previousTimeoutId = tipStatusTimeoutByPostIdRef.current.get(key);
    if (previousTimeoutId) clearTimeout(previousTimeoutId);

    setTipStatusByPostId((prev) => ({
      ...prev,
      [key]: { message: result.message, tone }
    }));

    const timeoutId = setTimeout(() => {
      setTipStatusByPostId((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      tipStatusTimeoutByPostIdRef.current.delete(key);
    }, 8000);
    tipStatusTimeoutByPostIdRef.current.set(key, timeoutId);
  };


  return (
    <div className="min-h-screen overflow-x-clip app-shell text-[#10162f]">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            border: '1px solid rgba(16, 22, 47, 0.3)',
            background: '#f5f3eb',
            color: '#10162f',
            borderRadius: '0px',
            boxShadow: '-4px 4px 0 rgba(15, 26, 70, 0.98)'
          },
          success: {
            iconTheme: {
              primary: '#3a10e5',
              secondary: '#f5f3eb'
            }
          },
          error: {
            iconTheme: {
              primary: '#be1809',
              secondary: '#f5f3eb'
            }
          }
        }}
      />
      <header className="sticky top-0 z-40 border-b border-[#10162f]/16 bg-white/85 backdrop-blur site-header">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6 lg:px-8">
          <button
            type="button"
            className="w-fit shrink-0 rounded-none border border-[#10162f]/25 bg-[#f5f3eb] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[#10162f] transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-[#10162f]/20"
            onClick={() => {
              setActivePage("app");
              setActiveTab('ecosystem');
            }}
          >
            FROG Community Hub
          </button>
          <nav className="order-3 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 sm:order-none sm:pb-0 tabs-scroll" aria-label="Frontend tabs">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`nav-tab whitespace-nowrap rounded-none border px-3.5 py-2 text-xs font-bold capitalize transition ${
                  activeTab === tab.id
                    ? 'is-active border-[#3a10e5] bg-[#3a10e5] text-white'
                    : 'border-[#10162f]/30 bg-white/85 text-[#10162f] hover:-translate-y-0.5 hover:shadow-md hover:shadow-[#10162f]/20'
                }`}
                onClick={() => {
                  setActivePage("app");
                  setActiveTab(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
            {faucet.address ? (
              <>
                <button
                  type="button"
                  className="hidden rounded-none border border-[#10162f]/25 bg-[#f5f3eb] px-3 py-2 font-mono text-xs text-[#10162f] transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-[#10162f]/20 md:inline"
                  onClick={() => setActivePage('profile')}
                >
                  {shortenAddress(faucet.address)}
                </button>
                <button
                  className={ghostButtonClass + ' w-auto'}
                  onClick={() => {
                    setActivePage("app");
                    faucet.disconnectWallet();
                  }}
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
              <button className={primaryButtonClass + ' w-auto'} onClick={faucet.connectWallet} disabled={!faucet.ready || faucet.isConnecting}>
                {faucet.isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">

      {activePage === 'profile' ? (
        <section className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
            <p className="text-xs uppercase tracking-[0.2em] text-[#10162f]/65">User Profile</p>
            <h1 className="mt-2 text-3xl leading-tight">@{displayUserHandle(faucet.address)}</h1>
            <p className="mt-2 font-mono text-xs text-[#10162f]/70">{faucet.address}</p>
            <div className="mt-5 rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[#10162f]/65">Total Posts</p>
              <p className="mt-1 text-3xl font-normal text-[#10162f]">{userPostCount}</p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button className={primaryButtonClass + ' w-auto'} onClick={() => social.refresh(50)} disabled={!social.ready || social.isRefreshing}>
                {social.isRefreshing ? 'Refreshing...' : 'Refresh Posts'}
              </button>
              <button className={ghostButtonClass + ' w-auto'} onClick={() => setActivePage('app')}>
                Back
              </button>
            </div>
          </div>
          <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
            <h2 className="text-xl">Your Latest Posts</h2>
            <p className="mt-1 text-sm text-[#10162f]/70">Showing posts where author matches your connected wallet.</p>
            {userPosts.length > 0 ? (
              <div className="mt-4 space-y-3">
                {userPosts.slice(0, 10).map((post) => (
                  <article key={post.id} className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/60 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">Post #{post.id}</strong>
                      <span className="text-xs text-[#10162f]/70">{formatPostTime(post.createdAtBlock)}</span>
                    </div>
                    <p className="mt-1 text-sm text-[#10162f]/80">{String(post.text || '').slice(0, 160) || '(No text)'}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-none border border-dashed border-[#10162f]/30 bg-[#f5f3eb]/70 px-4 py-3 text-sm text-[#10162f]/75">
                No posts yet for this wallet.
              </div>
            )}
          </div>
        </section>
      ) : activeTab === 'faucet' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,360px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-[#10162f]/65">FROG Community Hub</p>
              <h1 className="text-4xl leading-tight md:text-5xl">24h Faucet for FROG Token</h1>
              <p className="mt-3 max-w-2xl text-base text-[#10162f]/70">
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
            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 text-base text-[#10162f]/90 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Wallet</span>
                <strong className="break-all font-mono text-sm">{faucet.address || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Balance</span>
                <strong>{faucet.balance || '-'} FROG</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Token avatar</span>
                {faucet.tokenImage ? (
                  <img
                    src={faucet.tokenImage}
                    alt={faucet.tokenDisplayName || 'FROG token'}
                    className="h-8 w-8 rounded-none border border-[#10162f]/20 object-cover"
                  />
                ) : (
                  <strong>-</strong>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Faucet status</span>
                <strong>{faucet.faucetPaused ? 'Paused' : 'Active'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Next claim (block)</span>
                <strong>{faucet.nextClaimBlock || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span>Reclaim in</span>
                <strong>{faucet.address ? (faucet.canClaim ? 'Ready now' : (faucet.cooldownEtaSeconds > 0 ? formatCooldownEta(faucet.cooldownEtaSeconds) : 'Cooldown active')) : '-'}</strong>
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
              {faucet.status && <p className="mt-3 text-base text-[#10162f]/70">{faucet.status}</p>}
              {faucet.faucetPaused && (
                <p className="mt-3 text-base text-[#10162f]/70">Claims are temporarily paused by contract admin.</p>
              )}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Transfer</h2>
              <label className="mb-3 block text-base text-[#10162f]/70">
                Recipient wallet
                <input
                  className="mt-1.5 w-full rounded-none border border-[#10162f]/20 px-3 py-2.5 text-base outline-none transition focus:border-[#3a10e5] focus:ring-2 focus:ring-[#3a10e5]/20"
                  value={faucet.recipient}
                  onChange={(e) => faucet.setRecipient(e.target.value)}
                  placeholder="SP..."
                />
              </label>
              <label className="mb-3 block text-base text-[#10162f]/70">
                Amount
                <input
                  className="mt-1.5 w-full rounded-none border border-[#10162f]/20 px-3 py-2.5 text-base outline-none transition focus:border-[#3a10e5] focus:ring-2 focus:ring-[#3a10e5]/20"
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
              <p className="mt-3 text-base text-[#10162f]/70">
                Transfers are on-chain and final. Double-check recipient address before submitting.
              </p>
            </div>

            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Contract details</h2>
              <ul className="space-y-2.5 text-base text-[#10162f]/85">
                <li className="flex items-center justify-between gap-3"><span>Contract</span> <strong className="break-all font-mono text-sm">{contractAddress}.{contractName}</strong></li>
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
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-[#10162f]/65">FROG DAO</p>
              <h1 className="text-4xl leading-tight md:text-5xl">DAO Membership Pass</h1>
              <p className="mt-3 max-w-2xl text-base text-[#10162f]/70">
                Register your on-chain username and mint one non-transferable DAO pass to unlock governance.
              </p>
            </div>
            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 text-base text-[#10162f]/90 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Wallet</span>
                <strong className="break-all font-mono text-sm">{faucet.address || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>FROG balance</span>
                <strong>{dao.frogBalance || faucet.balance || '-'} FROG</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
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
              {(dao.status || faucet.status) && <p className="mt-3 text-base text-[#10162f]/70">{dao.status || faucet.status}</p>}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Register Username</h2>
              <label className="block text-base text-[#10162f]/70">
                Username (ASCII, max 32 chars)
                <input
                  className="mt-1.5 w-full rounded-none border border-[#10162f]/20 px-3 py-2.5 text-base text-[#10162f] outline-none transition focus:border-[#3a10e5] focus:ring-2 focus:ring-[#3a10e5]/20 disabled:bg-[#f5f3eb]"
                  value={dao.usernameInput}
                  onChange={(e) => dao.setUsernameInput(e.target.value)}
                  placeholder="froggovernor"
                  disabled={Boolean(dao.username) || dao.isRegistering}
                />
              </label>
              <button
                className={`${primaryButtonClass} mt-4`}
                onClick={dao.registerUsername}
                disabled={!faucet.address || !dao.ready || Boolean(dao.username) || !dao.usernameInput.trim() || dao.isRegistering}
              >
                {dao.isRegistering ? 'Registering...' : dao.username ? 'Username already set' : 'Register'}
              </button>
            </div>

            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Mint DAO Pass</h2>
              <p className="mb-3 text-base text-[#10162f]/70">
                Requirement: username registered + hold at least 1,000 FROG (mint fee: 99 FROG).
              </p>
              <button
                className={`${primaryButtonClass} mt-4`}
                onClick={dao.mintPass}
                disabled={!faucet.address || !dao.ready || dao.hasPass || !dao.eligible || dao.isMinting}
              >
                {dao.isMinting ? 'Minting...' : dao.hasPass ? 'Already minted' : dao.eligible ? 'Mint pass' : 'Not eligible'}
              </button>
            </div>

            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">DAO Contract</h2>
              <ul className="space-y-2.5 text-base text-[#10162f]/85">
                <li className="flex items-center justify-between gap-3"><span>Contract</span> <strong className="break-all font-mono text-sm">{daoContractAddress}.{daoContractName}</strong></li>
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
            <div className="ui-card rounded-none border border-[#10162f]/20 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center gap-3">
                {faucet.tokenImage ? (
                  <img
                    src={faucet.tokenImage}
                    alt={faucet.tokenDisplayName || 'FROG token'}
                    className="h-11 w-11 rounded-none border border-[#10162f]/20 bg-[#e6ecff] object-cover"
                  />
                ) : (
                  <div className="grid h-11 w-11 place-items-center rounded-none bg-[#3a10e5] text-sm font-bold text-white">
                    FG
                  </div>
                )}
                <div>
                  <p className="text-sm font-normal text-[#10162f]">{faucet.address ? `@${displayUserHandle(faucet.address)}` : '@guest'}</p>
                  <p className="text-base text-[#10162f]/70">{faucet.address ? shortenAddress(faucet.address) : 'Connect wallet to publish and like posts'}</p>
                </div>
              </div>

              <textarea
                ref={socialComposerRef}
                className="mt-4 min-h-[150px] w-full resize-none rounded-none border border-[#10162f]/20 bg-[#f5f3eb]/65 px-4 py-3 text-base outline-none transition focus:border-[#3a10e5] focus:ring-2 focus:ring-[#3a10e5]/20"
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
                <div className="inline-flex flex-wrap overflow-hidden rounded-none border border-[#10162f]/25 bg-white">
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('**')}><span>Bold</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('*')}><span>Italic</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('`')}><span>Code</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('~~')}><span>Strike</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyWrapFormat('[', '](https://)')}><span>Link</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('# ')}><span>H1</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('## ')}><span>H2</span></button>
                  <button type="button" className={formatterButtonClass} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('> ')}><span>Quote</span></button>
                  <button type="button" className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-[#10162f] transition hover:bg-[#f5f3eb]" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLinePrefixFormat('- ')}><span>List</span></button>
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
                    <div className="inline-flex items-center gap-2 rounded-none border border-[#10162f]/25 bg-white px-2 py-1.5">
                      <img src={socialImagePreviewUrl} alt="Selected upload preview" className="h-9 w-9 rounded-none object-cover" />
                      <div className="max-w-[150px]">
                        <p className="truncate text-xs font-medium text-[#10162f]">{socialImageFile.name}</p>
                        <p className="text-[11px] text-[#10162f]/70">One image per post</p>
                      </div>
                      <button type="button" className="rounded-none border border-[#10162f]/25 px-2 py-1 text-[11px] font-medium text-[#10162f]" onClick={clearSocialImage}>Remove</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-none border border-[#10162f]/20 bg-[#f5f3eb]/70 px-4 py-3">
                <p className="mb-2 text-[11px] font-normal uppercase tracking-[0.14em] text-[#10162f]/70">Live Preview</p>
                {socialPostInput.trim() || socialImagePreviewUrl
                  ? (
                    <div className="space-y-3 text-[15px] leading-relaxed text-[#10162f]">
                      {socialPostInput.trim() ? renderPostContent(socialPostInput) : null}
                      {socialImagePreviewUrl && (
                        <img src={socialImagePreviewUrl} alt="Post image preview" className="max-h-72 w-full rounded-none border border-[#10162f]/15 bg-[#e6ecff]/70 object-contain" />
                      )}
                    </div>
                  )
                  : <p className="text-sm text-[#10162f]/60">Your formatted preview will appear here as you type.</p>}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-base text-[#10162f]/70">{socialPostInput.length}/500 characters</p>
                <button className={primaryButtonClass} onClick={createSocialPost} disabled={!faucet.address || !social.ready || isSocialActionLocked}>
                  {social.isPublishing ? 'Publishing...' : `Publish (${social.postFee || '50'} FROG)`}
                </button>
              </div>
              {socialStatus && <p className="mt-3 text-base text-[#10162f]/70">{socialStatus}</p>}
              <p className="mt-1 text-base text-[#10162f]/60">Your balance: {social.viewerBalance || faucet.balance || '0'} FROG</p>
              {!social.ready && <p className="mt-1 text-base text-[#10162f]/60">Social contract is not configured.</p>}
            </div>

            <div className="ui-card rounded-none border border-[#10162f]/20 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <p className="text-xs uppercase tracking-[0.2em] text-[#10162f]/65">Author Dashboard</p>
              <h2 className="mt-1 text-xl font-normal">Creator Performance</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#10162f]/70">Authors</p>
                  <p className="text-base font-normal text-[#10162f]">{authorDashboard.authorCount}</p>
                </div>
                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#10162f]/70">Posts</p>
                  <p className="text-base font-normal text-[#10162f]">{authorDashboard.totalPosts}</p>
                </div>
                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#10162f]/70">Likes</p>
                  <p className="text-base font-normal text-[#10162f]">{authorDashboard.totalLikes}</p>
                </div>
                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#10162f]/70">STX Tipped</p>
                  <p className="text-base font-normal text-[#10162f]">{formatTipAmountFromMicroStx(authorDashboard.totalTipsMicroStx)}</p>
                </div>
              </div>
              <p className="mt-4 text-xs uppercase tracking-[0.12em] text-[#10162f]/70">Top Authors by Reputation</p>
              <div className="mt-4 space-y-2.5">
                {authorDashboard.topAuthors.length > 0 ? authorDashboard.topAuthors.map((creator, index) => (
                  <div key={creator.author} className="flex items-center justify-between rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/85 px-3 py-2">
                    <div>
                      <p className="text-base text-[#10162f]/70">Rank #{index + 1}</p>
                      <p className="text-sm font-normal text-[#10162f]">@{displayUserHandle(creator.author)}</p>
                      <p className="text-[11px] text-[#10162f]/70">{creator.postCount} posts • {creator.totalLikes} likes</p>
                    </div>
                    <strong className="text-sm">Rep {creator.reputation}</strong>
                  </div>
                )) : (
                  <div className="rounded-none border border-dashed border-[#10162f]/30 bg-[#f5f3eb]/70 px-3 py-2 text-sm text-[#10162f]/75">
                    No author metrics yet.
                  </div>
                )}
              </div>
              {faucet.address && (
                <div className="mt-4 rounded-none border border-[#10162f]/15 bg-white px-3 py-2">
                  {authorDashboard.currentAuthor ? (
                    <p className="text-xs text-[#10162f]/75">Your rank #{authorDashboard.currentAuthorRank} • Rep {authorDashboard.currentAuthor.reputation} • {authorDashboard.currentAuthor.postCount} posts</p>
                  ) : (
                    <p className="text-base text-[#10162f]/70">You are not ranked yet. Publish your first post to enter the dashboard.</p>
                  )}
                </div>
              )}
              <p className="mt-4 text-base text-[#10162f]/70">Fees: Publish {social.postFee || '50'} FROG, Like {social.likeFee || '5'} FROG. Tip: {socialTipAmountStx} STX. Treasury: {shortenAddress(social.treasury)}</p>
            </div>
          </header>

          <section className="mt-8">
            <div className="ui-card rounded-none border border-[#10162f]/20 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#10162f]/65">Community Leaderboard</p>
                  <h2 className="text-2xl font-normal">Top Tippers, Creators, and Posts</h2>
                  <p className="text-xs text-[#10162f]/65">Window: {leaderboardRange === 'weekly' ? 'Last 7 days' : 'Last 30 days'}{socialLeaderboard.updatedAt ? ' • Updated ' + formatPostTime(socialLeaderboard.updatedAt) : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-none border border-[#10162f]/20 bg-[#f5f3eb] p-1">
                    <button
                      type="button"
                      className={leaderboardRange === 'weekly'
                        ? 'rounded-none bg-white px-3 py-1 text-xs font-medium text-[#10162f]'
                        : 'rounded-none px-3 py-1 text-xs font-medium text-[#10162f]/75'}
                      onClick={() => setLeaderboardRange('weekly')}
                      disabled={socialLeaderboard.loading}
                    >
                      Weekly
                    </button>
                    <button
                      type="button"
                      className={leaderboardRange === 'monthly'
                        ? 'rounded-none bg-white px-3 py-1 text-xs font-medium text-[#10162f]'
                        : 'rounded-none px-3 py-1 text-xs font-medium text-[#10162f]/75'}
                      onClick={() => setLeaderboardRange('monthly')}
                      disabled={socialLeaderboard.loading}
                    >
                      Monthly
                    </button>
                  </div>
                  <button
                    type="button"
                    className={ghostButtonClass + ' w-auto'}
                    onClick={() => setLeaderboardRefreshNonce((prev) => prev + 1)}
                    disabled={socialLeaderboard.loading}
                  >
                    {socialLeaderboard.loading ? 'Refreshing...' : 'Refresh leaderboard'}
                  </button>
                </div>
              </div>

              {socialLeaderboard.error && (
                <p className="mt-3 text-sm text-[#9f1239]">{socialLeaderboard.error}</p>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#10162f]/70">Top Creators</p>
                  {socialLeaderboard.creatorTipperEnabled ? (
                    <div className="mt-2 space-y-2">
                      {socialLeaderboard.creators.slice(0, 5).map((entry) => (
                        <div key={entry.address} className="flex items-center justify-between text-sm text-[#10162f]">
                          <span>#{entry.rank} @{displayUserHandle(entry.address)}</span>
                          <span>{formatTipAmountFromMicroStx(entry.totalTipMicroStx)} STX</span>
                        </div>
                      ))}
                      {socialLeaderboard.creators.length === 0 && (
                        <p className="text-sm text-[#10162f]/70">No creator data in this window.</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[#10162f]/70">Creator ranking will activate after tipper/recipient sync is enabled.</p>
                  )}
                </div>

                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#10162f]/70">Top Tippers</p>
                  {socialLeaderboard.creatorTipperEnabled ? (
                    <div className="mt-2 space-y-2">
                      {socialLeaderboard.tippers.slice(0, 5).map((entry) => (
                        <div key={entry.address} className="flex items-center justify-between text-sm text-[#10162f]">
                          <span>#{entry.rank} @{displayUserHandle(entry.address)}</span>
                          <span>{formatTipAmountFromMicroStx(entry.totalTipMicroStx)} STX</span>
                        </div>
                      ))}
                      {socialLeaderboard.tippers.length === 0 && (
                        <p className="text-sm text-[#10162f]/70">No tipper data in this window.</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[#10162f]/70">Tipper ranking will activate after tipper/recipient sync is enabled.</p>
                  )}
                </div>

                <div className="rounded-none border border-[#10162f]/15 bg-[#f5f3eb]/80 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#10162f]/70">Top Posts</p>
                  <div className="mt-2 space-y-2">
                    {socialLeaderboard.posts.slice(0, 5).map((entry) => (
                      <div key={entry.contentHash} className="border-b border-[#10162f]/10 pb-2 text-sm last:border-b-0 last:pb-0">
                        <p className="font-medium text-[#10162f]">#{entry.rank} • {formatTipAmountFromMicroStx(entry.totalTipMicroStx)} STX • {entry.tipCount} tips</p>
                        <p className="text-[#10162f]/70">{entry.textPreview || ('Post #' + entry.postId)}</p>
                      </div>
                    ))}
                    {socialLeaderboard.posts.length === 0 && (
                      <p className="text-sm text-[#10162f]/70">No tipped posts in this window.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#10162f]/65">Community Feed</p>
                <h2 className="text-2xl font-normal">Latest Posts</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-none border border-[#10162f]/25 bg-white px-3 py-1 text-xs font-bold text-[#10162f]">{socialFeed.length} posts</span>
                <button className={ghostButtonClass} onClick={() => social.refresh(20)} disabled={!social.ready || isSocialActionLocked}>
                  {social.isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {isSocialFeedLoading ? (
              <div className="mx-auto grid max-w-3xl gap-4">
                <div className="ui-card rounded-none border border-[#10162f]/20 bg-white p-6 shadow-[0_18px_38px_rgba(14,35,24,0.12)]">
                  <div className="h-4 w-32 animate-pulse rounded-none bg-[#e6ecff]" />
                  <div className="mt-4 space-y-2">
                    <div className="h-3 w-full animate-pulse rounded-none bg-[#e6ecff]" />
                    <div className="h-3 w-5/6 animate-pulse rounded-none bg-[#e6ecff]" />
                    <div className="h-3 w-4/6 animate-pulse rounded-none bg-[#e6ecff]" />
                  </div>
                  <p className="mt-4 text-base text-[#10162f]/70">Loading posts from chain...</p>
                </div>
              </div>
            ) : socialFeed.length > 0 ? (
              <div className="relative mx-auto max-w-3xl">
                <div className="grid gap-4">
                {socialFeed.map((post) => {
                  const hasLiked = Boolean(post.hasLikedByViewer);
                  const isOwnPost = Boolean(faucet.address && post.author === faucet.address);
                  const isTippingThisPost = social.tippingPostId === String(post.id);
                  return (
                    <article key={post.id} className="ui-card ui-card--interactive overflow-hidden rounded-none border border-[#10162f]/20 bg-white shadow-[0_18px_38px_rgba(14,35,24,0.12)]">
                      <div className="flex items-center justify-between border-b border-[#10162f]/15 px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {faucet.tokenImage ? (
                            <img
                              src={faucet.tokenImage}
                              alt={faucet.tokenDisplayName || 'FROG token'}
                              className="h-9 w-9 rounded-none border border-[#10162f]/20 bg-[#e6ecff] object-cover"
                            />
                          ) : (
                            <div className="grid h-9 w-9 place-items-center rounded-none bg-[#e6ecff] text-xs font-bold text-[#10162f]">
                              FG
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-normal text-[#10162f]">@{displayUserHandle(post.author)}</p>
                            <p className="font-mono text-[11px] text-[#10162f]/70">{shortenAddress(post.author)}</p>
                            <p className="mt-1 inline-flex items-center rounded-none border border-[#10162f]/25 bg-[#f5f3eb] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#10162f]">Rep {post.authorReputation || '0'}</p>
                          </div>
                        </div>
                        <p className="text-xs text-[#10162f]/70">{formatPostTime(post.createdAtBlock)}</p>
                      </div>

                      <div className="px-4 py-4">
                        {renderPostContent(post.text || '')}
                        {Array.isArray(post.images) && post.images.length > 0 && (
                          <div className="mt-3 grid gap-2">
                            {post.images.map((imageUrl) => (
                              <a key={`${post.id}-${imageUrl}`} href={imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-none border border-[#10162f]/15">
                                <img src={imageUrl} alt="Post attachment" className="max-h-[70vh] w-full bg-[#e6ecff]/70 object-contain" loading="lazy" />
                              </a>
                            ))}
                          </div>
                        )}
                        {Array.isArray(post.links) && post.links.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {post.links.map((link) => (
                              <a key={`${post.id}-${link}`} href={link} target="_blank" rel="noreferrer" className="rounded-none border border-[#10162f]/25 bg-[#e6ecff] px-2.5 py-1 text-xs font-medium text-[#10162f] hover:underline">
                                {link}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#10162f]/15 bg-[#f5f3eb]/70 px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-sm text-[#10162f]/75">
                          <span aria-hidden="true">❤️</span>
                          <span>{post.likeCount || '0'} likes</span>
                          <span className="text-[#10162f]/55">•</span>
                          <span>{formatTipAmountFromMicroStx(post.totalTipMicroStx || '0')} STX tipped</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            className={ghostButtonClass}
                            type="button"
                            onClick={() => tipSocialPost(post.id, post.author)}
                            disabled={isOwnPost || isTippingThisPost || !faucet.address || isSocialActionLocked || social.likingPostId === String(post.id)}
                          >
                            {isTippingThisPost ? 'Tipping...' : isOwnPost ? 'Own post' : `Tip ${socialTipAmountStx} STX`}
                          </button>
                          {!isOwnPost && (
                            <button
                              className={hasLiked
                                ? 'inline-flex h-10 w-10 items-center justify-center rounded-none border border-[#ef4444]/35 bg-transparent text-[#ef4444]'
                                : 'inline-flex h-10 w-10 items-center justify-center rounded-none border border-[#10162f]/25 bg-transparent text-[#10162f] transition hover:bg-[#f5f3eb]'
                              }
                              type="button"
                              onClick={() => likeSocialPost(post.id)}
                              disabled={hasLiked || social.likingPostId === String(post.id) || !faucet.address || isTippingThisPost || isSocialActionLocked}
                              aria-label={social.likingPostId === String(post.id)
                                ? 'Liking post'
                                : hasLiked
                                  ? 'Post liked'
                                  : `Like post (${social.likeFee || '5'} FROG)`}
                              title={social.likingPostId === String(post.id)
                                ? 'Liking...'
                                : hasLiked
                                  ? 'Liked'
                                  : `Like (${social.likeFee || '5'} FROG)`}
                            >
                              <span className="text-base leading-none" aria-hidden="true">
                                {social.likingPostId === String(post.id)
                                  ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
                                  : <Heart className="h-4 w-4" fill={hasLiked ? 'currentColor' : 'none'} strokeWidth={2.25} />}
                              </span>
                            </button>
                          )}
                        </div>
                        {tipStatusByPostId[String(post.id)] && (
                          <p
                            className={
                              'text-xs ' + (tipStatusByPostId[String(post.id)].tone === 'success'
                                ? 'text-[#0f5132]'
                                : tipStatusByPostId[String(post.id)].tone === 'warning'
                                  ? 'text-[#8a4b00]'
                                  : 'text-[#9f1239]')
                            }
                          >
                            {tipStatusByPostId[String(post.id)].message}
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
                </div>
                {social.isRefreshing && (
                  <div className="absolute inset-0 z-10 grid place-items-center rounded-none border border-[#10162f]/15 bg-white/70 backdrop-blur-[1px]">
                    <div className="flex items-center gap-2 rounded-none border border-[#10162f]/15 bg-white px-3 py-2 text-sm text-[#10162f]/85 shadow">
                      <span className="h-4 w-4 animate-spin rounded-none border-2 border-[#10162f]/30 border-t-[#3a10e5]" />
                      <span>Syncing latest on-chain data...</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-none border border-dashed border-[#10162f]/30 bg-[#f5f3eb]/70 p-6 text-sm text-[#10162f]/75">
                Feed is empty. Publish the first post to kickstart community discussions.
              </div>
            )}
          </section>
        </>
      ) : activeTab === 'admin' ? (
        <>
          <header className="grid items-center gap-8 md:grid-cols-[minmax(260px,1fr)_minmax(260px,420px)]">
            <div>
              <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-[#10162f]/65">FROG ADMIN</p>
              <h1 className="text-4xl leading-tight md:text-5xl">Faucet Admin Controls</h1>
              <p className="mt-3 max-w-2xl text-base text-[#10162f]/70">
                Owner-only controls for pause state, claim amount, and cooldown blocks.
              </p>
            </div>
            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Status</span>
                <strong>{faucet.address ? 'Connected' : 'Not connected'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
                <span>Connected wallet</span>
                <strong className="break-all font-mono text-xs">{faucet.address || '-'}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#10162f]/16 py-2">
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
              {faucet.status && <p className="mt-3 text-xs text-[#10162f]/70">{faucet.status}</p>}
            </div>
          </header>

          <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Pause / Unpause</h2>
              <p className="mb-4 text-xs text-[#10162f]/70">
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

            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Set Claim Amount</h2>
              <p className="mb-3 text-xs text-[#10162f]/70">Current amount: <strong>{faucet.faucetAmount || '-'} FROG</strong></p>
              <label className="mb-3 block text-xs text-[#10162f]/70">
                New amount
                <input
                  className="mt-1.5 w-full rounded-none border border-[#10162f]/20 px-3 py-2.5 text-base outline-none transition focus:border-[#3a10e5] focus:ring-2 focus:ring-[#3a10e5]/20"
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

            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">Set Cooldown</h2>
              <p className="mb-3 text-xs text-[#10162f]/70">Current cooldown: <strong>{faucet.cooldownBlocks || '-'} blocks</strong></p>
              <label className="mb-3 block text-xs text-[#10162f]/70">
                New cooldown blocks
                <input
                  className="mt-1.5 w-full rounded-none border border-[#10162f]/20 px-3 py-2.5 text-base outline-none transition focus:border-[#3a10e5] focus:ring-2 focus:ring-[#3a10e5]/20"
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

            <div className="ui-card rounded-none border border-[#10162f]/16 bg-white p-6 shadow-[0_18px_40px_rgba(14,35,24,0.12)]">
              <h2 className="mb-3 text-lg font-normal">DAO Treasury</h2>
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
          <section className="hero-shell relative overflow-hidden rounded-none border border-[#10162f]/16 bg-[radial-gradient(circle_at_14%_14%,rgba(191,231,255,0.55),transparent_42%),radial-gradient(circle_at_86%_18%,rgba(58,16,229,0.14),transparent_48%),linear-gradient(135deg,#f5f3eb,#eef1ff_52%,#e6ecff)] p-6 shadow-[0_24px_60px_rgba(16,22,47,0.16)] md:p-8">
            <div className="hero-orb hero-orb-a" aria-hidden="true" />
            <div className="hero-orb hero-orb-b" aria-hidden="true" />
            <p className="text-xs font-normal uppercase tracking-[0.28em] text-[#10162f]/75">Community Home</p>
            <h1 className="mt-3 text-4xl leading-tight text-[#10162f] md:text-5xl">Frog Social for Stacks Community</h1>
            <p className="mt-4 max-w-3xl text-base text-[#10162f]/70">
              A lightweight social hub where Stacks builders and holders can post updates, like community signals, and tip quality content. Start with the Social tab, then discover the wider ecosystem below.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className={primaryButtonClass + ' w-auto'} onClick={() => setActiveTab('social')}>
                Open Social Feed
              </button>
              <button className={ghostButtonClass + ' w-auto'} onClick={() => setActiveTab('dao-nft')}>
                Get DAO Pass
              </button>
              <button className={ghostButtonClass + ' w-auto'} onClick={() => setActiveTab('faucet')}>
                Claim FROG
              </button>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <article className="rounded-none border border-[#10162f]/16 bg-white/80 p-4 backdrop-blur">
                <p className="text-xs font-normal uppercase tracking-[0.2em] text-[#10162f]/70">Publish</p>
                <p className="mt-2 text-sm text-[#10162f]/80">Share quick updates and links from your Stacks journey.</p>
              </article>
              <article className="rounded-none border border-[#10162f]/16 bg-white/80 p-4 backdrop-blur">
                <p className="text-xs font-normal uppercase tracking-[0.2em] text-[#10162f]/70">Like</p>
                <p className="mt-2 text-sm text-[#10162f]/80">Signal useful content on-chain with FROG-backed likes.</p>
              </article>
              <article className="rounded-none border border-[#10162f]/16 bg-white/80 p-4 backdrop-blur">
                <p className="text-xs font-normal uppercase tracking-[0.2em] text-[#10162f]/70">Tip</p>
                <p className="mt-2 text-sm text-[#10162f]/80">Reward creators directly using STX tips from the same feed.</p>
              </article>
            </div>
          </section>

          <header className="max-w-3xl">
            {/* <p className="mb-2.5 text-xs uppercase tracking-[0.3em] text-[#10162f]/65">EXPLORE STACKS ECOSYSTEM</p> */}
            <h2 className="text-3xl leading-tight md:text-4xl">EXPLORE STACKS ECOSYSTEM</h2>
            <p className="mt-3 text-base text-[#10162f]/70">
              Featured apps in a Stacks-style ecosystem layout for quick exploration.
            </p>
          </header>

          <div className="flex flex-wrap gap-2.5">
            {ecosystemCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={`pill-filter rounded-none border px-3.5 py-2 text-xs font-bold transition ${
                  ecosystemCategory === category
                    ? 'border-[#10162f] bg-[#10162f] text-white'
                    : 'border-[#10162f]/25 bg-white text-[#10162f] hover:-translate-y-0.5 hover:shadow-md hover:shadow-[#10162f]/20'
                }`}
                onClick={() => setEcosystemCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>


          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ecosystemApps.map((app) => (
              <article className="ui-card ui-card--interactive flex flex-col gap-3 rounded-none border border-[#10162f]/16 bg-white p-4 shadow-[0_18px_40px_rgba(14,35,24,0.12)]" key={app.name}>
                <div className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-none border border-[#10162f]/16 bg-[#f5f3eb]">
                  <img src={app.image} alt={`${app.name} logo`} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <h2 className="text-2xl leading-tight">{app.name}</h2>
                <p className="text-[#10162f]/70">{app.summary}</p>
                <div className="flex flex-wrap gap-2">
                  {app.tags.map((tag) => (
                    <span key={`${app.name}-${tag}`} className="rounded-none bg-[#e6ecff] px-2.5 py-1 text-xs font-bold text-[#10162f]">{tag}</span>
                  ))}
                </div>
                <a href={app.url} target="_blank" rel="noreferrer" className="w-fit font-bold text-[#10162f] transition hover:underline">
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

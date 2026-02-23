import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

const app = express();
const port = Number(process.env.BACKEND_PORT || process.env.PORT || 8787);
const dataDir = path.resolve(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'posts.json');
const uploadsDir = path.resolve(process.cwd(), 'uploads');

const backendNetwork = String(process.env.BACKEND_STACKS_NETWORK || process.env.STACKS_NETWORK || 'mainnet').toLowerCase();
const defaultHiroApiBaseUrl = backendNetwork === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
const hiroApiBaseUrl = String(process.env.HIRO_API_BASE_URL || defaultHiroApiBaseUrl).trim().replace(/\/$/, '');
const tipsContractId = String(process.env.TIPS_CONTRACT_ID || '').trim();

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const urlRegex = /^https?:\/\//i;
const txIdRegex = /^[0-9a-f]{64}$/i;

const ensureStore = () => {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ postsByHash: {}, tipReceiptsByTxId: {} }, null, 2));
  }
};

const normalizeStore = (input) => {
  if (!input || typeof input !== 'object') {
    return { postsByHash: {}, tipReceiptsByTxId: {} };
  }

  const postsByHash = input.postsByHash && typeof input.postsByHash === 'object'
    ? input.postsByHash
    : {};

  const tipReceiptsByTxId = input.tipReceiptsByTxId && typeof input.tipReceiptsByTxId === 'object'
    ? input.tipReceiptsByTxId
    : {};

  return {
    ...input,
    postsByHash,
    tipReceiptsByTxId
  };
};

const readStore = () => {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return normalizeStore(parsed);
  } catch (_) {
    return { postsByHash: {}, tipReceiptsByTxId: {} };
  }
};

const writeStore = (store) => {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(normalizeStore(store), null, 2));
};

const safeJsonParse = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch (_) {
    return fallback;
  }
};

const normalizeLinks = (links) => {
  if (!Array.isArray(links)) return [];
  const normalized = links
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0 && urlRegex.test(item));
  return [...new Set(normalized)].slice(0, 10);
};

const normalizeImages = (images) => {
  if (!Array.isArray(images)) return [];
  const normalized = images
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0 && (urlRegex.test(item) || item.startsWith('/uploads/')));
  return [...new Set(normalized)].slice(0, 1);
};

const parseLinksInput = (raw) => {
  if (Array.isArray(raw)) return raw;
  return safeJsonParse(raw, []);
};

const parseImagesInput = (raw) => {
  if (Array.isArray(raw)) return raw;
  return safeJsonParse(raw, []);
};

const buildPayload = (text, links, images) => ({
  text,
  links,
  images
});

const normalizeTipMicroStx = (value) => {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return '0';
  const amount = BigInt(raw);
  if (amount <= 0n) return '0';
  return amount.toString();
};

const normalizePostId = (value) => {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return '0';
  return raw;
};

const hashPayload = (payload) => {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const buildUploadedImageUrl = (_req, file) => {
  const explicitBaseUrl = String(process.env.BACKEND_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicitBaseUrl) return `${explicitBaseUrl}/uploads/${file.filename}`;

  return `/uploads/${file.filename}`;
};

const removeUploadedImage = (imageUrl) => {
  try {
    const parsed = new URL(String(imageUrl || ''));
    if (!parsed.pathname.startsWith('/uploads/')) return;
    const filename = path.basename(parsed.pathname);
    const fullPath = path.join(uploadsDir, filename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (_) {
    // Skip invalid/non-local URLs.
  }
};

const extractUintFromFunctionArg = (arg) => {
  const repr = String(arg?.repr || '').trim();
  const reprMatch = repr.match(/^u(\d+)$/);
  if (reprMatch) return reprMatch[1];

  const hex = String(arg?.hex || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(hex)) return null;

  const body = hex.slice(2);
  if (body.length < 4 || !body.startsWith('01')) return null;

  try {
    const uintHex = body.slice(2);
    if (!uintHex) return null;
    return BigInt(`0x${uintHex}`).toString();
  } catch (_) {
    return null;
  }
};

const fetchJsonWithTimeout = async (url, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return { ok: false, error: `hiro request failed (${response.status})` };
    }

    const payload = await response.json();
    return { ok: true, payload };
  } catch (err) {
    const message = String(err?.message || err || 'unknown hiro error');
    return { ok: false, error: `hiro request failed (${message})` };
  } finally {
    clearTimeout(timeout);
  }
};

const verifyTipTxViaHiro = async ({ txid, expectedPostId, expectedAmountMicroStx }) => {
  if (!tipsContractId) {
    return { ok: false, error: 'server is missing TIPS_CONTRACT_ID for tip verification' };
  }

  const txLookup = await fetchJsonWithTimeout(`${hiroApiBaseUrl}/extended/v1/tx/${txid}`);
  if (!txLookup.ok) return txLookup;

  const payload = txLookup.payload || {};
  const txStatus = String(payload.tx_status || '').toLowerCase();
  if (txStatus !== 'success') {
    return { ok: false, error: `transaction not successful (tx_status=${txStatus || 'unknown'})` };
  }

  const txType = String(payload.tx_type || '').toLowerCase();
  if (txType !== 'contract_call') {
    return { ok: false, error: `invalid transaction type (${txType || 'unknown'})` };
  }

  const contractCall = payload.contract_call;
  if (!contractCall || typeof contractCall !== 'object') {
    return { ok: false, error: 'missing contract_call payload in transaction' };
  }

  const contractId = String(contractCall.contract_id || '').trim();
  if (contractId !== tipsContractId) {
    return { ok: false, error: `tx contract mismatch (expected ${tipsContractId}, got ${contractId || 'unknown'})` };
  }

  const functionName = String(contractCall.function_name || '').trim();
  if (functionName !== 'tip-post') {
    return { ok: false, error: `tx function mismatch (expected tip-post, got ${functionName || 'unknown'})` };
  }

  const functionArgs = Array.isArray(contractCall.function_args) ? contractCall.function_args : [];
  if (functionArgs.length < 2) {
    return { ok: false, error: 'tip-post tx is missing function args' };
  }

  const txPostId = extractUintFromFunctionArg(functionArgs[0]);
  const txAmountMicroStx = extractUintFromFunctionArg(functionArgs[1]);

  if (!txPostId || txPostId !== expectedPostId) {
    return { ok: false, error: `postId mismatch (expected ${expectedPostId}, got ${txPostId || 'unknown'})` };
  }

  if (!txAmountMicroStx || txAmountMicroStx !== expectedAmountMicroStx) {
    return {
      ok: false,
      error: `amount mismatch (expected ${expectedAmountMicroStx}, got ${txAmountMicroStx || 'unknown'})`
    };
  }

  return {
    ok: true,
    txStatus,
    blockHeight: Number(payload.block_height || 0) || 0,
    txId: String(payload.tx_id || txid).toLowerCase()
  };
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStore();
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase() || '.img';
    const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '.img';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: MAX_IMAGE_SIZE
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    cb(null, mime.startsWith('image/'));
  }
});

app.use(cors());
app.use('/uploads', express.static(uploadsDir));
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/posts', upload.single('image'), (req, res) => {
  const text = String(req.body?.text || '').trim();
  const links = normalizeLinks(parseLinksInput(req.body?.links || []));

  const uploadedImages = req.file ? [buildUploadedImageUrl(req, req.file)] : [];
  const providedImages = normalizeImages(parseImagesInput(req.body?.images || []));
  const images = uploadedImages.length > 0 ? uploadedImages : providedImages;

  if (!text) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.length > 500) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'text max length is 500' });
  }

  const payload = buildPayload(text, links, images);
  const contentHash = hashPayload(payload);

  const store = readStore();
  const existing = store.postsByHash[contentHash];
  if (!existing) {
    store.postsByHash[contentHash] = {
      ...payload,
      contentHash,
      createdAt: new Date().toISOString(),
      totalTipMicroStx: '0',
      tipCount: 0
    };
    writeStore(store);
  } else if (req.file) {
    // Deduplicated content hash means current upload is not referenced.
    fs.unlinkSync(req.file.path);
  }

  return res.json({ contentHash });
});

app.delete('/posts/:hash', (req, res) => {
  const hash = String(req.params.hash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'invalid hash' });
  }

  const store = readStore();
  const existing = store.postsByHash[hash];
  const existed = Boolean(existing);
  if (existing) {
    const images = normalizeImages(existing.images || []);
    for (const imageUrl of images) {
      removeUploadedImage(imageUrl);
    }
    delete store.postsByHash[hash];
    writeStore(store);
  }

  return res.json({ ok: true, deleted: existed });
});

app.post('/tips', async (req, res) => {
  const contentHash = String(req.body?.contentHash || '').trim().toLowerCase();
  const postId = normalizePostId(req.body?.postId);
  const amountMicroStx = normalizeTipMicroStx(req.body?.amountMicroStx);
  const txid = String(req.body?.txid || '').trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    return res.status(400).json({ error: 'invalid contentHash' });
  }

  if (postId === '0') {
    return res.status(400).json({ error: 'invalid postId' });
  }

  if (amountMicroStx === '0') {
    return res.status(400).json({ error: 'invalid amountMicroStx' });
  }

  if (!txIdRegex.test(txid)) {
    return res.status(400).json({ error: 'invalid txid' });
  }

  const store = readStore();
  const existing = store.postsByHash[contentHash];
  if (!existing) {
    return res.status(404).json({ error: 'post not found for contentHash' });
  }

  const existingReceipt = store.tipReceiptsByTxId[txid];
  if (existingReceipt) {
    const samePayload = String(existingReceipt.contentHash) === contentHash
      && String(existingReceipt.postId) === postId
      && String(existingReceipt.amountMicroStx) === amountMicroStx;

    if (!samePayload) {
      return res.status(409).json({ error: 'txid already processed for another tip payload' });
    }

    return res.json({
      ok: true,
      duplicate: true,
      txid,
      contentHash,
      totalTipMicroStx: normalizeTipMicroStx(existing.totalTipMicroStx || '0'),
      tipCount: Number.parseInt(String(existing.tipCount || 0), 10) || 0
    });
  }

  const verification = await verifyTipTxViaHiro({
    txid,
    expectedPostId: postId,
    expectedAmountMicroStx: amountMicroStx
  });

  if (!verification.ok) {
    return res.status(400).json({ error: `tip tx verification failed: ${verification.error}` });
  }

  const currentTotal = normalizeTipMicroStx(existing.totalTipMicroStx || '0');
  const nextTotal = (BigInt(currentTotal) + BigInt(amountMicroStx)).toString();
  const currentCount = Number.parseInt(String(existing.tipCount || 0), 10);
  const nextCount = Number.isFinite(currentCount) && currentCount >= 0 ? currentCount + 1 : 1;

  store.postsByHash[contentHash] = {
    ...existing,
    totalTipMicroStx: nextTotal,
    tipCount: nextCount
  };

  store.tipReceiptsByTxId[txid] = {
    contentHash,
    postId,
    amountMicroStx,
    verifiedAt: new Date().toISOString(),
    blockHeight: verification.blockHeight || 0
  };

  writeStore(store);

  return res.json({
    ok: true,
    txid,
    contentHash,
    totalTipMicroStx: nextTotal,
    tipCount: nextCount
  });
});

app.get('/posts/by-hash', (req, res) => {
  const raw = String(req.query.hashes || '').trim();
  if (!raw) {
    return res.json({ posts: {} });
  }

  const hashes = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length === 64)
    .slice(0, 100);

  const store = readStore();
  const posts = {};

  for (const hash of hashes) {
    if (store.postsByHash[hash]) {
      const item = store.postsByHash[hash];
      posts[hash] = {
        ...item,
        totalTipMicroStx: normalizeTipMicroStx(item.totalTipMicroStx || '0'),
        tipCount: Number.parseInt(String(item.tipCount || 0), 10) || 0
      };
    }
  }

  return res.json({ posts });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'image max size is 5MB' });
    }
    return res.status(400).json({ error: err.message });
  }

  if (String(err?.message || '').toLowerCase().includes('image')) {
    return res.status(400).json({ error: 'invalid image upload' });
  }

  return res.status(500).json({ error: 'internal server error' });
});

ensureStore();
app.listen(port, () => {
  console.log(`backend server running on http://localhost:${port}`);
});

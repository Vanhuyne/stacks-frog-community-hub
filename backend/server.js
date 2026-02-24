import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.BACKEND_PORT || process.env.PORT || 8787);

const backendNetwork = String(process.env.BACKEND_STACKS_NETWORK || process.env.STACKS_NETWORK || 'mainnet').toLowerCase();
const defaultHiroApiBaseUrl = backendNetwork === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
const hiroApiBaseUrl = String(process.env.HIRO_API_BASE_URL || defaultHiroApiBaseUrl).trim().replace(/\/$/, '');
const tipsContractId = [
  process.env.TIPS_CONTRACT_ID,
  process.env.SOCIAL_TIPS_CONTRACT_ID,
  process.env.VITE_SOCIAL_TIPS_CONTRACT_ID
]
  .map((value) => String(value || '').trim())
  .find((value) => value.length > 0) || '';

const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseStorageBucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'frog-uploads').trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Backend now requires Supabase.');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const urlRegex = /^https?:\/\//i;
const txIdRegex = /^[0-9a-f]{64}$/i;
const contentHashRegex = /^[0-9a-f]{64}$/;

const safeJsonParse = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
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
    .filter((item) => item.length > 0 && urlRegex.test(item));
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

const buildPayload = (text, links, images) => ({ text, links, images });

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

const mapPostRowToApi = (row) => ({
  text: String(row.text || ''),
  links: normalizeLinks(row.links || []),
  images: normalizeImages(row.images || []),
  contentHash: String(row.content_hash || '').toLowerCase(),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  totalTipMicroStx: normalizeTipMicroStx(row.total_tip_micro_stx || '0'),
  tipCount: Number.parseInt(String(row.tip_count || 0), 10) || 0
});

const extractStorageObjectPathFromPublicUrl = (imageUrl) => {
  try {
    const parsed = new URL(String(imageUrl || ''));
    const marker = `/storage/v1/object/public/${supabaseStorageBucket}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch (_) {
    return null;
  }
};

const removeUploadedImage = async (imageUrl) => {
  const objectPath = extractStorageObjectPathFromPublicUrl(imageUrl);
  if (!objectPath) return;

  await supabase.storage.from(supabaseStorageBucket).remove([objectPath]);
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_IMAGE_SIZE
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    cb(null, mime.startsWith('image/'));
  }
});

const uploadImageToSupabase = async (file) => {
  const ext = path.extname(String(file.originalname || '')).toLowerCase() || '.img';
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '.img';
  const objectPath = `posts/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;

  const { error: uploadError } = await supabase.storage
    .from(supabaseStorageBucket)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false
    });

  if (uploadError) {
    throw new Error(`image upload failed: ${uploadError.message || 'unknown storage error'}`);
  }

  const { data } = supabase.storage.from(supabaseStorageBucket).getPublicUrl(objectPath);
  return {
    publicUrl: String(data?.publicUrl || '').trim(),
    objectPath
  };
};

app.use(cors());
app.use(express.json({ limit: '64kb' }));

app.get('/health', async (_req, res) => {
  const { error } = await supabase.from('posts').select('content_hash').limit(1);
  if (error) {
    return res.status(500).json({ ok: false, error: `supabase health check failed: ${error.message}` });
  }

  return res.json({ ok: true });
});

app.post('/posts', upload.single('image'), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const links = normalizeLinks(parseLinksInput(req.body?.links || []));

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: 'text max length is 500' });
  }

  const providedImages = normalizeImages(parseImagesInput(req.body?.images || []));

  let uploadedImage = null;
  try {
    if (req.file) {
      uploadedImage = await uploadImageToSupabase(req.file);
    }

    const images = uploadedImage ? [uploadedImage.publicUrl] : providedImages;
    const payload = buildPayload(text, links, images);
    const contentHash = hashPayload(payload);

    const { data: existing, error: existingError } = await supabase
      .from('posts')
      .select('content_hash')
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || 'failed to check existing post');
    }

    if (!existing) {
      const { error: insertError } = await supabase
        .from('posts')
        .insert({
          content_hash: contentHash,
          text,
          links,
          images,
          total_tip_micro_stx: '0',
          tip_count: 0
        });

      if (insertError) {
        throw new Error(insertError.message || 'failed to create post');
      }
    } else if (uploadedImage) {
      await supabase.storage.from(supabaseStorageBucket).remove([uploadedImage.objectPath]);
    }

    return res.json({ contentHash });
  } catch (err) {
    if (uploadedImage) {
      await supabase.storage.from(supabaseStorageBucket).remove([uploadedImage.objectPath]);
    }

    const message = String(err?.message || err || 'internal server error');
    if (message.toLowerCase().includes('image upload failed')) {
      return res.status(400).json({ error: message });
    }

    return res.status(500).json({ error: 'internal server error' });
  }
});

app.delete('/posts/:hash', async (req, res) => {
  const hash = String(req.params.hash || '').trim().toLowerCase();
  if (!contentHashRegex.test(hash)) {
    return res.status(400).json({ error: 'invalid hash' });
  }

  const { data: existing, error: readError } = await supabase
    .from('posts')
    .select('images')
    .eq('content_hash', hash)
    .maybeSingle();

  if (readError) {
    return res.status(500).json({ error: 'internal server error' });
  }

  if (!existing) {
    return res.json({ ok: true, deleted: false });
  }

  const images = normalizeImages(existing.images || []);
  for (const imageUrl of images) {
    await removeUploadedImage(imageUrl);
  }

  const { error: deleteError } = await supabase
    .from('posts')
    .delete()
    .eq('content_hash', hash);

  if (deleteError) {
    return res.status(500).json({ error: 'internal server error' });
  }

  return res.json({ ok: true, deleted: true });
});

app.post('/tips', async (req, res) => {
  const contentHash = String(req.body?.contentHash || '').trim().toLowerCase();
  const postId = normalizePostId(req.body?.postId);
  const amountMicroStx = normalizeTipMicroStx(req.body?.amountMicroStx);
  const txid = String(req.body?.txid || '').trim().toLowerCase();

  if (!contentHashRegex.test(contentHash)) {
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

  const { data: postRow, error: postReadError } = await supabase
    .from('posts')
    .select('content_hash, total_tip_micro_stx, tip_count')
    .eq('content_hash', contentHash)
    .maybeSingle();

  if (postReadError) {
    return res.status(500).json({ error: 'internal server error' });
  }

  if (!postRow) {
    return res.status(404).json({ error: 'post not found for contentHash' });
  }

  const { data: existingReceipt, error: receiptReadError } = await supabase
    .from('tip_receipts')
    .select('content_hash, post_id, amount_micro_stx')
    .eq('txid', txid)
    .maybeSingle();

  if (receiptReadError) {
    return res.status(500).json({ error: 'internal server error' });
  }

  if (existingReceipt) {
    const samePayload = String(existingReceipt.content_hash || '') === contentHash
      && String(existingReceipt.post_id || '') === postId
      && String(existingReceipt.amount_micro_stx || '') === amountMicroStx;

    if (!samePayload) {
      return res.status(409).json({ error: 'txid already processed for another tip payload' });
    }

    return res.json({
      ok: true,
      duplicate: true,
      txid,
      contentHash,
      totalTipMicroStx: normalizeTipMicroStx(postRow.total_tip_micro_stx || '0'),
      tipCount: Number.parseInt(String(postRow.tip_count || 0), 10) || 0
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

  const { error: insertReceiptError } = await supabase
    .from('tip_receipts')
    .insert({
      txid,
      content_hash: contentHash,
      post_id: postId,
      amount_micro_stx: amountMicroStx,
      verified_at: new Date().toISOString(),
      block_height: verification.blockHeight || 0
    });

  if (insertReceiptError) {
    if (String(insertReceiptError.code || '') === '23505') {
      return res.json({
        ok: true,
        duplicate: true,
        txid,
        contentHash,
        totalTipMicroStx: normalizeTipMicroStx(postRow.total_tip_micro_stx || '0'),
        tipCount: Number.parseInt(String(postRow.tip_count || 0), 10) || 0
      });
    }

    return res.status(500).json({ error: 'internal server error' });
  }

  const { data: updatedTotals, error: totalsError } = await supabase
    .rpc('increment_post_tip_totals', {
      p_content_hash: contentHash,
      p_amount_micro_stx: amountMicroStx
    })
    .single();

  if (totalsError) {
    await supabase.from('tip_receipts').delete().eq('txid', txid);
    return res.status(500).json({ error: `tip tx verification failed: ${totalsError.message}` });
  }

  return res.json({
    ok: true,
    txid,
    contentHash,
    totalTipMicroStx: normalizeTipMicroStx(updatedTotals.total_tip_micro_stx || '0'),
    tipCount: Number.parseInt(String(updatedTotals.tip_count || 0), 10) || 0
  });
});

app.get('/posts/by-hash', async (req, res) => {
  const raw = String(req.query.hashes || '').trim();
  if (!raw) {
    return res.json({ posts: {} });
  }

  const hashes = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => contentHashRegex.test(item))
    .slice(0, 100);

  if (hashes.length === 0) {
    return res.json({ posts: {} });
  }

  const { data, error } = await supabase
    .from('posts')
    .select('content_hash, text, links, images, created_at, total_tip_micro_stx, tip_count')
    .in('content_hash', hashes);

  if (error) {
    return res.status(500).json({ error: 'internal server error' });
  }

  const posts = {};
  for (const row of data || []) {
    const mapped = mapPostRowToApi(row);
    posts[mapped.contentHash] = mapped;
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

app.listen(port, () => {
  console.log(`backend server running on http://localhost:${port}`);
});

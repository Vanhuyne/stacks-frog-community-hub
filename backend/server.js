import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.set('trust proxy', 1);

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
const MAX_TEXT_LENGTH = 500;
const HIRO_TIMEOUT_MS = Number(process.env.HIRO_TIMEOUT_MS || 10000);

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_GENERAL = Number(process.env.RATE_LIMIT_MAX_GENERAL || 180);
const RATE_LIMIT_MAX_POSTS = Number(process.env.RATE_LIMIT_MAX_POSTS || 20);
const RATE_LIMIT_MAX_TIPS = Number(process.env.RATE_LIMIT_MAX_TIPS || 45);
const RATE_LIMIT_MAX_POST_LOOKUPS = Number(process.env.RATE_LIMIT_MAX_POST_LOOKUPS || 240);

const CACHE_TTL_POSTS_BY_HASH_MS = Number(process.env.CACHE_TTL_POSTS_BY_HASH_MS || 15_000);
const CACHE_TTL_HIRO_TX_MS = Number(process.env.CACHE_TTL_HIRO_TX_MS || 20_000);
const CACHE_TTL_VERIFY_TX_MS = Number(process.env.CACHE_TTL_VERIFY_TX_MS || 20_000);
const CACHE_TTL_STATS_MS = Number(process.env.CACHE_TTL_STATS_MS || 30_000);
const CACHE_TTL_JOBS_STATS_MS = Number(process.env.CACHE_TTL_JOBS_STATS_MS || 10_000);

const JOB_POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS || 15_000);
const JOB_CLEANUP_INTERVAL_MS = Number(process.env.JOB_CLEANUP_INTERVAL_MS || 3_600_000);
const JOB_CLEANUP_DONE_AFTER_HOURS = Number(process.env.JOB_CLEANUP_DONE_AFTER_HOURS || 168);
const JOB_CLEANUP_FAILED_AFTER_HOURS = Number(process.env.JOB_CLEANUP_FAILED_AFTER_HOURS || 720);
const JOB_BATCH_SIZE = Number(process.env.JOB_BATCH_SIZE || 6);
const JOB_RETRY_MAX_ATTEMPTS = Number(process.env.JOB_RETRY_MAX_ATTEMPTS || 8);

const ALERT_CHECK_INTERVAL_MS = Number(process.env.ALERT_CHECK_INTERVAL_MS || 60_000);
const ALERT_429_PER_WINDOW_WARN = Number(process.env.ALERT_429_PER_WINDOW_WARN || 50);
const ALERT_JOB_BACKLOG_WARN = Number(process.env.ALERT_JOB_BACKLOG_WARN || 100);
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 300_000);
const ALERT_WEBHOOK_URL = String(process.env.ALERT_WEBHOOK_URL || '').trim();

const JOB_TYPE_TIP_REVERIFY = 'tip_reverify';
const JOB_STATUS_PENDING = 'pending';
const JOB_STATUS_RUNNING = 'running';
const JOB_STATUS_DONE = 'done';
const JOB_STATUS_RETRY = 'retry';
const JOB_STATUS_FAILED = 'failed';

const IDEMPOTENCY_TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 600_000);
const IDEMPOTENCY_MAX_KEY_LENGTH = Number(process.env.IDEMPOTENCY_MAX_KEY_LENGTH || 128);
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{8,128}$/;

const urlRegex = /^https?:\/\//i;
const txIdRegex = /^[0-9a-f]{64}$/i;
const contentHashRegex = /^[0-9a-f]{64}$/;

const memCache = new Map();
const rateLimitStores = {
  general: new Map(),
  posts: new Map(),
  tips: new Map(),
  postLookup: new Map()
};
const idempotencyStore = new Map();

let jobsTableUnavailable = false;
let isProcessingJobs = false;

const runtimeMetrics = {
  rateLimit429Count: 0,
  healthProbeFailures: 0,
  jobsProbeFailures: 0
};
const alertLastSentAt = new Map();

const cacheGet = (key) => {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
};

const cacheSet = (key, value, ttlMs) => {
  memCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0)
  });
};

const cacheDeleteByPrefix = (prefix) => {
  for (const key of memCache.keys()) {
    if (key.startsWith(prefix)) memCache.delete(key);
  }
};

const getIdempotencyKey = (req) => {
  const raw = String(req.headers['idempotency-key'] || '').trim();
  if (!raw) return { key: '', error: '' };
  if (raw.length > IDEMPOTENCY_MAX_KEY_LENGTH) {
    return { key: '', error: 'Idempotency-Key is too long' };
  }
  if (!IDEMPOTENCY_KEY_REGEX.test(raw)) {
    return { key: '', error: 'Idempotency-Key format is invalid' };
  }
  return { key: raw, error: '' };
};

const getIdempotencyEntry = (key) => {
  const entry = idempotencyStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyStore.delete(key);
    return null;
  }
  return entry;
};

const setIdempotencyEntry = (key, value, ttlMs = IDEMPOTENCY_TTL_MS) => {
  idempotencyStore.set(key, {
    ...value,
    expiresAt: Date.now() + Math.max(1_000, Number(ttlMs) || IDEMPOTENCY_TTL_MS)
  });
};

const clearIdempotencyEntry = (key) => {
  if (!key) return;
  idempotencyStore.delete(key);
};

const maybeCleanupIdempotencyStore = () => {
  const now = Date.now();
  for (const [key, value] of idempotencyStore.entries()) {
    if (now > value.expiresAt) idempotencyStore.delete(key);
  }
};

const maybeCleanupRateStore = (store) => {
  const now = Date.now();
  for (const [key, info] of store.entries()) {
    if (now > info.resetAt + RATE_LIMIT_WINDOW_MS) {
      store.delete(key);
    }
  }
};

const createRateLimiter = ({ key, windowMs, maxRequests }) => {
  const windowSize = Math.max(1_000, Number(windowMs) || RATE_LIMIT_WINDOW_MS);
  const maxAllowed = Math.max(1, Number(maxRequests) || 1);
  const store = rateLimitStores[key];

  return (req, res, next) => {
    const sourceKey = String(req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();

    if (Math.random() < 0.01) {
      maybeCleanupRateStore(store);
      maybeCleanupIdempotencyStore();
    }

    const existing = store.get(sourceKey);
    if (!existing || now > existing.resetAt) {
      const nextInfo = { count: 1, resetAt: now + windowSize };
      store.set(sourceKey, nextInfo);
      res.setHeader('X-RateLimit-Limit', String(maxAllowed));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxAllowed - nextInfo.count)));
      res.setHeader('X-RateLimit-Reset', String(Math.floor(nextInfo.resetAt / 1000)));
      return next();
    }

    existing.count += 1;
    store.set(sourceKey, existing);

    const remaining = Math.max(0, maxAllowed - existing.count);
    res.setHeader('X-RateLimit-Limit', String(maxAllowed));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(existing.resetAt / 1000)));

    if (existing.count > maxAllowed) {
      runtimeMetrics.rateLimit429Count += 1;
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'rate limit exceeded, please retry shortly' });
    }

    return next();
  };
};

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

const isTransientHiroError = (message) => {
  const raw = String(message || '').toLowerCase();
  return raw.includes('hiro request failed') || raw.includes('timed out') || raw.includes('abort');
};

const fetchJsonWithTimeout = async (url, timeoutMs = HIRO_TIMEOUT_MS) => {
  const cacheKey = `hiro:${url}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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
      const output = { ok: false, error: `hiro request failed (${response.status})` };
      cacheSet(cacheKey, output, Math.min(5_000, CACHE_TTL_HIRO_TX_MS));
      return output;
    }

    const payload = await response.json();
    const output = { ok: true, payload };
    cacheSet(cacheKey, output, CACHE_TTL_HIRO_TX_MS);
    return output;
  } catch (err) {
    const message = String(err?.message || err || 'unknown hiro error');
    const output = { ok: false, error: `hiro request failed (${message})` };
    cacheSet(cacheKey, output, Math.min(3_000, CACHE_TTL_HIRO_TX_MS));
    return output;
  } finally {
    clearTimeout(timeout);
  }
};

const verifyTipTxViaHiro = async ({ txid, expectedPostId, expectedAmountMicroStx }) => {
  if (!tipsContractId) {
    return { ok: false, error: 'server is missing TIPS_CONTRACT_ID for tip verification' };
  }

  const cacheKey = `verify:${txid}:${expectedPostId}:${expectedAmountMicroStx}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const txLookup = await fetchJsonWithTimeout(`${hiroApiBaseUrl}/extended/v1/tx/${txid}`);
  if (!txLookup.ok) {
    cacheSet(cacheKey, txLookup, Math.min(5_000, CACHE_TTL_VERIFY_TX_MS));
    return txLookup;
  }

  const payload = txLookup.payload || {};
  const txStatus = String(payload.tx_status || '').toLowerCase();
  if (txStatus !== 'success') {
    const out = { ok: false, error: `transaction not successful (tx_status=${txStatus || 'unknown'})` };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const txType = String(payload.tx_type || '').toLowerCase();
  if (txType !== 'contract_call') {
    const out = { ok: false, error: `invalid transaction type (${txType || 'unknown'})` };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const contractCall = payload.contract_call;
  if (!contractCall || typeof contractCall !== 'object') {
    const out = { ok: false, error: 'missing contract_call payload in transaction' };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const contractId = String(contractCall.contract_id || '').trim();
  if (contractId !== tipsContractId) {
    const out = { ok: false, error: `tx contract mismatch (expected ${tipsContractId}, got ${contractId || 'unknown'})` };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const functionName = String(contractCall.function_name || '').trim();
  if (functionName !== 'tip-post') {
    const out = { ok: false, error: `tx function mismatch (expected tip-post, got ${functionName || 'unknown'})` };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const functionArgs = Array.isArray(contractCall.function_args) ? contractCall.function_args : [];
  if (functionArgs.length < 2) {
    const out = { ok: false, error: 'tip-post tx is missing function args' };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const txPostId = extractUintFromFunctionArg(functionArgs[0]);
  const txAmountMicroStx = extractUintFromFunctionArg(functionArgs[1]);

  if (!txPostId || txPostId !== expectedPostId) {
    const out = { ok: false, error: `postId mismatch (expected ${expectedPostId}, got ${txPostId || 'unknown'})` };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  if (!txAmountMicroStx || txAmountMicroStx !== expectedAmountMicroStx) {
    const out = { ok: false, error: `amount mismatch (expected ${expectedAmountMicroStx}, got ${txAmountMicroStx || 'unknown'})` };
    cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
    return out;
  }

  const out = {
    ok: true,
    txStatus,
    blockHeight: Number(payload.block_height || 0) || 0,
    txId: String(payload.tx_id || txid).toLowerCase()
  };
  cacheSet(cacheKey, out, CACHE_TTL_VERIFY_TX_MS);
  return out;
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

const fetchPostTotals = async (contentHash) => {
  const { data: postRow, error } = await supabase
    .from('posts')
    .select('total_tip_micro_stx, tip_count')
    .eq('content_hash', contentHash)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'failed to read post totals');
  }

  return {
    totalTipMicroStx: normalizeTipMicroStx(postRow?.total_tip_micro_stx || '0'),
    tipCount: Number.parseInt(String(postRow?.tip_count || 0), 10) || 0
  };
};

const persistTipReceiptAndTotals = async ({ txid, contentHash, postId, amountMicroStx, blockHeight }) => {
  const { data: existingReceipt, error: receiptReadError } = await supabase
    .from('tip_receipts')
    .select('content_hash, post_id, amount_micro_stx')
    .eq('txid', txid)
    .maybeSingle();

  if (receiptReadError) {
    throw new Error(receiptReadError.message || 'failed to read tip receipt');
  }

  if (existingReceipt) {
    const samePayload = String(existingReceipt.content_hash || '') === contentHash
      && String(existingReceipt.post_id || '') === postId
      && String(existingReceipt.amount_micro_stx || '') === amountMicroStx;

    if (!samePayload) {
      throw new Error('txid already processed for another tip payload');
    }

    const totals = await fetchPostTotals(contentHash);
    return {
      duplicate: true,
      ...totals
    };
  }

  const { error: insertReceiptError } = await supabase
    .from('tip_receipts')
    .insert({
      txid,
      content_hash: contentHash,
      post_id: postId,
      amount_micro_stx: amountMicroStx,
      verified_at: new Date().toISOString(),
      block_height: blockHeight || 0
    });

  if (insertReceiptError) {
    if (String(insertReceiptError.code || '') === '23505') {
      const totals = await fetchPostTotals(contentHash);
      return {
        duplicate: true,
        ...totals
      };
    }
    throw new Error(insertReceiptError.message || 'failed to insert tip receipt');
  }

  const { data: updatedTotals, error: totalsError } = await supabase
    .rpc('increment_post_tip_totals', {
      p_content_hash: contentHash,
      p_amount_micro_stx: amountMicroStx
    })
    .single();

  if (totalsError) {
    await supabase.from('tip_receipts').delete().eq('txid', txid);
    throw new Error(totalsError.message || 'failed to increment tip totals');
  }

  cacheDeleteByPrefix('stats:');

  return {
    duplicate: false,
    totalTipMicroStx: normalizeTipMicroStx(updatedTotals.total_tip_micro_stx || '0'),
    tipCount: Number.parseInt(String(updatedTotals.tip_count || 0), 10) || 0
  };
};

const enqueueTipReverifyJob = async ({ txid, contentHash, postId, amountMicroStx, reason }) => {
  if (jobsTableUnavailable) return false;

  const dedupeKey = `tip-reverify:${txid}`;
  const payload = {
    txid,
    contentHash,
    postId,
    amountMicroStx
  };

  const { error } = await supabase
    .from('jobs')
    .upsert({
      type: JOB_TYPE_TIP_REVERIFY,
      status: JOB_STATUS_PENDING,
      dedupe_key: dedupeKey,
      payload,
      attempts: 0,
      last_error: String(reason || ''),
      next_run_at: new Date().toISOString()
    }, {
      onConflict: 'type,dedupe_key'
    });

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('relation') && msg.includes('jobs')) {
      jobsTableUnavailable = true;
      console.warn('[jobs] jobs table unavailable; skipping async queue path');
      return false;
    }

    console.warn('[jobs] failed to enqueue tip reverify job:', error.message || error);
    return false;
  }

  return true;
};

const markJobResult = async ({ id, status, attempts, errorMessage, retryInMs = 0 }) => {
  if (jobsTableUnavailable) return;

  const nextRunAt = new Date(Date.now() + Math.max(0, retryInMs)).toISOString();

  await supabase
    .from('jobs')
    .update({
      status,
      attempts,
      last_error: errorMessage || null,
      next_run_at: status === JOB_STATUS_RETRY ? nextRunAt : new Date().toISOString(),
      started_at: status === JOB_STATUS_RUNNING ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
};

const processTipReverifyJob = async (job) => {
  const payload = job.payload || {};
  const txid = String(payload.txid || '').trim().toLowerCase();
  const contentHash = String(payload.contentHash || '').trim().toLowerCase();
  const postId = normalizePostId(payload.postId);
  const amountMicroStx = normalizeTipMicroStx(payload.amountMicroStx);

  if (!txIdRegex.test(txid) || !contentHashRegex.test(contentHash) || postId === '0' || amountMicroStx === '0') {
    await markJobResult({
      id: job.id,
      status: JOB_STATUS_FAILED,
      attempts: Number(job.attempts || 0) + 1,
      errorMessage: 'invalid payload for tip reverify job'
    });
    return;
  }

  const verify = await verifyTipTxViaHiro({
    txid,
    expectedPostId: postId,
    expectedAmountMicroStx: amountMicroStx
  });

  if (!verify.ok) {
    const nextAttempts = Number(job.attempts || 0) + 1;
    if (isTransientHiroError(verify.error) && nextAttempts < JOB_RETRY_MAX_ATTEMPTS) {
      await markJobResult({
        id: job.id,
        status: JOB_STATUS_RETRY,
        attempts: nextAttempts,
        errorMessage: verify.error,
        retryInMs: Math.min(120_000, 5_000 * (2 ** Math.min(6, nextAttempts)))
      });
      return;
    }

    await markJobResult({
      id: job.id,
      status: JOB_STATUS_FAILED,
      attempts: nextAttempts,
      errorMessage: verify.error
    });
    return;
  }

  try {
    await persistTipReceiptAndTotals({
      txid,
      contentHash,
      postId,
      amountMicroStx,
      blockHeight: verify.blockHeight || 0
    });

    await markJobResult({
      id: job.id,
      status: JOB_STATUS_DONE,
      attempts: Number(job.attempts || 0) + 1,
      errorMessage: null
    });
  } catch (err) {
    const message = String(err?.message || err || 'unknown error');
    const attempts = Number(job.attempts || 0) + 1;

    if (attempts < JOB_RETRY_MAX_ATTEMPTS) {
      await markJobResult({
        id: job.id,
        status: JOB_STATUS_RETRY,
        attempts,
        errorMessage: message,
        retryInMs: Math.min(180_000, 8_000 * (2 ** Math.min(6, attempts)))
      });
      return;
    }

    await markJobResult({
      id: job.id,
      status: JOB_STATUS_FAILED,
      attempts,
      errorMessage: message
    });
  }
};

const processPendingJobs = async () => {
  if (jobsTableUnavailable || isProcessingJobs) return;
  isProcessingJobs = true;

  try {
    const nowIso = new Date().toISOString();
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, type, status, attempts, payload')
      .in('status', [JOB_STATUS_PENDING, JOB_STATUS_RETRY])
      .lte('next_run_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(JOB_BATCH_SIZE);

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('relation') && msg.includes('jobs')) {
        jobsTableUnavailable = true;
        console.warn('[jobs] jobs table unavailable; disabling background job processor');
        return;
      }

      console.warn('[jobs] failed to fetch pending jobs:', error.message || error);
      return;
    }

    for (const job of jobs || []) {
      await supabase
        .from('jobs')
        .update({
          status: JOB_STATUS_RUNNING,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)
        .in('status', [JOB_STATUS_PENDING, JOB_STATUS_RETRY]);

      if (job.type === JOB_TYPE_TIP_REVERIFY) {
        await processTipReverifyJob(job);
      } else {
        await markJobResult({
          id: job.id,
          status: JOB_STATUS_FAILED,
          attempts: Number(job.attempts || 0) + 1,
          errorMessage: `unknown job type ${String(job.type || '')}`
        });
      }
    }
  } finally {
    isProcessingJobs = false;
  }
};

const probeJobsRuntime = async () => {
  if (jobsTableUnavailable) return;

  const { error } = await supabase
    .from('jobs')
    .select('id')
    .limit(1);

  if (!error) {
    console.log('[jobs] jobs table ready; async retry processor enabled');
    return;
  }

  const message = String(error.message || '').toLowerCase();
  if (message.includes('relation') && message.includes('jobs')) {
    jobsTableUnavailable = true;
    console.warn('[jobs] jobs table not found; run backend/supabase/schema.sql to enable async retries');
    return;
  }

  runtimeMetrics.jobsProbeFailures += 1;
  console.warn('[jobs] runtime probe error:', error.message || error);
};


const cleanupOldJobs = async () => {
  if (jobsTableUnavailable) return;

  const doneBefore = new Date(Date.now() - Math.max(1, JOB_CLEANUP_DONE_AFTER_HOURS) * 60 * 60 * 1000).toISOString();
  const failedBefore = new Date(Date.now() - Math.max(1, JOB_CLEANUP_FAILED_AFTER_HOURS) * 60 * 60 * 1000).toISOString();

  const [doneDelete, failedDelete] = await Promise.all([
    supabase.from('jobs').delete().eq('status', JOB_STATUS_DONE).lt('updated_at', doneBefore),
    supabase.from('jobs').delete().eq('status', JOB_STATUS_FAILED).lt('updated_at', failedBefore)
  ]);

  for (const result of [doneDelete, failedDelete]) {
    if (!result.error) continue;
    const msg = String(result.error.message || '').toLowerCase();
    if (msg.includes('relation') && msg.includes('jobs')) {
      jobsTableUnavailable = true;
      console.warn('[jobs] jobs table unavailable; disabling cleanup');
      return;
    }
    console.warn('[jobs] cleanup error:', result.error.message || result.error);
  }
};

const fetchJobStatusCount = async (status) => {
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);

  if (error) throw error;
  return Number(count || 0);
};


const emitAlert = async (key, message, metadata = {}) => {
  const now = Date.now();
  const lastSentAt = alertLastSentAt.get(key) || 0;

  if (now - lastSentAt < ALERT_COOLDOWN_MS) return;
  alertLastSentAt.set(key, now);

  console.warn(`[alert:${key}] ${message}`, metadata);

  if (!ALERT_WEBHOOK_URL) return;

  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key,
        message,
        metadata,
        at: new Date(now).toISOString()
      })
    });
  } catch (error) {
    console.warn('[alert] failed to send webhook:', error?.message || error);
  }
};

const runAlertChecks = async () => {
  const intervalSeconds = Math.max(1, Math.round(ALERT_CHECK_INTERVAL_MS / 1000));
  const rateLimit429Count = runtimeMetrics.rateLimit429Count;
  runtimeMetrics.rateLimit429Count = 0;

  if (rateLimit429Count >= ALERT_429_PER_WINDOW_WARN) {
    await emitAlert(
      'rate-limit-spike',
      `High 429 volume detected: ${rateLimit429Count} responses in ${intervalSeconds}s`,
      { rateLimit429Count, intervalSeconds }
    );
  }

  if (runtimeMetrics.healthProbeFailures > 0) {
    await emitAlert(
      'health-probe-failures',
      `Health probe failures detected: ${runtimeMetrics.healthProbeFailures} in ${intervalSeconds}s`,
      { failures: runtimeMetrics.healthProbeFailures, intervalSeconds }
    );
    runtimeMetrics.healthProbeFailures = 0;
  }

  if (runtimeMetrics.jobsProbeFailures > 0) {
    await emitAlert(
      'jobs-probe-failures',
      `Jobs runtime probe failures detected: ${runtimeMetrics.jobsProbeFailures} in ${intervalSeconds}s`,
      { failures: runtimeMetrics.jobsProbeFailures, intervalSeconds }
    );
    runtimeMetrics.jobsProbeFailures = 0;
  }

  if (jobsTableUnavailable) return;

  try {
    const [pending, retry] = await Promise.all([
      fetchJobStatusCount(JOB_STATUS_PENDING),
      fetchJobStatusCount(JOB_STATUS_RETRY)
    ]);

    const backlog = pending + retry;
    if (backlog >= ALERT_JOB_BACKLOG_WARN) {
      await emitAlert(
        'jobs-backlog-high',
        `Jobs backlog is high: ${backlog} (pending=${pending}, retry=${retry})`,
        { backlog, pending, retry }
      );
    }
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('relation') && msg.includes('jobs')) {
      jobsTableUnavailable = true;
      return;
    }
    console.warn('[alert] backlog check failed:', error?.message || error);
  }
};

app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(createRateLimiter({ key: 'general', windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX_GENERAL }));

app.get('/health', async (_req, res) => {
  const healthCached = cacheGet('health:status');
  if (healthCached) return res.json(healthCached);

  const { error } = await supabase.from('posts').select('content_hash').limit(1);
  if (error) {
    runtimeMetrics.healthProbeFailures += 1;
    return res.status(500).json({ ok: false, error: 'supabase health check failed: ' + (error.message || 'unknown error') });
  }

  const payload = { ok: true };
  cacheSet('health:status', payload, 3_000);
  return res.json(payload);
});


app.get('/jobs/stats', async (_req, res) => {
  if (jobsTableUnavailable) {
    return res.json({
      enabled: false,
      pending: 0,
      retry: 0,
      running: 0,
      failed: 0,
      done: 0,
      updatedAt: new Date().toISOString()
    });
  }

  const cacheKey = 'jobs:stats';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [pending, retry, running, failed, done] = await Promise.all([
      fetchJobStatusCount(JOB_STATUS_PENDING),
      fetchJobStatusCount(JOB_STATUS_RETRY),
      fetchJobStatusCount(JOB_STATUS_RUNNING),
      fetchJobStatusCount(JOB_STATUS_FAILED),
      fetchJobStatusCount(JOB_STATUS_DONE)
    ]);

    const payload = {
      enabled: true,
      pending,
      retry,
      running,
      failed,
      done,
      updatedAt: new Date().toISOString()
    };

    cacheSet(cacheKey, payload, CACHE_TTL_JOBS_STATS_MS);
    return res.json(payload);
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('relation') && msg.includes('jobs')) {
      jobsTableUnavailable = true;
      return res.json({
        enabled: false,
        pending: 0,
        retry: 0,
        running: 0,
        failed: 0,
        done: 0,
        updatedAt: new Date().toISOString()
      });
    }

    return res.status(500).json({ error: 'internal server error' });
  }
});

app.get('/stats', async (_req, res) => {
  const cacheKey = 'stats:global';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const [postsCountResult, tipAggregateResult] = await Promise.all([
    supabase.from('posts').select('content_hash', { count: 'exact', head: true }),
    supabase.from('posts').select('total_tip_micro_stx, tip_count')
  ]);

  if (postsCountResult.error || tipAggregateResult.error) {
    return res.status(500).json({ error: 'internal server error' });
  }

  let totalTipMicroStx = 0n;
  let totalTips = 0;
  for (const row of tipAggregateResult.data || []) {
    totalTipMicroStx += BigInt(String(row.total_tip_micro_stx || '0'));
    totalTips += Number.parseInt(String(row.tip_count || 0), 10) || 0;
  }

  const payload = {
    posts: Number(postsCountResult.count || 0),
    tips: totalTips,
    totalTipMicroStx: totalTipMicroStx.toString(),
    updatedAt: new Date().toISOString()
  };

  cacheSet(cacheKey, payload, CACHE_TTL_STATS_MS);
  return res.json(payload);
});

app.post('/posts', createRateLimiter({ key: 'posts', windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX_POSTS }), upload.single('image'), async (req, res) => {
  const { key: idempotencyKey, error: idempotencyError } = getIdempotencyKey(req);
  if (idempotencyError) {
    return res.status(400).json({ error: idempotencyError });
  }

  const idemCacheKey = idempotencyKey ? `idempotency:posts:${idempotencyKey}` : '';
  if (idemCacheKey) {
    const existing = getIdempotencyEntry(idemCacheKey);
    if (existing?.state === 'processing') {
      return res.status(409).json({ error: 'request with same Idempotency-Key is still processing' });
    }

    if (existing?.state === 'completed') {
      res.setHeader('Idempotency-Replayed', 'true');
      return res.status(existing.statusCode).json(existing.body);
    }

    setIdempotencyEntry(idemCacheKey, { state: 'processing' }, IDEMPOTENCY_TTL_MS);
  }

  const finish = (statusCode, body, { cacheResult = true } = {}) => {
    if (idemCacheKey) {
      if (cacheResult) {
        setIdempotencyEntry(idemCacheKey, {
          state: 'completed',
          statusCode,
          body
        }, IDEMPOTENCY_TTL_MS);
      } else {
        clearIdempotencyEntry(idemCacheKey);
      }
    }
    return res.status(statusCode).json(body);
  };

  const text = String(req.body?.text || '').trim();
  const links = normalizeLinks(parseLinksInput(req.body?.links || []));

  if (!text) {
    return finish(400, { error: 'text is required' });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return finish(400, { error: `text max length is ${MAX_TEXT_LENGTH}` });
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

      cacheDeleteByPrefix('posts-by-hash:');
      cacheDeleteByPrefix('stats:');
    } else if (uploadedImage) {
      await supabase.storage.from(supabaseStorageBucket).remove([uploadedImage.objectPath]);
    }

    return finish(200, { contentHash });
  } catch (err) {
    if (uploadedImage) {
      await supabase.storage.from(supabaseStorageBucket).remove([uploadedImage.objectPath]);
    }

    const message = String(err?.message || err || 'internal server error');
    if (message.toLowerCase().includes('image upload failed')) {
      return finish(400, { error: message });
    }

    return finish(500, { error: 'internal server error' }, { cacheResult: false });
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

  cacheDeleteByPrefix('posts-by-hash:');
  cacheDeleteByPrefix('stats:');
  return res.json({ ok: true, deleted: true });
});

app.post('/tips', createRateLimiter({ key: 'tips', windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX_TIPS }), async (req, res) => {
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
    if (isTransientHiroError(verification.error)) {
      const queued = await enqueueTipReverifyJob({
        txid,
        contentHash,
        postId,
        amountMicroStx,
        reason: verification.error
      });

      if (queued) {
        return res.status(202).json({
          ok: true,
          pending: true,
          txid,
          contentHash,
          message: 'tip verification queued; backend will retry shortly',
          totalTipMicroStx: normalizeTipMicroStx(postRow.total_tip_micro_stx || '0'),
          tipCount: Number.parseInt(String(postRow.tip_count || 0), 10) || 0
        });
      }
    }

    return res.status(400).json({ error: `tip tx verification failed: ${verification.error}` });
  }

  try {
    const persisted = await persistTipReceiptAndTotals({
      txid,
      contentHash,
      postId,
      amountMicroStx,
      blockHeight: verification.blockHeight || 0
    });

    return res.json({
      ok: true,
      duplicate: persisted.duplicate,
      txid,
      contentHash,
      totalTipMicroStx: persisted.totalTipMicroStx,
      tipCount: persisted.tipCount
    });
  } catch (err) {
    const message = String(err?.message || err || 'internal server error');
    if (message.includes('another tip payload')) {
      return res.status(409).json({ error: message });
    }
    return res.status(500).json({ error: 'internal server error' });
  }
});

app.get('/posts/by-hash', createRateLimiter({ key: 'postLookup', windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX_POST_LOOKUPS }), async (req, res) => {
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

  const cacheKey = `posts-by-hash:${hashes.slice().sort().join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
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

  const payload = { posts };
  cacheSet(cacheKey, payload, CACHE_TTL_POSTS_BY_HASH_MS);
  res.setHeader('X-Cache', 'MISS');
  return res.json(payload);
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

  probeJobsRuntime().catch((err) => {
    runtimeMetrics.jobsProbeFailures += 1;
    console.warn('[jobs] runtime probe failed:', err?.message || err);
  });

  cleanupOldJobs().catch((err) => {
    console.warn('[jobs] initial cleanup failed:', err?.message || err);
  });

  setInterval(() => {
    processPendingJobs().catch((err) => {
      console.warn('[jobs] unhandled processor error:', err?.message || err);
    });
  }, JOB_POLL_INTERVAL_MS);

  setInterval(() => {
    cleanupOldJobs().catch((err) => {
      console.warn('[jobs] periodic cleanup failed:', err?.message || err);
    });
  }, JOB_CLEANUP_INTERVAL_MS);

  setInterval(() => {
    runAlertChecks().catch((err) => {
      console.warn('[alert] periodic check failed:', err?.message || err);
    });
  }, ALERT_CHECK_INTERVAL_MS);
});

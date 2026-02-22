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

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const urlRegex = /^https?:\/\//i;

const ensureStore = () => {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ postsByHash: {} }, null, 2));
  }
};

const readStore = () => {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { postsByHash: {} };
    if (!parsed.postsByHash || typeof parsed.postsByHash !== 'object') return { postsByHash: {} };
    return parsed;
  } catch (_) {
    return { postsByHash: {} };
  }
};

const writeStore = (store) => {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
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

const hashPayload = (payload) => {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const buildUploadedImageUrl = (req, file) => {
  const explicitBaseUrl = String(process.env.BACKEND_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicitBaseUrl) return `${explicitBaseUrl}/uploads/${file.filename}`;

  const host = String(req.get('host') || '').trim();
  const protocol = String(req.protocol || 'http').trim();
  return `${protocol}://${host}/uploads/${file.filename}`;
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
      createdAt: new Date().toISOString()
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
      posts[hash] = store.postsByHash[hash];
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

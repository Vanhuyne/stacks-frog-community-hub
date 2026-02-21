import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 8787);
const dataDir = path.resolve(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'posts.json');

const urlRegex = /^https?:\/\//i;

const ensureStore = () => {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
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

const normalizeLinks = (links) => {
  if (!Array.isArray(links)) return [];
  const normalized = links
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0 && urlRegex.test(item));
  return [...new Set(normalized)].slice(0, 10);
};

const buildPayload = (text, links) => ({
  text,
  links
});

const hashPayload = (payload) => {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

app.use(cors());
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/posts', (req, res) => {
  const text = String(req.body?.text || '').trim();
  const links = normalizeLinks(req.body?.links || []);

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: 'text max length is 500' });
  }

  const payload = buildPayload(text, links);
  const contentHash = hashPayload(payload);

  const store = readStore();
  store.postsByHash[contentHash] = {
    ...payload,
    contentHash,
    createdAt: new Date().toISOString()
  };
  writeStore(store);

  return res.json({ contentHash });
});

app.delete('/posts/:hash', (req, res) => {
  const hash = String(req.params.hash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'invalid hash' });
  }

  const store = readStore();
  const existed = Boolean(store.postsByHash[hash]);
  if (existed) {
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

ensureStore();
app.listen(port, () => {
  console.log(`offchain server running on http://localhost:${port}`);
});

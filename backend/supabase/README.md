# Supabase Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `backend/supabase/schema.sql`.
3. Create a public storage bucket named `frog-uploads` (or set `SUPABASE_STORAGE_BUCKET` to your bucket name).
4. Set backend env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET` (optional, default `frog-uploads`)

## Runtime Notes (Low-Cost Mode)

Backend stays a single process but adds resilience layers:

- Rate limiting: in-memory per-IP limits for global traffic, post creation, tip sync, and hash lookups.
- Caching: in-memory TTL cache for hot reads (`/posts/by-hash`, Hiro tx lookups, tx verification results, `/stats`, `/jobs/stats`).
- Async jobs: lightweight `public.jobs` table + background polling loop for transient tip verification retries.
- Job retention: periodic cleanup for old `done`/`failed` jobs.
- Idempotency: `/posts` accepts `Idempotency-Key` to prevent duplicate submissions.

## Endpoints

- `/posts` (upload + create off-chain post hash, idempotent via `Idempotency-Key`)
- `/posts/by-hash` (bulk lookup, cached)
- `/tips` (tip receipt verification; can return `202 pending` if verification is queued)
- `/stats` (cached aggregate stats)
- `/jobs/stats` (cached queue counters)
- `/health`

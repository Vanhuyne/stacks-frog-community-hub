# Supabase Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `backend/supabase/schema.sql`.
3. Create a public storage bucket named `frog-uploads` (or set `SUPABASE_STORAGE_BUCKET` to your bucket name).
4. Set backend env vars:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET` (optional, default `frog-uploads`)

Backend endpoints stay unchanged (`/posts`, `/posts/by-hash`, `/tips`), but data and uploaded images are now persisted in Supabase.

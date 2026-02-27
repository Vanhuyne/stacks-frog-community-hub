-- Run this SQL in Supabase SQL Editor before starting backend.

create table if not exists public.posts (
  content_hash text primary key,
  text text not null,
  links jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  total_tip_micro_stx bigint not null default 0,
  tip_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

create table if not exists public.tip_receipts (
  txid text primary key,
  content_hash text not null references public.posts(content_hash) on delete cascade,
  post_id bigint not null,
  amount_micro_stx bigint not null check (amount_micro_stx > 0),
  verified_at timestamptz not null default timezone('utc', now()),
  block_height integer not null default 0
);

create index if not exists tip_receipts_content_hash_idx on public.tip_receipts (content_hash);

create or replace function public.increment_post_tip_totals(
  p_content_hash text,
  p_amount_micro_stx bigint
)
returns table (total_tip_micro_stx bigint, tip_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.posts
  set
    total_tip_micro_stx = posts.total_tip_micro_stx + p_amount_micro_stx,
    tip_count = posts.tip_count + 1
  where posts.content_hash = p_content_hash
  returning posts.total_tip_micro_stx, posts.tip_count;
end;
$$;

-- Lightweight async queue for low-cost deployments.
create table if not exists public.jobs (
  id bigserial primary key,
  type text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'retry', 'done', 'failed')),
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text,
  next_run_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists jobs_type_dedupe_key_uidx
  on public.jobs(type, dedupe_key)
  where dedupe_key is not null;

create index if not exists jobs_status_next_run_idx
  on public.jobs(status, next_run_at);

-- Backend uses service role key, so RLS is optional.
-- If you enable RLS later, keep server writes on service role only.

-- Optional helper to create a public storage bucket used by backend image uploads.
insert into storage.buckets (id, name, public)
values ('frog-uploads', 'frog-uploads', true)
on conflict (id) do nothing;

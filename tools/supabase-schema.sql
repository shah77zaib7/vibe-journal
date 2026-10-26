-- ============================================================================
-- VibeJournal — Supabase schema
--
-- Run this ONCE in your Supabase dashboard → SQL Editor → New query.
--
--   1. Create a project at https://supabase.com
--   2. SQL Editor → paste this whole file → Run
--   3. Authentication → Providers → Google → enable it, paste your
--      Google OAuth client ID + secret (see README for the Google setup)
--   4. Project Settings → API → copy the Project URL and the `anon` key
--      into js/config.js
--
-- ⚠  SECURITY — READ THIS
--   The `anon` key ships inside the app, in a PUBLIC GitHub repo. That is
--   normal and safe: the anon key is designed to be public. The ONLY thing
--   protecting your trades is Row Level Security below.
--   If these policies are missing or wrong, ANYONE can read, change or
--   delete your journal. Do not skip them, and do not use the
--   `service_role` key in the app — it bypasses RLS entirely.
-- ============================================================================

-- ─────────────────────────── tables ───────────────────────────

create table if not exists public.trades (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  deleted_at  timestamptz
);

create index if not exists trades_user_updated_idx
  on public.trades (user_id, updated_at desc);

create table if not exists public.shots (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  trade_id    text not null,
  path        text not null,
  mime        text,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create index if not exists shots_user_idx on public.shots (user_id);

create table if not exists public.settings (
  key         text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  value       jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists settings_user_idx on public.settings (user_id);

-- ────────────────────── row level security ──────────────────────
-- This is the part that actually keeps your data private.

alter table public.trades   enable row level security;
alter table public.shots    enable row level security;
alter table public.settings enable row level security;

-- trades -------------------------------------------------------------------
drop policy if exists "trades_select_own" on public.trades;
create policy "trades_select_own" on public.trades
  for select using (auth.uid() = user_id);

drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own" on public.trades
  for insert with check (auth.uid() = user_id);

drop policy if exists "trades_update_own" on public.trades;
create policy "trades_update_own" on public.trades
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "trades_delete_own" on public.trades;
create policy "trades_delete_own" on public.trades
  for delete using (auth.uid() = user_id);

-- shots --------------------------------------------------------------------
drop policy if exists "shots_select_own" on public.shots;
create policy "shots_select_own" on public.shots
  for select using (auth.uid() = user_id);

drop policy if exists "shots_insert_own" on public.shots;
create policy "shots_insert_own" on public.shots
  for insert with check (auth.uid() = user_id);

drop policy if exists "shots_update_own" on public.shots;
create policy "shots_update_own" on public.shots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "shots_delete_own" on public.shots;
create policy "shots_delete_own" on public.shots
  for delete using (auth.uid() = user_id);

-- settings -----------------------------------------------------------------
drop policy if exists "settings_select_own" on public.settings;
create policy "settings_select_own" on public.settings
  for select using (auth.uid() = user_id);

drop policy if exists "settings_insert_own" on public.settings;
create policy "settings_insert_own" on public.settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "settings_update_own" on public.settings;
create policy "settings_update_own" on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "settings_delete_own" on public.settings;
create policy "settings_delete_own" on public.settings
  for delete using (auth.uid() = user_id);

-- ────────────────────── screenshot storage ──────────────────────
-- Private bucket. Files live at  {user_id}/{trade_id}.jpg  and the policies
-- below scope every object to the folder belonging to the signed-in user.

insert into storage.buckets (id, name, public)
values ('shots', 'shots', false)
on conflict (id) do nothing;

drop policy if exists "shots_storage_select_own" on storage.objects;
create policy "shots_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'shots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "shots_storage_insert_own" on storage.objects;
create policy "shots_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'shots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "shots_storage_update_own" on storage.objects;
create policy "shots_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'shots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "shots_storage_delete_own" on storage.objects;
create policy "shots_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'shots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ─────────────────────── sanity check ───────────────────────
-- Run this after the script. Every table should say "row level security enabled".
-- If any says "disabled" the policies are not active and your data is exposed.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('trades', 'shots', 'settings')
order by tablename;

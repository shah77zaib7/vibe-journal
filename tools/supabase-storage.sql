-- ============================================================================
-- VibeJournal — screenshot storage only
-- ----------------------------------------------------------------------------
-- The tables and their Row Level Security policies live in
-- tools/supabase-schema.sql. This file is just the screenshot bucket, split
-- out because it is the part that needs the `storage` schema.
--
-- Run this in Supabase → SQL Editor → Run, if trades sync but screenshots
-- do not. It is safe to run more than once.
-- ============================================================================

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

-- Check it worked: the bucket must exist and must be private.
select id, name, public from storage.buckets where id = 'shots';

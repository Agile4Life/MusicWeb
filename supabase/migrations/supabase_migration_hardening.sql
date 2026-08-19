-- Safe, idempotent production migration for MusicWeb.
-- Run this after the existing schema has been installed.

begin;

-- Keep music private. The app uses Google Drive URLs for new uploads and
-- signed URLs for any legacy Supabase Storage files.
update storage.buckets
set public = false
where id = 'music-files';

drop policy if exists "Public Select music-files" on storage.objects;
drop policy if exists "Auth Insert music-files" on storage.objects;
drop policy if exists "Auth Update music-files" on storage.objects;
drop policy if exists "Auth Delete music-files" on storage.objects;
drop policy if exists "Users can upload audio files to music-files" on storage.objects;
drop policy if exists "Users can read their own audio files in music-files" on storage.objects;
drop policy if exists "Users can delete their own audio files in music-files" on storage.objects;

create policy "Users can upload audio files to music-files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'music-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can read their own audio files in music-files"
on storage.objects for select to authenticated
using (
  bucket_id = 'music-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can update their own audio files in music-files"
on storage.objects for update to authenticated
using (
  bucket_id = 'music-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'music-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can delete their own audio files in music-files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'music-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- One logical song per owner. Existing duplicates must be cleaned first by
-- supabase_dedupe_migration.sql if this index does not exist yet.
create unique index if not exists tracks_user_song_unique
on public.tracks (
  user_id,
  lower(btrim(title)),
  lower(btrim(coalesce(artist, '')))
);

-- Add a track only to a playlist owned by the current user.
create or replace function public.fn_add_track_to_playlist(
  p_playlist_id uuid,
  p_track_id uuid
)
returns public.playlist_tracks
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.playlist_tracks;
begin
  if not exists (
    select 1 from public.playlists
    where id = p_playlist_id and user_id = auth.uid()
  ) then
    raise exception 'Playlist không thuộc người dùng hiện tại';
  end if;

  if not exists (
    select 1 from public.tracks
    where id = p_track_id and user_id = auth.uid()
  ) then
    raise exception 'Bài hát không thuộc người dùng hiện tại';
  end if;

  insert into public.playlist_tracks (playlist_id, track_id)
  values (p_playlist_id, p_track_id)
  on conflict (playlist_id, track_id) do update
    set position = public.playlist_tracks.position
  returning * into result;

  return result;
end;
$$;

-- Record a play and listening history entry atomically.
create or replace function public.fn_play_track(p_track_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.tracks
  set play_count = coalesce(play_count, 0) + 1
  where id = p_track_id and user_id = auth.uid();

  if found then
    insert into public.listening_history (user_id, track_id)
    values (auth.uid(), p_track_id);
  end if;
end;
$$;

grant execute on function public.fn_add_track_to_playlist(uuid, uuid) to authenticated;
grant execute on function public.fn_play_track(uuid) to authenticated;

commit;

-- Run once in Supabase SQL Editor after backing up the database.
-- It removes older duplicate rows, then makes the rule atomic so concurrent
-- uploads cannot create the same song twice for one user.

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        lower(btrim(title)),
        lower(btrim(coalesce(artist, '')))
      order by created_at desc nulls last, id desc
    ) as row_number
  from public.tracks
), duplicates as (
  select id from ranked where row_number > 1
)
delete from public.tracks
where id in (select id from duplicates);

create unique index if not exists tracks_user_song_unique
  on public.tracks (
    user_id,
    lower(btrim(title)),
    lower(btrim(coalesce(artist, '')))
  );

commit;

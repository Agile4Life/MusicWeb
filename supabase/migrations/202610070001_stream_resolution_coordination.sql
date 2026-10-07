-- Additive shared cache protocol. Run with the postgres migration role.
-- Legacy stream_resolutions is deliberately neither read nor modified.
begin;

create table if not exists public.stream_resolution_cache (
  title_key text not null,
  artist_key text not null,
  duration_bucket integer not null,
  generation bigint not null default 0 check (generation >= 0),
  entry jsonb,
  expires_at timestamptz,
  primary key (title_key, artist_key, duration_bucket),
  check ((entry is null) = (expires_at is null)),
  check (entry is null or jsonb_typeof(entry) = 'object')
);

alter table public.stream_resolution_cache owner to postgres;
alter table public.stream_resolution_cache enable row level security;
-- RPCs own all mutation. Even the service role cannot delete epoch rows and
-- accidentally reuse a generation (ABA) through the ordinary table API.
revoke all on table public.stream_resolution_cache from public, anon, authenticated, service_role;

create or replace function public.read_stream_resolution_cache(
  p_title_key text,
  p_artist_key text,
  p_duration_bucket integer,
  p_invalidate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.stream_resolution_cache%rowtype;
begin
  insert into public.stream_resolution_cache (title_key, artist_key, duration_bucket)
  values (p_title_key, p_artist_key, p_duration_bucket)
  on conflict (title_key, artist_key, duration_bucket) do nothing;

  -- Both RPCs lock this same row. A publisher already in progress either
  -- finishes before invalidation, or observes the new generation afterward.
  select * into strict v_row
  from public.stream_resolution_cache
  where title_key = p_title_key and artist_key = p_artist_key
    and duration_bucket = p_duration_bucket
  for update;

  if p_invalidate then
    update public.stream_resolution_cache
    set generation = generation + 1, entry = null, expires_at = null
    where title_key = p_title_key and artist_key = p_artist_key
      and duration_bucket = p_duration_bucket
    returning * into v_row;
  end if;

  if v_row.entry is not null and v_row.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'generation', v_row.generation::text,
      'entry', v_row.entry,
      'expiresAt', extract(epoch from v_row.expires_at) * 1000
    );
  end if;

  -- Retain the row and epoch even when the payload expires.
  return jsonb_build_object('generation', v_row.generation::text, 'entry', null);
end;
$$;

create or replace function public.write_stream_resolution_cache(
  p_title_key text,
  p_artist_key text,
  p_duration_bucket integer,
  p_generation text,
  p_entry jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.stream_resolution_cache%rowtype;
  v_current_rank integer;
  v_incoming_rank integer;
  v_is_miss boolean;
begin
  insert into public.stream_resolution_cache (title_key, artist_key, duration_bucket)
  values (p_title_key, p_artist_key, p_duration_bucket)
  on conflict (title_key, artist_key, duration_bucket) do nothing;

  select * into strict v_row
  from public.stream_resolution_cache
  where title_key = p_title_key and artist_key = p_artist_key
    and duration_bucket = p_duration_bucket
  for update;

  -- Compare decimal text directly; never round bigint through a JSON number.
  if p_generation is distinct from v_row.generation::text then
    return jsonb_build_object('accepted', false, 'generation', v_row.generation::text);
  end if;

  if jsonb_typeof(p_entry) is distinct from 'object'
    or jsonb_typeof(p_entry -> 'isMiss') is distinct from 'boolean' then
    raise exception 'Invalid stream resolution entry' using errcode = '22023';
  end if;
  v_is_miss := (p_entry ->> 'isMiss')::boolean;
  if (v_is_miss and (
      p_entry -> 'source' is distinct from 'null'::jsonb
      or p_entry -> 'resolvedId' is distinct from 'null'::jsonb
    )) or (not v_is_miss and (
      p_entry ->> 'source' is null
      or p_entry ->> 'source' not in ('drive', 'nhaccuatui', 'soundcloud', 'youtube')
      or jsonb_typeof(p_entry -> 'resolvedId') is distinct from 'string'
      or length(btrim(p_entry ->> 'resolvedId')) = 0
    )) then
    raise exception 'Invalid stream resolution entry' using errcode = '22023';
  end if;

  v_incoming_rank := case when v_is_miss then 0 else case p_entry ->> 'source'
    when 'drive' then 4 when 'nhaccuatui' then 3
    when 'soundcloud' then 2 when 'youtube' then 1 else 0 end end;
  if v_row.entry is not null and v_row.expires_at > clock_timestamp() then
    v_current_rank := case when (v_row.entry ->> 'isMiss')::boolean then 0
      else case v_row.entry ->> 'source'
        when 'drive' then 4 when 'nhaccuatui' then 3
        when 'soundcloud' then 2 when 'youtube' then 1 else 0 end end;
    if v_incoming_rank < v_current_rank then
      return jsonb_build_object('accepted', false, 'generation', v_row.generation::text);
    end if;
  end if;

  update public.stream_resolution_cache
  set entry = p_entry - 'expiresAt',
      expires_at = clock_timestamp() + case when v_is_miss
        then interval '1 hour' else interval '30 days' end
  where title_key = p_title_key and artist_key = p_artist_key
    and duration_bucket = p_duration_bucket;

  return jsonb_build_object('accepted', true, 'generation', v_row.generation::text);
end;
$$;

alter function public.read_stream_resolution_cache(text, text, integer, boolean) owner to postgres;
alter function public.write_stream_resolution_cache(text, text, integer, text, jsonb) owner to postgres;
revoke all on function public.read_stream_resolution_cache(text, text, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.write_stream_resolution_cache(text, text, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.read_stream_resolution_cache(text, text, integer, boolean) to service_role;
grant execute on function public.write_stream_resolution_cache(text, text, integer, text, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;

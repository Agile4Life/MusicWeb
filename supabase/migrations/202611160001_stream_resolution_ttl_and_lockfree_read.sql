-- 1) Plain reads no longer insert or lock the row: they were a write per resolve
--    and serialised every listener of a hot track. Only invalidate/write lock.
-- 2) Entry lifetime depends on how trustworthy the result is. Timeouts look like
--    misses, and a fallback source (YouTube) must not hide the preferred one.
begin;

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
  if p_invalidate then
    insert into public.stream_resolution_cache (title_key, artist_key, duration_bucket)
    values (p_title_key, p_artist_key, p_duration_bucket)
    on conflict (title_key, artist_key, duration_bucket) do nothing;

    select * into strict v_row
    from public.stream_resolution_cache
    where title_key = p_title_key and artist_key = p_artist_key
      and duration_bucket = p_duration_bucket
    for update;

    update public.stream_resolution_cache
    set generation = generation + 1, entry = null, expires_at = null
    where title_key = p_title_key and artist_key = p_artist_key
      and duration_bucket = p_duration_bucket
    returning * into v_row;
  else
    select * into v_row
    from public.stream_resolution_cache
    where title_key = p_title_key and artist_key = p_artist_key
      and duration_bucket = p_duration_bucket;

    -- No row yet: epoch 0. write_stream_resolution_cache creates it at epoch 0.
    if not found then
      return jsonb_build_object('generation', '0', 'entry', null);
    end if;
  end if;

  if v_row.entry is not null and v_row.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'generation', v_row.generation::text,
      'entry', v_row.entry,
      'expiresAt', extract(epoch from v_row.expires_at) * 1000
    );
  end if;

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
  v_ttl interval;
begin
  insert into public.stream_resolution_cache (title_key, artist_key, duration_bucket)
  values (p_title_key, p_artist_key, p_duration_bucket)
  on conflict (title_key, artist_key, duration_bucket) do nothing;

  select * into strict v_row
  from public.stream_resolution_cache
  where title_key = p_title_key and artist_key = p_artist_key
    and duration_bucket = p_duration_bucket
  for update;

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

  v_ttl := case
    when v_is_miss then interval '2 minutes'
    else case p_entry ->> 'source'
      when 'drive' then interval '30 days'
      when 'nhaccuatui' then interval '7 days'
      when 'soundcloud' then interval '6 hours'
      else interval '30 minutes'
    end
  end;

  update public.stream_resolution_cache
  set entry = p_entry - 'expiresAt',
      expires_at = clock_timestamp() + v_ttl
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

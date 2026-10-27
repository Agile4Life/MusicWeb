-- Run in the MusicWeb project's Supabase SQL editor (mjpibwmproussfevtqbp).
-- Public deck snapshots are read through /api/song-battles, including by guests.
-- Direct Data API access is denied. The server verifies the NextAuth session
-- and filters every write by its server-derived user_id using service_role.
-- No shared gameplay, votes, sessions or private listening history is stored.
BEGIN;

CREATE TABLE IF NOT EXISTS public.song_battle_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- MusicWeb NextAuth identity; deliberately not a foreign key to auth.users.
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  -- Public display alias, never an authorization credential.
  creator_name text NOT NULL CHECK (char_length(btrim(creator_name)) BETWEEN 1 AND 80),
  tracks jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(tracks) = 'array'
      THEN jsonb_array_length(tracks) BETWEEN 2 AND 512
      ELSE false END
  ) CHECK (octet_length(tracks::text) <= 1048576),
  cover_url text CHECK (cover_url IS NULL OR (char_length(cover_url) <= 2048 AND cover_url LIKE 'https://%')),
  track_count integer GENERATED ALWAYS AS (jsonb_array_length(tracks)) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS song_battle_decks_recent_idx
  ON public.song_battle_decks (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS song_battle_decks_owner_idx
  ON public.song_battle_decks (user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.touch_song_battle_deck()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_song_battle_deck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_song_battle_deck() TO service_role;
DROP TRIGGER IF EXISTS song_battle_decks_touch ON public.song_battle_decks;
CREATE TRIGGER song_battle_decks_touch BEFORE UPDATE ON public.song_battle_decks
  FOR EACH ROW EXECUTE FUNCTION public.touch_song_battle_deck();

ALTER TABLE public.song_battle_decks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.song_battle_decks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.song_battle_decks TO service_role;

COMMENT ON TABLE public.song_battle_decks IS
  'Public song battle snapshots; API-only access. Owner authorization enforced by NextAuth server routes; each visitor plays locally.';
NOTIFY pgrst, 'reload schema';
COMMIT;

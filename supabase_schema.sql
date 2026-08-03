-- Script khởi tạo Database Schema và Storage Policies cho Supabase (Personal Music Streaming App)

-- 1. Bảng tracks (Quản lý bài hát)
CREATE TABLE IF NOT EXISTS public.tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    duration INTEGER DEFAULT 0,
    file_path TEXT NOT NULL,
    cover_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bật RLS cho bảng tracks
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tracks"
ON public.tracks FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tracks"
ON public.tracks FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tracks"
ON public.tracks FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tracks"
ON public.tracks FOR DELETE
USING (auth.uid() = user_id);


-- 2. Bảng playlists (Quản lý playlist)
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bật RLS cho bảng playlists
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own playlists"
ON public.playlists FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own playlists"
ON public.playlists FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own playlists"
ON public.playlists FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own playlists"
ON public.playlists FOR DELETE
USING (auth.uid() = user_id);


-- 3. Bảng playlist_tracks (Bảng trung gian liên kết Playlist - Track)
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_playlist_track UNIQUE (playlist_id, track_id)
);

-- Bật RLS cho bảng playlist_tracks
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tracks in their playlists"
ON public.playlist_tracks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.playlists
        WHERE playlists.id = playlist_tracks.playlist_id
        AND playlists.user_id = auth.uid()
    )
);

CREATE POLICY "Users can add tracks to their playlists"
ON public.playlist_tracks FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.playlists
        WHERE playlists.id = playlist_tracks.playlist_id
        AND playlists.user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete tracks from their playlists"
ON public.playlist_tracks FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.playlists
        WHERE playlists.id = playlist_tracks.playlist_id
        AND playlists.user_id = auth.uid()
    )
);


-- 4. Storage Bucket Policy cho Supabase Storage (Bucket: "music-files")
-- Lưu ý: Bạn cần tạo bucket 'music-files' trong Supabase Dashboard > Storage trước (Public: FALSE).

INSERT INTO storage.buckets (id, name, public) 
VALUES ('music-files', 'music-files', false)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies cho storage.objects trong bucket music-files
CREATE POLICY "Users can upload audio files to music-files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'music-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read their own audio files in music-files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'music-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own audio files in music-files"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'music-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

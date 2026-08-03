-- ==============================================================================
-- MASTER DATABASE SCHEMA & SEED DATA CHO MUSICWEB (PERSONAL MUSIC STREAMING APP)
-- Sao chép toàn bộ script này và dán vào Supabase Dashboard > SQL Editor và nhấn RUN.
-- ==============================================================================

-- 0. XÓA BẢNG CŨ (NẾU CÓ) ĐỂ REBUILD SẠCH SẼ TOÀN BỘ CẤU TRÚC DATABASE
DROP TABLE IF EXISTS public.playlist_tracks CASCADE;
DROP TABLE IF EXISTS public.playlists CASCADE;
DROP TABLE IF EXISTS public.tracks CASCADE;
DROP TABLE IF EXISTS public.favorite_tracks CASCADE;
DROP TABLE IF EXISTS public.listening_history CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;
DROP TABLE IF EXISTS public.user_settings CASCADE;

-- Bật các extensions cần thiết
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------------------
-- 1. BẢNG USER_PROFILES (Hồ sơ người dùng cá nhân mở rộng)
-- ------------------------------------------------------------------------------
CREATE TABLE public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    theme TEXT DEFAULT 'slate',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
CREATE POLICY "Users can view their own profile" ON public.user_profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
CREATE POLICY "Users can update their own profile" ON public.user_profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 2. BẢNG TRACKS (Quản lý bài hát + Lời bài hát + Thể loại + Đếm số lượt nghe)
-- ------------------------------------------------------------------------------
CREATE TABLE public.tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    genre TEXT,                        -- Thể loại nhạc (Pop, Lofi, Ballad, Rock...)
    lyrics TEXT,                       -- Lời bài hát (Plaintext hoặc Karaoke LRC format)
    duration INTEGER DEFAULT 0,         -- Thời lượng (giây)
    file_path TEXT NOT NULL,           -- Đường dẫn storage Supabase
    file_size BIGINT DEFAULT 0,        -- Dung lượng file (Bytes)
    cover_url TEXT,                    -- Ảnh bìa bài hát
    play_count INTEGER DEFAULT 0,      -- Số lần đã nghe
    is_favorite BOOLEAN DEFAULT FALSE, -- Đánh dấu yêu thích nhanh
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tracks" ON public.tracks;
CREATE POLICY "Users can view their own tracks" ON public.tracks FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tracks" ON public.tracks;
CREATE POLICY "Users can insert their own tracks" ON public.tracks FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tracks" ON public.tracks;
CREATE POLICY "Users can update their own tracks" ON public.tracks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tracks" ON public.tracks;
CREATE POLICY "Users can delete their own tracks" ON public.tracks FOR DELETE USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 3. BẢNG PLAYLISTS (Playlist cá nhân + Hỗ trợ Chia sẻ Public sau này)
-- ------------------------------------------------------------------------------
CREATE TABLE public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    is_public BOOLEAN DEFAULT FALSE,    -- Bật/tắt chế độ chia sẻ công khai
    share_code TEXT UNIQUE,             -- Mã chia sẻ ngắn (ví dụ: pl_xyz123)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own or public playlists" ON public.playlists;
CREATE POLICY "Users can view their own or public playlists" ON public.playlists FOR SELECT USING (auth.uid() = user_id OR is_public = TRUE);

DROP POLICY IF EXISTS "Users can insert their own playlists" ON public.playlists;
CREATE POLICY "Users can insert their own playlists" ON public.playlists FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own playlists" ON public.playlists;
CREATE POLICY "Users can update their own playlists" ON public.playlists FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own playlists" ON public.playlists;
CREATE POLICY "Users can delete their own playlists" ON public.playlists FOR DELETE USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 4. BẢNG PLAYLIST_TRACKS (Liên kết Playlist và Bài hát)
-- ------------------------------------------------------------------------------
CREATE TABLE public.playlist_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_playlist_track UNIQUE (playlist_id, track_id)
);

ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view tracks in accessible playlists" ON public.playlist_tracks;
CREATE POLICY "Users can view tracks in accessible playlists" ON public.playlist_tracks FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.playlists
        WHERE playlists.id = playlist_tracks.playlist_id
        AND (playlists.user_id = auth.uid() OR playlists.is_public = TRUE)
    )
);

DROP POLICY IF EXISTS "Users can add tracks to their playlists" ON public.playlist_tracks;
CREATE POLICY "Users can add tracks to their playlists" ON public.playlist_tracks FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.playlists
        WHERE playlists.id = playlist_tracks.playlist_id
        AND playlists.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Users can delete tracks from their playlists" ON public.playlist_tracks;
CREATE POLICY "Users can delete tracks from their playlists" ON public.playlist_tracks FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM public.playlists
        WHERE playlists.id = playlist_tracks.playlist_id
        AND playlists.user_id = auth.uid()
    )
);

-- ------------------------------------------------------------------------------
-- 5. BẢNG FAVORITE_TRACKS (Danh sách bài hát yêu thích cá nhân)
-- ------------------------------------------------------------------------------
CREATE TABLE public.favorite_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_favorite UNIQUE (user_id, track_id)
);

ALTER TABLE public.favorite_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their favorite tracks" ON public.favorite_tracks;
CREATE POLICY "Users can manage their favorite tracks" ON public.favorite_tracks FOR ALL USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 6. BẢNG LISTENING_HISTORY (Lịch sử nghe nhạc & Thống kê cá nhân)
-- ------------------------------------------------------------------------------
CREATE TABLE public.listening_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
    played_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.listening_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their listening history" ON public.listening_history;
CREATE POLICY "Users can view their listening history" ON public.listening_history FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their listening history" ON public.listening_history;
CREATE POLICY "Users can insert their listening history" ON public.listening_history FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 7. BẢNG USER_SETTINGS (Cài đặt tùy chỉnh hệ thống của từng người dùng)
-- ------------------------------------------------------------------------------
CREATE TABLE public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    audio_quality TEXT DEFAULT 'high',
    auto_play BOOLEAN DEFAULT TRUE,
    repeat_mode TEXT DEFAULT 'off',
    shuffle BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own settings" ON public.user_settings;
CREATE POLICY "Users can manage their own settings" ON public.user_settings FOR ALL USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 8. STORAGE BUCKET & POLICIES (Supabase Storage: "music-files")
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) 
VALUES ('music-files', 'music-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload audio files to music-files" ON storage.objects;
CREATE POLICY "Users can upload audio files to music-files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'music-files' AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can read their own audio files in music-files" ON storage.objects;
CREATE POLICY "Users can read their own audio files in music-files" ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'music-files' AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own audio files in music-files" ON storage.objects;
CREATE POLICY "Users can delete their own audio files in music-files" ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'music-files' AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ------------------------------------------------------------------------------
-- 9. TRIGGERS VÀ FUNCTIONS TỰ ĐỘNG HÓA POSTGRESQL
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, display_name, avatar_url)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), '')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 10. KHỞI TẠO TÀI KHOẢN USERS NẾU CHƯA TỒN TẠI (AN TOÀN CHO MỌI PHIÊN BẢN SUPABASE)
-- Mật khẩu khởi tạo: password123
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    -- User 1: admin@musicweb.com / password123
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@musicweb.com') THEN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            'a1b2c3d4-e5f6-7890-abcd-111111111111',
            'authenticated', 'authenticated',
            'admin@musicweb.com',
            crypt('password123', gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}',
            '{"full_name":"Quản Trị Viên"}', NOW(), NOW(), ''
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) VALUES (
            'a1b2c3d4-e5f6-7890-abcd-111111111111',
            'a1b2c3d4-e5f6-7890-abcd-111111111111',
            format('{"sub":"%s","email":"%s"}', 'a1b2c3d4-e5f6-7890-abcd-111111111111', 'admin@musicweb.com')::jsonb,
            'email',
            'a1b2c3d4-e5f6-7890-abcd-111111111111',
            NOW(), NOW(), NOW()
        );
    END IF;

    -- User 2: demo@musicweb.com / password123
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'demo@musicweb.com') THEN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            'b2c3d4e5-f6a7-8901-bcde-222222222222',
            'authenticated', 'authenticated',
            'demo@musicweb.com',
            crypt('password123', gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}',
            '{"full_name":"Demo Music Lover"}', NOW(), NOW(), ''
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) VALUES (
            'b2c3d4e5-f6a7-8901-bcde-222222222222',
            'b2c3d4e5-f6a7-8901-bcde-222222222222',
            format('{"sub":"%s","email":"%s"}', 'b2c3d4e5-f6a7-8901-bcde-222222222222', 'demo@musicweb.com')::jsonb,
            'email',
            'b2c3d4e5-f6a7-8901-bcde-222222222222',
            NOW(), NOW(), NOW()
        );
    END IF;

    -- User 3: user@musicweb.com / password123
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'user@musicweb.com') THEN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            'c3d4e5f6-a7b8-9012-cdef-333333333333',
            'authenticated', 'authenticated',
            'user@musicweb.com',
            crypt('password123', gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}',
            '{"full_name":"Thành Viên Mới"}', NOW(), NOW(), ''
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) VALUES (
            'c3d4e5f6-a7b8-9012-cdef-333333333333',
            'c3d4e5f6-a7b8-9012-cdef-333333333333',
            format('{"sub":"%s","email":"%s"}', 'c3d4e5f6-a7b8-9012-cdef-333333333333', 'user@musicweb.com')::jsonb,
            'email',
            'c3d4e5f6-a7b8-9012-cdef-333333333333',
            NOW(), NOW(), NOW()
        );
    END IF;
END $$;

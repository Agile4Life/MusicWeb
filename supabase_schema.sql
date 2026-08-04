-- ==============================================================================
-- MASTER DATABASE SCHEMA & SEED DATA CHO MUSICWEB (PERSONAL MUSIC STREAMING APP)
-- Sao chép toàn bộ script này và dán vào Supabase Dashboard > SQL Editor và nhấn RUN.
-- ==============================================================================

-- 0. Schema is intentionally non-destructive. Do not drop production tables.

-- Bật các extensions cần thiết
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------------------
-- 1. BẢNG USER_PROFILES (Hồ sơ người dùng cá nhân mở rộng)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
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
CREATE TABLE IF NOT EXISTS public.tracks (
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
DROP POLICY IF EXISTS "Everyone can view all tracks" ON public.tracks;
CREATE POLICY "Everyone can view all tracks" ON public.tracks FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own tracks" ON public.tracks;
CREATE POLICY "Users can insert their own tracks" ON public.tracks FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tracks" ON public.tracks;
CREATE POLICY "Users can update their own tracks" ON public.tracks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tracks" ON public.tracks;
CREATE POLICY "Users can delete their own tracks" ON public.tracks FOR DELETE USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 3. BẢNG PLAYLISTS (Playlist cá nhân + Hỗ trợ Chia sẻ Public sau này)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.playlists (
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
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
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
CREATE TABLE IF NOT EXISTS public.favorite_tracks (
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
CREATE TABLE IF NOT EXISTS public.listening_history (
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
CREATE TABLE IF NOT EXISTS public.user_settings (
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
-- 10. KHỞI TẠO TÀI KHOẢN USERS MẪU (BẢO ĐẢM ĐĂNG NHẬP THÀNH CÔNG 100%)
-- Mật khẩu mặc định cho tất cả tài khoản mẫu: password123
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_admin_id UUID := 'a1b2c3d4-e5f6-7890-abcd-111111111111';
    v_demo_id  UUID := 'b2c3d4e5-f6a7-8901-bcde-222222222222';
    v_user_id  UUID := 'c3d4e5f6-a7b8-9012-cdef-333333333333';
BEGIN
    -- Xóa các bản ghi tài khoản mẫu cũ nếu có để tạo mới sạch 100%
    DELETE FROM auth.identities WHERE email IN ('admin@musicweb.com', 'demo@musicweb.com', 'user@musicweb.com');
    DELETE FROM auth.users WHERE email IN ('admin@musicweb.com', 'demo@musicweb.com', 'user@musicweb.com');

    -- 1. User: admin@musicweb.com / password123
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_token, confirmation_token, email_change_token_new, email_change,
        raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
        phone, phone_confirmed_at, phone_change, phone_change_token,
        email_change_token_current, email_change_confirm_status, banned_until,
        reauthentication_token, is_sso_user, deleted_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
        'admin@musicweb.com', crypt('password123', gen_salt('bf')), NOW(),
        '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Quản Trị Viên"}'::jsonb,
        FALSE, NOW(), NOW(), NULL, NULL, '', '', '', 0, NULL, '', FALSE, NULL
    );

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_admin_id, v_admin_id,
        jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@musicweb.com'),
        'email', 'admin@musicweb.com', NOW(), NOW(), NOW()
    );

    -- 2. User: demo@musicweb.com / password123
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_token, confirmation_token, email_change_token_new, email_change,
        raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
        phone, phone_confirmed_at, phone_change, phone_change_token,
        email_change_token_current, email_change_confirm_status, banned_until,
        reauthentication_token, is_sso_user, deleted_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_demo_id, 'authenticated', 'authenticated',
        'demo@musicweb.com', crypt('password123', gen_salt('bf')), NOW(),
        '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Demo Music Lover"}'::jsonb,
        FALSE, NOW(), NOW(), NULL, NULL, '', '', '', 0, NULL, '', FALSE, NULL
    );

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_demo_id, v_demo_id,
        jsonb_build_object('sub', v_demo_id::text, 'email', 'demo@musicweb.com'),
        'email', 'demo@musicweb.com', NOW(), NOW(), NOW()
    );

    -- 3. User: user@musicweb.com / password123
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_token, confirmation_token, email_change_token_new, email_change,
        raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
        phone, phone_confirmed_at, phone_change, phone_change_token,
        email_change_token_current, email_change_confirm_status, banned_until,
        reauthentication_token, is_sso_user, deleted_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
        'user@musicweb.com', crypt('password123', gen_salt('bf')), NOW(),
        '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Thành Viên Mới"}'::jsonb,
        FALSE, NOW(), NOW(), NULL, NULL, '', '', '', 0, NULL, '', FALSE, NULL
    );

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_user_id, v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', 'user@musicweb.com'),
        'email', 'user@musicweb.com', NOW(), NOW(), NOW()
    );
END $$;

-- ------------------------------------------------------------------------------
-- 11. BÀI HÁT MẪU & PLAYLIST MẪU (SEED DATA SẴN SÀNG SỬ DỤNG)
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_admin_id UUID := 'a1b2c3d4-e5f6-7890-abcd-111111111111';
    v_track1_id UUID := 'f1e2d3c4-b5a6-7890-1111-111111111111';
    v_track2_id UUID := 'f2e3d4c5-b6a7-8901-2222-222222222222';
    v_playlist_id UUID := 'e1f2e3d4-c5b6-7890-3333-333333333333';
BEGIN
    -- Chèn bài hát mẫu cho Admin
    INSERT INTO public.tracks (id, user_id, title, artist, album, genre, duration, file_path, cover_url, play_count, is_favorite)
    VALUES 
    (
        v_track1_id, v_admin_id, 'Chill Lofi Beats', 'Lofi Master', 'Lofi Chill Collection', 'Lofi', 180,
        'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
        'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=60',
        42, TRUE
    ),
    (
        v_track2_id, v_admin_id, 'Midnight Synthwave', 'Retro Wave', 'Neon Dreams', 'Electronic', 210,
        'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73229.mp3?filename=synthwave-80s-110045.mp3',
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=60',
        88, TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    -- Chèn Playlist mẫu
    INSERT INTO public.playlists (id, user_id, name, description, cover_url, is_public)
    VALUES (
        v_playlist_id, v_admin_id, 'Giai Điệu Chill Đêm Khuya', 'Tuyển tập những bản nhạc lofi acoustic nhẹ nhàng nhất',
        'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=60', TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    -- Thêm bài hát vào playlist
    INSERT INTO public.playlist_tracks (playlist_id, track_id, position)
    VALUES 
    (v_playlist_id, v_track1_id, 1),
    (v_playlist_id, v_track2_id, 2)
    ON CONFLICT (playlist_id, track_id) DO NOTHING;
END $$;

-- ------------------------------------------------------------------------------
-- 8. CẤU HÌNH BUCKET STORAGE `music-files` (BỎ TẤT CẢ GIỚI HẠN DUNG LƯỢNG)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'music-files',
    'music-files',
    true,
    NULL, -- Bỏ hoàn toàn giới hạn dung lượng file
    NULL  -- Cho phép mọi loại file âm thanh
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = NULL,
    allowed_mime_types = NULL,
    public = false;

-- Cấp quyền truy cập RLS cho Storage objects
DROP POLICY IF EXISTS "Public Select music-files" ON storage.objects;
DROP POLICY IF EXISTS "Auth Insert music-files" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update music-files" ON storage.objects;
DROP POLICY IF EXISTS "Auth Delete music-files" ON storage.objects;

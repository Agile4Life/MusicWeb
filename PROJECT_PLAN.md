# Kế Hoạch Dự Án: Web Nghe Nhạc Cá Nhân (Personal Music Streaming App)

> Tài liệu này dùng để hướng dẫn các AI agent (Claude Code, Cursor, v.v.) hoặc lập trình viên triển khai dự án. Đọc kỹ toàn bộ trước khi bắt đầu code.

---

## 1. Tổng Quan Dự Án

Xây dựng một web app nghe nhạc cá nhân, giao diện lấy cảm hứng từ Spotify, cho phép:
- Người dùng đăng ký/đăng nhập (auth cơ bản)
- Upload file nhạc của chính mình (mp3, wav, m4a...)
- Nghe nhạc trực tiếp trên web (streaming player)
- Tạo, chỉnh sửa, xóa playlist
- Thêm/xóa bài hát vào playlist
- Quản lý thư viện nhạc cá nhân (my library)

**Không phải** nền tảng nhạc công cộng — mỗi user chỉ thấy và nghe nhạc của chính họ (trừ khi sau này mở rộng tính năng chia sẻ).

### Stack công nghệ
| Thành phần | Công nghệ |
|---|---|
| Frontend + Backend | Next.js (Node.js, App Router) |
| Ngôn ngữ | TypeScript (khuyến nghị) hoặc JavaScript |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Lưu trữ file nhạc | Supabase Storage (bucket riêng cho audio) |
| Styling | TailwindCSS |
| State/Player | React Context hoặc Zustand cho audio player state |
| Deploy | Vercel |

---

## 2. Kiến Trúc Hệ Thống

```
[Browser - Next.js Frontend]
        |
        | (Supabase JS client - auth, query, storage)
        v
[Supabase]
  ├── Auth (users)
  ├── Postgres DB (tracks, playlists, playlist_tracks)
  └── Storage (bucket: "music-files")
        |
[Vercel - hosting Next.js app, serverless functions cho API routes nếu cần]
```

- Next.js vừa là frontend vừa host API routes (`/app/api/...`) để xử lý logic phức tạp (nếu cần), nhưng phần lớn thao tác CRUD có thể gọi thẳng Supabase client từ frontend nhờ Row Level Security (RLS).
- File nhạc lưu trong Supabase Storage, không lưu trong repo hay filesystem của Vercel (Vercel serverless không có persistent storage).

---

## 3. Thiết Kế Database (Supabase / Postgres)

### Bảng `tracks`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid, PK, default gen_random_uuid() | |
| user_id | uuid, FK -> auth.users(id) | chủ sở hữu bài hát |
| title | text | tên bài hát |
| artist | text | nullable, tên nghệ sĩ (lấy từ metadata hoặc user nhập) |
| album | text | nullable |
| duration | integer | số giây, lấy từ metadata file audio |
| file_path | text | đường dẫn trong Supabase Storage |
| cover_url | text | nullable, ảnh bìa (nếu có) |
| created_at | timestamptz | default now() |

### Bảng `playlists`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK -> auth.users(id) | |
| name | text | |
| description | text | nullable |
| cover_url | text | nullable |
| created_at | timestamptz | |

### Bảng `playlist_tracks` (many-to-many)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid, PK | |
| playlist_id | uuid, FK -> playlists(id) | |
| track_id | uuid, FK -> tracks(id) | |
| position | integer | thứ tự bài hát trong playlist |
| added_at | timestamptz | |

### Row Level Security (RLS) — BẮT BUỘC
Bật RLS cho cả 3 bảng, chỉ cho phép:
```sql
-- Ví dụ policy cho bảng tracks
create policy "Users can CRUD their own tracks"
on tracks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```
Áp dụng tương tự cho `playlists`. Với `playlist_tracks`, kiểm tra qua join với `playlists.user_id`.

### Supabase Storage
- Tạo bucket `music-files` (private, không public).
- Policy: user chỉ upload/đọc file trong path dạng `music-files/{user_id}/{filename}`.
- Dùng signed URL (`createSignedUrl`) để phát nhạc, không public URL trực tiếp.

---

## 4. Cấu Trúc Thư Mục Đề Xuất (Next.js App Router)

```
/app
  /login/page.tsx
  /register/page.tsx
  /(app)/
    layout.tsx              -> layout chính có sidebar + player bar (giống Spotify)
    /page.tsx                -> Trang chủ / thư viện nhạc
    /playlist/[id]/page.tsx  -> Chi tiết playlist
    /upload/page.tsx         -> Trang upload nhạc
  /api/
    /tracks/route.ts         -> (nếu cần xử lý server-side, ví dụ đọc metadata file)
/components
  /player/PlayerBar.tsx       -> Thanh player cố định dưới cùng
  /player/PlayerContext.tsx   -> Context quản lý audio state toàn cục
  /sidebar/Sidebar.tsx        -> Sidebar giống Spotify (Home, Library, Playlists)
  /track/TrackList.tsx
  /track/TrackRow.tsx
  /playlist/PlaylistCard.tsx
  /upload/UploadForm.tsx
  /auth/AuthForm.tsx
/lib
  /supabase/client.ts         -> supabase client (browser)
  /supabase/server.ts         -> supabase client (server component/actions)
  /supabase/middleware.ts     -> refresh session
/middleware.ts                 -> bảo vệ route, redirect nếu chưa login
```

---

## 5. Chi Tiết Tính Năng

### 5.1 Authentication (Login/Logout)
- Dùng `supabase.auth.signUp()`, `signInWithPassword()`, `signOut()`.
- Session lưu qua cookie (dùng `@supabase/ssr` package cho Next.js App Router).
- Middleware kiểm tra session, redirect `/login` nếu chưa đăng nhập và đang vào route được bảo vệ.
- Trang: `/login`, `/register`, nút Logout ở sidebar/header.

### 5.2 Upload nhạc
- Form upload chọn file (accept `.mp3,.wav,.m4a,.flac`).
- Client upload trực tiếp lên Supabase Storage bằng `supabase.storage.from('music-files').upload()`.
- Đọc metadata file (title, artist, album, duration) bằng thư viện như `music-metadata-browser` (client-side) trước khi lưu record vào bảng `tracks`.
- Cho phép user sửa tay title/artist nếu metadata không có.
- Hiển thị progress bar khi upload.
- (Tùy chọn nâng cao) Cho upload ảnh bìa riêng, hoặc tự extract cover art từ file audio.

### 5.3 Music Player
- Player bar cố định ở cuối màn hình (giống Spotify): nút play/pause, next/prev, thanh seek, volume, hiển thị tên bài + nghệ sĩ + cover.
- Dùng thẻ `<audio>` HTML5 ẩn, điều khiển qua JS, quản lý state bằng Context/Zustand (currentTrack, queue, isPlaying, currentTime...).
- Lấy signed URL từ Supabase Storage mỗi khi phát bài hát (URL hết hạn sau X phút, cần refetch nếu cần).
- Hỗ trợ hàng đợi phát (queue): phát tiếp bài kế trong playlist hoặc trong danh sách nhạc hiện tại.
- Shuffle / Repeat (tùy chọn, nice-to-have).

### 5.4 Playlist
- Tạo playlist mới (nhập tên, mô tả tùy chọn).
- Thêm bài hát vào playlist (từ trang thư viện, nút "Add to playlist" mở dropdown/modal chọn playlist).
- Xóa bài khỏi playlist.
- Xóa/sửa tên playlist.
- Kéo-thả sắp xếp lại thứ tự bài trong playlist (tùy chọn nâng cao, dùng `dnd-kit`).
- Trang chi tiết playlist hiển thị danh sách bài hát + nút Play All.

### 5.5 Thư viện nhạc cá nhân (Library)
- Trang chủ hiển thị toàn bộ bài hát đã upload, dạng danh sách hoặc lưới.
- Tìm kiếm/lọc theo tên bài/nghệ sĩ (client-side filter đơn giản là đủ).
- Xóa bài hát (xóa cả record DB lẫn file trong Storage).

---

## 6. UI/UX (giống Spotify)

- Theme tối (dark theme) làm mặc định: nền đen/xám đậm (#121212), chữ trắng, accent màu xanh lá (#1DB954) hoặc màu tùy chỉnh.
- Layout 3 vùng: Sidebar trái (điều hướng + danh sách playlist) — Main content (giữa) — Player bar cố định dưới cùng.
- Component tái sử dụng: TrackRow (hover hiện nút play), PlaylistCard (ảnh bìa + tên), PlayerBar.
- Responsive: trên mobile, sidebar thu gọn thành bottom nav hoặc hamburger menu.
- Dùng `frontend-design` skill (nếu agent có) để tinh chỉnh thẩm mỹ, tránh giao diện "mặc định" nhàm chán.

---

## 7. Biến Môi Trường (Environment Variables)

Tạo file `.env.local` (không commit lên git):
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # chỉ dùng server-side, không expose ra client
```
Khi deploy lên Vercel, thêm các biến này vào Project Settings > Environment Variables.

---

## 8. Các Bước Triển Khai (Roadmap cho Agent)

1. **Khởi tạo project**: `npx create-next-app@latest` (TypeScript, App Router, TailwindCSS).
2. **Setup Supabase**: tạo project trên supabase.com, lấy URL + anon key, cài `@supabase/supabase-js` và `@supabase/ssr`.
3. **Tạo schema DB**: chạy SQL tạo bảng `tracks`, `playlists`, `playlist_tracks` + bật RLS + tạo policies (mục 3).
4. **Tạo Storage bucket** `music-files` (private) + storage policies theo `user_id`.
5. **Xây dựng Auth**: trang login/register, middleware bảo vệ route, Context lưu user session.
6. **Xây dựng layout chính**: Sidebar + Player bar khung sườn (chưa cần logic, làm UI trước).
7. **Chức năng Upload**: form upload -> lưu file lên Storage -> đọc metadata -> insert vào bảng `tracks`.
8. **Hiển thị thư viện nhạc**: fetch danh sách tracks của user, render TrackList.
9. **Music Player**: xây PlayerContext, kết nối `<audio>` tag, lấy signed URL khi play.
10. **Playlist CRUD**: tạo/sửa/xóa playlist, thêm/xóa bài trong playlist, trang chi tiết playlist.
11. **Kết nối Player với Playlist**: play toàn bộ playlist, next/prev theo queue.
12. **Polish UI/UX**: responsive, loading states, empty states, error handling.
13. **Testing**: thử luồng đăng ký -> upload -> tạo playlist -> nghe nhạc -> logout.
14. **Deploy lên Vercel**: kết nối repo GitHub với Vercel, thêm env variables, deploy.

---

## 9. Lưu Ý Bảo Mật & Kỹ Thuật

- **Không bao giờ** để `SUPABASE_SERVICE_ROLE_KEY` lộ ra client-side code.
- Bucket Storage phải **private**, luôn dùng signed URL có thời hạn khi phát nhạc.
- RLS phải bật cho mọi bảng để đảm bảo user A không đọc/xóa được nhạc của user B.
- Giới hạn dung lượng file upload (ví dụ tối đa 50MB/bài) để tránh vượt free tier Supabase Storage.
- Vercel serverless function có giới hạn thời gian chạy và không có filesystem persistent — mọi upload phải đi thẳng lên Supabase Storage, không lưu tạm trên server Next.js.
- Cân nhắc giới hạn định dạng file chỉ nhận audio hợp lệ (kiểm tra MIME type).

---

## 10. Có Thể Mở Rộng Sau (Không bắt buộc ở bản đầu)

- Chia sẻ playlist công khai qua link.
- Lyrics đồng bộ.
- Nghe nhạc offline (cache qua Service Worker).
- Thống kê bài hát nghe nhiều nhất.
- Kéo-thả sắp xếp playlist.
- Dark/Light theme toggle.

---

*Tài liệu này là bản kế hoạch tổng quan — agent triển khai nên đọc kỹ mục 3 (schema + RLS) và mục 5 (chi tiết tính năng) trước khi viết code để tránh phải refactor lại kiến trúc giữa chừng.*

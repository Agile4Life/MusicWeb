# Hướng Dẫn Deploy Dự Án MusicWeb Lên Vercel

## NhacCuaTui stream (tùy chọn)

The custom NCT endpoint must return the same `/api/search` and `/api/song/{id}` response shapes used by the proxy, including an HTTPS `audioUrl` hosted on `stream.nct.vn`. Use an authorized endpoint only.

For Spotify/YouTube Music playlist imports to persist the NCT match, run `supabase_nct_playlist_migration.sql` once in Supabase SQL Editor. It adds the `tracks.source` and `tracks.nhaccuatui_id` columns used to restore fresh NCT streams after reload.

Tính năng phát ưu tiên NhacCuaTui không bắt buộc thêm biến môi trường vì route đã có endpoint mặc định:

| Key | Value |
| --- | --- |
| `NCT_API_BASE_URL` | `https://music-api.vanhuy2004h.io.vn` |
| `NEXT_PUBLIC_NCT_STREAM_CACHE_URL` | `https://music-stream-cache.phongtct.workers.dev` (optional)

Chỉ thêm `NCT_API_BASE_URL` trên Vercel nếu bạn có backend NhacCuaTui được cấp quyền hoặc muốn dùng endpoint riêng. Để trống biến này sẽ dùng endpoint mặc định. `NEXT_PUBLIC_NCT_STREAM_CACHE_URL` là tùy chọn để chơi NCT qua Cloudflare Worker cache proxy thay vì qua Next.js origin; nếu được cấu hình, player sẽ gửi audio request trực tiếp đến Worker. Sau khi đổi biến môi trường, cần redeploy. URL stream ký hạn được lấy mới cho mỗi lần phát và không nên lưu vào Vercel env, database hoặc log.
Dự án Next.js App Router này đã được cấu hình tối ưu và sẵn sàng 100% để deploy trực tiếp lên Vercel.

---

## 🚀 Phương Án 1: Deploy qua GitHub (Khuyên Dùng)

1. **Đưa mã nguồn lên GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit for Vercel deployment"
   git push origin main
   ```

2. **Kết nối Vercel**:
   - Truy cập [vercel.com/new](https://vercel.com/new) và đăng nhập tài khoản Vercel của bạn.
   - Chọn repository **MusicWeb** từ GitHub của bạn và nhấn **Import**.

3. **Cấu hình Biến Môi Trường (Environment Variables)**:
   Tại mục **Environment Variables** trên Vercel, điền 3 biến sau:

   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://mjpibwmproussfevtqbp.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_mT97L0yZZOXReH-6ToCWGg_cpryfNgs` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_mT97L0yZZOXReH-6ToCWGg_cpryfNgs` |

4. **Nhấn Deploy**:
   Vercel sẽ tự động chạy `npm run build` và cấp link website chính thức dạng `https://musicweb-xxx.vercel.app`.

---

## 💻 Phương Án 2: Deploy trực tiếp bằng Vercel CLI (Từ Terminal)

Nếu bạn đã cài Vercel CLI hoặc muốn đẩy trực tiếp từ máy tính:

1. Chạy lệnh đăng nhập Vercel:
   ```bash
   npx vercel login
   ```
2. Chạy lệnh deploy:
   ```bash
   npx vercel --prod
   ```
3. Nhập tên dự án và cấu hình biến môi trường khi được hỏi.

---

## 🔒 Lưu Ý Quan Trọng Sau Khi Deploy
- Hãy đảm bảo bạn đã chạy toàn bộ nội dung file [supabase_schema.sql](file:///d:/MusicWeb/supabase_schema.sql) trên **Supabase Dashboard > SQL Editor** để ứng dụng trên Vercel đọc/ghi dữ liệu và lưu trữ file nhạc bình thường.

# Hướng Dẫn Deploy Dự Án MusicWeb Lên Vercel

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

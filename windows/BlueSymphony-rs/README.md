# BlueSymphony Windows Native (Pure Rust + Iced 0.14)

Ứng dụng nghe nhạc native cho Windows 11 kết nối trực tiếp tới backend production `https://www.bluesymphony.site`, viết hoàn toàn bằng **Rust** (`iced 0.14` + `wgpu` DirectX 12 + Windows Media Foundation + SMTC).

## Kiến trúc Workspace

- `crates/bs-core` — Networking (`www.bluesymphony.site`), Auth (Supabase + NextAuth cookie), Lossy JSON decoders, NhacCuaTui direct client, Multi-source `StreamResolver` + Range prewarm, Lyrics LRC/LRCLIB/Romaji, Queue & Recovery logic.
- `crates/bs-win` — Windows DPAPI (`CryptProtectData`), DWM Mica/Dark titlebar, System Tray (`tray-icon`), Global Hotkeys (`global-hotkey`), Taskbar Thumbnail Toolbar (`ITaskbarList3`).
- `crates/bs-audio` — WinRT `Windows::Media::Playback::MediaPlayer` + System Media Transport Controls (Windows 11 Media Flyout, phím Media, Lock Screen), retry cold-cache & auto-skip (tối đa 4 lỗi liên tiếp).
- `crates/bs-app` — Giao diện Iced 0.14 (*Aurora Glass*, *Midnight Dark*, *Vinyl Editorial*), WGSL Aurora shader phản ứng theo ảnh bìa, Now Playing + Synced Lyrics LRC + Romaji, Queue Drawer, Mini-Player Always-on-Top và Gaming Mode.

## Cấu hình Đăng nhập (Tuỳ chọn)

App chạy ngay toàn bộ tính năng công khai (Trang chủ, Tìm kiếm, NhacCuaTui, SoundCloud, Album, Nghệ sĩ, Lyrics) mà không cần cấu hình. Để bật đăng nhập & đồng bộ Yêu thích / Lịch sử / Playlist cá nhân:

1. Chạy script sinh `config/secrets.toml` từ `MusicWeb/.env.local` (nếu có):
   ```powershell
   .\scripts\make-secrets.ps1
   ```
   Hoặc sao chép `config/secrets.example.toml` thành `config/secrets.toml` và điền `supabase_url` + `supabase_anon_key` (hoặc đặt biến môi trường `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

## Build, Test & Chạy

*(Nếu `cargo` chưa có sẵn trong `PATH`, thêm `$env:USERPROFILE\.cargo\bin`)*

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Chạy unit tests + clippy
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Kiểm tra kết nối API live (tuỳ chọn)
cargo test -p bs-core --test live_smoke -- --ignored --nocapture

# Chạy bản dev hoặc build release
cargo run -p bs-app
cargo build --release -p bs-app
```

File thực thi release: `target\release\bs-app.exe`.

## Phím tắt

- `Space` — Phát / Tạm dừng (tự bỏ qua khi đang gõ trong ô nhập)
- `Ctrl + K` hoặc `Ctrl + F` — Tìm kiếm nhanh
- `Ctrl + L` — Mở / Đóng màn hình Đang phát & Lời bài hát
- `Ctrl + Q` — Bật / Tắt Hàng chờ phát
- `Ctrl + Shift + M` — Bật / Tắt cửa sổ Mini-Player Always-on-Top
- `Ctrl + Trái / Phải` — Bài trước / Bài tiếp theo
- `Ctrl + Lên / Xuống` — Tăng / Giảm âm lượng 5%
- **Global Hotkeys (khi app chạy nền/ẩn Tray):** `Ctrl + Alt + Space`, `Ctrl + Alt + Trái/Phải`, `Ctrl + Shift + M`


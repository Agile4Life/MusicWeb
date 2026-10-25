# Design Spec: Tính Năng Viết & Căn Chỉnh Lời Bài Hát Cho Tài Khoản Admin (Admin Custom Lyrics & Live LRC Sync)

## 1. Tổng Quan & Mục Tiêu
Tính năng cho phép người dùng có quyền **Admin** (`isAdmin(email)`) viết mới hoặc chỉnh sửa lời bài hát cho các bản nhạc không tìm được lời tự động (hoặc lời tự động chưa chuẩn / chưa đồng bộ thời gian), bao gồm cả các bản nhạc từ nguồn ngoài như SoundCloud (kể cả Remix/Cover/UGC), YouTube, NhacCuaTui, Spotify, Deezer và Local/Drive.

---

## 2. Kiến Trúc & Phân Quyền (Security & Architecture)

### 2.1. Phân quyền (Role-Based Access Control)
- **Quyền xem lời bài hát:** Tất cả người dùng truy cập ứng dụng đều tự động nhận và hiển thị lời bài hát do Admin đã lưu thông qua luồng [`getPrimaryLyrics`](file:///d:/MusicWeb/lib/lyricsFlow.ts).
- **Quyền tạo / chỉnh sửa / xóa lời tùy chỉnh:** Chỉ tài khoản đã đăng nhập có `isAdmin(email) === true` (từ [`lib/accessControl.ts`](file:///d:/MusicWeb/lib/accessControl.ts)) mới:
  - Nhìn thấy nút **"✍️ Viết lời bài hát"** khi bài hát chưa có lời và nút **"✏️ Sửa lời"** trên thanh công cụ Lyrics trong [`LyricsView.tsx`](file:///d:/MusicWeb/components/player/LyricsView.tsx) và [`MobileFullviewPlayer.tsx`](file:///d:/MusicWeb/components/player/MobileFullviewPlayer.tsx).
  - Có quyền gọi `POST /api/lyrics/custom` để lưu hoặc xóa lời tùy chỉnh (Server xác thực session qua NextAuth / Supabase Auth và kiểm tra `isAdmin(email)`, trả về `403 Forbidden` nếu không hợp lệ).

### 2.2. Lưu trữ dữ liệu (Database & Fallback Memory Cache)
- Tận dụng cột `lyrics TEXT` đã có sẵn trong bảng `public.tracks` ([`supabase/schema.sql`](file:///d:/MusicWeb/supabase/schema.sql#L29)).
- Nếu bài hát từ nguồn ngoài chưa có bản ghi trong `public.tracks`, endpoint `POST /api/lyrics/custom` sử dụng [`resolveExternalTrackId`](file:///d:/MusicWeb/lib/trackPersistence.ts#L83-L213) để ánh xạ hoặc khởi tạo bản ghi trong `public.tracks`, sau đó cập nhật cột `lyrics` cho tất cả các bản ghi khớp định danh bài hát đó.
- Kèm theo bộ nhớ đệm in-memory trên server để đảm bảo phản hồi tức thì và hoạt động mượt ngay cả khi kết nối Supabase tạm thời gián đoạn.

---

## 3. Luồng Dữ Liệu & API (`/api/lyrics/custom`)

### 3.1. `GET /api/lyrics/custom`
- **Query Params:** `id`, `source`, `title`, `artist`, `youtube_id`, `nhaccuatui_id`, `soundcloud_id`, `spotify_id`, `file_path`.
- **Xử lý:**
  1. Kiểm tra in-memory cache hoặc truy vấn `public.tracks` theo các định danh nguồn (`id` nếu là UUID, `nhaccuatui_id`, `youtube_id`, `spotify_id`, `file_path`, `soundcloud:<id>`) hoặc theo cặp `title + artist` (không phân biệt hoa thường).
  2. Lấy giá trị cột `lyrics` (nếu khác rỗng).
  3. Chuyển đổi sang cấu trúc `LrclibResponse`:
     - Nếu chứa mốc thời gian LRC (`[mm:ss.xx]`): gán vào `syncedLyrics`.
     - Ngược lại: gán vào `plainLyrics`.
  4. Trả về `{ found: boolean, data: LrclibResponse | null, rawLyrics: string | null }`.

### 3.2. `POST /api/lyrics/custom`
- **Body Payload:**
  ```typescript
  interface SaveCustomLyricsPayload {
    track: Track
    lyrics: string | null // Chuỗi rỗng hoặc null để xóa lời tùy chỉnh và quay về lời tự động
  }
  ```
- **Xử lý:**
  1. Xác thực người dùng và kiểm tra `isAdmin(email)`. Nếu không phải Admin trả về `403 Forbidden`.
  2. Chuẩn hóa văn bản lời bài hát (`lyrics.trim()`).
  3. Tìm các bản ghi khớp trong `public.tracks` (hoặc tạo mới qua `resolveExternalTrackId` nếu chưa tồn tại và `lyrics` khác rỗng) rồi cập nhật cột `lyrics`.
  4. Cập nhật in-memory cache và trả về `{ success: true, data: LrclibResponse | null, rawLyrics: string | null }`.

### 3.3. Tích hợp vào `getPrimaryLyrics` (`lib/lyricsFlow.ts`)
- Thứ tự ưu tiên mới trong `getPrimaryLyrics(track)`:
  1. **Custom Lyrics từ Admin (`track.lyrics` hoặc `fetchCustomLyrics(track)`):** Kiểm tra đầu tiên, **trước cả** bộ lọc `isSoundCloudUgcOrRemix` để nếu Admin viết lời cho một bản nhạc SoundCloud Remix/Cover thì hệ thống vẫn hiển thị đầy đủ.
  2. **NhacCuaTui Synced Lyrics (`fetchNctLyrics`)**.
  3. **LRCLIB / YouTube Music (`fetchLyricsFromLrclib`)**.
  4. **Plain Lyrics fallback**.
- Khi Admin lưu lời mới trên giao diện:
  - Gọi `setCustomLyricsInPrimaryCache(track, response)` / xóa cache cũ và phát sự kiện `window.dispatchEvent(new CustomEvent('musicweb:lyrics-updated', { detail: { track, lyrics, data } }))` để cả `LyricsView` lẫn `MobileFullviewPlayer` cập nhật tức thì.

---

## 4. Thiết Kế Giao Diện (`AdminLyricsEditorModal.tsx`)

### 4.1. Điểm kích hoạt (Entry Points)
- **Khi chưa có lời bài hát (Empty State):**
  - Trong `LyricsView.tsx` và `MobileFullviewPlayer.tsx`: Hiển thị nút **"✍️ Viết lời bài hát"** (chỉ hiện với tài khoản Admin) ngay bên dưới thông báo *"Chưa có lời bài hát cho bản nhạc này"*.
- **Khi đã có lời bài hát (Header / Utility Bar):**
  - Trong `LyricsView.tsx` (cả chế độ có Header và chế độ ẩn Header trong `NowPlayingOverlay`) và `MobileFullviewPlayer.tsx`: Hiển thị nút **"✏️ Sửa lời"** dành riêng cho Admin. Khi mở modal từ bài đã có lời, tự động nạp nội dung lời hiện tại (ưu tiên chuỗi LRC nếu đang có `syncedLyrics`, hoặc `plainLyrics`) vào trình soạn thảo để Admin chỉnh sửa hoặc căn nhịp tiếp.

### 4.2. Hai chế độ trong `AdminLyricsEditorModal`
1. **Tab 1 — Soạn thảo văn bản (`Soạn thảo`):**
   - Khung `<textarea>` lớn với font monospace/sans rõ nét để nhập hoặc dán lời bài hát (hỗ trợ cả văn bản thuần và định dạng `[mm:ss.xx]`).
   - Thanh công cụ nhanh:
     - **"+ Chèn mốc hiện tại `[mm:ss.xx]`"**: Chèn thời gian phát nhạc hiện tại vào đầu dòng đang đặt con trỏ.
     - **"🧹 Xóa toàn bộ mốc thời gian"**: Chuyển lời LRC về văn bản thuần để căn nhịp lại từ đầu.
2. **Tab 2 — Căn thời gian trực tiếp (`Căn nhịp LRC`):**
   - Tách nội dung thành danh sách từng dòng lời bài hát.
   - Thanh điều khiển trình phát nhạc tích hợp ngay trong modal:
     - Nút **Play / Pause**, tua nhanh **`-3s`**, **`+3s`**, hiển thị thời gian phát hiện tại dạng `mm:ss.xx`.
   - Nút hành động chính: **"⏱️ Gắn mốc `[mm:ss.xx]` cho dòng đang chọn & xuống dòng tiếp"** (hỗ trợ phím tắt `Space` hoặc `Enter` khi đang ở tab Căn nhịp).
   - Trên mỗi dòng:
     - Hiển thị mốc thời gian hiện tại (vd: `01:12.45` hoặc `--:--.--` nếu chưa gắn).
     - Nút tinh chỉnh nhanh `-0.2s` / `+0.2s`, nút bấm vào mốc thời gian để tua nhạc tới câu đó nghe thử, và nút gắn lại mốc thời gian cho riêng dòng đó.
3. **Footer hành động:**
   - Nút **"Khôi phục lời tự động"** (xóa lời tùy chỉnh trong DB nếu muốn quay về lời tự động).
   - Nút **"Hủy"** và **"Lưu lời bài hát"** (hiển thị trạng thái đang lưu + thông báo Toast thành công).

---

## 5. Kế Hoạch Kiểm Thử (Verification Plan)
1. **Unit Tests (`vitest`):**
   - Kiểm thử helper định dạng/xử lý LRC trong trình soạn thảo (`formatLrcTimestamp`, `stampLineWithTime`, `stripAllLrcTimestamps`, `customLyricsToLrclibResponse`).
   - Kiểm thử `getPrimaryLyrics` ưu tiên lời bài hát tùy chỉnh của Admin (bao gồm cả trường hợp bài hát SoundCloud Remix/Cover).
2. **Kiểm thử phân quyền API:**
   - Người dùng thường / chưa đăng nhập gọi `POST /api/lyrics/custom` nhận `403 Forbidden`.
   - Admin gọi `POST /api/lyrics/custom` lưu thành công vào `public.tracks.lyrics`.
3. **Kiểm thử tích hợp UI:**
   - Kiểm tra hiển thị nút "Viết lời bài hát" và "Sửa lời" trên cả Desktop (`LyricsView`, `NowPlayingOverlay`, `/lyrics`) và Mobile (`MobileFullviewPlayer`).


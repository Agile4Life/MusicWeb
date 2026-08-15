# Design Spec: Minimal Flat Theme Engine cho MusicWeb

**Ngày tạo:** 2026-08-15  
**Trạng thái:** Đã tinh chỉnh & Chờ duyệt triển khai  
**Phương án đã chọn:** Phương án 1 — Full Theme Engine Mode (`minimal-flat`) trong `ThemeContext` & CSS Token Switcher

---

## 1. Mục tiêu & Nguyên tắc Cốt lõi

Bổ sung phong cách **Minimal Flat** trở thành một Theme Style Mode chính thức trong MusicWeb (bên cạnh `classic` và `liquid-glass`), chuyển đổi giao diện sang phong cách phẳng, mộc mạc, sáng sủa và chuẩn mực thị giác:

### Các nguyên tắc bắt buộc:
1. **Không bóng đổ (Zero Shadow):** `box-shadow: none` trên tất cả bề mặt (sidebar, player bar, cards, modal, buttons). Phân tách khối bằng màu nền tương phản hoặc viền `1px`.
2. **Không gradient (Zero Gradient):** Mọi bề mặt chỉ sử dụng một màu đơn sắc (solid color), không dùng gradient dù là 2 màu nhẹ.
3. **Không blur / backdrop-filter (Zero Glass):** Tắt hoàn toàn `backdrop-filter`, `blur`, `filter` khúc xạ ánh sáng và các lớp `rgba` mô phỏng kính.
4. **Viền tối đa 1px (Neutral Border):** Viền mảnh `1px solid #E5E3DA` dùng để phân định ranh giới chức năng rõ ràng, không dùng viền trang trí nổi bật.
5. **Hệ thống Bo góc Nhất quán:**
   - `6px`: Ảnh bìa nhỏ, thumbnail track, badge nhỏ.
   - `8px`: Hàng bài hát (track row), card bài hát, button, input.
   - `12px`: Khung container chính, panel sidebar, modal.
   - Tránh dùng bo góc pill `999px` ngoại trừ nút tròn Play/Pause trung tâm và avatar.
6. **Màu Accent Đơn Nhất:** Cam đất (`#D85A30`) dùng làm điểm nhấn duy nhất cho trạng thái đang phát (now-playing), thanh tiến trình nhạc (progress bar), avatar/CTA chính và focus-ring.
7. **Định hướng Theme (Color Scheme Intent):** `minimal-flat` được chủ đích thiết kế độc quyền dưới dạng **Light Mode** (`color-scheme: light`) để truyền tải trọn vẹn tinh thần "mộc mạc, ấm áp như giấy in và đĩa than cổ điển", không tạo biến thể dark mode làm loãng cá tính phong cách.

---

## 2. Bảng Màu Tiêu Chuẩn (Minimal Flat Palette)

| Vai trò Token | Mã màu | Ý nghĩa sử dụng |
|---|---|---|
| `--bg-space` / Nền trang | `#FAFAF7` | Nền tổng thể trang, nền player bar, nền sidebar |
| `--bg-surface-2` / Nền phụ & hover | `#F1EFE8` | Hàng đang chọn, trạng thái hover hàng track, card nhẹ |
| `--border-subtle` / Viền | `#E5E3DA` | Đường kẻ chia tách sidebar/header/player bar/danh sách |
| `--text-primary` / Chữ chính | `#1F1F1D` | Tiêu đề bài hát, tên album, text quan trọng, nút Play trung tâm |
| `--text-secondary` / Chữ phụ | `#8A8677` | Tên nghệ sĩ, thời lượng bài hát, label phụ |
| `--primary-spotify` / Accent | `#D85A30` | Trạng thái bài đang phát, fill thanh tiến trình, dot active, focus ring |
| Nút Play trung tâm | `#1F1F1D` (nền) + `#FAFAF7` (icon) | Nút play/pause chính giữa player bar với độ tương phản cao nhất |

---

## 3. Typography Rules

- **Font Family:** Sử dụng `Inter` (`--font-sans`) làm font chính cho toàn bộ giao diện minimal flat.
- **Font Weight Giới hạn:** Chỉ dùng 2 độ đậm `400` (Regular) và `500` (Medium). Triệt tiêu `600`, `700`, `800` khi ở mode Minimal Flat để giữ cảm giác nhẹ nhàng, phẳng mộc.
- **Cỡ chữ theo cấp:**
  - Brand/Logo: `16px` (Weight 500)
  - Nav item: `13px` (Active: Weight 500, Thường: Weight 400)
  - Tên bài hát: `13–14px` (Weight 500)
  - Nghệ sĩ / Meta / Thời lượng: `12px` (Weight 400, Màu `#8A8677`)
  - Label nhóm: `13px` (Weight 500, Màu `#8A8677`)

---

## 4. Chi tiết Kiến trúc & Component

### 4.1 Quản lý State trong `ThemeContext.tsx`
- Cập nhật `export type ThemeStyle = 'classic' | 'liquid-glass' | 'minimal-flat'`
- Khi `themeStyle === 'minimal-flat'`:
  - Gắn thuộc tính `data-theme-style="minimal-flat"` lên thẻ `<html>`.
  - Tự động vô hiệu hóa toàn bộ cấu hình khúc xạ thủy tinh / sắc sai (`applyLiquidGlassConfig` dọn dẹp các attribute `data-aberration-*` và `data-refraction-mode`).
  - Ghi nhớ lựa chọn vào `localStorage.getItem('musicweb-theme-style')`.

### 4.2 Bộ quy tắc CSS trong `app/globals.css`
> **Lưu ý về Kỹ thuật & `!important`:** Việc sử dụng `!important` trong khối `[data-theme-style="minimal-flat"]` là giải pháp an toàn (retrofit overlay) giúp ghi đè triệt để các tiện ích Tailwind utility và hiệu ứng kính Liquid Glass sẵn có mà không làm hỏng logic của 2 mode kia. Về lâu dài, toàn bộ hệ thống style sẽ được tái cấu trúc thành token layer đồng nhất.

```css
[data-theme-style="minimal-flat"] {
  --bg-space: #FAFAF7 !important;
  --bg-page: #FAFAF7 !important;
  --bg-surface-1: #FAFAF7 !important;
  --bg-surface-2: #F1EFE8 !important;
  --elevation-0-bg: #FAFAF7 !important;
  --elevation-1-bg: #FAFAF7 !important;
  --elevation-2-bg: #F1EFE8 !important;
  --elevation-3-bg: #F1EFE8 !important;
  --text-primary: #1F1F1D !important;
  --text-secondary: #8A8677 !important;
  --text-muted: #8A8677 !important;
  --border-subtle: #E5E3DA !important;
  --glass-border: #E5E3DA !important;
  --primary-spotify: #D85A30 !important;
  --spotify-green: #D85A30 !important;
  --accent: #D85A30 !important;
  --spotify-glow: transparent !important;
  --theme-glow-shadow: none !important;
  --glass-blur: 0px !important;
  --radius-sm: 6px !important;
  --radius-control: 8px !important;
  --radius-card: 8px !important;
  --radius-md: 8px !important;
  --radius-lg: 12px !important;
  --radius-xl: 12px !important;
  color-scheme: light;
}

/* Triệt tiêu Shadow & Glass toàn cục */
[data-theme-style="minimal-flat"] *,
[data-theme-style="minimal-flat"] *::before,
[data-theme-style="minimal-flat"] *::after {
  box-shadow: none !important;
  text-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Bảo toàn Accessibility: Focus Ring bằng viền Accent */
[data-theme-style="minimal-flat"] :focus-visible {
  outline: none !important;
  box-shadow: 0 0 0 2px #D85A30 !important;
}

/* Ẩn Spotlight cursor & Ambient Glow Orbs */
[data-theme-style="minimal-flat"] .cursor-spotlight,
[data-theme-style="minimal-flat"] .ambient-glow-orb {
  display: none !important;
}
```

### 4.3 Component Specs Chi Tiết
1. **Sidebar Navigation (`.app-sidebar`):**
   - Nền: `#FAFAF7`, viền phải: `1px solid #E5E3DA`.
   - Nav Item: Chữ `#1F1F1D` (hoặc `#8A8677` khi unselected), hover/active: nền `#F1EFE8`, bo góc `8px`.
2. **Track Row (`.song-row` / Song Table):**
   - Mặc định: Nền trong suốt, không viền.
   - Hover / Selected / Playing: Nền `#F1EFE8`, bo góc `8px`.
   - Tên bài hát: `#1F1F1D`, Weight 500. Icon đang phát / Equalizer bar: `#D85A30`.
3. **Thumbnail / Album Art (`.album-art`, img):**
   - Bo góc cố định `6px`, không viền, không bóng đổ.
4. **Player Bar (`.player-bar` / `.mini-player-bar`):**
   - Nền: `#FAFAF7`, viền trên: `1px solid #E5E3DA` (không shadow).
   - Thanh tiến trình (Seek bar): Track nền `#E5E3DA`, phần đã phát `#D85A30`, chiều cao `3–4px`, bo góc `2px`.
   - Nút Play/Pause trung tâm: Hình tròn nền `#1F1F1D`, icon `#FAFAF7`.
   - Nút Previous/Next/Shuffle/Repeat: Icon `#1F1F1D` hoặc `#8A8677`, hover đổi nền nhẹ `#F1EFE8` bo góc `8px`.
5. **Search Input (`.search-input`, `input[type="search"]`):**
   - Nền: `#FAFAF7` hoặc `#F1EFE8`, viền `1px solid #E5E3DA`, bo góc `8px`.
   - Chữ gõ: `#1F1F1D` (Weight 400), Placeholder: `#8A8677`.
   - Trạng thái Focus: Đổi màu viền sang `#D85A30`, không phát sáng glow, không làm mờ nền xung quanh.
6. **Modal & Dialogs (`.modal`, `.dialog-content`):**
   - Container modal: Nền đặc `#FAFAF7`, viền `1px solid #E5E3DA`, bo góc `12px`, không shadow.
   - Overlay nền mờ (Backdrop): Sử dụng nền tối đơn sắc `rgba(0, 0, 0, 0.45)`, **tuyệt đối không dùng `backdrop-filter: blur(...)`**.
   - Nút hành động trong modal: Nút phụ nền `#F1EFE8`, nút chính nền `#1F1F1D` chữ `#FAFAF7` hoặc nền cam `#D85A30`.
7. **Theme Selector (`ThemeSelector.tsx`):**
   - Thêm nút thứ 3: **Minimal Flat (Tối Giản Phẳng)** với icon mộc mạc và mô tả rõ ràng. Ẩn khối tinh chỉnh khúc xạ thủy tinh khi đang chọn mode này.

---

## 5. Checklist Tự Kiểm Tra (Pre-Delivery Verification)

- [ ] Không còn `box-shadow` nào xuất hiện khi ở mode `minimal-flat` (ngoại trừ focus-visible ring `0 0 0 2px #D85A30`).
- [ ] Không còn `backdrop-filter`, `blur`, hoặc `rgba` làm mờ kiểu kính trên cả modal overlay.
- [ ] Mỗi màn hình chỉ sử dụng 1 màu accent `#D85A30` cho playing state, progress và focus-ring.
- [ ] Mọi bo góc đều thuộc bộ giá trị chuẩn: `6px` (ảnh/thumb), `8px` (hàng/nút/card/search), `12px` (container/modal).
- [ ] Text weight chỉ 400 hoặc 500, font chữ hiển thị sắc nét với tiếng Việt.
- [ ] Ranh giới phân chia rõ ràng bằng viền `1px solid #E5E3DA`.
- [ ] Chuyển đổi qua lại giữa `minimal-flat`, `liquid-glass`, và `classic` mượt mà, không bị sót style.

---

## 6. Danh sách File Thực hiện

1. `components/theme/ThemeContext.tsx`: Mở rộng type `ThemeStyle`, bổ sung xử lý dọn dẹp thuộc tính kính khi kích hoạt `minimal-flat`.
2. `components/theme/ThemeSelector.tsx`: Bổ sung Option card Minimal Flat vào danh sách Style Engine.
3. `app/globals.css`: Định nghĩa đầy đủ bộ token, overrides cho sidebar, player bar, track list, search, modal, focus-visible khi `[data-theme-style="minimal-flat"]`.
4. `components/theme/CursorSpotlight.tsx`: Bỏ qua render spotlight khi đang ở `minimal-flat`.

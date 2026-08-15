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

## 2. Bảng Màu Tiêu Chuẩn (Minimal Editorial / Vinyl Studio Palette)

| Vai trò Token | Mã màu | Ý nghĩa sử dụng |
|---|---|---|
| `--void` / Nền không gian | `#141017` | Nền plum obsidian sâu lắng, kết hợp radial glow hổ phách ấm |
| `--surface` / Bề mặt cấp 1 | `#1D1720` | Bề mặt card, ô tìm kiếm, dialog modal |
| `--surface-2` / Bề mặt cấp 2 | `#251E29` | Gradient card, header đĩa |
| `--hair` / Đường phân cách | `rgba(244,236,230,0.08)` | Viền nhẹ, divider |
| `--paper` / Chữ chính | `#F4ECE1` | Tiêu đề Fraunces serif, tên bài hát, nút Play trung tâm |
| `--paper-dim` / Chữ phụ | `#B9AC9C` | Tên nghệ sĩ, mô tả hero, icon sidebar |
| `--muted` / Text mờ | `#8B8090` | Nhãn nhóm, timecode, meta tag |
| `--accent-strong` / Hổ phách | `#E8A94F` | Điểm nhấn active nav, progress bar, play button card |
| `--wine` / Đỏ rượu | `#A24B3D` | Tag Hot, icon Yêu thích |
| `--sage` / Xanh xô thơm | `#7C9070` | Tag Cloud |

---

## 3. Typography Rules

- **Display & Headings:** `Fraunces` (`--font-fraunces`, Serif) cho Tiêu đề trang, Hero banner, logo mark `MuSic.` và nhãn đĩa than.
- **UI & Nội dung:** `Inter` (`--font-inter`, Sans) cho toàn bộ danh sách, điều hướng và form input.
- **Timecode & Data:** `IBM Plex Mono` / `JetBrains Mono` (`--font-ibm-plex-mono`, Mono) cho thời lượng phát và eyebrow tag.

---

## 4. Chi tiết Kiến trúc & Component

### 4.1 Quản lý State trong `ThemeContext.tsx`
- Cập nhật `export type ThemeStyle = 'classic' | 'liquid-glass' | 'minimal-flat'`
- Khi `themeStyle === 'minimal-flat'`:
  - Gắn thuộc tính `data-theme-style="minimal-flat"` lên thẻ `<html>`.
  - Tự động vô hiệu hóa toàn bộ cấu hình khúc xạ thủy tinh / sắc sai (`applyLiquidGlassConfig` dọn dẹp các attribute `data-aberration-*` và `data-refraction-mode`).
  - Ghi nhớ lựa chọn vào `localStorage.getItem('musicweb-theme-style')`.

### 4.2 Bộ quy tắc CSS trong `app/globals.css`

```css
[data-theme-style="minimal-flat"] {
  --void: #141017;
  --surface: #1D1720;
  --surface-2: #251E29;
  --surface-3: #2E2632;
  --hair: rgba(244, 236, 230, 0.08);
  --hair-strong: rgba(244, 236, 230, 0.14);
  --paper: #F4ECE1;
  --paper-dim: #B9AC9C;
  --muted: #8B8090;
  --accent: #C98A3D;
  --accent-strong: #E8A94F;
  --accent-ink: #2A1704;
  --wine: #A24B3D;
  --sage: #7C9070;

  --bg-space: #141017 !important;
  --bg-page: #141017 !important;
  --bg-surface-1: #1D1720 !important;
  --bg-surface-2: #251E29 !important;
  --bg-surface-3: #2E2632 !important;
  --text-primary: #F4ECE1 !important;
  --text-secondary: #B9AC9C !important;
  --text-muted: #8B8090 !important;
  --border-subtle: rgba(244, 236, 230, 0.08) !important;
  --glass-border: rgba(244, 236, 230, 0.14) !important;
  --primary-spotify: #E8A94F !important;
  --spotify-green: #E8A94F !important;
  --accent: #C98A3D !important;
  --radius-sm: 9px !important;
  --radius-md: 14px !important;
  --radius-lg: 20px !important;
  color-scheme: dark;
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

# Design Spec: Cập nhật Typography (Font chữ) cho MusicWeb

**Ngày tạo:** 2026-08-12  
**Trạng thái:** Chờ duyệt  
**Phương án đã chọn:** Phương án 1 — Dual Font System (`Space Grotesk` + `Inter` + `JetBrains Mono`)

---

## 1. Mục tiêu

Nâng cấp hệ thống Typography của MusicWeb nhằm:
1. Mang lại diện mạo cá tính, kỹ thuật số hiện đại cho phần Tiêu đề/Hero thông qua font display **Space Grotesk**.
2. Đảm bảo độ rõ nét, dễ đọc tối đa ở kích thước nhỏ (danh sách bài hát, tên nghệ sĩ, menu) thông qua **Inter**.
3. Căn chỉnh số liệu chuẩn hàng lối (thời lượng nhạc, bitrate, thống kê) với **JetBrains Mono** (`tabular-nums`).
4. Hỗ trợ 100% tiếng Việt đầy đủ dấu thanh mà không bị lỗi layout shift (FOUT/FOIT) nhờ cơ chế self-host `next/font/google`.

---

## 2. Kiến trúc & Cấu hình Font (Font Architecture)

### 2.1 Khai báo tập trung trong `app/layout.tsx`
Sử dụng `next/font/google` nạp 3 font family với `subsets: ['latin', 'vietnamese']` và `display: 'swap'`:

- **Space Grotesk** (`--font-space-grotesk`): Dùng cho Display & Headings (`weights: ['600', '700']`).
- **Inter** (`--font-inter`): Dùng cho Body & UI Components (`weights: ['400', '500', '600', '700']`).
- **JetBrains Mono** (`--font-jetbrains-mono`): Dùng cho thông số thời gian, bitrate, counter (`weights: ['400', '500']`).

Các biến font CSS này được gán trực tiếp vào thẻ `<html>` trong `app/layout.tsx`.

### 2.2 Định nghĩa CSS Variables & Tailwind v4 Theme (`app/globals.css`)
Cập nhật trong `:root` và `@theme` block:

```css
:root {
  --font-display: var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif;
  --font-sans: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), 'JetBrains Mono', monospace;
}

@theme {
  --font-display: var(--font-display);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}
```

Dọn dẹp các dòng `@import url('https://fonts.googleapis.com/css2?...')` cũ trong `globals.css` để tránh nạp trùng lặp `Inter` qua CDN runtime.

---

## 3. Typography Scale & Quy tắc sử dụng (Usage Rules)

| Vai trò | Font Family Class | Kích thước đề xuất | Font Weight | Phạm vi ứng dụng |
|---|---|---|---|---|
| **Display Title** | `font-display` | 28–32px | 700 (Bold) | Tiêu đề màn hình chính (vd "Chào mừng trở lại", "Khu Vực Cá Nhân") |
| **Section H2** | `font-display` | 20–22px | 700 (Bold) | Tiêu đề section (vd "Trending & Hot Albums", "Danh sách phát") |
| **Body / Track Title** | `font-sans` | 14–15px | 500 (Medium) / 600 | Tên bài hát, tên nghệ sĩ, văn bản mô tả, menu navigation |
| **Label / Eyebrow** | `font-sans` | 12.5–13px | 600 (SemiBold) | Label input, button, tag phân loại |
| **Meta / Duration** | `font-mono tabular-nums` | 11–12px | 500 (Medium) | Thời lượng bài phát (`03:45`), đếm lượt nghe, bitrate audio |

---

## 4. Kiểm tra Tiếng Việt & Phản hồi Thị giác (Vietnamese Diacritics Verification)

- Bộ ký tự kiểm tra: `à á ả ã ạ ă ằ ắ ẳ ẵ ặ â ầ ấ ẩ ẫ ậ ê ề ế ể ễ ệ ô ồ ố ổ ỗ ộ ơ ờ ớ ở ỡ ợ ư ừ ứ ử ữ ự đ`
- Đảm bảo `line-height` cho font display tối thiểu 1.25 đến 1.3 để dấu thanh tiếng Việt không bị cắt ngọn hoặc đè dòng trên.

---

## 5. Danh sách File cần thay đổi

1. `app/layout.tsx`: Import `Space_Grotesk`, `Inter`, `JetBrains_Mono` từ `next/font/google`, gắn biến CSS vào `<html>`.
2. `app/globals.css`: Dọn dẹp `@import` font CDN thừa, bổ sung `:root` variables & Tailwind `@theme` mappings cho `--font-display`, `--font-sans`, `--font-mono`.
3. Kiểm tra các tiêu đề chính trong các trang (`app/page.tsx`, `components/`) để áp dụng lớp `font-display` cho H1/H2 tiêu đề nổi bật.

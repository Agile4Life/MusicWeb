# Design Spec: Hệ Thống Quản Trị & Chỉnh Sửa Thông Báo Trực Tiếp (Admin Announcement Management)

## 1. Tổng Quan & Mục Tiêu
Tính năng cho phép người dùng có quyền **Admin** (`isAdmin`) chỉnh sửa trực tiếp nội dung thông báo hệ thống (Welcome Announcement Modal) ngay trên giao diện web, dữ liệu được lưu trữ trên CSDL Supabase và tự động đồng bộ đến tất cả người dùng truy cập web.

---

## 2. Kiến Trúc & Phân Quyền (Security & Architecture)

### 2.1. Phân quyền chặt chẽ (Role-Based Access Control)
- **Quyền xem:** Mọi người dùng (Khách vãng lai, Listener, Admin) đều nhận và hiển thị thông báo đã xuất bản mới nhất từ API.
- **Quyền chỉnh sửa:** Chỉ các tài khoản có email nằm trong danh sách Admin (`isAdmin(email)` từ `lib/accessControl.ts` và Session Auth) mới:
  - Thấy nút **"✏️ Chỉnh sửa thông báo"** trên Modal và trong trang Cài đặt (Settings).
  - Có quyền gọi API `POST /api/announcement` để cập nhật CSDL (API server-side xác thực session và kiểm tra quyền Admin, từ chối `403 Forbidden` nếu không phải Admin).

### 2.2. Cấu trúc dữ liệu thông báo (`AnnouncementData`)
```typescript
export interface AnnouncementData {
  id?: string
  badge: string // Nhãn trên đầu, vd: "Thông báo từ Tác giả"
  title: string // Tiêu đề chính, vd: "Chào mừng bạn đến với MusicWeb 🎵"
  content: string // Nội dung văn bản chi tiết
  facebook_url?: string
  instagram_url?: string
  contact_email?: string
  cta_text?: string // Chữ trên nút đóng/bắt đầu, vd: "Đã hiểu & Bắt đầu"
  is_enabled: boolean // Trạng thái Bật/Tắt hiển thị thông báo
  updated_at?: string
  version?: number // Tăng version khi Admin muốn hiển thị lại thông báo mới cho cả người đã tick "Không hiển thị lại"
}
```

---

## 3. Thành Phần Giao Diện (UI / UX)

### 3.1. Chỉnh sửa trực tiếp trên Welcome Announcement Modal (`WelcomeAnnouncementModal.tsx`)
- Khi người dùng đăng nhập là **Admin**, xuất hiện nút **"✏️ Sửa thông báo"** (Glassmorphic Admin Action) ở góc trên modal.
- Khi bấm, modal chuyển sang chế độ **Trình chỉnh sửa trực tiếp (Live Editor Mode)**:
  - Ô nhập Nhãn (`badge`), Tiêu đề (`title`).
  - Khung soạn thảo Nội dung (`content`) hỗ trợ xuống dòng nhiều đoạn.
  - Các trường Link mạng xã hội (Facebook, Instagram, Email) và Chữ nút CTA.
  - Công tắc Bật/Tắt thông báo (`is_enabled`).
  - Nút **"Lưu thay đổi"** (với hiệu ứng lưu và thông báo Toast thành công) & Nút **"Hủy"**.

### 3.2. Quản trị trong Cài Đặt (`app/(app)/settings/page.tsx`)
- Thêm khối **"🛠️ Quản trị thông báo hệ thống (Dành cho Admin)"** vào trang Settings:
  - Hiển thị xem trước nội dung thông báo hiện tại.
  - Nút bấm mở nhanh trình chỉnh sửa thông báo.
  - Công tắc bật/tắt hiển thị toàn trang.

---

## 4. API & Lưu Trữ CSDL (Data Flow)

### 4.1. Endpoint `/api/announcement`
- `GET /api/announcement`:
  - Đọc thông báo từ bảng `system_announcements` (hoặc `app_settings`) trong Supabase.
  - Nếu CSDL chưa có hoặc lỗi mạng, trả về fallback mặc định cấu hình sẵn (`DEFAULT_ANNOUNCEMENT`).
- `POST /api/announcement`:
  - Xác thực session đăng nhập.
  - Kiểm tra `isAdmin(session.user.email)` -> Nếu sai trả về `403 Forbidden`.
  - Validate dữ liệu và Upsert vào Supabase.

---

## 5. Kế Hoạch Kiểm Thử (Verification Plan)
1. **Kiểm thử phân quyền:**
   - Tài khoản Listener / Chưa đăng nhập: Chỉ thấy thông báo, KHÔNG thấy nút chỉnh sửa, gọi API `POST` bị từ chối `403`.
   - Tài khoản Admin: Thấy nút chỉnh sửa, mở editor, lưu thành công.
2. **Kiểm thử cập nhật & lưu trữ:**
   - Thay đổi tiêu đề, nội dung, link -> Lưu -> Tải lại trang kiểm tra nội dung mới được hiển thị chính xác.
   - Bật/Tắt `is_enabled` -> Kiểm tra modal ẩn/hiện đúng trạng thái.
3. **Chạy test tự động:** Chạy toàn bộ test suites của dự án (`npm test`) đảm bảo 100% pass.

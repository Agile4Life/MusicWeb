# Bộ bài đấu cộng đồng

Người dùng đã chốt: nhiều người có thể tạo và đăng bộ bài; mọi người truy cập cùng bộ bài nhưng chơi, chọn người thắng độc lập. Không có phòng bỏ phiếu đồng thời.

Tích hợp tại Spotify Lab, giữ giao diện minimal-flat và luồng nghe thử. Bổ sung tab cộng đồng với tìm kiếm, phân trang và lọc bộ bài của mình. Người có tài khoản đăng nhập có thể đăng bộ bài gồm tên, mô tả, tên hiển thị và 2–512 bài từ các nguồn đã hỗ trợ. Mỗi bộ có link /spotify-lab?deck=<uuid>. Khách mở link và chơi được; chỉ tác giả có thể cập nhật hoặc xóa. Khi mở bộ, tải snapshot riêng cho ván chơi; kết quả của người này không thay đổi lựa chọn của người khác.

Bảng riêng public.song_battle_decks lưu snapshot JSONB các bài, owner_id nội bộ, metadata công khai và phiên bản cập nhật. API server dùng session hiện tại để phân quyền, không nhận owner từ client, không trả owner_id ra công khai. Bật RLS, chặn truy cập trực tiếp của anon/authenticated; chỉ service_role dùng API server. Không thay đổi bảng playlist/thư viện cá nhân.

Plugin Supabase hiện nối project khác với web. Người dùng yêu cầu bàn giao SQL để tự chạy trên project của MusicWeb. Vì vậy migration là deliverable; không tự áp dụng lên project khác. Kiểm chứng SQL bằng Postgres PGlite thực, các API bằng kiểm thử phân quyền và giả lập transport, UI bằng trình duyệt với nhiều phiên khách/tác giả/người khác. Trạng thái chưa chạy SQL phải được thông báo rõ trên UI và tài liệu bàn giao.

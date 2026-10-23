# Bật thư viện Đọ nhạc cộng đồng

1. Mở SQL Editor của Supabase đang dùng cho MusicWeb (`mjpibwmproussfevtqbp`).
2. Chạy toàn bộ nội dung [SONG_BATTLE_COMMUNITY.sql](./SONG_BATTLE_COMMUNITY.sql).
3. Mở `/spotify-lab`, đăng nhập, thêm ít nhất 2 bài và chọn **Đăng bộ bài**. Mở link chia sẻ trong cửa sổ khác để chơi độc lập.

SQL có thể chạy lại an toàn. Script chỉ tạo bảng, chỉ mục và trigger dành cho bộ bài đấu; không thay đổi bài hát hoặc playlist cá nhân hiện có. Không cần bật Realtime.

API dùng cấu hình Supabase hiện có của web. `SUPABASE_SERVICE_ROLE_KEY` phải chỉ có ở server; không thêm tiền tố `NEXT_PUBLIC_`. Khách xem/chơi qua API của MusicWeb, người đăng nhập được tạo bộ bài, tác giả được sửa/xóa. Bảng không cho trình duyệt đọc/ghi trực tiếp. Thông tin chủ sở hữu nội bộ không được trả về API công khai.

Mỗi bộ lưu một snapshot từ 2 đến 512 bài; link Spotify/YouTube/SoundCloud giữ đúng nguồn. Mỗi lượt chơi chạy độc lập trên trình duyệt, không ghi lựa chọn hoặc kết quả của người này vào ván của người khác. Tải lại trang sẽ bắt đầu lượt chơi mới. Cập nhật bộ bài không thay đổi một lượt chơi đã mở.

Nếu chưa chạy SQL, tab cộng đồng hiển thị trạng thái chờ thiết lập; tính năng tạo cuộc đấu/nghe thử tại chỗ vẫn hoạt động. Migration chưa được áp dụng lên Supabase từ phiên làm việc này theo yêu cầu người dùng.

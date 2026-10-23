# Đọ nhạc — đề xuất triển khai

Trạng thái: người dùng duyệt và điều chỉnh phạm vi: tích hợp trực tiếp spotify-lab, dùng nghe thử hiện có, giao diện minimal-flat, nhập playlist từ các nguồn sẵn có.

## Điều chỉnh đã duyệt

Thay /song-battle bằng /spotify-lab, giữ trang truy cập độc lập hiện có. Dùng lại API playlist Spotify, YouTube và SoundCloud để thêm bài vào ván chơi (không tự ghi vào thư viện cá nhân). Giữ nguồn phát gốc bằng một trình phát tại một thời điểm: Spotify iFrame API/nghe thử, YouTube embed hoặc SoundCloud embed. Không tự tìm bài thay thế có thể sai bản thu. Hiển thị thông báo nếu trình phát bị chặn hoặc nguồn không có bản nghe thử. Cho phép giải 2 bài để so sánh nhanh ngoài 4/8/16/32 bài. Phiên bản này không cần điều hướng mới hoặc thêm provider của toàn ứng dụng vào trang công khai.

## Mục tiêu

Thêm tính năng so sánh hai bài hát vào MusicWeb, dựa trên luồng đấu loại của UwUFUFU. Người chơi nghe và chọn bài thích hơn qua từng cặp đến khi còn một bài vô địch.

## Khảo sát bằng REA

Trang tham chiếu: https://www.uwufufu.com/worldcup/nhc-bun-cho-cc-t-trong-lng-x-mi-t-i-i

- Trang giới thiệu có nút Play, bảng xếp hạng và danh sách lựa chọn. Evidence: ev_578bf6adbbfdf2d4e4e682364f66a427453224bedf201a667891486237549f08.
- REA bấm Play và quan sát trang setup: Solo, Random/Custom, chọn số bài theo lũy thừa hai, nút Start. Evidence: ev_3966cbb5b94f33cbc97e2baf6a3e1be45718617c12ad04fcb109dde1dbeabc70.
- REA chọn Round of 4 rồi Start: màn chơi hiển thị hai iframe, tên bài, hai nút Choose, VS và Round of 4 | 1/2. Evidence: ev_12c04a9e810540bccf2f63b0212c5e834b05ef262844e1c2fb0ba30a3d2b1e4d.
- Chưa quan sát hành vi sau Choose hoặc màn kết quả. Quy tắc đi tiếp bên dưới là thiết kế đề xuất theo thể thức đấu loại, không phải kết luận về mã nguồn trang mẫu.

## Ba phương án

1. Tích hợp vào MusicWeb, dùng bài hát và trình phát sẵn có (khuyến nghị): giao diện thống nhất, dùng lại tìm kiếm và xử lý nguồn nhạc.
2. Trang riêng với hai video YouTube nhúng: gần màn chơi mẫu hơn nhưng tách khỏi trải nghiệm nghe nhạc của MusicWeb.
3. Chỉ so sánh một cặp: ít thao tác, nhưng không có giải đấu và bài vô địch.

## Thiết kế đề xuất

- Thêm đường dẫn /song-battle và mục Đọ nhạc trong điều hướng hiện có.
- Thiết lập: tìm và thêm bài bằng tìm kiếm hiện có; có thể lấy bài từ playlist cá nhân. Chọn 4, 8, 16 hoặc 32 bài tùy số bài đã thêm. Cần đủ bài mới bắt đầu; không cho thêm trùng ID.
- Bắt đầu: xáo trộn danh sách, lấy đúng số bài đã chọn và ghép từng cặp.
- Màn đấu: hai thẻ có ảnh bìa, tên bài, nghệ sĩ, nút nghe/dừng và nút Chọn bài này. Desktop đặt cạnh nhau, điện thoại xếp dọc. Mỗi lần chỉ phát một bài bằng PlayerProvider hiện có.
- Chọn bài thắng chuyển sang cặp tiếp theo. Hết vòng ghép các bài thắng, lặp đến chung kết. Hiển thị tên vòng, số trận trong vòng và tiến độ tổng.
- Có thể quay lại lựa chọn trước. Chặn thao tác chọn lặp khi cặp đang chuyển. Dừng bài đang nghe khi đổi trận hoặc rời màn chơi.
- Kết quả: bài vô địch, danh sách các trận đã chọn và nút chơi lại với thứ tự ngẫu nhiên mới.
- Ván chơi nằm trong bộ nhớ của trang; tải lại bắt đầu thiết lập mới. Không thêm bảng dữ liệu hoặc thống kê cộng đồng trong phiên bản này.

## Cấu trúc và kiểm chứng

Tách logic ghép cặp/đi tiếp/quay lại thành module thuần TypeScript, UI trang riêng sử dụng Track và các hook trình phát có sẵn. Dùng theme hiện có. Đọc hướng dẫn Next.js trong node_modules/next/dist/docs trước khi viết mã.

Kiểm tra giải 4 và 8 bài đi đến đúng vô địch, mỗi bài thua bị loại, tiến độ, quay lại, lựa chọn lặp và số lượng không hợp lệ. Kiểm tra tích hợp tìm kiếm/playlist, chuyển bài không phát chồng, lỗi nguồn nhạc vẫn cho phép chọn, bố cục mobile, lint và TypeScript các phần thay đổi.

## Lỗi và phạm vi

Tìm kiếm/playlist lỗi phải có thông báo và thử lại. Phát nhạc lỗi dùng trạng thái lỗi của player, không tự loại bài. Bảo toàn các thay đổi đang có của người dùng trong artist/page.tsx, NowPlayingOverlay.tsx và PlayerBar.tsx.

Không triển khai multiplayer, Twitch, bảng xếp hạng cộng đồng hoặc sao chép kho bài từ trang tham chiếu trong phạm vi đề xuất này.

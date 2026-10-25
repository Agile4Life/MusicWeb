# Rà soát API bên ngoài — 25/10/2026

## Cập nhật: đã loại bỏ Audius và iTunes

Theo yêu cầu tiếp theo, cả hai nhà cung cấp đã được gỡ khỏi ứng dụng:

- Xóa `lib/audius.ts`, `lib/itunes.ts`; bỏ các lượt search/chart/lookup, fallback trending theo nghệ sĩ và fallback album của iTunes.
- Album dùng Spotify/Deezer và cache nội bộ. ID album iTunes/Audius cũ trả 410 trước khi gọi DB/provider; không còn alias ID số sang iTunes. Cache và tìm kiếm loại album của nguồn đã gỡ.
- Bỏ hai nhóm khỏi response tìm kiếm, client parser/context, scoring, type nguồn và metadata ID đang hoạt động. Request tìm hai nguồn cũ trả 400.
- Bài đã lưu giữ ID/tên bài; URL nguồn cũ bị loại và player phân giải lại qua nguồn được hỗ trợ. Kết quả đã chuyển sang NCT/SoundCloud/YouTube/Drive vẫn được giữ khi khôi phục. Chặn cả dấu hiệu stream Audius trên discovery host tùy chọn.
- Các bài Battle cũ chỉ phân giải khi nằm trong cặp hiện tại hoặc được chọn nghe; không phân giải toàn bộ playlist khi nhập. Giữ nguyên pool/tournament đã lưu. Nếu không tìm được nguồn thay thế, giao diện giữ thông báo không phát được; các snapshot chưa có transport hợp lệ vẫn chịu điều kiện kiểm tra khi đăng lại.
- Các tham chiếu còn lại đến tên nguồn cũ phục vụ từ chối request, kiểm tra dữ liệu cũ và regression; không còn adapter hay lượt fetch API của hai bên.

Kiểm chứng cuối: **129 file / 947 test không cần API thật đạt**, TypeScript đạt. ESLint kiểm tra 53 file: 0 chẩn đoán mới so với trước đợt gỡ, còn 137 chẩn đoán có sẵn. Rà soát độc lập đã duyệt sau khi sửa các lỗi tương thích local/Drive/Battle. Test trình duyệt mới timeout khi mở trang local, trước assertion; chưa xác nhận E2E bằng trình duyệt. Ba file test phụ thuộc API thật vẫn được loại khỏi bộ kiểm tra không cần mạng như đợt trước.

Các mục bên dưới ghi lại đợt tối ưu ban đầu, trước yêu cầu loại bỏ hai nhà cung cấp.

Đã giảm các lượt gọi dư trong tìm kiếm, khôi phục phát nhạc, lyrics, album trang chủ và gợi ý bài tiếp theo. Không loại bỏ nhà cung cấp khỏi ứng dụng; các nhánh cần cho phát nhạc và fallback vẫn được giữ.

## Những chỗ đã sửa

| Luồng | Trước | Sau | Mã nguồn |
| --- | --- | --- | --- |
| Tìm riêng Spotify hoặc Deezer | Gọi nguồn được chọn và YouTube để bổ sung lượt xem, sau đó bỏ danh sách YouTube khỏi response | Chỉ gọi nguồn được chọn; phân giải nguồn phát khi cần | `app/api/search/route.ts` |
| Khôi phục phát nhạc | Tìm NCT, Spotify, Deezer, YouTube, SoundCloud và local dù player chỉ dùng ba nguồn phát | `source=playback` chỉ tìm NCT, YouTube, SoundCloud; áp dụng ở cả ba nhánh khôi phục | `app/api/search/route.ts`, `lib/playback/playbackSourceService.ts`, `lib/playback/sourcePorts.ts` |
| Lyrics của bài có NCT ID | Gọi NCT và LRCLIB đồng thời dù lời đồng bộ NCT đã là kết quả ưu tiên cao nhất | Dùng lời đồng bộ NCT ngay; chỉ gọi LRCLIB khi NCT thiếu lời đồng bộ | `lib/lyricsFlow.ts` |
| Access token Spotify | Các tác vụ đồng thời có thể tự xin cùng một token khi cache chưa có hoặc hết hạn | Dùng chung request đang chạy; vẫn làm mới token hết hạn và thử lại được sau lỗi | `lib/spotify.ts` |
| Tìm nghệ sĩ Deezer | Radio và related-track đồng thời tra cùng nghệ sĩ hai lần | Gộp request cùng truy vấn đang chạy; giữ so khớp danh tính nghiêm ngặt và cache fetch hiện có | `lib/deezer.ts` |
| Album trang chủ | Xin 60 album Deezer từ chart lấy tối đa 50 mục nên luôn mở thêm bốn tìm kiếm nghệ sĩ khi chart đầy | Xin 50 ứng viên chart để trộn với Spotify và iTunes, tối đa 60 album tổng | `app/api/albums/new-releases/route.ts` |
| Auto-queue | Luôn tìm seed, nghệ sĩ liên quan, topic và Deezer related/top; có thể gọi cả Spotify dù đã đủ số bài được yêu cầu | Lấy seed/native, radio và cá nhân hóa trước; chỉ gọi peer/related/topic/top/Spotify khi danh sách sau lọc chưa đủ | `lib/queueRecommend.ts` |

Quyết định mở rộng auto-queue dựa trên số bài **sau khi** loại trùng, kiểm tra thể loại/vùng, lịch sử, bài thường bị bỏ qua và giới hạn hai bài mỗi nghệ sĩ. Bổ sung một regression cho trường hợp nhiều ứng viên thô nhưng danh sách cuối vẫn thiếu vì giới hạn nghệ sĩ.

## Số lượt gọi đã chứng minh trong test

Các số sau là kịch bản mô phỏng ở mức HTTP/provider tương ứng, không phải phép đo traffic hoặc độ trễ production.

| Kịch bản | Trước sửa | Sau sửa |
| --- | ---: | ---: |
| Tám tác vụ Spotify đồng thời khi chưa có token: HTTP xin token | 8 | 1 |
| Radio và related Deezer đồng thời: HTTP tìm cùng nghệ sĩ | 2 | 1 |
| Chart Deezer có đủ 50 album: tổng HTTP Deezer cho feed trộn | 5 | 1 |
| Tìm riêng Spotify/Deezer: thao tác tìm provider | 2 | 1 |
| NCT trả lời đồng bộ: số lần gọi LRCLIB | 1 | 0 |
| Khôi phục player: số nguồn tìm kiếm ngoài / truy vấn local | 5 / 1 | 3 / 0 |

Test auto-queue xác nhận không gọi peer/related/topic/top/Spotify khi nguồn chính đã đủ; vẫn mở rộng khi thiếu đa dạng, bị loại bởi lịch sử/skip hoặc provider lỗi.

## Kiểm chứng

- Các regression về request dư đã được chạy trước sửa và thất bại đúng vì số lượt gọi vượt yêu cầu; sau sửa đều đạt.
- `npm.cmd test -- --maxWorkers=2 --exclude lib/__tests__/lyrics.test.ts --exclude lib/__tests__/supershy_check.test.ts --exclude lib/__tests__/soundcloud.test.ts`: **126 file, 879 test đạt**.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: đạt.
- ESLint cho 16 file sửa/thêm, so chẩn đoán theo rule/message với `HEAD`: **0 chẩn đoán mới**; còn 62 chẩn đoán có sẵn trong các file được kiểm tra.
- Rà soát mã độc lập: không phát hiện vấn đề cần sửa.
- Lần chạy toàn bộ 900 test ban đầu có sáu ca API thật lỗi mạng `EACCES` và một test cache gọi API NCT bằng ID giả. Fixture cache đã mock NCT tương ứng với mock SoundCloud có sẵn; test cache nằm trong 879 ca đạt ở trên. Ba file chứa test API thật được loại khỏi lần chạy không cần mạng; chưa xác minh các kết nối upstream thật.
- Fixture playback còn dùng port `findFallback` đã bỏ khỏi interface được chuyển sang cấp ứng viên qua response tìm kiếm hiện hành, để test thực sự đi qua nhánh SoundCloud lỗi rồi fallback YouTube và TypeScript hợp lệ.

## Đánh đổi và các luồng giữ lại

- Với bài NCT chỉ có lời thường hoặc thiếu lời, LRCLIB bắt đầu sau khi NCT trả kết quả. Ưu tiên kết quả không đổi; trường hợp này có thể chờ lâu hơn so với gọi đồng thời.
- Với queue thiếu bài, bước mở rộng chờ nguồn chính. Khi đã đủ bài, tập ứng viên không còn gồm toàn bộ nguồn phụ nên thứ tự gợi ý có thể khác. Các bộ lọc và giới hạn theo nghệ sĩ vẫn áp dụng.
- Nếu Spotify và iTunes đều không có album trong khi Deezer chart đầy, feed có thể chỉ có 50 album; ứng dụng không tìm thêm bốn nghệ sĩ chỉ để đạt 60. Chart ngắn hoặc lỗi vẫn dùng cơ chế bổ sung của Deezer hiện có.
- Tìm kiếm `source=all` vẫn gọi đầy đủ nguồn vì giao diện sử dụng các nhóm kết quả đó. Gợi ý nhập liệu và tìm kiếm đã chia sẻ cache/request cùng truy vấn, nên không thêm tầng cache trùng.
- Phân giải album ở player đã có chống trùng request và cache kết quả thiếu ngắn hạn. Không bỏ các lượt tra cứu có mục đích hoàn thiện album.
- Prewarm khi hover/chuẩn bị bài tiếp theo vẫn được giữ để giảm chờ khi phát; đây là tác vụ dự đoán, cần log số request thực sự được dùng trước khi giảm thêm. SoundCloud cũng có thể tải nhiều bundle khi cần tìm lại client ID; đó là nhánh xác thực riêng, chưa thay đổi trong đợt này.
- Giữ kiểm tra stream trong cache để tránh dùng URL không còn phát được. Không thay đổi auth, truy vấn Supabase, schema hay transport stream.

Các thay đổi Spotify Lab có sẵn trong workspace không thuộc đợt sửa này.

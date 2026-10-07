# Thay đổi Supabase cho cache phát nhạc

Đợt sửa này có migration Supabase. Chưa chạy migration, deploy hay thay đổi dữ
liệu trên Supabase thật của bạn. SQL được kiểm tra bằng PostgreSQL local qua
PGlite; điều đó chưa xác nhận cấu hình PostgREST/RLS của project đang chạy.

## File cần áp dụng

[202610070001_stream_resolution_coordination.sql](../../supabase/migrations/202610070001_stream_resolution_coordination.sql)

Migration chạy bằng quyền `postgres` và tạo:

| Đối tượng | Mục đích và quyền |
| --- | --- |
| `public.stream_resolution_cache` | Cache mới theo title/artist/duration, giữ version chung giữa các server |
| `read_stream_resolution_cache(text,text,integer,boolean)` | Đọc version/cache hoặc tăng version và xóa payload khi invalidate |
| `write_stream_resolution_cache(text,text,integer,text,jsonb)` | Chỉ nhận kết quả đúng version; từ chối hạ nguồn ưu tiên còn hạn |

Bảng bật RLS. `anon`, `authenticated` và `service_role` không được đọc/ghi bảng
trực tiếp. Hai RPC dùng `SECURITY DEFINER`, cố định `search_path`, owner `postgres`,
chỉ cấp EXECUTE cho `service_role`. Browser không được gọi các RPC này bằng anon
key. Bảng `stream_resolutions` cũ và các bảng user, tracks, playlist không bị sửa,
xóa hay backfill. Code resolver mới ngừng dùng cache `stream_resolutions` cũ.

Không cần nâng Supabase SDK runtime. Dependency `@electric-sql/pglite` mới chỉ nằm
trong `devDependencies` để chạy kiểm thử PostgreSQL.

## Thay đổi vận hành

- Server cần `SUPABASE_SERVICE_ROLE_KEY` và `NEXT_PUBLIC_SUPABASE_URL`. Giữ service
  key ở môi trường server; không đổi thành biến có tiền tố `NEXT_PUBLIC_`.
- Mỗi request resolver kiểm tra version qua RPC trước khi dùng cache RAM. Vì vậy
  có thêm round trip Supabase cho request từng chỉ đọc RAM; DB cũng khóa row khi
  đọc/ghi nên request cùng một bài có thể chờ nhau.
- Hit lưu 30 ngày, miss lưu 1 giờ, thời hạn do đồng hồ DB quyết định. Cache RAM
  giữ tối đa 10 phút cho hit và 1 phút cho miss, vẫn xác minh với DB mỗi lần dùng.
- Thứ tự ưu tiên khi cùng version: Drive > NhacCuaTui > SoundCloud > YouTube >
  miss. Một request cũ không được ghi lại sau khi server khác invalidate.
- Khi thiếu migration/service key hoặc RPC lỗi: tiếp tục tìm nguồn phát mới,
  bỏ cache đã phối hợp và không ghi ngược vào bảng cũ. Playback vẫn hoạt động
  nhưng có thể chậm hơn, tăng lượt gọi provider và ghi cảnh báo server.
- Mỗi RPC có deadline 1.5 giây và gửi abort khi quá hạn; cache bị treo không được
  giữ request phát nhạc vô thời hạn. Timeout không đảm bảo transaction DB đã bị
  hủy, nên kiểm tra version trong SQL vẫn bảo vệ các ghi đến muộn.
- Version row được giữ sau khi payload hết hạn để tránh tái dùng version cũ.
  Số row tăng theo các tổ hợp tìm kiếm. Không chạy job TTL xóa row, `TRUNCATE`
  hay reset `generation` khi resolver đang hoạt động; cần thiết kế quy trình
  bảo trì riêng nếu số row lớn.

## Thứ tự triển khai

1. Chạy file migration bằng cơ chế migration hiện tại của project. Nếu dùng
   Supabase SQL Editor, mở đúng project và chạy toàn bộ file một lần bằng quyền
   `postgres`. Không chạy riêng phần thân hàm hoặc bỏ phần cấp/thu hồi quyền.
2. Xác nhận bảng và hai hàm mới xuất hiện. Migration gửi thông báo reload schema
   cho PostgREST; nếu API chưa thấy RPC, kiểm tra schema cache trước khi deploy.
3. Xác nhận service key đã được đặt ở server, sau đó deploy code resolver mới.
   Code cũ vẫn có thể dùng bảng cũ trong thời gian rollout; code mới dùng bảng mới.
4. Gọi `/api/resolve-stream?title=...&artist=...&duration=...`, gọi lại với
   `&invalidate=1`, rồi gọi bình thường. Xác nhận response `Cache-Control: no-store`,
   stream phát được và log không báo lỗi RPC/RLS.
5. Theo dõi thời gian resolver, lỗi RPC và số row cache mới. SQL test local không
   thay thế kiểm tra nhiều session/instance trên môi trường staging.

Có thể chạy lại migration để tạo/cấp quyền cho các đối tượng của migration này.
Nếu rollback code, giữ bảng/RPC mới trong thời gian các instance mới đang kết thúc
request. Code cũ dùng cache cũ; không cần xóa dữ liệu mới để rollback code.

## Kiểm tra trên điện thoại thật

Sau deploy, kiểm tra Safari iPhone và Chrome Android với stream thật:

1. Đổi bài A/B liên tục; chỉ B được phát và lyrics phải thuộc B.
2. Pause khi đang tải; URL tới sau không tự phát. Play lại phải tiếp tục được.
3. Khóa màn hình, Pause/Play từ điều khiển hệ điều hành; mở app lại gần cuối bài
   không được tự Play nếu đã Pause.
4. Repeat-one ít nhất ba vòng; seek gần cuối rồi đổi bài để phát hiện seek cũ.
5. Thử volume 0/0.5/1 và nút volume vật lý, rút tai nghe/Bluetooth nếu có.

Browser emulation kiểm tra code/UI và HTML audio, không kiểm chứng audio session,
lock screen hay giới hạn background của thiết bị thật.

Kiểm thử SQL local: `npm.cmd run test:playback-db`. Script dùng một worker và
compiler WASM ít bộ nhớ để tránh lỗi cấp phát trên Windows nhiều CPU; không thay
đổi flags hay cách chạy server production.

# Kiểm chứng phần playback còn lại

Ngày 2026-10-07, tiếp tục từ `7237692`, nhánh `fix/playback-reliability-recheck`.
User yêu cầu tiếp tục sửa, commit từng phần và báo các ảnh hưởng Supabase.
Kiểm chứng chuẩn bị deploy được tiếp tục ngày **2026-10-11**. User yêu cầu giữ
nguyên logic iOS; các lỗi trong audit iOS được hoãn, không đánh dấu đã sửa.

## Cache giữa nhiều server

Commit `f857515` tạo bảng/version chung và hai RPC. Test dùng hai module resolver
production tách biệt, gồm warm L1 trên B rồi invalidate trên A; kết quả in-flight
và NCT đến muộn của version cũ không được ghi; upgrade cùng version phải được B
quan sát. Hai case còn chạy xuyên production route/helper tới SQL migration thật
qua PGlite. SQL tests kiểm tra ưu tiên nguồn, miss/hit, TTL, bigint, quyền RPC/RLS
và chạy lại migration giữ nguyên dữ liệu legacy.

Review tái hiện thêm response retry đến trễ làm lùi observed version và tái dùng
in-flight cũ khi RPC outage. Regression đã thất bại trước sửa rồi pass sau sửa.
RPC read/write bị treo cũng được tái hiện; nay có deadline 1.5 giây, abort signal
và dọn timer. DB version guard vẫn xử lý ghi đến muộn sau timeout.

**Chưa migrate hoặc deploy Supabase thật.** Chi tiết schema, quyền, biến môi trường,
chi phí thêm round trip, retention version row và rollout nằm trong
[hướng dẫn Supabase](2026-10-07-supabase-playback-rollout.md). PGlite một connection
không mô phỏng contention của các session PostgreSQL độc lập; cần thử staging.

## Kiểm thử code

Suite deterministic và script SQL đều chạy lại ngày 2026-10-11, sau kiểm tra build.

- Deterministic suite: **89 file, 579 test pass**, exit 0.
- SQL/helper/production-route integration: **48 test pass**, exit 0.
- Resolver mock-transport regression: **19 test pass**, exit 0.
- TypeScript source và bộ file browser mới: pass với config scratch riêng.
- ESLint các helper/test/browser/config mới: pass. Resolver có một cảnh báo
  unused catch variable có sẵn; không có lint error trong bộ file cache mới.
- Diff whitespace check pass. Review độc lập đã xác nhận không còn blocker.

Lệnh full deterministic đã chạy (ba suite gọi provider thật bị chặn mạng vẫn
được giữ nguyên trong repository):

```powershell
$env:NODE_OPTIONS='--v8-pool-size=1'
node --liftoff-only --no-wasm-tier-up --wasm-num-compilation-tasks=1 node_modules/vitest/vitest.mjs run --exclude lib/__tests__/lyrics.test.ts --exclude lib/__tests__/soundcloud.test.ts --exclude lib/__tests__/supershy_check.test.ts --maxWorkers=1 --pool=forks --execArgv=--liftoff-only --execArgv=--no-wasm-tier-up --execArgv=--wasm-num-compilation-tasks=1
```

Chạy riêng SQL: `npm.cmd run test:playback-db`. Compiler WASM baseline và một
worker tránh lỗi thiếu bộ nhớ của Windows. Flags chỉ dùng khi kiểm thử.

Repo-wide lint và TypeScript theo generated `.next` hiện có còn có các lỗi
baseline đã ghi trong [audit trước](2026-10-07-playback-flow-audit.md). Kết quả
build sạch dưới đây được kiểm chứng riêng, không dựa vào các file generated đó.

## Build production ngày 2026-10-11

**`npm.cmd run build` pass, exit 0**, Next.js 16.2.12 với Turbopack mặc định.
Compile, TypeScript, thu thập page data và tạo **58 trang static** hoàn tất.
Không dùng `ignoreBuildErrors`, không đổi sang Webpack và không mock font.

Build chạy trên bản sao các file tracked hiện tại và bộ file browser mới tại
`scratch/deploy-verification-20261011`, dùng junction tới `node_modules` đã cài.
Không sao chép `.env` hoặc dữ liệu `test-results`, không thay đổi `.next` của
workspace chính. Next chọn workspace root `D:\MusicWeb` do có lockfile ở cả thư
mục gốc và bản sao; đây là cảnh báo của cấu trúc kiểm chứng local.

Lượt build sandbox đầu tiên thất bại khi tải Google Fonts. Lượt có mạng tiếp
theo compile/typecheck được nhưng thiếu Google OAuth. Lượt cuối thêm cấu hình
giả cho auth và Supabase đã hoàn tất. URL Supabase là `http://127.0.0.1:9`, anon
key/auth credentials là fixture và service-role key trống; không gọi DB thật.
Các giá trị giả chỉ dùng trong shell kiểm chứng, không được đặt lên hosting.

Hosting cần `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` hoặc
`AUTH_SECRET`, cùng cấu hình Supabase thật. Cache phối hợp cần thêm
`SUPABASE_SERVICE_ROLE_KEY` ở server. `.env.example` đã bổ sung các biến còn thiếu.
Chưa xác minh giá trị hoặc quyền truy cập của cấu hình hosting thật.

## Browser ngày 2026-10-11

Commit **`fbb5f13`** bổ sung fixture/config/spec. Lượt cuối **14 pass, 4 skip,
exit 0**, chạy lần lượt với một worker trên Playwright 1.63.0/Windows:

| Project | Pass | Skip | Phạm vi skip |
| --- | ---: | ---: | --- |
| Chromium desktop | 5 | 1 | Lyrics dành cho mobile |
| Chromium mobile (Pixel 7) | 5 | 1 | Đo slider volume desktop |
| WebKit 26.6 mobile (iPhone 13) | 4 | 2 | Volume desktop và MediaSession API không tồn tại trên browser này |

Không có unexpected failure hoặc flaky test. Case chạy thực gồm kết quả A đến
muộn không giành audio B, Pause trong khi resolve, repeat-one qua ba lần EOF,
lyrics cache B từ chối response A đến muộn và highlight theo thời gian audio.
Chromium còn kiểm tra Pause/Play qua handler MediaSession production và lifecycle
events giả lập. Không thay `audio.play()` hoặc tạo fake media playback.

Web Audio analyser đo RMS ở volume 1 là `0.2586698752`, volume 0.5 là
`0.1291252599`, tỷ lệ **0.4991894004**; `audio.volume` vẫn là 1. Đây là tín hiệu
audio native trong graph, không phải đo loa hoặc volume vật lý của điện thoại.
Ảnh thành công ở cả mobile project hiển thị bài B và dòng thứ ba của B đang
highlight. Server Next do test tạo đã dừng sau teardown.

```powershell
Remove-Item Env:PLAYBACK_RELIABILITY_RUN -ErrorAction SilentlyContinue
node node_modules/@playwright/test/cli.js test --config playback_reliability.config.ts
```

Report cuối: `scratch/playback-browser/latest/report.json`, bắt đầu
`2026-10-11T04:35:05.680Z`, duration 143.2 giây. Ảnh nằm trong thư mục results
của từng mobile project cùng tên `mobile-lyrics-success.png`; artifacts được
giữ local dưới scratch, không commit. WebKit cần browser binary đã cài; config
chỉ thêm project khi tìm được executable, vì vậy phải đối chiếu đủ ba project
trước khi so sánh với kết quả này.

## Cách ly browser và giới hạn thiết bị

Ở lượt browser thử nghiệm trước, một fetch từ worker đi ra ngoài `page.route`
và resolver local đã thử đọc Supabase thật. PostgREST trả `PGRST202` vì chưa có
RPC mới; không có RPC mới nào được thực thi, không migrate hoặc ghi cache mới.
Không kết luận rằng toàn bộ lượt đó không có request đọc dữ liệu thật.

Harness cuối chuyển sang `browserContext.route`, chặn service worker, chặn host
ngoài fixture và ghi đè cả URL Supabase public/server thành loopback với key giả,
service-role key trống. Audio fixture dùng HTTP server loopback riêng từng test,
hỗ trợ CORS/range và luôn dọn kết nối. WebKit không phát được WAV qua
`route.fulfill` ở lượt thử đầu nhưng probe HTTP native phát được WAV và MP3;
không quy lỗi này thành codec iOS không được hỗ trợ.

Probe lỗi launch/close WebKit đã được tái hiện: trước sửa còn server giữ process
treo; sau sửa cả hai đường lỗi đều thoát tự nhiên với status 1. Review độc lập
đã duyệt fixture, cách ly, cleanup và config Next.

Lượt WebKit native HTTP đầu tiên qua bốn case nhưng timeout khi chờ handler
Pause. Probe trên secure loopback xác nhận WebKit 26.6/Windows không có
`navigator.mediaSession` hoặc `setActionHandler`; đây là thiếu capability của
browser kiểm chứng. Test nay attach capability native và skip chỉ khi API không
tồn tại. Trên browser có API, handler production vẫn phải được đăng ký và hành
vi Pause/Play vẫn phải qua assertion. Không thêm handler giả để làm test pass.

WebKit trên Windows với emulation iPhone không xác minh audio session, khóa
màn hình hoặc suspension thực trên iPhone. Các lỗi iOS đã ghi riêng trong
[audit iOS](2026-10-07-ios-background-playback-audit.md) và đang hoãn theo yêu cầu.

## Bước triển khai còn lại

Chưa push, deploy hoặc chạy migration trên Supabase thật. Áp dụng migration và
kiểm tra RPC/quyền server theo [hướng dẫn rollout](2026-10-07-supabase-playback-rollout.md)
trước khi deploy resolver mới. Sau deploy cần smoke test stream thật và nhiều
instance/session DB; test local không xác nhận các bước vận hành này.

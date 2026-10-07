# Kiểm tra lại playback sau pull — desktop và mobile

Ngày kiểm tra: 2026-10-07. Bản audit đầu dựa trên `ca59264`; sau khi người dùng
pull, baseline chuyển sang `825184a`. Báo cáo này thay thế kết luận cũ.
Nhánh sửa: `fix/playback-reliability-recheck`.

## Kết quả đối chiếu

Bản vừa pull đã sửa đồng bộ queue và TTL URL ở đường phát nhanh; đã gọi
`prewarmTrackBatch` lúc playback bắt đầu. Vì vậy không áp dụng lại các sửa cũ
cho những phần này và không còn coi batch prewarm là hàm vô dụng.

Các lỗi còn lại được tái hiện bằng callback/module production, deferred promises,
storage giả lập và HTTP loopback. Những test này không thay cho thử nghiệm trên
iPhone/Android thật.

| Mã audit cũ | Sau pull | Xử lý trong nhánh này |
| --- | --- | --- |
| B01: tác vụ A sửa hoặc Pause bài B | Còn lỗi | Guard request/track sau await; callback play cũ không Pause audio của chủ mới; fallback/retry không ghi state/source sau khi mất quyền |
| B02: Pause khi đang resolve/recover | Đã sửa đường chính, còn đường recovery | Giữ ý định Pause ở fallback, retry, iframe watchdog và play rejection |
| B03: OS Pause rồi tự phát khi foreground | Đã sửa intent nhưng còn pending resume | Pause/Stop hủy pending resume, pending iframe và timers; completion OS Play không ghi đè Pause đến sau |
| B04: NCT stream bị cắt | Timer headers đã sửa, body error vẫn thành EOF thường | Propagate body error tới downstream, hủy reader và dọn listener; slow body không bị timeout headers cắt |
| B05: request cũ phục hồi cache đã invalidated | Còn lỗi | Fence client persistence và server L1/L2 theo generation; serialize DB writes/deletes trong cùng process; xem giới hạn nhiều instance bên dưới |
| B06: repeat-one chỉ lặp một lần | Còn lỗi | Reset completion guard khi bắt đầu vòng tiếp theo, kể cả Pause khi replay đang pending rồi Resume |
| B07: xóa bài hiện tại làm queue trùng | Đã sửa trong pull | Giữ `commitQueue` và merge theo ID trên queue mới nhất |
| B08: cache URL bỏ qua TTL | Đã sửa trong pull | Giữ `readFreshAudioUrl` ở cả đường chính và quick-play |
| B09: seek A trong lúc resolve áp sang B | Còn lỗi | Xóa pending seek khi bắt đầu request mới |
| B10: lyrics/romaji A ghi đè cached B trên mobile | Còn lỗi | Invalidate trước mọi cache/empty branch và lúc cleanup; kết quả đến muộn không sửa lyrics/loading của bài mới |
| B11: foreground ở gần EOF tự chuyển bài đang Pause | Còn lỗi | Completion và foreground reconciliation kiểm tra ý định playback |
| B12: cùng tên bài nhưng sai nghệ sĩ | Còn lỗi | NCT/YouTube/SoundCloud yêu cầu bằng chứng tên nghệ sĩ; giữ credit trong title, featured artists, Unicode và tên AC/DC |
| B13: Heartbeat bị loại vì chứa beat | Còn lỗi | Match marker theo từ/cụm từ; kiểm tra title gốc và giữ đúng biến thể được yêu cầu |
| B14: đổi host nhưng cùng path vẫn giữ src cũ | Còn lỗi | So sánh origin cùng pathname/search |
| B15: media volume và gain cùng giảm âm lượng | Còn lỗi | Khi gain đã kết nối, media volume là 1; áp volume qua gain và giữ mute đồng bộ; setup gain ở đường bắt đầu phát |
| B16: eviction vẫn ghi payload quá lớn | Còn lỗi | Trim snapshot đang ghi, đo UTF-8, giữ selected track/index trong cửa sổ queue; retry khi browser quota nhỏ hơn giới hạn |

## Lỗi mới trong bản pull và lỗi bổ sung

- Priority race chờ SoundCloud tuần tự sau cửa sổ NCT dù YouTube đã có kết quả.
  Đã sửa để ưu tiên fallback đã sẵn sàng theo thứ tự, rồi nhận kết quả hợp lệ
  đầu tiên từ những tác vụ còn lại, kể cả NCT.
- Late NCT promotion chạy trước khi có fallback winner và sau đó bị winner ghi
  đè. Đã chỉ promotion sau fallback thắng và publish winner trước upgrade.
- Supabase upsert builder là PromiseLike, không có `.catch()`. Đã await builder
  bên trong mutation queue; test có builder thực với fetch giả lập.
- HTTP cache có thể trả lại cùng response `invalidate=1`, khiến lỗi lần sau
  không thực sự invalidation trên server. Resolver/invalidation requests và
  responses dùng `no-store`; cache client, L1/L2 vẫn hoạt động.
- Lyrics cache ở cả primary flow và LRCLIB giữ null/error vô hạn và thiếu metadata
  trong key. Đã không cache miss, thêm album/duration/video identity và giới hạn
  200 successful entries mỗi cache. Các request cùng key vẫn được deduplicate.
- Iframe buffering event đến sau Pause tạo timer gọi playVideo; iframe error
  recovery cũng loadVideo sau Pause. Đã guard intent trước timer và sau await;
  bỏ lựa chọn candidates[0] khi matcher đã từ chối toàn bộ.
- NCT retry polling có thể tiếp tục sau timeout. Đã thêm deadline và điều kiện
  Pause để kết thúc polling.

## Code không chạy đã dọn

- Bỏ fullscreen legacy trong PlayerBar: flag luôn false và mọi setter đều ghi false.
  Mobile full player thực tế vẫn được mount qua NowPlayingOverlay.
- Bỏ state iOS/drag và giá trị sheet không dùng trong MobileFullviewPlayer,
  giữ nguyên gesture refs/handlers đang điều khiển DOM.
- Bỏ mobileTab không dùng trong NowPlayingOverlay.
- Bỏ import getTrackResolution/savePlaybackState/loadPlaybackState không dùng
  trong PlayerContext; không xóa public API còn được module khác dùng.
- Bỏ fetchNctSong không có caller và normalizer import liên quan trong resolver.
- Bỏ QUEUE_MAX_ENTRIES không được thực thi và circuit-breaker branch không thể
  tới do guard fallback phía trên; mutex fallback được giải phóng trong finally.

Overlay đóng có `inert`/`aria-hidden`; thêm tên truy cập cho các nút mobile.
Progress/volume slider semantics, focus management khi mở overlay và refactor
engine API vẫn là cải thiện tiếp theo, chưa nằm trong các sửa này.

## Các điểm chính để review code

- Ownership và intent: [PlayerContext](../../components/player/PlayerContext.tsx),
  [production callback tests](../../components/player/__tests__/playbackOwnership.test.ts).
- Mobile: [MobileFullviewPlayer](../../components/player/MobileFullviewPlayer.tsx),
  [mobile ownership tests](../../components/player/__tests__/mobileLyricsOwnership.test.ts).
- Cache server: [resolve route](../../app/api/resolve-stream/route.ts),
  [server ownership tests](../../app/api/resolve-stream/__tests__/cacheOwnership.test.ts).
- Race: [helper](../../lib/catalogResolutionRace.ts),
  [tests](../../lib/__tests__/catalogResolutionRace.test.ts).
- Transport: [NCT route](../../app/api/nhaccuatui/stream/route.ts),
  [loopback tests](../../app/api/nhaccuatui/__tests__/streamTransport.test.ts).
- Identity: [catalogMatching](../../lib/catalogMatching.ts),
  [provider tests](../../lib/__tests__/playbackMatchingReliability.test.ts).
- Storage: [playbackPersistence](../../lib/playbackPersistence.ts),
  [boundary tests](../../lib/__tests__/playbackPersistence.test.ts).

## Kiểm chứng

- Suite deterministic cuối: **87 file, 521 test pass**, exit 0.

  `npm.cmd run test -- --exclude lib/__tests__/lyrics.test.ts --exclude lib/__tests__/soundcloud.test.ts --exclude lib/__tests__/supershy_check.test.ts`

- Full suite đã chạy: sáu case gọi LRCLIB/YouTube/SoundCloud thật thất bại vì
  mạng sandbox bị chặn (`EACCES`). Ba file trên chứa các case đó; không sửa hay
  vô hiệu hóa chúng trong repository.
- Source TypeScript check pass, exit 0. Dùng config tạm trong scratch, include
  app/components/hooks/lib/types và exclude generated .next, workers, docs.
  `tsc` theo config repository vẫn bị lỗi cú pháp có sẵn trong
  `.next/dev/types/routes.d.ts` và `validator.ts`.
- Full lint vẫn thất bại bởi lỗi có sẵn trong repository và các worktree/skill
  files. So sánh baseline PlayerContext: 29 errors/34 warnings; hiện tại
  29 errors/32 warnings. Lỗi component mobile giảm từ 9 xuống 6; năm lỗi
  no-explicit-any trong YouTube có sẵn. Helper và test mới lint pass.
- `git diff --check` pass. Review độc lập các nhóm mobile, matching/storage,
  stream và PlayerContext; đã sửa các case được reviewer tái hiện thêm.
- Chưa chạy browser E2E, đo âm lượng thực hoặc thử lock-screen/background trên
  thiết bị thật. Gesture code được giữ nguyên nhưng chưa kiểm tra bằng thao tác thực.

## Giới hạn còn lại và hướng cải thiện

**B05 chưa giải quyết hoàn toàn giữa nhiều server instance.** Generation và
mutation queue bảo vệ cùng một process. Hai instance vẫn có thể ghi cùng row L2
theo thứ tự khác nhau. Cần generation/version lưu trong DB và conditional upsert
hoặc RPC/transaction để xử lý phân tán; nhánh này không deploy hay migrate DB.

Matcher chủ động từ chối metadata không có bằng chứng đủ tên nghệ sĩ. Alias/channel
không mang tên nghệ sĩ có thể giảm số match; nên bổ sung alias bằng dữ liệu xác thực,
thay vì mở lại đường chấp nhận chỉ vì cùng title/duration.

Bước kiểm chứng trên thiết bị thật nên bao gồm đổi A/B nhanh, Pause trong lúc
buffering, OS Pause/Play khi khóa màn hình, foreground lúc gần EOF, repeat-one
nhiều vòng và volume 0/0.5/1. Những case này kiểm tra audio session của hệ điều hành,
không được mô phỏng đầy đủ bằng VM.

Sau đó nên tách controller playback ra khỏi PlayerContext lớn để mount/test
integration với media adapter; chuyển dần các test đang mô phỏng lại handler sang
test gọi production như các regression mới.

## Commit từng phần

| Commit | Nội dung |
| --- | --- |
| `cf18bfe` | Matching nghệ sĩ/biến thể, source origin và giới hạn storage |
| `5dd9fb2` | Lyrics mobile, retry miss và dọn overlay không chạy |
| `7ab01a8` | Playback ownership, Pause/Resume, repeat/seek và gain |
| `aca4194` | Priority race, cache invalidation/HTTP cache và NCT transport |

Giữ nguyên các thay đổi có sẵn của người dùng trong test-results và
`tests/e2e/search_flow.spec.ts`. Không push, deploy hay thay đổi dịch vụ ngoài.

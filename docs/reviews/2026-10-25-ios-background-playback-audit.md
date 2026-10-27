# Review phát nền iOS sau df35989

Review tại HEAD `df35989f30d51ed7e05e94c740bbb6f6cd118222`, ngày 2026-10-25.
Không sửa implementation player trong đợt review này.

**Kết luận:** còn một thay đổi mới có nguy cơ bị chính sách autoplay chặn ở
phiên phát đầu tiên, một lỗi xử lý lệnh Play sau khi bị chặn, và đường fallback
vẫn có thể mất native HTML audio. Chưa đủ bằng chứng kết luận phát nền iOS ổn
định. Không kết luận mọi phiên bản iOS đều bị lỗi.

## Phạm vi commit

| Commit | Phần liên quan |
| --- | --- |
| `df35989` | Tìm nguồn catalog cho YouTube trên iOS, fallback HTML5, đăng ký lại MediaSession khi resume, thêm load() khi stop |
| `8274d8e` | Bỏ Web Audio trên iOS, giữ HTML audio khi chuyển bài nền, cache URL cho bài tiếp theo |
| `e627906` | Ưu tiên fallback HTML5 và khôi phục playback khi bị pause ở nền |
| `487c6d7` | Thay đổi engine, khôi phục và chuyển bài trước đợt tách player thành controller/runtime |
| `1bf469a` | Manifest, viewport và service worker hai cache |

Đã lần theo runtime hiện tại sau các commit tách controller/runtime
`8f40fa9` và `c954778`; các vị trí trong báo cáo ngày 2026-10-07 không còn dùng
nguyên số dòng cũ.

## F01 — P1: phát YouTube lần đầu có thể mất user gesture

**Thay đổi mới trong `df35989`.**

Vị trí: `lib/playback/playbackSourceService.ts:624`, `:725`;
`lib/playback/playbackController.ts:1328`, `:1345`;
`components/track/TrackList.tsx:317`.

Ở phiên mới, chọn bài YouTube chưa có cache từ kết quả tìm kiếm đi qua
`playSearchTrack` → `playTrack`. Controller truyền `preserveGesture: false`.
Nhánh mới của `resolveImmediate` trả null khi foreground chưa có cache, khiến
controller dừng transport rồi chờ `resolvePlayable`. Resolver chờ tìm nguồn
catalog hoặc deadline 1800 ms trước khi gọi native `audio.play()`.

Không có bước phát/unlock HTML audio ngay trong thao tác chọn bài này. Trên
thiết bị vẫn yêu cầu user gesture cho audio element, lời gọi sau network/timer
có thể bị `NotAllowedError`. Việc gọi tên option là `preserveGesture` không
truyền quyền user activation qua request mạng. Đường Next dùng quick-play
không có nghĩa đường chọn bài từ danh sách cũng dùng quick-play.

**Bằng chứng:** cùng controller, transport và engine production, thay resolver
trước/sau commit. Resolver trước gọi native play một lần ngay trước khi hàm
chọn bài trả về. Resolver mới chưa gọi lần nào; chỉ gọi sau khi promise catalog
hoàn thành. Với media giả lập yêu cầu gesture trực tiếp, bản trước phát được,
bản mới bị từ chối và UI về paused, không có playbackError.

Đây là bằng chứng về thứ tự gọi code và cách xử lý rejection, chưa phải test
chính sách autoplay trên iPhone thật. Phiên đã unlock audio hoặc được trình
duyệt cho phép autoplay có thể không gặp triệu chứng.

Hướng xử lý: giữ đường gọi native play ngay trong thao tác đầu tiên nếu đã có
endpoint stream dùng được; hoặc chuẩn bị nguồn trước khi cho chọn phát. Nếu
phải chờ nguồn, cần cung cấp thao tác Play rõ ràng và xử lý trường hợp bị chặn.

Căn cứ nền tảng: [chính sách media của WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/)
và [kiểm tra user gesture trong MediaElementSession](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/MediaElementSession.cpp).
Không suy từ mã nguồn main rằng mọi bản Safari đã phát hành dùng cùng hành vi.

## F02 — P2: Play màn hình khóa bị hiểu thành Pause sau NotAllowedError

**Lỗi còn tồn tại trong luồng hiện tại, không phải toàn bộ mới do `df35989`.**

Vị trí: `lib/playback/playbackController.ts:367`, `:1765`;
`components/player/runtime/mediaSessionBinding.ts:67`.

Khi native play trả `NotAllowedError`, controller đặt `pendingResume=true`,
`isPlaying=false`, nhưng vẫn giữ desired state là playing. Handler MediaSession
nhận Play thấy UI paused nên gọi `togglePlay`. Toggle xét cả desired state,
coi phiên này đang active và thực hiện nhánh Pause thay vì thử resume.

**Bằng chứng:** sau một native play bị từ chối giả lập, gọi handler MediaSession
Play production: số lần native play vẫn là 1 và native pause tăng lên 1. Gọi
Play lần thứ hai mới thử native play lần thứ hai và phát được trong harness.
Đường lệnh hệ điều hành này không đi qua pointerdown của trang để tự recovery.

Hướng xử lý: lệnh OS Play/Pause nên có hành vi đặt trạng thái cụ thể, không dùng
toggle dựa trên trạng thái mong muốn đã cũ; đồng bộ xử lý pending resume.

## F03 — P1: fallback vẫn chọn YouTube iframe và tháo native audio ở nền

**Lỗ hổng còn lại sau thay đổi mới; fallback iframe đã có từ trước.**

Vị trí: `lib/playback/playbackController.ts:881`, `:1421`, `:1566`;
`components/player/adapters/browserTransport.ts:99`;
`components/player/engines/Html5AudioEngine.ts:45`.

Sau lỗi YouTube proxy, commit mới thử tìm nguồn HTML5 thay thế. Nếu không có
nguồn dùng được, code vẫn chọn `engine: 'youtube'` kể cả đang hidden.
Transport gọi `html5.stop()`, xóa src và load lại audio element. Phiên này lúc
đó phụ thuộc iframe YouTube, không còn native audio stream để tiếp tục phát nền.

**Bằng chứng:** với `tabHidden=true`, native play lỗi proxy và catalog không có
nguồn thay thế, code production gọi loadVideoById của iframe và unload HTML
audio. Nếu iframe giữ trạng thái paused, controller vẫn tạm đặt
`isPlaying=true` vì `YouTubeIframeEngine.loadAndPlay()` hoàn thành sau khi gửi
lệnh, không đợi xác nhận PLAYING. Probe không chứng minh YouTube luôn pause
trên iPhone; nó chứng minh code vẫn chọn iframe và có thể báo phát khi chưa phát.

Hướng xử lý: quy định fallback phù hợp với yêu cầu phát nền iOS; khi không còn
nguồn HTML5 thì hiển thị đúng trạng thái không thể tiếp tục. Xác nhận trạng thái
phát thật của iframe trước khi báo thành công nếu vẫn sử dụng engine này.

## Hạn chế của prewarm, worker và PWA

- `playbackSourceService.ts:1310`: prewarm cho bài YouTube trực tiếp trên iOS chỉ
  cache chuỗi `/api/youtube/stream?...`, chưa tìm nguồn catalog thay thế hoặc
  gọi endpoint để làm nóng upstream. `prewarmNearEnd` tại `:1470` chủ động bỏ
  HEAD YouTube. `lib/prewarmTrackBatch.ts` chỉ xử lý NCT và Drive. Vì thế
  quick-play đồng bộ khi Next không chứng minh stream kế tiếp đã sẵn sàng.
  Probe xác nhận số lần tìm catalog bằng 0 trong nhánh prewarm này.
- `lib/youtubeStream.ts:146`: yt-dlp vẫn chạy trước các phương án khác và có
  timeout 25 giây; việc giảm timeout ytdl-core trong commit mới không giới hạn
  toàn bộ cold resolution xuống 3,5 giây. Đây là độ trễ upstream, không phải
  bằng chứng iOS từ chối quyền phát.
- `browserLifecycle.ts:85` gửi KEEP_ALIVE mỗi 20 giây nhưng không gửi MessagePort;
  `public/sw.js:168` chỉ ACK khi có port. Không có cơ chế tại đây bảo đảm giữ JS
  hoặc audio session khi iOS suspend trang. Service worker có lifetime theo
  event theo [đặc tả W3C](https://www.w3.org/TR/service-workers/#service-worker-lifetime).
- Manifest, safe area và cài Home Screen cải thiện trải nghiệm PWA; chúng không
  tự cấp quyền autoplay hoặc bảo đảm thực thi JavaScript liên tục dưới nền.
  Service worker hiện chỉ can thiệp audio `/api/drive-stream`, không cache audio
  YouTube/SoundCloud qua các API tương ứng.
- Hành vi phụ thuộc phiên bản Safari/iOS. [Release notes Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)
  ghi nhận một bản sửa chuyển item playlist khi tab ở nền. Không dùng các bug
  WebKit cũ đã FIXED làm bằng chứng mọi bản iOS hiện tại vẫn lỗi.

Thay đổi bỏ nối HTML audio qua AudioContext trên iOS trong `8274d8e` phù hợp với
mục tiêu dùng native media pipeline. Trong phạm vi review này chưa thấy thay
đổi safe-area/theme trực tiếp ép audio pause khi hidden.

## Kiểm chứng và giới hạn

- 7 file test có sẵn: **78/78 pass**. Gồm source service, controller, ownership,
  transport, MediaSession và runtime lifecycle. Đây không phải toàn bộ test suite.
- 5 probe audit: **5/5 pass**, xác nhận các hành vi nêu trên. Pass nghĩa là tái
  hiện đúng hành vi đang review, không có nghĩa lỗi playback đã được sửa.
- Probe import controller, source service, browser transport, HTML5 engine và
  MediaSession production; chỉ dependency mạng và media/hardware là giả lập.
- Không chạy iPhone thật, không khóa màn hình thiết bị thật, không xác nhận
  upstream stream hoặc production deployment đang phát thành công/thất bại.
- Không sửa player, service worker hay API; chỉ thêm báo cáo và artifact audit
  trong scratch. Không commit hoặc deploy.

Lệnh chạy probe (artifact local trong scratch):

```powershell
node node_modules/vitest/vitest.mjs run --config scratch/ios-background-review-2026-10-25.config.mts --reporter=verbose
```

Thứ tự xử lý đề xuất: F01 và F02 trước, sau đó F03 cùng prewarm nguồn thực tế.
Cuối cùng thử Safari và PWA trên iPhone: phiên mới chọn bài từ tìm kiếm, khóa
màn hình ngay lúc resolve, chuyển bài cache hit/miss, OS Pause/Play, và phục hồi
sau cuộc gọi. Ghi rõ phiên bản iOS và nguồn stream cho từng tình huống.

# Kiểm tra phát nền iOS

Kiểm tra ngày 2026-10-07 trên code hiện tại sau `f857515`. User yêu cầu đánh giá
phát nền iOS trước khi tiếp tục sửa. Đợt kiểm tra này chưa sửa logic player.

**Kết luận:** còn lỗi trong đường khôi phục audio và điều kiện kết thúc bài;
chưa đủ căn cứ khẳng định phát nền/lock screen iPhone đã ổn định. Những lỗi logic
dưới đây được tái hiện bằng callback production với media/context giả lập. Đây
không phải bằng chứng rằng tất cả iPhone/iOS hiện tại đều gặp triệu chứng đó.

## I01 — High: bỏ qua AudioContext interrupted

Vị trí: `components/player/PlayerContext.tsx:471`, `:3618`, `:3717`, `:3893`.

`ensureWebAudioGain` nối mọi HTML audio qua `MediaElementAudioSourceNode` và
GainNode, gồm iOS. Nhưng helper, foreground và user activation chỉ resume khi
state là `suspended`. Khi Safari trả state `interrupted`, cả ba đường đều bỏ qua.

Probe thực thi callback production: context `interrupted`, audio đang paused,
intent `playing`; foreground hoặc activation gọi `audio.play()` một lần, ghi
`isPlaying=true`, nhưng **không gọi context.resume() lần nào**. UI có thể báo phát
khi graph audio chưa chạy. Không có listener `AudioContext.statechange` hoặc
kiểm tra clock của context để phát hiện graph ngừng chạy.

[WebKit bug 276016](https://bugs.webkit.org/show_bug.cgi?id=276016) ghi nhận
trạng thái interrupted và các trường hợp context vẫn báo running nhưng clock
không tiến trên những phiên bản iOS trước. Báo cáo đó là căn cứ cho tình huống
cần xử lý, không chứng minh phiên bản iOS trên máy người dùng đang bị lỗi WebKit.

Hướng sửa: ưu tiên HTML audio không đi qua Web Audio trên iOS nếu không cần
software volume; hoặc xử lý interrupted và statechange khi intent đang playing,
đợi recovery có giới hạn, kiểm tra trạng thái thực trước khi báo đang phát.
Giữ nguyên intent Pause. Cần A/B trên iPhone với graph bật/tắt vì chỉ thêm resume
không đảm bảo khắc phục mọi dạng graph bị đứng.

## I02 — High: YouTube restore chọn iframe trên iOS

Vị trí: `components/player/PlayerContext.tsx:317`, `:1463`, `:1819`, `:2550`.

Reload sau khi phát YouTube: mode HTML5 mặc định false. Restore và iframe onReady
cue bài đã lưu mà không xét iOS. Khi iframe đã cued/paused, nút Play đi thẳng vào
`playVideo()` và return; không chuyển sang proxy HTML5. Probe callback production
với state restored/cued: iframe được Play một lần, HTML5 source rỗng,
ytHtml5Mode=false nhưng isPlaying=true. Đây là lỗi engine có thể làm mất phát nền
ở đường resume sau reload, dù Play bài mới qua đường chính dùng HTML5.

Hướng sửa: restore chỉ chuẩn bị engine phù hợp platform; mọi đường Play/OS Play
sử dụng cùng quyết định engine, giữ đúng vị trí đã lưu và không autoplay khi restore.

## I03 — Medium: một dạng YouTube metadata chọn iframe trên iOS

Vị trí: `lib/trackSourceClassifier.ts:63`,
`components/player/PlayerContext.tsx:834`, `:844`, `:2366`.

Track có `source='youtube'`, `file_path` là video ID 11 ký tự hợp lệ, nhưng thiếu
`youtube_id` và `id` không có prefix `yt-`: normalizer không lấy ID trần, trong
khi classifier/extractor lại nhận được ID. `getAudioUrl` chỉ dùng proxy iOS nếu
có `track.youtube_id`, nên trả null. Nhánh sau lấy ID từ file_path rồi chọn
iframe, đặt `ytHtml5ModeRef=false`. Engine thực tế khác engine HTML5 mà classifier
đã chọn cho iOS; bài có thể mất khả năng phát khi khóa màn hình/chuyển app.

Hướng sửa: dùng chung `extractYouTubeVideoId` khi chuẩn hóa và chọn engine. Thêm
regression cho metadata legacy này, tránh suy luận engine riêng ở nhiều nhánh.

## I04 — Medium: foreground có thể bỏ qua phần cuối bài chưa ended

Vị trí: `components/player/PlayerContext.tsx:3603`, `:3756`.

Khi còn <=1 giây, foreground/heartbeat coi bài đã kết thúc mà không yêu cầu
native `ended` hay chứng cứ playback bị đứng. Probe: audio duration=180,
currentTime=179.2, paused=true, ended=false, intent playing. Foreground gọi
completion một lần và return, **không thử resume**. Một interruption gần cuối
bài có thể thành chuyển bài/repeat sớm và ghi completed.

Hướng sửa: dùng ended làm nguồn chính; watchdog chỉ suy luận EOF sau khi đo
không tiến triển trong khoảng đủ dài và kiểm tra ownership/intent/engine. Tách
khôi phục interruption khỏi kết thúc bài. Những nhánh waiting/stalled gần EOF
cũng cần cùng điều kiện để tránh cắt phần cuối.

## I05 — Medium: repeat-one nuốt lỗi autoplay và không đánh dấu chờ resume

Vị trí: `components/player/PlayerContext.tsx:3026`.

Nhánh repeat-one gọi `playOwnedAudio(...).catch(() => {})`. Khi trả
`NotAllowedError`, completion guard vẫn giữ bài đã handled nhưng pendingResume
không được bật. Probe sau reject và user activation: pendingResume=false,
completionHandled=true, chỉ có một lần play được thử. Chạm để khôi phục không
chạy vì handler yêu cầu pendingResume. Nút Play/MediaSession Play riêng có thể
khôi phục, nhưng cơ chế tự recovery khác với đường playTrack chính.

Hướng sửa: xử lý rejection theo request/intent; NotAllowedError chuyển sang chờ
activation, UI paused và không buffering vô hạn; lỗi stream xử lý riêng. Guard
repeat phải được reset khi lần phát lại thật sự thành công.

## Cơ chế không bảo đảm phát nền

`PlayerContext.tsx:1918` ping KEEP_ALIVE mỗi 20 giây; `public/sw.js:84` chỉ trả
ACK nếu có MessagePort, nhưng caller không gửi port. Không có pending work hay
waitUntil kéo dài lifetime. Không nên xem ping này là bảo đảm Safari giữ audio
hay JavaScript khi khóa màn hình. Service worker có lifetime theo event và có
thể bị dừng sau khi hết việc theo [đặc tả W3C](https://www.w3.org/TR/service-workers/#service-worker-lifetime).

Cold next-track hiện vẫn đi qua `playTrack`, dừng engine/xóa src ở `:1958` rồi có
thể chờ resolve. Prewarm/quick-play giảm đường này nhưng không bao phủ mọi cache
miss, shuffle, URL hết hạn hay queue mới. Cần thử chuyển bài khi đã khóa màn hình;
đây là rủi ro cần kiểm chứng thiết bị, chưa kết luận tất cả đường async bị chặn.

## Bằng chứng và phạm vi kiểm tra

- Probe callback production: `node scratch/ios-background-audit.cjs` (artifact
  local, ignored). Xác nhận cả năm nhóm; không thay implementation bằng mô hình
  khác. Context state và rejection do probe cung cấp để tái hiện nhánh lỗi.
- Bộ regression hiện có: 4 file/33 test pass. Các test cũ chưa bao phủ interrupted,
  pause do interruption gần EOF và repeat-one bị NotAllowedError. Pass không đồng
  nghĩa background iOS đã pass.
- Probe WebKit Windows ban đầu với route-fulfilled/data URI không chạy audio.
  Probe HTTP local thật sau đó phát được WAV và MP3. Lỗi harness trước đó không
  được dùng làm kết luận rằng iOS/WebKit không hỗ trợ audio.
- Chưa dùng iPhone thật. Windows WebKit với iPhone user agent không mô phỏng audio
  session hay suspend/lock screen của iOS.
- Không có thay đổi Supabase/migration nào trong việc audit iOS này. Migration
  cache đã commit trước đó vẫn chưa áp dụng lên database thật.

Thứ tự sửa đề xuất: I01 + engine iOS I02/I03, rồi I04/I05; sau đó thử khóa màn hình
và chuyển app nhiều vòng, OS Pause/Play, cuộc gọi/rút tai nghe, next-track cache
hit/miss, repeat-one và Safari/PWA trên iPhone thật. Ghi cả phiên bản iOS và nguồn
nhạc vì hành vi phụ thuộc audio session và codec/transport thực tế.

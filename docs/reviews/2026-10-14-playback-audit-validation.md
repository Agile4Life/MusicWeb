# Kiểm chứng báo cáo playback, fallback và matching

Ngày: 2026-10-14. Phạm vi: rà soát báo cáo người dùng cung cấp, đối chiếu code hiện tại và chạy kiểm chứng cục bộ. Không triển khai thay đổi vào source code trong lượt rà soát này.

## Kết luận

Báo cáo xác định được nhiều lỗi thật, đặc biệt là Drive nhận sai nghệ sĩ, fallback bỏ qua matching, mất ký tự Unicode và xóa sót YouTube ID trong cache. Một số đề xuất cần điều chỉnh để tránh làm mất thông tin phiên bản, giảm khả năng phục hồi lỗi mạng hoặc tạo vòng lặp chuyển bài lỗi.

Ưu tiên sửa tính đúng đắn của matching và danh tính cache trước; sau đó xác thực nguồn phát, khôi phục có giới hạn và tối ưu prewarm. Các con số giảm 3–5 giây hoặc phát/chuyển bài ở 0ms chưa có phép đo production để xác nhận.

## Bằng chứng đã chạy

Chạy trực tiếp các module TypeScript hiện tại bằng transpilation CommonJS, với input giả lập; thao tác cache dùng localStorage trong bộ nhớ và fetch giả lập, không gọi tài khoản/provider thực.

| Kiểm tra | Kết quả thực tế |
|---|---|
| Drive: `Baby`, nghệ sĩ `Justin Bieber` | Trả track nghệ sĩ `MCK`. |
| NCT: target `Love Story`, nghệ sĩ `Taylor Swift`, 240 giây; chỉ có candidate `Blank Space` cùng nghệ sĩ/thời lượng | Nhận candidate sai tên. |
| YouTube: candidate đúng tên `Love Story` và candidate `Love Is Here` từ `Taylor Swift - Topic`, cùng thời lượng | Candidate sai tên từ Topic thắng. |
| NCT normalize `Đen`, `Đom Đóm` | Trả `en`, `om om`. |
| NCT normalize tên tiếng Trung `阿斯嘉` và tiếng Hàn `방탄소년단` | Trả chuỗi rỗng. |
| SoundCloud: target `Anh Da Quen Voi Co Don`, candidate `Anh`, cùng nghệ sĩ/thời lượng | Được chấp nhận. |
| Server cache key: `Hello` và `Hello (Remix)`, cùng nghệ sĩ/thời lượng | Tạo cùng khóa. |
| Lưu YouTube ID ở key 4 phần và key 3 phần rồi gọi `invalidateStreamResolution` | Key 4 phần bị xóa; `getCachedYouTubeId` vẫn trả ID cũ từ key 3 phần. |

Bộ kiểm thử liên quan hiện có: **9 file, 107 test đều qua**. Bao gồm NCT, matching đa nguồn, SoundCloud identity, Unicode YouTube, normalize key, client/server cache ownership, priority race và playback ownership. Các ví dụ lỗi bổ sung trên chưa được bộ kiểm thử hiện có bao phủ; kết quả test qua không chứng minh các lỗi này không tồn tại.

## Đối chiếu từng mục của báo cáo

| Mục | Kết luận kiểm chứng | Phương án nên dùng |
|---|---|---|
| 2.1 — Drive nhận sai MCK | **Xác nhận bằng runtime.** Tất cả 30 entry hiện tại mang nghệ sĩ MCK nên `tArtist.includes('mck')` làm điều kiện nghệ sĩ luôn đúng ở nhánh fuzzy. | Sửa cả hai điều kiện đặc cách MCK, dùng danh tính nghệ sĩ/alias đã xác nhận. Áp dụng ranh giới từ, kiểm tra phiên bản và thời lượng cho cả static Drive và DB lookup. Chỉ xóa một vế chưa đủ khắc phục toàn bộ lỗi identity. |
| 2.2 — NCT mất Đ/đ và non-Latin | **Xác nhận bằng runtime.** Regex ASCII loại các ký tự này. Riêng `en` có độ dài 2 nên mô tả nó bị loại do `< 2` trong báo cáo không chính xác. | Fold Đ/đ và giữ chữ/số Unicode; đồng bộ quy tắc normalizer với identity matcher. Không hứa matching được tên romanized và tên gốc nếu chưa có dữ liệu alias. |
| 2.3 — Emergency/NCT fallback bỏ matching | **Xác nhận trong code.** Emergency chọn `[0]` của NCT/YouTube/SoundCloud; nhánh NCT thay thế chỉ kiểm tra ID khác. | Mọi nhánh phải dùng cùng điều kiện tên bài, nghệ sĩ, phiên bản và thời lượng. Không nới các điều kiện identity chỉ vì resolver trước đó trả miss. |
| 2.4 — SoundCloud reverse phrase và `.find()` | **Xác nhận bằng runtime/code.** Candidate ngắn `Anh` được nhận cho target dài. | Chặn partial title không đủ bằng chứng trước, rồi xếp hạng các candidate hợp lệ. Ngưỡng 60% trong báo cáo là đề xuất cần hiệu chỉnh bằng tập bài kiểm chứng, không phải ngưỡng đã được xác nhận. |
| 2.5 — Substring token/hậu tố/variant | **Substring là lỗi thật; hướng xóa hậu tố cần sửa.** `Radio Edit`, `Single Version`, live và remix có thể xác định bản thu người dùng muốn. `piano version` đã có trong danh sách marker hiện tại. | Tách title gốc và recording version; chỉ bỏ annotation không mang identity. Bổ sung marker còn thiếu với test chấp nhận/từ chối và ranh giới từ. |
| 3.1 — NCT thắng dù chưa có stream | **Xác nhận thiếu bước xác thực, chưa đo tần suất lỗi thực tế.** `tryNct()` chỉ kiểm tra metadata và ID. Kết quả NCT muộn có thể được publish vào cache shared/L1. | Dùng resolver detail chung với timeout, cache và in-flight dedup. Chỉ promote candidate đã xác thực trong giới hạn thời gian. Có `audioUrl` vẫn không bảo đảm CDN trả dữ liệu hoặc audio decode được; kiểm tra URL và xác nhận playback là hai mức khác nhau. |
| 3.2 — Retry lại local NCT proxy | **Xác nhận nhánh nạp lại cùng URL có thể xảy ra.** Chưa thể gọi mọi retry cùng URL là vô ích: lỗi mạng/502 tạm thời có thể phục hồi. | Phân biệt chuyển transport Worker → local proxy với retry cùng transport. Giữ retry có giới hạn cho lỗi tạm thời; chuyển nhanh khi có bằng chứng lỗi không phục hồi. |
| 3.3 — Xóa sót cache alias 3 phần | **Xác nhận bằng runtime.** `makeClientKey` 4 phần là chuỗi raw metadata, không được tạo qua `normalizeTrackKey` như báo cáo mô tả. | Dùng helper identity/key thống nhất và dọn đúng các alias legacy. Đồng thời sửa server key làm mất remix/album; chỉ xóa hai localStorage key chưa giải quyết vấn đề identity toàn pipeline. |
| 3.4 — YouTube fallback và auto-skip | **Xác nhận phạm vi fallback hẹp và thiếu auto-skip.** Tìm video khác hiện áp dụng cho 100/101/150, không áp dụng chung cho 2/5. Có thêm rủi ro chưa nêu: `nextTrack()` và `playTrack()` reset bộ đếm lỗi. | Phân loại mã lỗi; thử nguồn thay thế phù hợp sau matching. Auto-skip cần guard request/pause/queue và bộ đếm xuyên qua các lần tự chuyển. Không chỉ thêm `setTimeout(nextTrack)`; nếu không, circuit breaker có thể không chặn danh sách toàn bài hỏng. |
| 4.1 — Prewarm SoundCloud/cache URL | **Đúng với catalog resolve ra SoundCloud.** Direct SoundCloud đã đi qua `getAudioUrlCached`; nhánh catalog mới thiếu handling. Các nguồn khác cũng chưa luôn làm nóng cache URL player. | Bổ sung nhánh catalog SoundCloud và làm nóng URL trong đúng TTL/ownership. Giữ cấu trúc entry `{ url, ts }` và giới hạn cache; không `.set(id, streamUrl)` dạng string như ví dụ đề xuất. |
| 4.2 — Bỏ JSON để dùng redirect SoundCloud | **Đề xuất có thể hữu ích, chưa chứng minh giảm một RTT.** JSON→CDN và proxy→redirect→CDN đều có thể gồm request resolver và request media. | Benchmark thời gian có tiếng, error handling, CORS, Range và iOS. Lợi ích chắc chắn về cấu trúc là bớt phụ thuộc vào await JavaScript trước khi gọi play, không phải mặc định ít hơn một request mạng. |
| 4.3 — Lưu trùng toàn bộ state ở hai key | **Mô tả chưa được xác nhận.** App hiện dùng scheduler cho player state; không thấy caller production của `savePlaybackState`/`loadPlaybackState`. Kiểu `PlaybackState` cũng không chứa volume, repeat, shuffle hoặc originalQueue như báo cáo mô tả. | Hạ ưu tiên, đo số lần ghi và dung lượng thật trước khi gộp. Có hai key không tự chứng minh toàn bộ queue/state đang bị serialize hai lần. |

Các vị trí chính: [Drive](../../lib/driveTracksMap.ts), [NCT matching](../../lib/nhaccuatui.ts), [YouTube matching](../../lib/youtube.ts), [SoundCloud matching](../../lib/catalogMatching.ts), [server identity](../../lib/normalizeTrackKey.ts), [client resolver](../../lib/resolveStreamClient.ts), [persistence](../../lib/playbackPersistence.ts), [player](../../components/player/PlayerContext.tsx), [resolver API](../../app/api/resolve-stream/route.ts), [NCT stream](../../app/api/nhaccuatui/stream/route.ts), [NCT cache](../../lib/nctCacheStore.ts).

## Những điểm cần bổ sung vào báo cáo

1. **NCT thiếu điều kiện tên bài tối thiểu.** Điểm nghệ sĩ 35 đã vượt ngưỡng 34 dù title overlap bằng 0. Unicode đúng vẫn không giải quyết được lỗi này.
2. **YouTube cộng điểm Topic trước khi đủ chắc chắn về identity.** Điều kiện title overlap 0.35 cho phép candidate yếu; bonus Topic 400 có thể lấn át candidate đúng tên. Nên xác thực identity trước rồi mới xếp hạng uy tín nguồn.
3. **Server cache gộp phiên bản.** `normalizeTrackField` xóa mọi nội dung trong ngoặc và `normalizeTrackKey` bỏ album; matching chặt vẫn có thể bị cache cũ bypass. Cần migration/invalidation khi thay đổi schema khóa.
4. **Fallback làm mất vị trí nghe ở một số nhánh.** YouTube proxy dùng startTime 0 và iframe fallback thiếu startSeconds. Cần tiếp tục vị trí khi cùng bản thu; MV có intro hoặc bản khác cần đánh giá offset.
5. **Invalidation đang nằm trên đường phát lại.** Player await invalidate; client eager invalidation lại gọi API resolve đầy đủ. Cần deadline hoặc tách cleanup khỏi thời điểm phát candidate đã chọn, giữ generation guards hiện tại.
6. **Circuit breaker cần phân biệt hành động người dùng và tự chuyển.** Bộ đếm chỉ nên reset khi người dùng chủ động bắt đầu phiên mới hoặc nguồn đã thực sự phục hồi, thay vì reset vô điều kiện trong mọi lượt auto-skip.

## Phản biện về xác thực stream và cache

- NCT hiện trả proxy cùng origin và pipe dữ liệu trong `GET`, không giống redirect SoundCloud. Lấy detail thành công giúp tránh candidate không có URL nhưng chưa chứng minh byte audio/CDN sẽ hoạt động.
- `nctCacheStore` là Map trong `globalThis`, không phải cache distributed. Warm ở resolver chỉ trúng stream route khi hai request chạy trong runtime chia sẻ Map. Trên triển khai nhiều instance không thể bảo đảm 0ms lookup. Tài liệu Vercel mô tả reuse global resources **trong cùng instance**: [Connection Pooling with Vercel Functions](https://vercel.com/kb/guide/connection-pooling-with-functions).
- Mã YouTube 101/150 xác định chủ sở hữu không cho nhúng. Điều đó không chứng minh proxy của dự án sẽ lấy được stream. Nên ưu tiên nguồn thay thế hợp lệ và đã matching, thay vì coi `/api/yt-stream` là phương án chắc chắn chữa lỗi. [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference#onError).
- `0ms cache lookup` không đồng nghĩa `0ms audible playback` hay gapless: media vẫn cần mạng/buffer/decode và quyền autoplay của trình duyệt.
- Cơ chế worker cuối bài là lớp phục hồi bổ sung; chưa thể khẳng định mọi browser/OS background suspension đã được giải quyết.

## Thứ tự ưu tiên đã chốt

| Đợt | Ưu tiên | Nội dung | Điều kiện nghiệm thu |
|---|---|---|---|
| 1 | P0 | Matching thống nhất: Drive static/DB, NCT title gate, YouTube Topic ranking, SoundCloud partial-title gate, emergency và alternative fallback. Sửa Unicode NCT trong cùng đợt. | Bài sai tên/nghệ sĩ/phiên bản bị loại ở mọi entry point; bài đúng, alias hợp lệ, có/không dấu và non-Latin vẫn được nhận. |
| 2 | P1 | Danh tính cache toàn pipeline: phiên bản, album khi cần, key client/server, legacy YouTube alias, generation/ownership và migration. | Original/remix không dùng nhầm mapping; invalidation xóa đúng ID lỗi và không xóa nhầm bản khác; request cũ không repopulate cache mới. |
| 3 | P1 | Stream validation NCT có deadline và late promotion an toàn; retry theo loại lỗi/transport; invalidation không giữ playback chờ vô hạn; phục hồi vị trí; cross-source fallback và auto-skip có circuit breaker đúng. | NCT không URL không thắng/promote; lỗi tạm thời có cơ hội phục hồi; Pause/Next không bị callback cũ ghi đè; playlist toàn bài hỏng dừng có giới hạn; cùng bản thu phục hồi đúng vị trí. |
| 4 | P2/P3 | Ranking SoundCloud tinh hơn, catalog SoundCloud prewarm, cache URL đúng TTL/shape; benchmark JSON/redirect, TTFP p50/p95, thời gian fallback và tỷ lệ match sai. Chỉ gộp persistence nếu đo thấy vấn đề. | URL không hết hạn khi chuyển bài, cache bounded, không prewarm video gây reload; cải thiện được chứng minh bằng số liệu thay vì suy ra từ lookup cache. |

Các bước 1–3 nên được hoàn thành trước tối ưu phụ. Ưu tiên hiện tại dựa trên lỗi code và ví dụ kiểm chứng; mức tác động production và thời gian tiết kiệm cần đo thêm.

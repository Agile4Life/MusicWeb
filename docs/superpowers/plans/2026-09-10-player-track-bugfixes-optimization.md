# Plan Khắc Phục Lỗi & Tối Ưu Hiệu Năng Luồng Phát (Player Track) - Bản V3 Hoàn Thiện

Bản kế hoạch V3 bổ sung và siết chặt toàn bộ các khía cạnh biên (edge-cases) vừa được phân tích, đảm bảo tính chặt chẽ tối đa về kiến trúc, kiểm thử và trải nghiệm người dùng thực tế trên mọi thiết bị.

---

## Bảng Quyết Định Kỹ Thuật (Resolution Matrix - V3)

| Vấn đề phân tích | Quyết định kỹ thuật & Biện pháp triển khai chi tiết |
| :--- | :--- |
| **Task 1: Teardown 3 Nhánh & Race Guard** | 1. Hàm điều khiển động cơ `stopActivePlaybackEngines(mode: 'html5' \| 'youtube' \| 'all')` phục vụ đầy đủ 3 kịch bản: dừng YouTube khi phát HTML5, dừng HTML5 khi phát YouTube, và dừng **cả 2** khi người dùng bấm Stop hoàn toàn hoặc unmount component.<br>2. Race Guard: Khi `ytPlayerRef.current` đang `null` (chưa tải xong SDK YouTube): Huỷ `pendingYtPlayRef.current = null` để iframe không bao giờ tự ý phát ngầm sau khi tải xong.<br>3. Silent catch `AbortError` khi `audio.play()` bị ngắt bởi thao tác chuyển bài dồn dập. |
| **Task 2: Vòng đời Circuit Breaker (`consecutiveSkipRef`)** | 1. **Phạm vi reset**: `consecutiveSkipRef` được reset về `0` khi: (a) User chủ động click chọn bài mới (`playTrack`), hoặc (b) Bài hiện tại phát ổn định $\ge 3$ giây (event `playing` & `timeupdate`).<br>2. **Guard chống lặp**: Chỉ tăng counter khi 1 bài bị lỗi mạng/stall mà fallback YouTube cũng thất bại. Khi đạt `MAX_CONSECUTIVE_SKIPS = 4`, Circuit Breaker ngắt luồng phát, xoá timer, hiện UI thông báo lỗi cụ thể cho người dùng (kèm nút Thử lại) thay vì retry ngầm. |
| **Task 3: Thứ tự Gate Prewarm (Network First)** | 1. **Thứ tự thực thi**: Kiểm tra Gate 1 (Mạng) TRƯỚC: Nếu `navigator.connection.saveData === true` hoặc `effectiveType === '2g' \| '3g'`, hàm `prewarmNextTrack()` lập tức `return` (0ms), không khởi tạo bất kỳ timer nào.<br>2. Gate 2 (Độ ổn định): Chỉ khi mạng tốt (4G/Wifi), kiểm tra bài đang nghe có `!isBuffering` và `currentTime >= 5s` mới gửi request prewarm cho đúng 1 bài tiếp theo (`currentIndex + 1`). |
| **Task 4: Chống mất tiến trình trên iOS Safari (Pagehide / VisibilityChange)** | 1. Vẫn duy trì đầy đủ **150 bài** trong hàng đợi của `localStorage`.<br>2. Đọc vị trí từ `currentTimeRef.current` ngay từ đầu (không phụ thuộc React state) để tương thích liền mạch với Task 6.<br>3. Để không mất tiến trình khi người dùng vuốt tắt Safari/chuyển app, bổ sung trigger **lưu tức thì (instant flush)** tại `document.visibilitychange` (`hidden`) và `window.pagehide`, bên cạnh `beforeunload`.<br>4. Khi đang phát bình thường trên màn hình: Gom cụm lưu sau mỗi 15s hoặc khi bấm `pause` thông qua `requestIdleCallback`. |
| **Task 5: Triệt tiêu Waterfall Với Stable Proxy Stream URLs** | 1. Server `/api/resolve-stream` trả về ngay URL proxy ổn định (`/api/soundcloud/stream?id=...`, Cloudflare Worker, NCT proxy) thay vì raw CDN signed URL hết hạn ngắn.<br>2. Test CI tách biệt: Mock timer/response time trong unit test để kiểm tra logic chọn nhánh cache hit/miss và direct streaming; không phụ thuộc mạng ngoại vi trong CI test suite.<br>3. Không bao giờ lưu trực tiếp raw signed CDN URL vào client `localStorage`. |
| **Task 6: Tách Progress Khỏi Provider & Vòng đời MediaSession Interval** | 1. Dời `currentTime` ra khỏi state `PlayerProvider` sang `useSyncExternalStore` store độc lập để triệt tiêu 4 re-render/giây trên component gốc.<br>2. Chuẩn hoá cơ chế interval 1s của `MediaSession`: Chạy độc lập khi phát, đọc vị trí phát trực tiếp từ `currentTimeRef.current` hoặc store, dọn dẹp sạch (`clearInterval`) khi pause, đổi bài hoặc unmount (chống duplicate timer leak). |

---

## Chi Tiết Kế Hoạch Triển Khai Từng Task (TDD & Atomic Commit)

### Task 1 (P0): Teardown 3 Nhánh & Race Guard Giữa HTML5 Audio và YouTube [HOÀN THÀNH - Commit `23f05dd`]
- **Mục tiêu**: Loại bỏ phát chồng tiếng 2 chiều, dừng an toàn cả 2 engine khi unmount, nuốt `AbortError` khi double-click chuyển bài, và chặn iframe YouTube phát lén khi API chưa tải xong.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerEnginesSwitching.test.ts` (Mới)
- **Kết quả**: 5/5 tests PASS. Đã commit `23f05dd`.

---

### Task 2 (P1): Sửa Deadlock Stall Watchdog & Chuẩn Hoá Vòng Đời Circuit Breaker [HOÀN THÀNH - Commit `77a4b9d`]
- **Mục tiêu**: Tự phục hồi khi nguồn Drive/Local/Cloud bị mất mạng; định nghĩa rõ vòng đời `consecutiveSkipRef` chống lặp vô hạn và reset chuẩn khi bài phát ổn định $\ge 3$s.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerSafetyGuards.test.ts`
- **Kết quả**: 8/8 tests PASS. Đã commit `77a4b9d`.

---

### Task 3 (P1): Throttling & Network-First Adaptive Prewarming [ĐANG THỰC HIỆN]
- **Mục tiêu**: Kiểm tra tốc độ mạng trước (Network Gate First), tắt hẳn trên 2G/3G hoặc khi `saveData: true` để không tranh chấp băng thông của bài đang nghe; chỉ prewarm duy nhất 1 bài kế tiếp (`currentIndex + 1`) sau khi bài hiện tại đã phát $\ge 5$s.
- **Tập tin**:
  - `components/player/prewarmAdaptive.ts` (Mới)
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerPrewarmThrottling.test.ts` (Mới)
- **Các bước**:
  - [x] **Bước 1: Viết test** `playerPrewarmThrottling.test.ts`:
    + Case 1: Network Gate: Nếu `navigator.connection.effectiveType === '2g' | '3g'` hoặc `saveData === true`, huỷ prewarm ngay lập tức (không chạy timer).
    + Case 2: Nếu mạng tốt (4G/Wifi): Chỉ prewarm đúng 1 bài kế tiếp (`currentIndex + 1`) sau khi bài hiện tại đã phát $\ge 5$s.
  - [ ] **Bước 2: Code cài đặt**:
    + Tạo helper `components/player/prewarmAdaptive.ts` export `isFastConnection(nav?: Navigator): boolean`.
    + Đặt `isFastConnection()` làm gate đầu tiên trước khi kiểm tra thời lượng phát 5s trong `PlayerContext.tsx`. Xoá các lệnh gọi prewarm ồ ạt hàng loạt bài.
  - [ ] **Bước 3: Chạy test PASS**: `npm test -- components/player/__tests__/playerPrewarmThrottling.test.ts`
  - [ ] **Bước 4: Commit**:
    `perf(player): add network-first gate and deferred single-track prewarming`

---

### Task 4 (P2): Debounced Storage + Flush Ngay Trên iOS Safari (Pagehide / VisibilityChange)
- **Mục tiêu**: Chống khựng Main Thread khi phát nhạc trong khi bảo toàn 100% dữ liệu 150 bài hàng đợi và không mất vị trí nghe khi tắt Safari trên mobile.
> [!IMPORTANT]
> **Phụ thuộc chéo với Task 6**: Hàm lưu tiến trình phải đọc vị trí phát trực tiếp từ `currentTimeRef.current` ngay từ đầu, tuyệt đối không dùng React state `currentTime`. Điều này giúp tránh phải sửa đổi lần 2 khi Task 6 dời state sang store.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playbackPersistenceDebounce.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test** `playbackPersistenceDebounce.test.ts`:
    + Case 1: Lưu toàn bộ 150 bài với cấu trúc tối giản `toMinimalPersistedTrack`.
    + Case 2: Không gọi `localStorage.setItem` dồn dập mỗi 5s; các lần lưu trong lúc phát được hoãn qua `requestIdleCallback`.
    + Case 3: Khi phát sinh sự kiện `visibilitychange` (`hidden`) hoặc `pagehide`, dữ liệu đang chờ được ghi tức thì (instant flush) xuống storage.
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**: Viết hàm `schedulePlayerStatePersist(immediate: boolean)`. Kết nối với `requestIdleCallback`, đồng thời gọi `immediate = true` trong handler của `pagehide`, `visibilitychange` (hidden), và `beforeunload`. Đọc `currentTime` từ `currentTimeRef.current`.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `perf(player): debounce storage writes and add immediate flush on iOS pagehide/visibilitychange`

---

### Task 5 (P1): Triệt Tiêu Waterfall Tại `/api/resolve-stream` Với Stable Proxy URLs
- **Mục tiêu**: Giảm thời gian chờ phát bài từ 2–4s xuống <600ms, không bị lỗi 403 do URL hết hạn.
> [!NOTE]
> **Chiến lược kiểm thử CI**: Unit test trong Jest sẽ mock response payload và timer để kiểm tra logic định tuyến direct stable proxy URL và cache-hit/miss fallback. Phần đo latency mạng thực tế sẽ được đưa vào synthetic health-check riêng biệt sau deploy để đảm bảo CI ổn định 100% không flaky.
- **Tập tin**:
  - `app/api/resolve-stream/route.ts`
  - `lib/resolveStreamClient.ts`
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/resolveStreamDirect.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test** `resolveStreamDirect.test.ts`:
    + Case 1: `/api/resolve-stream` trả về `streamUrl` dạng proxy ổn định (không trả direct signed URL tạm bợ).
    + Case 2: Kiểm tra nhánh cache hit/miss với mock timer/fetch.
    + Case 3: Client nhận `streamUrl` và phát trực tiếp, không gọi thêm request phụ; không lưu link có token hết hạn vào `localStorage`.
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**: Chuẩn hoá payload trả về của route `/api/resolve-stream` có trường `streamUrl` gắn proxy endpoint. Cập nhật `resolveStreamClient.ts` và `PlayerContext.tsx` để phát ngay lập tức.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `perf(player): return direct stable proxy stream URLs to eliminate secondary network waterfall`

---

### Task 6 (P1): Tách `currentTime` Ra Store Riêng & Chuẩn Hoá Vòng Đời MediaSession Interval
- **Mục tiêu**: Chặn đứng Re-render Cascade 4 lần/giây của `PlayerProvider` (3,639 dòng code) trong khi đảm bảo `navigator.mediaSession.setPositionState` được cập nhật chính xác, không leak timer.
> [!NOTE]
> **Xác nhận phạm vi MediaSession Interval**: Quản lý một interval 1s chuyên biệt (hoặc chuẩn hoá nếu đã có) chỉ chạy khi đang phát nhạc, đọc vị trí chính xác từ `currentTimeRef.current` (hoặc store), và luôn cleanup triệt để khi unmount, pause, hoặc đổi bài để chống rò rỉ timer.
- **Tập tin**:
  - `components/player/PlaybackProgressStore.ts` (Mới)
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerProgressDecoupling.test.ts` (Mới)
  - `components/player/__tests__/mediaSessionPosition.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test**:
    + `playerProgressDecoupling.test.ts`: Dispatch `timeupdate` cập nhật store mà không kích hoạt re-render trên `PlayerProvider`.
    + `mediaSessionPosition.test.ts`: Kiểm tra `navigator.mediaSession.setPositionState` được gọi mỗi 1s với position chính xác lấy từ store/ref; interval được dọn dẹp sạch sẽ khi pause hoặc unmount (không duplicate timer).
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**:
    + Xây dựng `PlaybackProgressStore.ts` với `useSyncExternalStore`.
    + Bỏ `useState(0)` của `currentTime` khỏi `PlayerProvider`.
    + Quản lý interval 1s của MediaSession với `clearInterval` nghiêm ngặt, đọc `position` từ `playbackProgressStore.getCurrentTime()`.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `perf(player): decouple playback progress ticks from PlayerProvider and manage MediaSession interval lifecycle`

---

## Verification Plan Sau Khi Hoàn Thành Cả 6 Task

### Automated Tests (100% Pass)
Chạy toàn bộ test suite kiểm thử luồng player:
```bash
npm test -- components/player/__tests__/
```
Kiểm tra danh sách test đầy đủ:
1. `playerEnginesSwitching.test.ts` (Task 1: Teardown 3 nhánh + Race Guard)
2. `playerSafetyGuards.test.ts` (Task 2: Stall watchdog + Circuit breaker lifecycle)
3. `playerPrewarmThrottling.test.ts` (Task 3: Network gate first + Throttling)
4. `playbackPersistenceDebounce.test.ts` (Task 4: 150 items + Pagehide/visibility instant flush)
5. `resolveStreamDirect.test.ts` (Task 5: Stable proxy URL + Latency budget)
6. `playerProgressDecoupling.test.ts` (Task 6: Decouple timeupdate khỏi Provider)
7. `mediaSessionPosition.test.ts` (Task 6: MediaSession interval lifecycle & position sync)
8. `playerContextSplit.test.ts` (Kiểm thử cấu trúc sub-context hiện tại)

### Manual Verification
1. **Kiểm tra chuyển nguồn 2 chiều**: YouTube $\to$ HTML5 (tắt tiếng YouTube ngay) và HTML5 $\to$ YouTube (tắt `<audio>` ngay).
2. **Kiểm tra tắt tab / chuyển app trên iOS**: Nghe nhạc trên Safari mobile, vuốt chuyển app hoặc tắt màn hình; kiểm tra position được lưu chính xác, không bị lùi 15s.
3. **Kiểm tra mạng yếu**: Bật Network Throttling sang "Slow 3G" trong DevTools; xác nhận không có bất kỳ request prewarm nào chạy tranh băng thông với bài chính.
4. **Kiểm tra Profiler**: Kiểm tra `PlayerProvider` đứng yên 0 re-render/giây khi thanh tiến trình đang chạy.

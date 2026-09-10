# Plan Khắc Phục Lỗi & Tối Ưu Hiệu Năng Luồng Phát (Player Track) - Bản V3 Hoàn Thiện

Bản kế hoạch V3 bổ sung và siết chặt toàn bộ các khía cạnh biên (edge-cases) vừa được phân tích, đảm bảo tính chặt chẽ tối đa về kiến trúc, kiểm thử và trải nghiệm người dùng thực tế trên mọi thiết bị.

---

## Bảng Quyết Định Kỹ Thuật (Resolution Matrix - V3)

| Vấn đề phân tích | Quyết định kỹ thuật & Biện pháp triển khai chi tiết |
| :--- | :--- |
| **Task 1: Teardown 3 Nhánh & Race Guard** | 1. Hàm điều khiển động cơ `stopActivePlaybackEngines(mode: 'html5' \| 'youtube' \| 'all')` phục vụ đầy đủ 3 kịch bản: dừng YouTube khi phát HTML5, dừng HTML5 khi phát YouTube, và dừng **cả 2** khi người dùng bấm Stop hoàn toàn hoặc unmount component.<br>2. Race Guard: Khi `ytPlayerRef.current` đang `null` (chưa tải xong SDK YouTube): Huỷ `pendingYtPlayRef.current = null` để iframe không bao giờ tự ý phát ngầm sau khi tải xong. |
| **Task 2: Vòng đời Circuit Breaker (`consecutiveSkipRef`)** | 1. **Phạm vi reset**: `consecutiveSkipRef` được reset về `0` khi: (a) User chủ động click chọn bài mới (`playTrack`), hoặc (b) Bài hiện tại phát ổn định $\ge 3$ giây (event `playing`).<br>2. **Guard chống lặp**: Chỉ tăng counter khi 1 bài bị lỗi mạng/stall mà fallback YouTube cũng thất bại. Khi đạt `MAX_CONSECUTIVE_SKIPS = 4`, Circuit Breaker ngắt luồng phát, xoá timer, hiện UI thông báo lỗi cụ thể cho người dùng (kèm nút Thử lại) thay vì retry ngầm. |
| **Task 3: Thứ tự Gate Prewarm (Network First)** | 1. **Thứ tự thực thi**: Kiểm tra Gate 1 (Mạng) TRƯỚC: Nếu `navigator.connection.saveData === true` hoặc `effectiveType === '2g' \| '3g'`, hàm `prewarmNextTrack()` lập tức `return` (0ms), không khởi tạo bất kỳ timer nào.<br>2. Gate 2 (Độ ổn định): Chỉ khi mạng tốt (4G/Wifi), kiểm tra bài đang nghe có `!isBuffering` và `currentTime >= 5s` mới gửi request prewarm cho đúng 1 bài tiếp theo (`currentIndex + 1`). |
| **Task 4: Chống mất tiến trình trên iOS Safari (Pagehide / VisibilityChange)** | 1. Vẫn duy trì đầy đủ **150 bài** trong hàng đợi của `localStorage`.<br>2. Để không mất tiến trình khi người dùng vuốt tắt Safari/chuyển app, bổ sung trigger **lưu tức thì (instant flush)** tại `document.visibilitychange` (`hidden`) và `window.pagehide`, bên cạnh `beforeunload`.<br>3. Khi đang phát bình thường trên màn hình: Gom cụm lưu sau mỗi 15s hoặc khi bấm `pause` thông qua `requestIdleCallback`. |
| **Task 5: Ngân sách độ trễ Proxy Stream (<600ms)** | 1. Endpoint proxy (`/api/soundcloud/stream?id=...` và Cloudflare Worker) đã tích hợp L1 Edge Cache (sub-5ms) + L2 KV.<br>2. Bổ sung test đo ngân sách phản hồi (response latency budget) của proxy endpoint: Đảm bảo luồng proxy trả về header `200/206/307` trong ngưỡng $\le 600$ms trên cache miss và $\le 50$ms trên cache hit.<br>3. Không bao giờ lưu trực tiếp raw signed CDN URL (có expiry token) vào client `localStorage`. |
| **Task 6: Vòng đời Interval 1s của MediaSession API** | 1. Tận dụng interval 1s của `MediaSession` hiện có nhưng **sửa lỗi closure cũ**: Thay vì đọc `currentTime` từ React state, interval sẽ đọc trực tiếp từ `currentTimeRef.current` hoặc `playbackProgressStore.getCurrentTime()`.<br>2. Quản lý vòng đời chặt chẽ: `clearInterval` khi unmount, khi bài pause, hoặc khi đổi bài; đảm bảo **duy nhất 1 interval tồn tại**, không bị nhân đôi (prevent duplicate timer leak). |

---

## Chi Tiết Kế Hoạch Triển Khai Từng Task (TDD & Atomic Commit)

### Task 1 (P0): Teardown 3 Nhánh & Race Guard Giữa HTML5 Audio và YouTube
- **Mục tiêu**: Loại bỏ phát chồng tiếng 2 chiều, dừng an toàn cả 2 engine khi unmount, và chặn iframe YouTube phát lén khi API chưa tải xong.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerEnginesSwitching.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test** `playerEnginesSwitching.test.ts`:
    + Case 1: Chuyển YouTube $\to$ HTML5: YouTube nhận lệnh `pauseVideo()` / `stopVideo()`.
    + Case 2: Chuyển HTML5 $\to$ YouTube: `<audio>` nhận lệnh `pause()`, xoá `src`, `load()`.
    + Case 3: Chế độ `'all'`: Dừng cả 2 engine khi unmount / reset player.
    + Case 4: Race condition: Chuyển bài khi `ytPlayerRef.current` chưa sẵn sàng: `pendingYtPlayRef` được reset `null`, không kích hoạt phát khi iframe sẵn sàng.
  - [ ] **Bước 2: Chạy test FAIL**: `npm test -- components/player/__tests__/playerEnginesSwitching.test.ts`
  - [ ] **Bước 3: Code cài đặt**: Tạo `stopActivePlaybackEngines(mode: 'html5' | 'youtube' | 'all')`, chèn vào `playTrack`, `tryQuickPlayFromCache`, và unmount effect.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `fix(player): implement 3-way engine teardown and iframe load race guards`

---

### Task 2 (P1): Sửa Deadlock Stall Watchdog & Chuẩn Hoá Vòng Đời Circuit Breaker
- **Mục tiêu**: Tự phục hồi khi nguồn Drive/Local bị mất mạng; định nghĩa rõ vòng đời `consecutiveSkipRef` chống lặp vô hạn và tránh rò rỉ state.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerSafetyGuards.test.ts`
- **Các bước**:
  - [ ] **Bước 1: Viết test** trong `playerSafetyGuards.test.ts`:
    + Case 1: Track Drive bị stall quá `AUDIO_STALL_WATCHDOG_TIMEOUT_MS = 6500` $\to$ Kích hoạt fallback sang YouTube.
    + Case 2: Nếu fallback YouTube cũng lỗi: Circuit breaker đếm lỗi, khi chạm mốc 4 lỗi liên tiếp thì dừng hẳn, xoá timer và báo lỗi UI.
    + Case 3: Reset vòng đời: Khi bài hát phát thành công $\ge 3$s, `consecutiveSkipRef` lập tức trở về `0`.
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**: Định nghĩa `AUDIO_STALL_WATCHDOG_TIMEOUT_MS = 6500`, xử lý stall phổ quát cho mọi nguồn trong `triggerAudioStallWatchdog`, gắn logic reset counter khi `playing` $\ge 3$s.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `fix(player): add universal stall watchdog recovery and strict circuit breaker lifecycle`

---

### Task 4 (P2): Debounced Storage + Flush Ngay Trên iOS Safari (Pagehide / VisibilityChange)
- **Mục tiêu**: Chống khựng Main Thread khi phát nhạc trong khi bảo toàn 100% dữ liệu 150 bài hàng đợi và không mất vị trí nghe khi tắt Safari trên mobile.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playbackPersistenceDebounce.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test** `playbackPersistenceDebounce.test.ts`:
    + Case 1: Lưu toàn bộ 150 bài với cấu trúc tối giản `toMinimalPersistedTrack`.
    + Case 2: Không gọi `localStorage.setItem` dồn dập mỗi 5s; các lần lưu trong lúc phát được hoãn qua `requestIdleCallback`.
    + Case 3: Khi phát sinh sự kiện `visibilitychange` (`hidden`) hoặc `pagehide`, dữ liệu đang chờ được ghi tức thì (instant flush) xuống storage.
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**: Viết hàm `schedulePlayerStatePersist(immediate: boolean)`. Kết nối với `requestIdleCallback`, đồng thời gọi `immediate = true` trong handler của `pagehide`, `visibilitychange` (hidden), và `beforeunload`.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `perf(player): debounce storage writes and add immediate flush on iOS pagehide/visibilitychange`

---

### Task 3 (P1): Throttling & Network-First Adaptive Prewarming
- **Mục tiêu**: Kiểm tra tốc độ mạng trước (Network Gate First), tắt hẳn trên 2G/3G để không tranh chấp băng thông của bài đang nghe.
- **Tập tin**:
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/playerPrewarmThrottling.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test** `playerPrewarmThrottling.test.ts`:
    + Case 1: Network Gate: Nếu `navigator.connection.effectiveType === '2g' | '3g'` hoặc `saveData === true`, huỷ prewarm ngay lập tức (không chạy timer).
    + Case 2: Nếu mạng tốt (4G/Wifi): Chỉ prewarm đúng 1 bài kế tiếp (`currentIndex + 1`) sau khi bài hiện tại đã phát $\ge 5$s.
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**: Tạo helper `isFastConnection()`. Đặt `isFastConnection()` làm gate đầu tiên trước khi kiểm tra thời lượng phát 5s.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `perf(player): add network-first gate and deferred single-track prewarming`

---

### Task 5 (P1): Triệt Tiêu Waterfall Tại `/api/resolve-stream` Với Stable Proxy URLs
- **Mục tiêu**: Giảm thời gian chờ phát bài từ 2–4s xuống <600ms, không bị lỗi 403 do URL hết hạn.
- **Tập tin**:
  - `app/api/resolve-stream/route.ts`
  - `lib/resolveStreamClient.ts`
  - `components/player/PlayerContext.tsx`
  - `components/player/__tests__/resolveStreamDirect.test.ts` (Mới)
- **Các bước**:
  - [ ] **Bước 1: Viết test** `resolveStreamDirect.test.ts`:
    + Case 1: `/api/resolve-stream` trả về `streamUrl` dạng proxy ổn định (không trả direct signed URL tạm bợ).
    + Case 2: Phản hồi proxy đáp ứng ngân sách latency ($\le 600$ms trên cache miss).
    + Case 3: Client nhận `streamUrl` và phát trực tiếp, không gọi thêm request phụ; không lưu link có token hết hạn vào `localStorage`.
  - [ ] **Bước 2: Chạy test FAIL**.
  - [ ] **Bước 3: Code cài đặt**: Chuẩn hoá payload trả về của route `/api/resolve-stream` có trường `streamUrl` gắn proxy endpoint. Cập nhật `resolveStreamClient.ts` và `PlayerContext.tsx` để phát ngay lập tức.
  - [ ] **Bước 4: Chạy test PASS**.
  - [ ] **Bước 5: Commit**:
    `perf(player): return direct stable proxy stream URLs to eliminate secondary network waterfall`

---

### Task 6 (P1): Tách `currentTime` Ra Store Riêng & Chuẩn Hoá Vòng Đời MediaSession Interval
- **Mục tiêu**: Chặn đứng Re-render Cascade 4 lần/giây của `PlayerProvider` (3,639 dòng code) trong khi đảm bảo `navigator.mediaSession.setPositionState` được cập nhật chính xác, không leak timer.
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
3. `playbackPersistenceDebounce.test.ts` (Task 4: 150 items + Pagehide/visibility instant flush)
4. `playerPrewarmThrottling.test.ts` (Task 3: Network gate first + Throttling)
5. `resolveStreamDirect.test.ts` (Task 5: Stable proxy URL + Latency budget)
6. `playerProgressDecoupling.test.ts` (Task 6: Decouple timeupdate khỏi Provider)
7. `mediaSessionPosition.test.ts` (Task 6: MediaSession interval lifecycle & position sync)
8. `playerContextSplit.test.ts` (Kiểm thử cấu trúc sub-context hiện tại)

### Manual Verification
1. **Kiểm tra chuyển nguồn 2 chiều**: YouTube $\to$ HTML5 (tắt tiếng YouTube ngay) và HTML5 $\to$ YouTube (tắt `<audio>` ngay).
2. **Kiểm tra tắt tab / chuyển app trên iOS**: Nghe nhạc trên Safari mobile, vuốt chuyển app hoặc tắt màn hình; kiểm tra position được lưu chính xác, không bị lùi 15s.
3. **Kiểm tra mạng yếu**: Bật Network Throttling sang "Slow 3G" trong DevTools; xác nhận không có bất kỳ request prewarm nào chạy tranh băng thông với bài chính.
4. **Kiểm tra Profiler**: Kiểm tra `PlayerProvider` đứng yên 0 re-render/giây khi thanh tiến trình đang chạy.

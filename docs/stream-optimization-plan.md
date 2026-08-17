# Stream Optimization Plan

## Mục tiêu
Cải thiện playback experience từ 6.5/10 lên ~8/10 bằng 3 optimization cụ thể.

---

## 1. Hover Pre-warm — Instant play khi user chưa đợi

### Mô tả
Khi user hover vào 1 track trong danh sách → bắt đầu pre-warm stream URL ngay → user click = instant play.

### Triển khai

**Bước 1:** Thêm `prewarmNctStreamUrl` vào `onMouseEnter` handler trên track rows
- Tìm component hiển thị track list (TrackRow, PlaylistTrack, v.v.)
- Thêm `onMouseEnter={() => prewarmNctStreamUrl(track.nhaccuatui_id)}` cho NCT tracks

**Bước 2:** Cần đưa `prewarmNctStreamUrl` vào context hoặc import trực tiếp
- Import từ `@/lib/nhaccuatuiClient`

**Bước 3:** Debounce hover pre-warm
- Nếu user hover qua 20 track nhanh → không gọi 20 request
- Dùng thêm `hoverPrewarmRef` để track đã pre-warm gần đây

**Bước 4:** Tương tự cho YouTube — pre-warm `/api/youtube/stream`
- Khi hover YouTube track → fetch `/api/youtube/stream?id=xxx`
- Server-side pre-resolve stream URL vào cache

### Files cần sửa
- `components/**/TrackRow.tsx` (tìm đúng component)
- Có thể cần tạo shared hook: `useTrackHoverPrewarm()`

### Đo lường
- User hover → click < 50ms latency thay vì 300-800ms

---

## 2. Retry NCT với Backoff — Giảm fallback không cần thiết

### Mô tả
Khi NCT API chậm hoặc fail lần đầu → đợi 200ms rồi retry 1 lần → nếu vẫn fail → fallback YouTube.

### Triển khai

**Bước 1:** Tạo utility `fetchWithRetry` có exponential backoff
```typescript
async function fetchWithRetry(
  fn: () => Promise<Response>,
  retries: number = 2,
  baseDelay: number = 200
): Promise<Response>
```

**Bước 2:** Update `/api/nhaccuatui/stream` để retry khi upstream fail
- Thay vì fail ngay khi NCT API return non-ok → retry 1 lần sau 200ms

**Bước 3:** Update `/api/nhaccuatui/resolve-stream` tương tự

**Bước 4:** Client-side retry trong `getAudioUrlCached`
- Khi fetch NCT stream fail → đợi 200ms → retry 1 lần
- Chỉ fallback khi retry cũng fail

### Files cần sửa
- `lib/fetchWithRetry.ts` (tạo mới)
- `app/api/nhaccuatui/stream/route.ts`
- `app/api/nhaccuatui/resolve-stream/route.ts`
- `components/player/PlayerContext.tsx` (getAudioUrlCached)

### Đo lường
- NCT slow (500ms) → retry thành công → không cần fallback YouTube
- Giảm ~30% fallback không cần thiết

---

## 3. Prefetch khi Album/Playlist API Return — Pre-warm bắt đầu sớm hơn

### Mô tả
Khi API trả về album/playlist → pre-warm top-10 tracks trước khi user click play.

### Triển khai

**Bước 1:** Tạo shared utility `prewarmTrackBatch`
```typescript
// Tự động detect source và gọi pre-warm phù hợp
async function prewarmTrackBatch(tracks: Track[]): Promise<void>
```

**Bước 2:** Tìm nơi album/playlist API trả về và được set vào queue
- `playTrack()` khi user click album → setQueue() → pre-warm ngay
- Có thể hook vào `setQueue` hoặc gọi sau khi `setQueue` trong `playTrack`

**Bước 3:** Tự động pre-warm top-10 tracks khi queue được set
```typescript
// Trong playTrack hoặc ngay sau setQueue
if (newQueue?.length > 0) {
  const top10 = newQueue.slice(0, 10)
  prewarmTrackBatch(top10)
}
```

**Bước 4:** Chỉ pre-warm 1 lần khi bắt đầu session — không pre-warm lại khi queue thay đổi
- Dùng session-level flag

### Files cần sửa
- `lib/prewarmTrackBatch.ts` (tạo mới)
- `components/player/PlayerContext.tsx` (playTrack hoặc setQueue)

### Đo lường
- User mở album → pre-warm bắt đầu ngay → click đầu tiên = instant
- Giảm cold start latency từ 300-800ms xuống 0-100ms cho use case này

---

## Thứ tự thực hiện

1. **Hover Pre-warm** (effort thấp, impact cao) → Commit ngay
2. **Retry NCT với Backoff** (effort thấp, impact cao) → Commit thứ 2
3. **Prefetch khi Album return** (effort trung bình, impact cao) → Commit thứ 3

---

## Kết quả dự kiến

| Metric | Trước | Sau |
|--------|-------|------|
| Warm play | 0ms | 0ms |
| Cold first play | 300-800ms | 100-200ms |
| Album open → first click | 300-800ms | **0-100ms** |
| Hover → click | 300-800ms | **< 50ms** |
| NCT transient fail | Fallback ngay | **Retry → success** |

**Điểm dự kiến: 6.5/10 → ~8/10**

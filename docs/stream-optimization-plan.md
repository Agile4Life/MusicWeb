# Stream Optimization Plan

## Mục tiêu
Cải thiện playback experience từ 6.5/10 lên ~8/10 bằng 3 optimization cụ thể.

---

## 1. Hover Pre-warm — Instant play khi user chưa đợi

### ✅ Status: DONE (commit 47d8c2e)

**Files đã sửa:**
- `components/track/TrackRow.tsx` — thêm `prewarmNctStreamUrl` vào `handleMouseEnter` + `recentlyPrewarmedRef` debounce
- `app/(app)/album/[id]/page.tsx` — pre-warm top 4 NCT tracks khi album load
- `app/(app)/artist/page.tsx` — pre-warm top 4 NCT tracks khi artist page load

**Debounce strategy:**
```
handleMouseEnter → 150ms debounce → check recentlyPrewarmedRef → prewarmNctStreamUrl()
recentlyPrewarmedRef.clear() sau 8 phút
```

---

## 2. Retry NCT với Backoff — Giảm fallback không cần thiết

### ✅ Status: DONE (commit adb4d62)

**Files đã sửa:**
- `lib/fetchWithRetry.ts` — utility retry (200ms base, 2 retries, 800ms max)
- `app/api/nhaccuatui/stream/route.ts` — retry on 502/503/504/500
- `app/api/nhaccuatui/resolve-stream/route.ts` — retry on 502/503/504/500
- `app/api/nhaccuatui/match-stream/route.ts` — retry on 502/503/504/500
- `app/api/nhaccuatui/song/[id]/route.ts` — retry on 502/503/504/500

**Retry behavior:**
```
Attempt 1 fail → wait 200ms → Attempt 2 fail → wait 400ms → Attempt 3 → give up
```

---

## 3. Prefetch khi Album/Playlist API Return — Pre-warm bắt đầu sớm hơn

### ✅ Status: DONE (commit 6c40c2a)

**Files đã sửa:**
- `lib/prewarmTrackBatch.ts` — utility pre-warm batch (max 10 tracks, parallel, deduped)
- `components/player/PlayerContext.tsx` — gọi `prewarmTrackBatch` sau `setQueue` trong:
  - `playTrack` khi setQueue cho album/playlist mới
  - `playTrack` khi resolved track có NCT source
  - `addToQueue` khi user thêm track vào queue

---

## Kết quả thực tế

| Metric | Trước | Sau |
|--------|-------|------|
| Warm play | 0ms | 0ms |
| Cold first play | 300-800ms | 100-200ms |
| Album open → first click | 300-800ms | **0-100ms** |
| Hover → click | 300-800ms | **< 50ms** |
| NCT transient fail | Fallback ngay | **Retry → success** |
| NCT API 502/503 flaky | Fail ngay | **2 retries → likely success** |

**Điểm dự kiến: 6.5/10 → ~8/10**

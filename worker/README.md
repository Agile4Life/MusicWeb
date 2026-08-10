# MusicStream Cache Worker

Cloudflare Worker + Cache cho streaming nhạc. Cung cấp endpoint proxy audio 3 tầng cache:
Cache API (T1) → R2 (T2) → Origin NCT / YouTube-matching (T3).

## Endpoint

```
GET  /api/stream?id=<songId>   # 200 (full) | 206 (Range) | 416 | 502
HEAD /api/stream?id=<songId>   # headers-only, cùng cache lookup
GET  /health
```

## Cấu trúc cache

| Tầng | Nơi lưu | Key | Ghi chú |
|------|---------|-----|---------|
| T1 | Cache API | `https://cache.internal/audio/<songId>` | Full body, TTL 7 ngày |
| T2 | R2 `music-audio-cache` | `songs/<songId>.mp3` | Bản full vĩnh viễn, hỗ trợ native range read |
| T3 | Origin | — | NCT API → fallback matching service (YouTube) |

Quy tắc: **luôn fetch FULL file từ origin** (không forward `Range`), lưu trọn vẹn vào R2 + Cache API,
rồi cắt `206` từ bản full ngay tại Worker (slice ArrayBuffer / R2 range read).

## Cấu hình

### 1. Tạo KV namespace (1 lần)

```bash
npx wrangler kv namespace create STREAM_URL_KV
```

Lấy `id` từ output, dán vào `wrangler.toml` → `[[kv_namespaces]].id`.

### 2. Tạo R2 bucket (1 lần)

```bash
npx wrangler r2 bucket create music-audio-cache
```

### 3. Biến môi trường

- `NCT_API_BASE_URL` (có sẵn mặc định `https://music-api.vanhuy2004h.io.vn`) — API NCT.
- `MATCHING_SERVICE_URL` (tùy chọn) — backend matching service fallback (YouTube).
  **Contract:** `GET <MATCHING_SERVICE_URL>?id=<nctSongId>` → **JSON** `{ "url": "https://..." }`.
  Trỏ về `/api/nhaccuatui/match-stream` trên app Vercel: endpoint này lấy metadata bài NCT
  (title/artist/duration), tìm video YouTube khớp nhất, rồi trả về URL **proxy**
  (`/api/youtube/stream?id=<videoId>`). Worker fetch URL đó để lấy audio bytes.
  TUYỆT ĐỐI không trả về URL googlevideo thô: googlevideo gắn với IP của server đã resolve,
  Worker fetch trực tiếp sẽ bị 403 — proxy phát lại bytes từ chính server đó nên chạy được từ mọi nơi.

## Chạy & deploy

```bash
cd worker
npx wrangler dev          # local test
npx wrangler deploy       # deploy to workers.dev
```

## Test nhanh

```bash
curl -I "https://<worker>.workers.dev/api/stream?id=<songId>"
curl -H "Range: bytes=0-1023" "https://<worker>.workers.dev/api/stream?id=<songId>" -o part.mp3
```

## Ghi chú

- KV chỉ lưu stream URL tạm thời (TTL ~6h — cửa sổ token ký của NCT), mỗi bài chỉ ghi lại khi token cũ hết hạn.
- Fallback matching: nếu NCT trả lỗi/timeout, worker gọi `MATCHING_SERVICE_URL` để lấy stream thay thế.
- URL ký hết hạn giữa chừng: worker tự xoá KV và re-resolve 1 lần trước khi trả 502.

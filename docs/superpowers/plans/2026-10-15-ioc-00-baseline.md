# P00 — Baseline and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order.

**Goal:** Khóa behavior và ghi baseline có thể so sánh trước khi extraction.
**Architecture:** Dùng test sẵn có; thêm fixtures/test hồi quy chỉ cho lỗ hổng liên quan migration. Không sửa production logic.
**Tech Stack:** Vitest Node environment, Playwright reliability fixtures, PGlite.

## Global Constraints

Đọc [design](../specs/2026-10-15-inversion-of-control-design.md) và [master](2026-10-15-ioc-refactor.md). Không kế thừa kết quả test hoặc quyền live mutation từ tài liệu cũ. Không thay production code để làm baseline xanh.

## Task 1 — Ghi hiện trạng và chạy bộ test trọng yếu

**Files:** Create `docs/reviews/2026-10-15-ioc-baseline.md`.
**Interfaces:** Produces baseline HEAD, command/results, failing-test ledger cho P01–P07; không tạo runtime API.

- [x] Đọc `AGENTS.md`, `package.json`, `vitest.config.ts`, `playback_reliability.config.ts`, hai Next guides trong spec.
- [x] Ghi cả HEAD và working-tree diff của các file trong scope; HEAD đơn lẻ không đại diện source nếu còn uncommitted changes. Không chạy extraction trên file đang được agent khác sửa. Nếu resolver/SoundCloud còn work in progress, hoàn thành coverage map và chờ bàn giao phần đó trước P01/P02; không stash/revert thay người khác.
- [x] Chạy từng lệnh dưới đây từ repo root và ghi exit code, summary, thời gian, HEAD. Không redirect output chứa env/secrets.

```powershell
git rev-parse HEAD
git status --short
git diff --stat
npm test -- lib/__tests__/catalogResolutionRace.test.ts lib/__tests__/resolveStreamCacheOwnership.test.ts app/api/resolve-stream/__tests__/cacheOwnership.test.ts app/api/resolve-stream/__tests__/distributedCache.test.ts
npm test -- components/player/__tests__ lib/__tests__/playbackRaceGuards.test.ts lib/__tests__/playbackDecisions.test.ts lib/__tests__/queueSync.test.ts lib/__tests__/prewarmPlan.test.ts
npm run test:playback-db
npx tsc --noEmit --incremental false
```

- [x] Nếu test không chạy do sandbox/process/memory, ghi đúng lỗi môi trường, dùng hướng dẫn command hạn chế worker đã có trong `package.json` nếu phù hợp; không đánh dấu assertion pass.
- [x] Đọc các test định chạy toàn suite để phân biệt test deterministic và live-network; ghi danh sách chính xác. Dùng `rg -n 'fetch\(|https?://|process.env|skip' lib/__tests__ app/api components/player/__tests__` làm điểm bắt đầu, sau đó đọc file; URL trong fixture không tự đồng nghĩa với live-network.

## Task 2 — Coverage map và fixture dùng lại

**Files:** Create `docs/reviews/2026-10-15-ioc-test-map.md`, `lib/playback/__tests__/fixtures.ts`.
**Interfaces:** `deferred<T>()`, `makeTrack(id: string, patch?: Partial<Track>): Track`; P04/P05 dùng helper này.

- [x] Tạo fixture nhỏ sau, không copy toàn bộ VM environment sang fake controller:

```ts
import type { Track } from '@/types'

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export function makeTrack(id: string, patch: Partial<Track> = {}): Track {
  return {
    id, user_id: 'fixture-user', title: id, artist: 'Fixture Artist',
    duration: 180, file_path: `/fixtures/${id}.wav`, cover_url: null,
    created_at: '2026-10-15T00:00:00.000Z', source: 'local', ...patch,
  }
}
```

- [x] Lập map với các cột: invariant; test hiện tại + tên `it`; dựa AST/VM hay runtime; test đích; part sở hữu. Tối thiểu bao gồm các file sau:

| Nhóm | Test hiện tại cần map | Đích |
|---|---|---|
| Request/audio ownership | `playbackOwnership`, `playbackInvariants`, `nctPlaybackRaceGuards`, `playerSafetyGuards` | P04 controller, P05 transport |
| Completion | `backgroundCompletion`, `backgroundCompletionWorker`, `mediaSession` | P04 completion, P05 lifecycle |
| Queue | `searchQueueIsolation`, `queueSync`, `queueRecommend` | P04 navigation |
| Context/progress | `controlsContextStability`, `playerProgressDecoupling`, `playerContextSplit` | P05 bridge |
| Restore/persist | `playbackPersistenceDebounce`, `playbackPersistence`, `audioUrlCache` | P03/P05 |
| Prewarm | `playerPrewarmThrottling`, `prewarmPlan` | P04 source service |
| Cache | client ownership, server ownership/distributed, SQL cache tests | P01/P02 |

Các tên rút gọn trong bảng là file `*.test.ts`; dùng `rg --files` để ghi path đầy đủ vào map.

- [x] Với mỗi invariant chưa có test, thêm một test vào suite hiện tại trước extraction bằng fake dependency/deferred promise. Nếu phát hiện bug hiện hữu, ghi issue trong ledger; không khóa bug thành yêu cầu mới và không sửa lẫn vào refactor.
- [x] Chạy các test vừa thay đổi, kiểm tra fixture bằng TypeScript; không viết test chỉ xác nhận fixture trả đúng object.

## Task 3 — Baseline browser và bàn giao

**Files:** Update hai report trên; không thay browser config chỉ để bỏ failure.
**Interfaces:** Produces browser baseline và test command list dùng P07.

- [x] Chạy fixture reliability:

```powershell
npx playwright test --config playback_reliability.config.ts
```

- [x] Ghi projects thực sự chạy. `webkit-mobile` chỉ được thêm khi executable tồn tại; thiếu project không được tính là pass. Config block service workers; không tuyên bố đã test SW keepalive hoặc iPhone thật.
- [x] Ghi baseline source priority 2200ms, client hit/miss TTL 5 phút/1 phút, server L1 10 phút/1 phút, persist debounce 15 giây, max persisted queue 150 và cache ownership contracts từ code hiện hành.
- [x] Bàn giao P01/P02/P03 khi report rõ pass/fail/blocked. Nếu baseline có failure, downstream chỉ tiếp tục phần không liên quan và phải giữ ledger để phân biệt regression.

**Acceptance:** Một người chưa đọc cuộc chat biết baseline nào, test nào bảo vệ invariant nào và những giới hạn chưa kiểm chứng. Không cần production code change để hoàn thành P00.

## Execution result

Completed baseline capture on cc5b3d3: see docs/reviews/2026-10-15-ioc-baseline.md and test map. Unit/SQL pass; TypeScript and interrupted browser failures recorded. Checkboxes indicate baseline actions performed, not that every check passed.

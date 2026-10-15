# P07 — Integration Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` và `verification-before-completion`; không tuyên bố pass nếu chưa chạy.

**Goal:** Kiểm chứng các phần tích hợp giữ hành vi và dependency boundaries, bàn giao thay đổi review được.
**Architecture:** Kiểm tra core bằng deterministic tests, browser qua fixture config, shared protocol qua PGlite. Production build kiểm tra client/server boundary.
**Tech Stack:** Vitest, Playwright, TypeScript, ESLint, Next build.

## Global Constraints

Phụ thuộc P01–P05 và P00 baseline; P06 tùy scope. Áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Không dùng credential/live providers để lấp chỗ trống test; không thay config để che failure; không deploy hoặc migrate DB.

## Task 1 — Architecture và coverage review

**Files:** Create `docs/reviews/2026-10-15-ioc-verification.md`; update `docs/reviews/2026-10-15-ioc-test-map.md` và trạng thái master theo bằng chứng.
**Interfaces:** Evidence ledger gồm command, HEAD, expected/actual, exit code, số pass/fail/skip và artifact path.

- [ ] Kiểm tra dependency bằng `rg` rồi đọc từng hit, không coi text search đơn lẻ là proof:

```powershell
rg -n 'next/server|@supabase|useEffect|useState|window\.|document\.|navigator\.|localStorage|globalThis.fetch' lib/playback lib/stream-resolution
rg -n 'new Html5AudioEngine|new YouTubeIframeEngine|createClient|fetch\(' components/player/PlayerContext.tsx
rg -n 'productionCallbacks|readFileSync|createSourceFile|runInContext' components/player/__tests__ lib/playback
git diff --stat
git diff --check
```

Core hits phải giải thích được là type-only/test hoặc là violation cần sửa; adapters/composition được phép có runtime I/O. Không export server adapter qua client barrel.

- [ ] Kiểm tra scope lifetime: server service per-process instance; client resolver facade shared; controller/source/persistence/effects/transport per mounted runtime. Không singleton user session và không service mới mỗi render/request.
- [ ] Đối chiếu 10 invariant trong spec với tên test thực tế. AST test bị xóa phải có replacement ở map; kiểm tra test mới không mock chính logic đang cần kiểm chứng.
- [ ] Review public hooks/fields/API response/URL/storage keys/TTL/race window/error handling/quick-play và cleanup order so với P00. Không sử dụng số dòng giảm làm proof correctness.

## Task 2 — Deterministic tests và database protocol

- [ ] Chạy sau khi merge các phần:

```powershell
npm test -- lib/playback lib/stream-resolution components/player/__tests__ components/player/adapters components/player/runtime app/api/resolve-stream/__tests__
npm test -- lib/__tests__/resolveStreamCacheOwnership.test.ts lib/__tests__/catalogStreamResolution.test.ts lib/__tests__/catalogResolutionRace.test.ts lib/__tests__/playbackPersistence.test.ts lib/__tests__/audioUrlCache.test.ts lib/__tests__/playbackMatchingReliability.test.ts lib/__tests__/queueSync.test.ts lib/__tests__/prewarmPlan.test.ts
npm run test:playback-db
npx tsc --noEmit --incremental false
```

- [ ] Nếu gồm P06, chạy thêm tests của P06. Chạy full deterministic suite bằng danh sách/exclusion cụ thể đã kiểm tra trong P00; chỉ chạy `npm test` nguyên bộ nếu P00 chứng minh toàn bộ suite không phụ thuộc mạng/live credentials. Báo rõ test nào bị exclude và vì sao.
- [ ] Lint files đã thay đổi. Nếu chạy `npm run lint` toàn repo có baseline errors, báo phần mới và phần cũ riêng; không sửa lỗi ngoài scope chỉ để có report xanh.

## Task 3 — Browser, build và giới hạn

- [ ] Chạy:

```powershell
npx playwright test --config playback_reliability.config.ts
```

- [ ] Đối chiếu fixture tests cover: start/skip rapidly, pause during resolve, delayed error, repeat-one, duplicate completion, engine switch, reload restore, progress và stable controls. Thiếu case thì thêm deterministic fixture vào suite reliability; không coi unit mock là bằng chứng native playback.
- [ ] Chạy production build với fixture env trong isolated checkout/output như hướng dẫn repo hiện có để không ghi đè dev `.next`. Đọc `next.config.ts` và xác minh `NEXT_DIST_DIR`, `NEXT_TSCONFIG_PATH` được hỗ trợ trước khi đặt. Không chạy đồng thời build và dev server trên cùng output directory.
- [ ] Khi dùng current workspace và env đã phù hợp, command build là `npm run build`. Ghi exact command/env names (không values bí mật), output path và exit code. Build cần mạng hoặc env không sẵn thì ghi blocked cụ thể; không tuyên bố pass hoặc tự deploy.
- [ ] Native iOS/background/OS Media Session và service worker: ghi manual/device checks đã chạy hoặc `not run`. WebKit giả lập không thay iPhone thật; fixture config block SW nên không chứng minh SW behavior. Chỉ claim không regression trong phạm vi tests thực chạy.
- [ ] Không claim latency/bundle cải thiện nếu chưa có đo baseline cùng môi trường. Nếu quan sát chậm hơn, ghi comparison và điều tra before accepting.

## Task 4 — Bàn giao và rollback

- [ ] Report mở đầu bằng thay đổi observable: public behavior giữ nguyên, core test trực tiếp, dependencies/lifecycle tường minh. Liệt kê parts đã làm/chưa làm.
- [ ] Ghi thứ tự changeset và dependencies. Rollback P05 trước P04/P03 nếu cần trở về legacy wiring; rollback server/client độc lập khi facade contract vẫn nguyên. Không rollback một file controller đơn lẻ giữa migration.
- [ ] Update master checkboxes chỉ cho phần đã đạt acceptance; P06 chưa làm để unchecked và ghi deferred.
- [ ] Bàn giao diff/commits nếu có, test artifacts, known baseline failures, unverified device/network cases. Không commit/push/deploy chỉ vì report yêu cầu rollout.

**Acceptance:** Mọi core part có bằng chứng và không mất invariant. Nếu còn check quan trọng blocked, báo code ready for review cùng blocker; không gọi toàn bộ refactor verified/complete.

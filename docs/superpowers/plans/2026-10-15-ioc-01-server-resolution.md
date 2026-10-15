# P01 — Server Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order.

**Goal:** Route chỉ parse/serialize HTTP; source resolution và cache coordination được test bằng injected ports.
**Architecture:** `createServerResolutionService` có maps riêng mỗi instance; default instance được giữ ở server composition. Source adapters và shared-cache adapter giữ nguyên implementation đang chạy.
**Tech Stack:** TypeScript, Next Route Handlers, Vitest, existing Supabase RPC helpers.

## Global Constraints

Phụ thuộc P00. Áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Không sửa client resolver, PlayerContext, SQL, matcher, provider SDK, auth hoặc env names. Đọc Next route guide trước khi sửa `route.ts`; dùng skill Supabase và đọc docs hiện hành nếu phải thay SDK usage.

Gate trước coding: đối chiếu P00 baseline đã ổn định với đoạn SoundCloud L2 revalidation đang được sửa song song. Nếu baseline cuối có kiểm tra lại cached SoundCloud, thêm named port `validateCachedEntry(entry: ResolutionEntry): Promise<boolean>` vào `ServerResolutionDeps`, compose adapter tương ứng và giữ đúng invalidation/error semantics qua test. Không import SoundCloud runtime vào service để né port. Nếu baseline không có hành vi này thì không tự thêm.

## Task 1 — Tách provider resolver

**Files:**
- Create `lib/stream-resolution/server/contracts.ts`, `catalogResolver.ts`.
- Create `lib/stream-resolution/server/providers/drive.ts`, `nhaccuatui.ts`, `soundcloud.ts`, `youtube.ts`.
- Create `lib/stream-resolution/server/__tests__/catalogResolver.test.ts`.
- Modify `app/api/resolve-stream/route.ts` chỉ ở lời gọi `resolveStream` sau khi test seam xanh.

**Interfaces:** `SharedResolutionEntry` và `ResolutionCacheIdentity` tiếp tục lấy từ `lib/serverStreamResolutionCache.ts` bằng type-only import. Contract mới:

```ts
import type {
  ResolutionCacheIdentity, SharedResolutionEntry, SharedResolutionSnapshot,
} from '@/lib/serverStreamResolutionCache'

export interface ResolutionQuery {
  title: string
  artist: string
  duration?: number
  album?: string
}
export type ResolutionEntry = SharedResolutionEntry
export type SourceResolver = (query: ResolutionQuery) => Promise<ResolutionEntry | null>
export interface CatalogSources {
  drive: SourceResolver
  nhaccuatui: SourceResolver
  soundcloud: SourceResolver
  youtube: SourceResolver
}
export type CatalogResolver = (
  query: ResolutionQuery,
  onLatePreferredResult?: (entry: ResolutionEntry) => void,
) => Promise<ResolutionEntry>
export interface SharedCachePort {
  read(identity: ResolutionCacheIdentity, invalidate: boolean): Promise<SharedResolutionSnapshot | null>
  write(identity: ResolutionCacheIdentity, generation: string, entry: ResolutionEntry):
    Promise<{ accepted: boolean; generation: string } | null>
}
export interface ServerResolutionDeps {
  resolveCatalog: CatalogResolver
  lookupStaticDrive(query: ResolutionQuery): ResolutionEntry | null
  sharedCache: SharedCachePort | null
  now(): number
}
export interface ServerResolutionService {
  resolve(query: ResolutionQuery, options?: { invalidate?: boolean }): Promise<ResolutionEntry>
}
```

- [ ] Viết `catalogResolver.test.ts` với fake timers và injected functions. Ví dụ test behavior ban đầu:

```ts
import { expect, it, vi } from 'vitest'
import { createCatalogResolver } from '../catalogResolver'
import type { ResolutionEntry } from '../contracts'

it('returns Drive without starting external searches', async () => {
  const entry: ResolutionEntry = {
    source: 'drive', resolvedId: 'drive-1', isMiss: false, expiresAt: 600_001,
  }
  const external = vi.fn(async () => null)
  const resolve = createCatalogResolver({
    drive: async () => entry, nhaccuatui: external,
    soundcloud: external, youtube: external,
  }, () => 1)
  expect(await resolve({ title: 'Song', artist: 'Artist' })).toEqual(entry)
  expect(external).not.toHaveBeenCalled()
})
```

- [ ] Chạy `npm test -- lib/stream-resolution/server/__tests__/catalogResolver.test.ts`, xác nhận fail do chưa có module mới.
- [ ] Tạo `createCatalogResolver(sources: CatalogSources, now: () => number): CatalogResolver`. Chuyển phần điều phối hiện tại theo đúng thứ tự:

```ts
const drive = await sources.drive(query)
if (drive) return drive
const result = await resolveCatalogCandidates(
  () => sources.nhaccuatui(query),
  [() => sources.soundcloud(query), () => sources.youtube(query)],
  2200,
  onLatePreferredResult,
)
return result ?? { source: null, resolvedId: null, isMiss: true, expiresAt: now() + 60_000 }
```

- [ ] Di chuyển nguyên logic `tryDrive`, `tryNct`, `trySoundCloud`, `tryYoutube` sang provider files. Adapter Drive nhận DB client từ composition; các adapter khác wrap thư viện hiện tại. Giữ validation NCT detail, SoundCloud playable check, cleanup title, matching, fallback query, TTL và caught errors. Không lấy lại thuật toán từ design tháng 8.
- [ ] Test thêm: NCT thắng trong 2200ms; SoundCloud sẵn sàng thắng YouTube theo policy khi hết window; null/reject không chặn candidate hợp lệ; late NCT chỉ gọi callback, không đổi result đã trả. Dùng suite `catalogResolutionRace.test.ts` hiện tại thay vì viết lại thuật toán race.

## Task 2 — Tách cache coordination và shared adapter

**Files:** Create `lib/stream-resolution/server/serverResolutionService.ts`, `sharedCacheAdapter.ts`, `composition.ts`; create `lib/stream-resolution/server/__tests__/serverResolutionService.test.ts`.
**Interfaces:** `createServerResolutionService(deps: ServerResolutionDeps): ServerResolutionService`; `getServerResolutionService(): ServerResolutionService` trong composition. Shared adapter wrap `readSharedResolution`/`writeSharedResolution`; null port nghĩa là shared cache không được cấu hình, khác với read trả null vì outage.

- [ ] Viết test instance isolation, in-flight coalescing, invalidation và hai instance cùng shared fake. Tạo service A/B cùng `SharedCachePort` giả nhưng maps local khác nhau. Không dùng `vi.resetModules()` để giả lập service instance trong test mới.
- [ ] Chuyển maps và helpers `generationFor`, `storeL1`, `mutateCache`, `persistResolution` vào factory. Các maps chỉ sống trong closure của instance; không tạo service mới mỗi HTTP request.
- [ ] Chuyển phần `GET` sau parse và trước `respondWith` vào `resolve`. Giữ các bước: normalize identity có album → revoke local ownership trước await → đọc shared epoch → kiểm tra epoch cũ bằng BigInt → L1 → static Drive → L2 → dedup → cold resolve → initial publish → late preferred publish.
- [ ] Giữ chính xác điều kiện outage: có shared port nhưng read thất bại thì không dùng unvalidated L1 và không ghi L2 kiểu cũ. Không biến outage thành miss hợp lệ.
- [ ] Giữ serialization per-key cho publication. Không xóa generation rows/map chỉ vì payload hết TTL; không đổi opaque decimal string thành Number.
- [ ] Test các lịch sau bằng deferred promise: A cold → B invalidate → A publish; delayed shared read epoch 0 sau epoch 1; late NCT đến trước initial await tiếp tục; rejected publication; shared outage; miss không downgrade hit. Assert kết quả cache thực tế, không chỉ số lần gọi mock.
- [ ] Chạy suite service và `npm run test:playback-db`. SQL helper/schema giữ nguyên; test DB chỉ dùng PGlite local.

## Task 3 — Route facade và contract HTTP

**Files:** Modify `app/api/resolve-stream/route.ts`, hai test cache route hiện có; create `app/api/resolve-stream/__tests__/httpContract.test.ts`.
**Interfaces:** Giữ `GET(request: NextRequest): Promise<Response>`, `dynamic = 'force-dynamic'`, response miss/hit, URLs và Cache-Control hiện tại. Không export factory tùy ý từ file route.

- [ ] Viết contract test route: thiếu title → 400 hiện tại; miss → 200 `{ miss: true }`; hit từng source giữ fields và stream URL; successful response luôn `Cache-Control: no-store`; `invalidate=1` được truyền vào service; query album/duration parse giữ nguyên.
- [ ] Composition lazy-create adapter DB theo logic env hiện tại, giữ service instance; không chụp request cookies/user vào singleton. Chuyển facade thành parse → service.resolve → respondWith. Giữ `respondWith` hoặc chuyển sang module sibling nếu cần test, không hợp nhất client URL builder trong PR này.
- [ ] Chuyển test route cache sang seam mới khi cần nhưng giữ ít nhất một test qua `GET` chứng minh wiring thật dùng service. Test độc lập coordination ở Task 2 không được thay thế hoàn toàn HTTP tests.
- [ ] Verify:

```powershell
npm test -- lib/stream-resolution/server app/api/resolve-stream/__tests__ lib/__tests__/catalogResolutionRace.test.ts
npm run test:playback-db
npx tsc --noEmit --incremental false
npx eslint lib/stream-resolution/server app/api/resolve-stream
```

**Acceptance:** Route không chứa cache maps/provider orchestration; factory không import Next/Supabase runtime; hai service instance test riêng; HTTP và SQL protocol giữ nguyên. Bàn giao P07 với test evidence và danh sách file di chuyển.

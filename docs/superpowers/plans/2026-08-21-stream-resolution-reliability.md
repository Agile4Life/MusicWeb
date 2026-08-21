# Stream Resolution Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NCT retries real, prevent slow resolvers from blocking catalog playback, return valid Piped streams immediately, and cap NCT prewarm concurrency.

**Architecture:** Keep existing source contracts and Drive fast paths. Add small pure async helpers for retry classification, valid-result racing, and bounded concurrency so behavior is unit-testable without external APIs. Wire those helpers into existing route and player code without changing public API response shapes.

**Tech Stack:** TypeScript, Next.js 16 route handlers, React 19, Vitest 4.

## Global Constraints

- Preserve existing playback request-id guards and source response schemas.
- Never retry a 4xx response; retry only HTTP 500/502/503/504 and classified network/timeout errors.
- Do not persist signed URLs beyond their existing caches.
- Do not change R2 configuration, deployed Workers, or secrets in this plan.
- Run focused tests with `npm.cmd run test -- <file>` and commit each completed task separately.

---

## File Structure

- `lib/fetchWithRetry.ts`: classify resolved responses as retryable as well as thrown transient errors.
- `lib/__tests__/fetchWithRetry.test.ts`: regression coverage for response and thrown-error retries.
- `lib/firstValidResult.ts`: pure helper that returns the first non-null async result.
- `lib/__tests__/firstValidResult.test.ts`: ensures null candidates do not win and delayed candidates do not block a valid result.
- `lib/youtubeStream.ts`: use the valid-result helper for Piped instances.
- `lib/catalogResolutionRace.ts`: pure staggered race helper giving NCT a short head start.
- `lib/__tests__/catalogResolutionRace.test.ts`: source preference and slow-provider regressions.
- `app/api/resolve-stream/route.ts`: use the catalog race helper after Drive misses.
- `lib/limitedConcurrency.ts`: generic bounded-concurrency mapper.
- `lib/__tests__/limitedConcurrency.test.ts`: verifies the maximum active operation count.
- `lib/prewarmTrackBatch.ts`: use bounded concurrency for NCT prewarm.

### Task 1: Make NCT retry semantics match the documented policy

**Files:**
- Modify: `lib/fetchWithRetry.ts`
- Create: `lib/__tests__/fetchWithRetry.test.ts`

**Interfaces:**
- Consumes: `fn: () => Promise<T>` and `retryOn?: (outcome: T | unknown, attempt: number) => boolean`.
- Produces: `fetchWithRetry<T>()`, which retries resolved retryable responses and thrown retryable errors.

- [ ] **Step 1: Write the failing tests**

```ts
it('retries a transient HTTP response before returning success', async () => {
  const operation = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response('ok', { status: 200 }))

  const result = await fetchWithRetry(operation, {
    retries: 1,
    baseDelayMs: 0,
    retryOn: (outcome) => outcome instanceof Response && isTransientError(outcome),
  })

  expect(result.status).toBe(200)
  expect(operation).toHaveBeenCalledTimes(2)
})
```

Add one test where a `TimeoutError` is retried and one where a `403` is returned after one attempt.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm.cmd run test -- lib/__tests__/fetchWithRetry.test.ts`

Expected: the transient-response test fails because the current helper returns the first `503` response.

- [ ] **Step 3: Implement minimal response-aware retry behavior**

Update `fetchWithRetry` so it evaluates `retryOn(result, attempt)` immediately after a successful `await fn()`. If true and attempts remain, wait then continue; otherwise return the result. In `catch`, evaluate the same predicate against the error. Keep the final error behavior unchanged.

- [ ] **Step 4: Update NCT callers to classify thrown transient errors**

In each NCT route that calls `fetchWithRetry`, import `isNetworkError` and set:

```ts
retryOn: (outcome) =>
  outcome instanceof Response ? isTransientError(outcome) : isNetworkError(outcome),
```

- [ ] **Step 5: Run focused tests to verify green**

Run: `npm.cmd run test -- lib/__tests__/fetchWithRetry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/fetchWithRetry.ts app/api/nhaccuatui lib/__tests__/fetchWithRetry.test.ts
git commit -m "fix: retry transient NCT responses"
```

### Task 2: Return the first valid Piped stream

**Files:**
- Create: `lib/firstValidResult.ts`
- Create: `lib/__tests__/firstValidResult.test.ts`
- Modify: `lib/youtubeStream.ts`

**Interfaces:**
- Produces: `firstValidResult<T>(tasks: Array<() => Promise<T | null>>): Promise<T | null>`.
- Consumes: Piped resolver functions that return a stream or `null`.

- [ ] **Step 1: Write failing helper tests**

```ts
it('returns the first non-null result without waiting for a slower task', async () => {
  const result = await firstValidResult([
    async () => null,
    async () => ({ url: 'https://fast.example/audio', mimeType: 'audio/mp4' }),
    async () => new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
  ])

  expect(result).toEqual({ url: 'https://fast.example/audio', mimeType: 'audio/mp4' })
})
```

Also assert that all-null and rejected tasks return `null`.

- [ ] **Step 2: Run the test to verify red**

Run: `npm.cmd run test -- lib/__tests__/firstValidResult.test.ts`

Expected: FAIL because `firstValidResult` does not exist.

- [ ] **Step 3: Implement the helper and use it for Piped**

Each task must reject internally when it has no usable value. Use `Promise.any` only over those rejecting wrappers; catch its aggregate failure and return `null`. Replace Piped's `Promise.allSettled` plus loop in `lib/youtubeStream.ts` with this helper.

- [ ] **Step 4: Run focused tests to verify green**

Run: `npm.cmd run test -- lib/__tests__/firstValidResult.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/firstValidResult.ts lib/__tests__/firstValidResult.test.ts lib/youtubeStream.ts
git commit -m "fix: return first valid Piped stream"
```

### Task 3: Stop catalog resolution from awaiting all providers

**Files:**
- Create: `lib/catalogResolutionRace.ts`
- Create: `lib/__tests__/catalogResolutionRace.test.ts`
- Modify: `app/api/resolve-stream/route.ts`

**Interfaces:**
- Produces: `resolveCatalogCandidates<T>(preferred: () => Promise<T | null>, fallbacks: Array<() => Promise<T | null>>, preferredHeadStartMs?: number): Promise<T | null>`.
- Consumes: NCT as preferred candidate, then YouTube and SoundCloud fallbacks.

- [ ] **Step 1: Write failing behavior tests**

```ts
it('returns a fallback instead of waiting for a slow preferred source after its head start', async () => {
  const startedAt = Date.now()
  const result = await resolveCatalogCandidates(
    () => new Promise((resolve) => setTimeout(() => resolve({ source: 'nct' }), 200)),
    [async () => ({ source: 'youtube' })],
    20,
  )

  expect(result).toEqual({ source: 'youtube' })
  expect(Date.now() - startedAt).toBeLessThan(100)
})
```

Add a test that NCT wins when it resolves inside the head-start period and a test that all-null candidates return `null`.

- [ ] **Step 2: Run the test to verify red**

Run: `npm.cmd run test -- lib/__tests__/catalogResolutionRace.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the staggered valid-result race**

Start the preferred task immediately. Wait up to 250ms for it; if it does not yield a valid result, start fallbacks and return the first valid result from all still-running tasks. Null/rejected candidates must not win. Do not await unresolved losers after a winner is selected.

- [ ] **Step 4: Wire route calls to the helper**

Replace the `Promise.all([tryNct(), tryYoutube(), trySoundCloud()])` block in `resolveStream` with `resolveCatalogCandidates(tryNct, [tryYoutube, trySoundCloud])`. Keep the existing Drive path and response/cache structures unchanged.

- [ ] **Step 5: Run focused tests to verify green**

Run: `npm.cmd run test -- lib/__tests__/catalogResolutionRace.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/catalogResolutionRace.ts lib/__tests__/catalogResolutionRace.test.ts app/api/resolve-stream/route.ts
git commit -m "perf: avoid waiting for slow catalog resolvers"
```

### Task 4: Cap NCT prewarm concurrency at two

**Files:**
- Create: `lib/limitedConcurrency.ts`
- Create: `lib/__tests__/limitedConcurrency.test.ts`
- Modify: `lib/prewarmTrackBatch.ts`

**Interfaces:**
- Produces: `mapWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void>`.
- Consumes: deduplicated NCT tracks and `prewarmNctStreamUrl`.

- [ ] **Step 1: Write a failing concurrency test**

```ts
it('never runs more tasks than the limit', async () => {
  let active = 0
  let peak = 0
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
  })
  expect(peak).toBe(2)
})
```

- [ ] **Step 2: Run the test to verify red**

Run: `npm.cmd run test -- lib/__tests__/limitedConcurrency.test.ts`

Expected: FAIL because `mapWithConcurrency` does not exist.

- [ ] **Step 3: Implement the minimal worker-pool helper**

Reject non-positive or non-integer limits. Start `Math.min(limit, items.length)` workers, each claiming the next index until all tasks are processed. Await all workers.

- [ ] **Step 4: Use the helper for NCT prewarm**

Replace `Promise.allSettled(toPrewarm.map(...))` with `mapWithConcurrency(toPrewarm, 2, async (track) => { await prewarmNctStreamUrl(track.nhaccuatui_id!) })`. Catch individual prewarm errors inside the task so one failure does not stop later tracks.

- [ ] **Step 5: Run focused tests to verify green**

Run: `npm.cmd run test -- lib/__tests__/limitedConcurrency.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/limitedConcurrency.ts lib/__tests__/limitedConcurrency.test.ts lib/prewarmTrackBatch.ts
git commit -m "perf: bound NCT prewarm concurrency"
```

### Task 5: Verify the integrated change

**Files:**
- Modify only if verification identifies a defect in Tasks 1-4.

- [ ] **Step 1: Run all new focused tests**

Run:

```bash
npm.cmd run test -- lib/__tests__/fetchWithRetry.test.ts lib/__tests__/firstValidResult.test.ts lib/__tests__/catalogResolutionRace.test.ts lib/__tests__/limitedConcurrency.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm.cmd run lint`

Expected: PASS with no errors.

- [ ] **Step 3: Run the full suite and classify failures**

Run: `npm.cmd run test`

Expected: new tests and all deterministic tests pass. Existing tests that call real external lyrics/SoundCloud APIs must be reported separately if network isolation makes them fail.

- [ ] **Step 4: Review diff and commit any verification-only correction**

Run: `git diff --check` and `git status --short`.

If an additional correction was required, commit only that correction:

```bash
git add <verified-files>
git commit -m "test: verify stream resolution reliability"
```

## Plan Self-Review

- Spec coverage: Tasks 1-4 map one-to-one to every in-scope design requirement; Task 5 verifies them together.
- No placeholders: all files, public helpers, tests, commands, and commit boundaries are explicit.
- Type consistency: route candidates use `Promise<L1Entry | null>` and satisfy the generic `T | null` helper contracts; prewarm uses `Track` with its existing optional `nhaccuatui_id` guard.

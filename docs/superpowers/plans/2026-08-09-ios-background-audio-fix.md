# iOS Background Audio Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direct HTML5 audio sources reliable for Safari iOS background playback while routing YouTube tracks directly to the existing non-background IFrame engine.

**Architecture:** Add a tiny client-safe helper that awaits an audio element's `play()` Promise. `PlayerContext` will use it for direct playback and Media Session play actions, updating state only after success. YouTube tracks will return no HTML5 source from `getAudioUrl`, so they enter the IFrame path immediately.

**Tech Stack:** Next.js 16.2.12, React 19, TypeScript, Vitest 4.

## Global Constraints

- Do not change authentication, database schema, service-worker caching, or upload/stream route contracts.
- YouTube background/lock-screen playback is explicitly out of scope.
- New tests must run in Vitest's Node environment without browser automation or external network.
- Production code must be written only after its regression test has failed.

---

### Task 1: Add the failing playback Promise regression tests

**Files:**
- Create: `lib/__tests__/audioPlayback.test.ts`
- Create: `lib/audioPlayback.ts`

**Interfaces:**
- Produces `playAudioElement(audio: Pick<HTMLAudioElement, 'play'>): Promise<void>` for `PlayerContext`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { playAudioElement } from '../audioPlayback'

describe('playAudioElement', () => {
  it('waits for a successful audio.play Promise', async () => {
    const play = vi.fn().mockResolvedValue(undefined)

    await expect(playAudioElement({ play })).resolves.toBeUndefined()
    expect(play).toHaveBeenCalledOnce()
  })

  it('propagates a rejected audio.play Promise', async () => {
    const error = new Error('NotAllowedError')
    const play = vi.fn().mockRejectedValue(error)

    await expect(playAudioElement({ play })).rejects.toBe(error)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module**

Run: `npm.cmd test -- lib/__tests__/audioPlayback.test.ts`

Expected: FAIL because `lib/audioPlayback.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal helper**

```ts
export async function playAudioElement(audio: Pick<HTMLAudioElement, 'play'>): Promise<void> {
  await audio.play()
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm.cmd test -- lib/__tests__/audioPlayback.test.ts`

Expected: 2 tests pass.

### Task 2: Route YouTube directly to the IFrame engine

**Files:**
- Modify: `components/player/PlayerContext.tsx:263-304`
- Test: `lib/__tests__/audioPlayback.test.ts`

**Interfaces:**
- `getAudioUrl` returns `null` for tracks with `source === 'youtube'` or a `youtube_id`, allowing the existing `tryLoadYt` path to run immediately.

- [ ] **Step 1: Add a focused source-routing assertion to the test file**

Add a pure assertion for the routing rule through an exported helper:

```ts
import { shouldUseHtml5Audio } from '../audioPlayback'

it('does not route YouTube tracks to HTML5 audio', () => {
  expect(shouldUseHtml5Audio({ source: 'youtube', youtube_id: 'abc123' })).toBe(false)
  expect(shouldUseHtml5Audio({ source: 'local' })).toBe(true)
})
```

- [ ] **Step 2: Run the focused test and verify the new routing test fails**

Run: `npm.cmd test -- lib/__tests__/audioPlayback.test.ts`

Expected: FAIL because `shouldUseHtml5Audio` is not defined.

- [ ] **Step 3: Implement the minimal routing helper and use it in `getAudioUrl`**

```ts
export function shouldUseHtml5Audio(track: { source?: string; youtube_id?: string }): boolean {
  return track.source !== 'youtube' && !track.youtube_id
}
```

Import it into `PlayerContext.tsx`, and return `null` before constructing a YouTube proxy URL when it returns `false`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm.cmd test -- lib/__tests__/audioPlayback.test.ts`

Expected: 3 tests pass.

### Task 3: Await direct playback and Media Session playback

**Files:**
- Modify: `components/player/PlayerContext.tsx:870-1044,1606-1614`

**Interfaces:**
- Direct HTML5 playback sets `isPlaying` only after `playAudioElement(audio)` resolves.
- Media Session `play` uses the same helper and sets `isPlaying=false` when playback is rejected.

- [ ] **Step 1: Update the direct playback path**

Set the initial state to buffering/stopped while resolving a source. Replace the unawaited call with:

```ts
try {
  await playAudioElement(audio)
  if (requestId !== playRequestRef.current) return
  setIsPlaying(true)
  setPlaybackError(null)
  return
} catch (err: any) {
  if (err?.name === 'AbortError' || String(err).includes('interrupted')) return
  setIsPlaying(false)
  console.warn('HTML5 audio stream playback info:', err)
}
```

- [ ] **Step 2: Update the Media Session play handler**

Keep the YouTube branch unchanged. In the HTML5 branch, await `playAudioElement(audioRef.current)` inside an async callback and only then set `isPlaying(true)`; on rejection set `isPlaying(false)` and preserve the warning/error path.

- [ ] **Step 3: Run focused and existing tests**

Run: `npm.cmd test -- lib/__tests__/audioPlayback.test.ts`

Expected: all focused tests pass.

### Task 4: Verify the regression fix

**Files:**
- Verify: `components/player/PlayerContext.tsx`
- Verify: `lib/audioPlayback.ts`
- Verify: `lib/__tests__/audioPlayback.test.ts`

- [ ] **Step 1: Run the complete test suite**

Run: `npm.cmd test`

Expected: the new audio tests pass; report the pre-existing lyrics/network failures separately if they remain.

- [ ] **Step 2: Run TypeScript/build verification**

Run: `npx.cmd tsc --noEmit`

Expected: no new type errors from the playback change.

- [ ] **Step 3: Inspect the final diff and worktree**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only the intended spec/plan and playback source/test files are changed. Commit creation may be unavailable because this workspace exposes `.git` as read-only.

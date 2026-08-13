# Playback Race Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale playback callbacks and timers from skipping or overwriting the active track during rapid transitions.

**Architecture:** Reuse `playRequestRef` as the ownership generation for every playback operation. Add timer invalidation and guard checks at callback boundaries, while keeping the current HTML5 and YouTube engines intact.

**Tech Stack:** Next.js/React, TypeScript, Vitest.

## Global Constraints

- Do not change lyrics or external provider behavior.
- Do not add a new playback engine or dependency.
- Every production change must have a regression test or be covered by an existing focused test.

---

### Task 1: Add focused guard utilities and regression tests

**Files:**
- Create: `lib/__tests__/playbackRaceGuards.test.ts`
- Create: `lib/playbackRaceGuards.ts`

- [ ] Write tests for stale generation rejection, track-id mismatch rejection, and current generation acceptance.
- [ ] Run `npm.cmd test -- --run lib/__tests__/playbackRaceGuards.test.ts` and verify the new tests fail because the helper does not exist.
- [ ] Implement the minimal pure helper.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Guard HTML5 and YouTube transitions

**Files:**
- Modify: `components/player/PlayerContext.tsx`

- [ ] Add a timer cleanup helper and invalidate timers at the beginning of `playTrack` and quick-play transitions.
- [ ] Capture request generation/track identity in HTML5 retry and fallback callbacks.
- [ ] Guard `ended`, `loadedmetadata`, and error fallback state changes.
- [ ] Guard YouTube delayed watchdog and async fallback callbacks.
- [ ] Use `currentIndexRef`/`queueRef` for queue removal decisions.

### Task 3: Verify playback behavior

- [ ] Run `npm.cmd test -- --run lib/__tests__/playbackRaceGuards.test.ts lib/__tests__/audioPlayback.test.ts lib/__tests__/queueRecommend.test.ts`.
- [ ] Run `npm.cmd test` and record any failures separately from playback changes.
- [ ] Run `npm.cmd run lint -- components/player/PlayerContext.tsx lib/playbackRaceGuards.ts` if the project lint command accepts file arguments.

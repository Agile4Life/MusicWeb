# iOS Background Playback Recovery Implementation Plan

> Execute the approved audit fixes in the current checkout; preserve the existing review artifact and leave changes reviewable.

**Goal:** Preserve first-play activation, make OS commands deterministic, and keep iOS recovery in native HTML audio.

**Architecture:** Keep the existing source service/controller/transport boundaries. Add explicit playback intent operations and an injected iframe capability; prepare catalog alternatives concurrently with native playback.

**Tech Stack:** Next.js 16.2.12, React 19.2.4, TypeScript, Vitest.

## Global Constraints

- Read relevant installed Next.js docs before editing; completed for Client Components, routes and Vitest.
- No silent-audio workaround, service-worker lifetime claim or new backend endpoint.
- Preserve desktop/Android iframe support, ownership checks and user Pause intent.
- The user requested a local commit after verification; preserve independent changes from other tasks.

### Task 1: Regression tests

**Files:** `components/player/__tests__/iosPlayback.test.ts`, `lib/playback/__tests__/playbackSourceService.test.ts`.

- [x] Add integration tests with production source service/controller/transport/engines and simulated media/network boundaries.
- [x] Verify cold selection calls native play before awaiting catalog, with a strict gesture fake.
- [x] Verify one OS Play resumes after `NotAllowedError`; OS Pause prevents activation recovery.
- [x] Verify repeated Play/Pause are idempotent and late playback completion respects Pause.
- [x] Verify iOS proxy failure never starts iframe in foreground, background, event recovery or quick Next.
- [x] Verify next-track prewarm promotes a resolved catalog stream; iOS alternate-video recovery returns HTML5.
- [x] Run the new tests first and record expected failures before implementation.

### Task 2: Playback intent commands

**Files:** `lib/playback/controllerTypes.ts`, `lib/playback/playbackController.ts`, `components/player/runtime/mediaSessionBinding.ts`.

**Interfaces:**

```ts
play(): Promise<void>;
pause(): void;
// Existing UI API remains available.
togglePlay(): Promise<void>;
```

- [x] Extract explicit Pause and Play from toggle; preserve request/toggle ownership checks.
- [x] A blocked Play sets pending resume, clears buffering and does not re-resolve or pause.
- [x] Bind MediaSession Play to `controller.play()`; Pause/Stop to `controller.pause()`.
- [x] Run integration and existing MediaSession/controller tests.

### Task 3: Native iOS source selection and recovery

**Files:** `lib/playback/playbackSourceService.ts`, `lib/playback/controllerTypes.ts`, `lib/playback/playbackController.ts`, `components/player/runtime/createPlayerRuntime.ts`.

**Interface:**

```ts
canUseYouTubeIframe?: () => boolean; // defaults true; browser runtime disables on iOS
```

- [x] Return the deterministic YouTube HTML5 endpoint synchronously on cold iOS selection.
- [x] Start the deduplicated catalog candidate lookup without awaiting it before native play.
- [x] Resolve catalog alternatives during direct YouTube upcoming prewarm and retain generation guards.
- [x] Return HTML5 for iOS alternate-video recovery; do not return an iframe when no iOS stream exists.
- [x] Reject unsupported iframe targets before transport side effects, including persisted restore.
- [x] Keep a paused/error result when all HTML5 recovery options fail.
- [x] Update old tests that intentionally asserted the removed blocking first-play policy.
- [x] Run the integration/source/controller test set and inspect remaining failures before expanding checks.

### Task 4: Review and final verification

- [x] Run all relevant player/source/runtime regression tests once fixes are stable.
- [x] Run TypeScript, ESLint on affected source/tests, and a production build.
- [x] Request an independent read-only code review under the requesting-code-review skill.
- [x] Address significant findings and rerun checks affected by any follow-up change.
- [x] Record actual validation results and the remaining real-iPhone validation limitation.

Validation: 43 suites / 275 tests, TypeScript, scoped ESLint, SW syntax and independent review passed. Production build was attempted but Google Fonts downloads failed due to the environment network; see docs/reviews/2026-10-26-ios-background-playback-fix.md.

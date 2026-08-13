# Plan: Now Playing Signature 3D

> **For agent:** Execute this plan only after the CORS gate below is satisfied. Keep the implementation within the existing React Three Fiber/Three setup; do not add a heavyweight 3D dependency or change playback/data contracts.

## Goal

Turn Now Playing into the product’s single signature moment: album-cover planet/disk, restrained depth particles, cover-derived glow/rim light, readable lyrics, and a quiet responsive fallback.

## Scope and independence

This plan owns `NowPlayingStage`, `ParticleScene`, `LyricsView`, `TrackCoverImage` integration, and the color-extraction utility/data contract. It can fall back to existing accent tokens when the source is not readable or extraction fails.

## CORS gate and extraction decision

The checked representative responses returned `Access-Control-Allow-Origin: *` for:

- YouTube: `img.youtube.com/vi/ogalxoVRNuQ/hqdefault.jpg`
- Deezer: a live `cdn-images.dzcdn.net` cover URL obtained from the Deezer search API
- iTunes: a live `is1-ssl.mzstatic.com` artwork URL obtained from the iTunes search API

This is evidence that the major provider paths can support client-side sampling, not a guarantee for arbitrary `cover_url` values stored in the database. Before implementation, add a runtime capability check: load the image with `crossOrigin="anonymous"`, draw only after it is complete, and treat a canvas `SecurityError`/tainted canvas as a normal failure. For failed or unknown origins, use a server-side upload/ingest extraction path and persist a derived color alongside the track/album metadata. Never block playback or rendering on extraction.

All pixel sampling must first downsample the source to approximately 32×32 pixels (allowed range 20–50px), then read the small canvas. Do not read the original cover dimensions or sample on every animation frame.

## Five-phase mapping

1. **Phase 1 — Audit and foundation:** inventory current stage layers, CSS transforms, text paths, and existing `album-3d-reflection`/parallax behavior.
2. **Phase 2 — Signature structure:** stabilize album stage, rim/reflection, lyric emphasis, and welcome/background depth contracts.
3. **Phase 3 — Particles and finishing:** split particles into restrained depth layers, add skeleton/empty fallbacks, and keep motion intentional.
4. **Phase 4 — Color extraction:** run the CORS-gated 32×32 sampler, derive a safe accent/glow, and apply it to rim light/reflection/background only.
5. **Phase 5 — Hardening:** reduced motion, focus, Safari/canvas fallback, performance budgets, responsive layout, and visual QA.

## Implementation steps

### 1. Audit and stage contract

- Inspect `components/player/NowPlayingStage.tsx`, `components/player/NowPlayingOverlay.tsx`, `components/player/ParticleScene.tsx`, `components/player/StageWithFrequencyData.tsx`, `components/player/LyricsView.tsx`, `components/common/TrackCoverImage.tsx`, and the matching CSS in `app/globals.css`.
- Preserve the already improved lyric readability: high contrast, limited mask fade, modest active scale, no strong blur, and no transform on the text itself that causes rasterized blur.
- Define a stable layer order: background glow/particles → album stage → reflection/rim → lyrics and metadata → controls/focus affordances.

### 2. Album planet/disk and depth lighting

- Reuse the current album-cover and reflection structure. Tune perspective, rim light, and specular highlight with transform/opacity and the optional `--player-derived-accent` fallback.
- Keep the single-light-source rule: top-left-ish directional highlight with restrained shadow beneath; avoid multiple competing glows.
- Ensure the cover remains sharp: do not apply blur/filter to the image itself, and avoid unnecessary nested transforms around title/lyric text.
- Keep mouse/pointer parallax bounded, disabled for reduced motion, and inert on touch/no-hover devices.

### 3. ParticleScene and fallback states

- In `ParticleScene.tsx`, retain Three/R3F but separate the field into two or three low-density depth layers with different size/opacity/speed; cap DPR/particle count on small or constrained devices.
- Drive animation from `useFrame` with stable references; avoid React state updates per frame and remove listeners on unmount.
- Add a CSS/DOM fallback when WebGL is unavailable, reduced motion is enabled, or the device budget is exceeded. The album and lyrics must remain fully usable.
- Reuse `HeroCardSkeleton`/existing skeleton conventions for loading transitions and provide a quiet empty state for missing cover/lyrics without changing copy/actions.

### 4. CORS-safe cover color extraction

- Add a small utility near the existing media utilities (for example `lib/coverColor.ts`) with explicit inputs: image URL, target sample size (default 32), and optional fallback accent.
- Use an offscreen canvas at 32×32 (clamped to 20–50), draw the loaded image into it, read pixels once, reject transparent/near-black/near-white noise, and return a bounded color representation suitable for CSS custom properties.
- Cache by normalized image URL and invalidate when the cover URL changes. Do not run extraction on progress updates or every render.
- On client-side CORS failure, use the ingest/server path: extend the relevant track/album persistence shape and ingestion routes only as needed to store the derived color. If schema migration is required, document the exact migration and keep nullable fallback behavior for existing rows.
- Apply the result only to CSS variables for glow/rim/reflection/background. The base accent remains the fallback and no control text may lose contrast.
- Add tests for downsample dimensions, cache reuse, transparent/noisy images, CORS/tainted-canvas failure, fallback color, and URL changes.

### 5. Lyrics readability and motion policy

- In `LyricsView.tsx`, keep active-line emphasis through contrast, weight, modest scale, and a restrained accent marker. Keep surrounding lines readable enough to scan; do not reintroduce aggressive opacity or blur.
- Animate lyric transitions with opacity/transform on the line container only when it does not blur glyphs; verify at 100% zoom on Chromium and Safari.
- Preserve lyric loading request guards and active-index behavior; this plan must not alter timing or playback state.
- Honor `prefers-reduced-motion`, keyboard focus, and screen-reader semantics. Reduced motion may remove parallax/particle movement but must retain the active-line cue.

### 6. Verification and visual review

- Run typecheck/lint/unit tests plus the color-extraction tests and a production build.
- Exercise: missing cover, cross-origin failure, WebGL unavailable, reduced motion, mobile width, long lyric lines, rapid track changes, and opening/closing the overlay.
- Take before/after screenshots at 1440×900 and 390×844 for album stage, particles, and lyrics. Save under `docs/superpowers/visual-reviews/now-playing-signature-before.png` and `now-playing-signature-after.png`.
- Review at 100% zoom for lyric sharpness, album edge/rim stability, glow contrast, particle distraction, focus visibility, and fallback quality; record findings in `docs/superpowers/visual-reviews/now-playing-signature-3d.md` and fix visual regressions before completion.

## Acceptance criteria

- The album stage is the only high-expression 3D surface; the rest remains quiet and readable.
- Color extraction is CORS-safe, sampled from a 20–50px canvas, cached, non-blocking, and has ingest/fallback behavior.
- Lyrics are visibly sharper and more readable than the current blurred/faded treatment while retaining animation.
- WebGL, reduced-motion, mobile, and missing-data fallbacks remain functional.
- Automated checks and the before/after visual review pass without playback or race-condition regressions.

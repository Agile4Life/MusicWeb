# Plan: Player & Navigation Depth

> **For agent:** Execute this plan independently. Do not alter audio state transitions, queue semantics, routing, or the race-condition guards already present. This plan is visual/interaction polish around those contracts.

## Goal

Give the persistent player and queue/navigation surfaces quiet depth: clear glass hierarchy, stable active-track treatment, and intentional micro-motion that remains readable and race-safe.

## Scope and independence

This plan owns `PlayerBar`, queue/up-next surfaces, and navigation-adjacent player chrome. It may consume the token aliases from the foundation plan; if they are absent, preserve the existing variables and add local fallbacks rather than requiring that plan to land first.

## Five-phase mapping

1. **Phase 1 — Audit and foundation:** inventory player/queue surfaces and map existing classes to elevation/radius/motion tokens.
2. **Phase 2 — Player depth:** refine persistent player glass, progress, controls, and active queue state.
3. **Phase 3 — Signature preparation:** establish stable layering/z-index and transition contracts used by the Now Playing overlay.
4. **Phase 4 — Color extraction gate:** keep player chrome on the established accent; receive optional derived color from the Now Playing plan without making audio controls depend on extraction success.
5. **Phase 5 — Hardening:** focus, reduced motion, responsive/mobile behavior, and visual QA under rapid track changes.

## Implementation steps

### 1. Audit the player surface

- Inspect `components/player/PlayerBar.tsx`, `components/player/QueueDrawer.tsx`, `components/player/UpNextList.tsx`, `components/player/NowPlayingOverlay.tsx`, and relevant `.player-bar`, `.mini-player`, drawer, and queue rules in `app/globals.css`.
- Capture a baseline with desktop player, mobile mini-player, open queue, and active/up-next rows.
- Map z-index ownership so the player, drawer, overlay, focus rings, and tooltips cannot accidentally create a new stacking context that clips controls.

### 2. Refine desktop and mobile player chrome

- Keep `.player-bar` as one large glass surface with one border highlight and a tokenized shadow; do not blur individual text/control elements.
- Keep progress animation on transform/width as currently supported, but avoid animating box-shadow or filter on every progress tick.
- Preserve button handlers and `usePlayer` state. Add only visual states for hover, pressed, focus-visible, disabled, and buffering/error if those states already exist in the component.
- Apply the same hierarchy to `.mini-player` without introducing a second mobile-only visual language.

### 3. Queue and Up Next state

- In `QueueDrawer.tsx` and `UpNextList.tsx`, make the current track identifiable with a restrained accent rail/glow and clear text contrast; do not rely on opacity alone.
- Keep list rows lightweight: transform/opacity micro-motion only, no per-row backdrop filters or large shadows.
- Ensure queue open/close animation can be interrupted without leaving `aria-hidden`, focus, or pointer-event state stale.
- Verify the current-track indicator remains correct during rapid next/previous actions; this is a visual audit of the existing race-safe state, not a change to playback logic.

### 4. Overlay handoff contract

- In `NowPlayingOverlay.tsx`, preserve a stable overlay shell and define the visual handoff points for the signature stage: backdrop, stage layer, lyric layer, close button, and player controls.
- Keep the close/focus behavior intact and make focus-visible outlines readable above the glass layers.
- Define an optional CSS custom property interface such as `--player-derived-accent` with fallback to `--accent`; no player behavior may wait for a color extraction promise.

### 5. Verification and visual review

- Run the project’s typecheck/lint/test commands from `package.json`.
- Exercise desktop and mobile controls with keyboard, pointer, touch-sized targets, reduced motion, and a sequence of rapid track changes while the queue is open.
- Take before/after screenshots at 1440×900 and 390×844 for persistent player, open queue, and overlay states. Save under `docs/superpowers/visual-reviews/player-navigation-depth-before.png` and `player-navigation-depth-after.png`.
- Review screenshots for text sharpness, active-row clarity, clipping, z-index errors, and motion residue after closing the queue; record findings in `docs/superpowers/visual-reviews/player-navigation-depth.md` and fix issues before completion.

## Acceptance criteria

- Player, mini-player, queue, and overlay share consistent depth without per-element blur overload.
- Existing playback, queue, routing, and focus behavior is preserved.
- Rapid track changes never leave stale visual active states after the current render settles.
- Automated checks pass and visual review confirms readability at desktop/mobile sizes.

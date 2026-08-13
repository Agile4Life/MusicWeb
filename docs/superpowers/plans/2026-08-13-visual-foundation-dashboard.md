# Plan: Visual Foundation & Dashboard Depth

> **For agent:** Execute this plan task-by-task. Preserve existing data, navigation, audio, and playback behavior. Use the current accent tokens; do not introduce a second brand palette.

## Goal

Deliver the shared depth foundation and the dashboard-facing half of the five-phase upgrade: clearer elevation, restrained glass surfaces, coherent hover tilt, and a layered welcome/dashboard presentation without changing business logic.

## Scope and independence

This is an independently testable deliverable. It owns global visual tokens and dashboard surfaces. The player plan and Now Playing plan may consume these tokens, but this plan must remain usable if they are implemented later by retaining existing-token fallbacks.

## Five-phase mapping

1. **Phase 1 — Audit and foundation:** capture baseline, reconcile tokens in `app/globals.css`, and verify text clarity/reduced-motion behavior.
2. **Phase 2 — Dashboard depth:** refine cards, sidebar/active state, hero banner, and dashboard loading/empty states.
3. **Phase 3 — Signature preparation:** expose the same elevation/radius/motion contracts to player-facing consumers without adding player-specific effects here.
4. **Phase 4 — Color extraction gate:** document that dashboard cards do not extract colors; consume only the shared accent contract and wait for the Now Playing CORS decision.
5. **Phase 5 — Hardening:** responsive, accessibility, performance, and visual regression checks.

## Implementation steps

### 1. Baseline and token contract

- Inspect `app/globals.css`, `app/layout.tsx`, `app/(app)/page.tsx`, `components/common/TiltCard.tsx`, `components/sidebar/Sidebar.tsx`, and `components/navigation/TopBar.tsx`.
- Record current screenshots at 1440×900 and 390×844 for the dashboard, including loading and populated states.
- Normalize or alias existing values to the agreed contracts: `--elev-1` through `--elev-4`, `--radius-sm/md/lg/full`, `--ease-standard`, `--ease-spring`, `--dur-fast/base/slow`, and `--glow-accent`. Keep backwards-compatible aliases for existing `--elev-*-shadow` names.
- Keep `subpixel-antialiased`, readable contrast, and the current accent source. Do not reintroduce transforms on the text-rendering path.

### 2. Card interaction and elevation

- Update `components/common/TiltCard.tsx` so tilt is limited to pointer-capable devices, capped at the existing low angle, reset on leave, and disabled for reduced motion.
- Prefer transform/opacity for interaction. Use elevation tokens at rest/hover instead of continuously interpolating large box shadows.
- Update dashboard card markup in `app/(app)/page.tsx` only where needed to keep the cover, play affordance, and specular layer visually ordered; do not change card click or playback handlers.
- Verify the six trending cards do not create excessive rasterization or nested `transform` text blurring.

### 3. Sidebar, top bar, and hero depth

- Refine `components/sidebar/Sidebar.tsx` and `components/navigation/TopBar.tsx` using the shared glass/elevation contract: one subtle surface highlight, one active rail/glow, and visible keyboard focus.
- Refine the `.hero-banner` presentation in `app/globals.css` and the hero section in `app/(app)/page.tsx`: quiet gradient/parallax, no moving text, and no new hard-coded brand colors.
- Keep backdrop blur limited to the large panel surfaces; avoid applying it to every card.

### 4. Loading and empty-state continuity

- Reuse `components/common/SkeletonLoader.tsx` for dashboard loading states and replace generic full-card pulsing where it makes text/edges noisy.
- Audit dashboard empty states and preserve their existing actions, copy, and routing while improving hierarchy, icon treatment, and spacing.

### 5. Verification and visual review

- Run the repository’s typecheck/lint/test commands identified from `package.json`.
- Test keyboard focus, hover, touch/no-hover, 390px width, and `prefers-reduced-motion: reduce`.
- Take before/after screenshots at 1440×900 and 390×844 for the same seeded dashboard state. Save them under `docs/superpowers/visual-reviews/visual-foundation-dashboard-before.png` and `visual-foundation-dashboard-after.png`.
- Review the pair at 100% zoom for text sharpness, card edge stability, contrast, clipping, and unintended layout shifts; record findings in `docs/superpowers/visual-reviews/visual-foundation-dashboard.md` and fix any visual regression before declaring this plan complete.

## Acceptance criteria

- Dashboard cards, hero, sidebar, and top bar share one elevation/radius/motion system.
- Existing interactions and playback/navigation callbacks are unchanged.
- No continuous heavy shadow animation, text blur, or reduced-motion violation remains.
- Automated checks pass and the screenshot comparison shows improved hierarchy without reduced readability.

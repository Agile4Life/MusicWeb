# Design Spec: Advanced Hover/Motion Effects for MusicWeb Home Page

## Goal
Implement modern, high-performance 60fps hover and motion effects for song cards, album cards, and recently played track rows across the MusicWeb home page. All visual effects (border glows, shadows, overlays, accent bars) automatically adapt to the active theme using CSS variables (`var(--spotify-glow)`, `var(--primary-spotify)`) and `color-mix()`.

## Proposed Architecture & Design

### 1. Motion & Theme Tokens (`app/globals.css`)
- **Tokens**:
  - `--motion-fast: 160ms;`
  - `--motion-base: 240ms;`
  - `--motion-slow: 400ms;`
  - `--ease-out-smooth: cubic-bezier(0.16, 1, 0.3, 1);`
  - `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);`

### 2. Card Hover Effects (`.media-card`)
- **Layer A (Lift & Shadow)**:
  - `transform: translateY(-6px) scale(1.015)` on hover.
  - Shadow: `0 12px 24px -8px color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, transparent), 0 4px 8px -4px rgba(0, 0, 0, 0.4)`.
- **Layer B (Gradient Border Glow)**:
  - `::before` pseudo-element with `linear-gradient(135deg, color-mix(in srgb, var(--spotify-glow, #22d3ee) 60%, transparent), transparent 60%)`.
  - Border mask using `-webkit-mask` / `mask-composite: exclude` for crisp border glow.
- **Layer C (Cover Zoom & Play Button Spring)**:
  - Cover image: `transform: scale(1.06)` on hover.
  - Gradient overlay (`.cover-overlay`): Fades in on hover.
  - Play button (`.play-btn`): `transform: scale(0.8) translateY(6px)` ➔ `scale(1) translateY(0)` with `--ease-spring`.
- **Title Shift**:
  - Color transitions smoothly to `var(--spotify-glow)` on hover.

### 3. Track Rows Hover (`.recent-row` / `TrackRow`)
- Background hover shift to `bg-white/[0.06]`.
- Left accent indicator bar (`::before`): `transform: scaleY(0)` ➔ `scaleY(1)` with `var(--spotify-glow)`.
- Thumbnail image (`.row-thumb`): `transform: scale(1.08)`.
- Index number / Play icon crossfade.

### 4. Staggered Entry & Accessibility
- `@keyframes card-in` with `animation-delay: calc(var(--i, 0) * 40ms)`.
- `@media (prefers-reduced-motion: reduce)` disables all animations and transitions.
- Focus visible support matching `:hover` for keyboard navigation.

## Verification Plan
1. Test hovering over Album Cards and Song Cards on Home page — verify lift, glowing gradient border, cover image zoom, and play button spring transition.
2. Test hovering over Track Rows — verify left accent bar scaleY(1), thumbnail zoom, and index crossfade.
3. Test theme switching — verify all hover colors adapt to the selected theme.
4. Run `cmd /c "npm run test"` to ensure no regression errors.

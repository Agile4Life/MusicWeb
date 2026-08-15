# Minimal Flat Theme Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Minimal Flat" theme style engine in MusicWeb, providing an independent Light Mode flat aesthetic with zero glassmorphism, zero shadows, zero gradients, 1px neutral dividers, 6/8/12px border radii, and a single terracotta accent (`#D85A30`).

**Architecture:** Extend `ThemeStyle` in `ThemeContext.tsx` with `'minimal-flat'`, implement comprehensive CSS variable and component overrides in `app/globals.css` under `[data-theme-style="minimal-flat"]`, update `CursorSpotlight.tsx` to deactivate glow in minimal flat mode, and add a selection card in `ThemeSelector.tsx`.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind CSS v4, Vitest.

## Global Constraints

- Zero shadow across all components except `:focus-visible` ring (`0 0 0 2px #D85A30`).
- Zero gradient (solid colors only).
- Zero blur / backdrop-filter on all surfaces including modal overlays.
- Max 1px border (`#E5E3DA`) for functional separation only.
- Strict border radii: `6px` (thumbnails/images), `8px` (rows/cards/buttons/inputs), `12px` (main containers/modals).
- Single accent color: `#D85A30` (terracotta orange) for playing track, progress bar, and primary focus.
- Light mode locked (`color-scheme: light`) with palette: `#FAFAF7` (bg), `#F1EFE8` (surface-2/hover), `#1F1F1D` (primary text/play button), `#8A8677` (secondary text).
- Typography weight limited strictly to `400` and `500`.

---

### Task 1: Theme State Management & Context Extension

**Files:**
- Modify: `components/theme/ThemeContext.tsx`
- Test: `lib/__tests__/minimalFlatTheme.test.ts`

**Interfaces:**
- Consumes: `ThemeStyle = 'classic' | 'liquid-glass' | 'minimal-flat'`
- Produces: Updated `useTheme()` hook providing `themeStyle: 'minimal-flat'`, clean attribute cleanup on `<html>`

- [ ] **Step 1: Write the failing unit test**

Create `lib/__tests__/minimalFlatTheme.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { THEMES } from '@/components/theme/ThemeContext'

describe('Minimal Flat Theme Spec & Constants', () => {
  it('exports valid theme structure', () => {
    expect(THEMES).toBeDefined()
    expect(THEMES.slate).toBeDefined()
  })

  it('defines MINIMAL_FLAT_TOKENS adhering to spec rules', () => {
    const MINIMAL_FLAT_TOKENS = {
      bgSpace: '#FAFAF7',
      bgSurface2: '#F1EFE8',
      borderSubtle: '#E5E3DA',
      textPrimary: '#1F1F1D',
      textSecondary: '#8A8677',
      accent: '#D85A30',
      radiusThumb: '6px',
      radiusControl: '8px',
      radiusContainer: '12px',
    }

    expect(MINIMAL_FLAT_TOKENS.bgSpace).toBe('#FAFAF7')
    expect(MINIMAL_FLAT_TOKENS.bgSurface2).toBe('#F1EFE8')
    expect(MINIMAL_FLAT_TOKENS.borderSubtle).toBe('#E5E3DA')
    expect(MINIMAL_FLAT_TOKENS.textPrimary).toBe('#1F1F1D')
    expect(MINIMAL_FLAT_TOKENS.textSecondary).toBe('#8A8677')
    expect(MINIMAL_FLAT_TOKENS.accent).toBe('#D85A30')
    expect(MINIMAL_FLAT_TOKENS.radiusThumb).toBe('6px')
    expect(MINIMAL_FLAT_TOKENS.radiusControl).toBe('8px')
    expect(MINIMAL_FLAT_TOKENS.radiusContainer).toBe('12px')
  })
})
```

- [ ] **Step 2: Run test to verify it passes/fails**

Run: `npx vitest run lib/__tests__/minimalFlatTheme.test.ts`
Expected: PASS

- [ ] **Step 3: Update `ThemeContext.tsx` to support `minimal-flat`**

Update `ThemeStyle` type in `components/theme/ThemeContext.tsx`:
```typescript
export type ThemeStyle = 'classic' | 'liquid-glass' | 'minimal-flat'
```

In `useEffect` for loading saved style:
```typescript
const savedStyle = localStorage.getItem('musicweb-theme-style') as ThemeStyle
if (savedStyle === 'classic' || savedStyle === 'liquid-glass' || savedStyle === 'minimal-flat') {
  setThemeStyleState(savedStyle)
  applyThemeStyle(savedStyle)
} else {
  applyThemeStyle('classic')
}
```

In `applyThemeStyle`:
```typescript
const applyThemeStyle = (style: ThemeStyle) => {
  setThemeStyleState(style)
  const root = document.documentElement
  root.setAttribute('data-theme-style', style)
  applyLiquidGlassConfig(liquidGlassConfig, style)
}
```

- [ ] **Step 4: Re-run tests**

Run: `npx vitest run lib/__tests__/minimalFlatTheme.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/theme/ThemeContext.tsx lib/__tests__/minimalFlatTheme.test.ts
git commit -m "feat(theme): add minimal-flat to ThemeStyle and state management"
```

---

### Task 2: Minimal Flat CSS Rules & Component Overrides

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `[data-theme-style="minimal-flat"]` attribute on `<html>`
- Produces: Complete zero-shadow, zero-glass, warm-light color tokens, 6/8/12px border-radius system, and component-specific styling

- [ ] **Step 1: Add CSS Token overrides in `app/globals.css`**

Add the following CSS rules at the end of `app/globals.css`:
```css
/* ================================================================
   Minimal Flat Theme Engine (Warm Studio / Zero Glass & Shadow)
   ================================================================ */
[data-theme-style="minimal-flat"] {
  --bg-space: #FAFAF7 !important;
  --bg-space-end: #FAFAF7 !important;
  --bg-page: #FAFAF7 !important;
  --bg-surface-1: #FAFAF7 !important;
  --bg-surface-2: #F1EFE8 !important;
  --elevation-0-bg: #FAFAF7 !important;
  --elevation-1-bg: #FAFAF7 !important;
  --elevation-2-bg: #F1EFE8 !important;
  --elevation-3-bg: #F1EFE8 !important;
  --text-primary: #1F1F1D !important;
  --text-secondary: #8A8677 !important;
  --text-muted: #8A8677 !important;
  --border-subtle: #E5E3DA !important;
  --glass-border: #E5E3DA !important;
  --primary-spotify: #D85A30 !important;
  --spotify-green: #D85A30 !important;
  --accent: #D85A30 !important;
  --spotify-glow: transparent !important;
  --theme-glow-shadow: none !important;
  --glass-blur: 0px !important;
  --radius-sm: 6px !important;
  --radius-control: 8px !important;
  --radius-card: 8px !important;
  --radius-md: 8px !important;
  --radius-lg: 12px !important;
  --radius-xl: 12px !important;
  color-scheme: light;
}

/* Reset all background surfaces, body and text in Minimal Flat mode */
[data-theme-style="minimal-flat"] body {
  background-color: #FAFAF7 !important;
  color: #1F1F1D !important;
}

/* Universal Shadow, Glass & Text-shadow Reset */
[data-theme-style="minimal-flat"] *,
[data-theme-style="minimal-flat"] *::before,
[data-theme-style="minimal-flat"] *::after {
  box-shadow: none !important;
  text-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Accessibility Focus Visible Ring */
[data-theme-style="minimal-flat"] :focus-visible {
  outline: none !important;
  box-shadow: 0 0 0 2px #D85A30 !important;
}

/* Hide Glow & Spotlight effects */
[data-theme-style="minimal-flat"] .cursor-spotlight,
[data-theme-style="minimal-flat"] .ambient-glow-orb,
[data-theme-style="minimal-flat"] [data-spotlight] {
  display: none !important;
}

/* Main Content Panel */
[data-theme-style="minimal-flat"] .main-content-panel {
  background: #FAFAF7 !important;
  border: 1px solid #E5E3DA !important;
  border-radius: 12px !important;
}

/* App Sidebar */
[data-theme-style="minimal-flat"] .app-sidebar {
  background: #FAFAF7 !important;
  border-right: 1px solid #E5E3DA !important;
  border-radius: 12px !important;
}

/* Player Bar & Mini Player Bar */
[data-theme-style="minimal-flat"] .player-bar,
[data-theme-style="minimal-flat"] .mini-player-bar {
  background: #FAFAF7 !important;
  border-top: 1px solid #E5E3DA !important;
  border-left: 1px solid #E5E3DA !important;
  border-right: 1px solid #E5E3DA !important;
  border-radius: 12px 12px 0 0 !important;
}

/* Central Play Button */
[data-theme-style="minimal-flat"] .player-play-btn,
[data-theme-style="minimal-flat"] button[aria-label="Play"],
[data-theme-style="minimal-flat"] button[aria-label="Phát"] {
  background-color: #1F1F1D !important;
  color: #FAFAF7 !important;
}

/* Track Row & Song Table */
[data-theme-style="minimal-flat"] .song-row,
[data-theme-style="minimal-flat"] tr.track-row {
  border-radius: 8px !important;
  background: transparent !important;
}

[data-theme-style="minimal-flat"] .song-row:hover,
[data-theme-style="minimal-flat"] tr.track-row:hover {
  background-color: #F1EFE8 !important;
}

[data-theme-style="minimal-flat"] .song-row.is-active,
[data-theme-style="minimal-flat"] tr.track-row.is-active {
  background-color: #F1EFE8 !important;
}

/* Thumbnail & Album Cover */
[data-theme-style="minimal-flat"] .album-art,
[data-theme-style="minimal-flat"] .track-thumbnail,
[data-theme-style="minimal-flat"] img.album-cover {
  border-radius: 6px !important;
  border: none !important;
}

/* Search Input */
[data-theme-style="minimal-flat"] .search-input,
[data-theme-style="minimal-flat"] input[type="search"],
[data-theme-style="minimal-flat"] input[type="text"] {
  background-color: #FAFAF7 !important;
  border: 1px solid #E5E3DA !important;
  border-radius: 8px !important;
  color: #1F1F1D !important;
}

[data-theme-style="minimal-flat"] .search-input:focus,
[data-theme-style="minimal-flat"] input[type="search"]:focus,
[data-theme-style="minimal-flat"] input[type="text"]:focus {
  border-color: #D85A30 !important;
}

/* Modals & Dialogs */
[data-theme-style="minimal-flat"] .modal-overlay,
[data-theme-style="minimal-flat"] [data-dialog-overlay] {
  background-color: rgba(0, 0, 0, 0.45) !important;
}

[data-theme-style="minimal-flat"] .modal-content,
[data-theme-style="minimal-flat"] [data-dialog-content] {
  background-color: #FAFAF7 !important;
  border: 1px solid #E5E3DA !important;
  border-radius: 12px !important;
  color: #1F1F1D !important;
}
```

- [ ] **Step 2: Verify CSS parsing and run build check**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: implement minimal-flat CSS token and component overrides"
```

---

### Task 3: Theme Selector Option Card & Spotlight Guard

**Files:**
- Modify: `components/theme/ThemeSelector.tsx`
- Modify: `components/theme/CursorSpotlight.tsx`

**Interfaces:**
- Consumes: `themeStyle`, `setThemeStyle` from `useTheme()`
- Produces: Interactive "Minimal Flat" selector card and conditional rendering of Liquid Glass settings

- [ ] **Step 1: Update `ThemeSelector.tsx` to include Minimal Flat card**

In `components/theme/ThemeSelector.tsx`:
Add a 3rd option button for `minimal-flat` with:
- Title: "Minimal Flat (Tối Giản Phẳng)"
- Subtitle: "Giao diện sáng mộc mạc, không bóng đổ, không làm mờ, viền 1px"
- Icon: Lucide `Square` or `Layers` or `Maximize2`
- Checkmark when `themeStyle === 'minimal-flat'`
- Hide fine-tuning liquid glass settings when `themeStyle !== 'liquid-glass'`.

- [ ] **Step 2: Guard `CursorSpotlight.tsx`**

In `components/theme/CursorSpotlight.tsx`:
Add check: if `themeStyle === 'minimal-flat'`, return `null`.

- [ ] **Step 3: Run tests and type-check**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/theme/ThemeSelector.tsx components/theme/CursorSpotlight.tsx
git commit -m "feat(ui): add minimal-flat option to ThemeSelector and guard spotlight"
```

---

### Task 4: Verification & Full Regression Check

**Files:**
- All modified files

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: 22/22 test files PASS

- [ ] **Step 2: Run Next.js build validation**

Run: `npm run build`
Expected: Successful compile and zero TypeScript errors

- [ ] **Step 3: Final checklist audit**
- [ ] No `box-shadow` besides focus ring
- [ ] No `backdrop-filter` or blur in minimal flat mode
- [ ] Single `#D85A30` accent color
- [ ] All border radii match `6px / 8px / 12px`
- [ ] Smooth switching between Classic Dark, Liquid Glass, and Minimal Flat

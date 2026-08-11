# Home Page Advanced Hover & Motion Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 60fps GPU-optimized hover and motion effects for song cards, album cards, and track rows on the Home page, synchronized dynamically with theme tokens (`var(--spotify-glow)`, `var(--primary-spotify)`).

**Architecture:** Add CSS rules for `.media-card` (GPU shadow layer via `::after`, border glow via `::before`, cover zoom, and play button spring transition) and `.recent-row` (left accent indicator bar, thumb zoom, index crossfade) in `app/globals.css`. Update JSX in `page.tsx`, `albums/page.tsx`, and `TrackRow.tsx` to use these classes and inline `--i` stagger variables.

**Tech Stack:** Next.js, React (TypeScript), CSS (`app/globals.css`), Tailwind CSS.

## Global Constraints
- All glow/border/overlay colors must adapt to `--spotify-glow` and `--primary-spotify` using `color-mix()`.
- Shadow animations must use GPU-friendly `opacity` transitions on `::after` layers instead of animating `box-shadow` directly.
- Scoped `will-change: transform` on hover state (`.media-card:hover`, `.recent-row:hover .row-thumb`).
- `prefers-reduced-motion: reduce` fallback turning off transitions/animations.

---

### Task 1: Add CSS Motion Tokens, `.media-card`, `.recent-row`, and Reduced-Motion Rules

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `--spotify-glow`, `--primary-spotify`, `color-mix()`
- Produces: CSS classes `.media-card`, `.cover-overlay`, `.play-btn`, `.recent-row`, `.row-thumb`, `.index-num`, `.index-play`, `@keyframes card-in`

- [ ] **Step 1: Edit `app/globals.css` to add motion tokens, media-card, and recent-row rules**

Add the following CSS rules to `app/globals.css`:

```css
/* ================================================================
   Motion Tokens & GPU-Optimized Hover Effects
   ================================================================ */
:root {
  --motion-fast: 160ms;
  --motion-base: 240ms;
  --motion-slow: 400ms;
  --ease-out-smooth: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Staggered Entrance Animation */
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 3-Layer GPU-Optimized Media Card */
.media-card {
  position: relative;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: transform var(--motion-base) var(--ease-out-smooth), border-color var(--motion-base) var(--ease-out-smooth);
  animation: card-in var(--motion-slow) var(--ease-out-smooth) backwards;
  animation-delay: calc(var(--i, 0) * 40ms);
}

.media-card:hover {
  transform: translateY(-6px) scale(1.015);
  will-change: transform;
  border-color: color-mix(in srgb, var(--spotify-glow, #22d3ee) 40%, transparent);
}

/* Layer A: GPU Shadow Glow Layer via ::after */
.media-card::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    0 14px 28px -8px color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, transparent),
    0 4px 10px -4px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity var(--motion-base) var(--ease-out-smooth);
  pointer-events: none;
  z-index: -1;
}

.media-card:hover::after,
.media-card:focus-visible::after {
  opacity: 1;
}

/* Layer B: Border Glow Gradient via ::before */
.media-card::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--spotify-glow, #22d3ee) 60%, transparent),
    transparent 60%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity var(--motion-base) var(--ease-out-smooth);
  pointer-events: none;
  z-index: 2;
}

.media-card:hover::before,
.media-card:focus-visible::before {
  opacity: 1;
}

/* Layer C: Cover Zoom, Overlay & Spring Play Button */
.media-card .cover-img {
  transition: transform var(--motion-slow) var(--ease-out-smooth);
}

.media-card:hover .cover-img {
  transform: scale(1.06);
}

.media-card .cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0) 60%);
  opacity: 0;
  transition: opacity var(--motion-base) var(--ease-out-smooth);
  pointer-events: none;
}

.media-card:hover .cover-overlay {
  opacity: 1;
}

.media-card .play-btn {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--primary-spotify, #06b6d4);
  color: #000000;
  opacity: 0;
  transform: scale(0.8) translateY(6px);
  transition:
    opacity var(--motion-fast) var(--ease-out-smooth),
    transform var(--motion-fast) var(--ease-spring);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--spotify-glow, #22d3ee) 50%, transparent);
}

.media-card:hover .play-btn,
.media-card:focus-visible .play-btn {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.media-card .card-title {
  transition: color var(--motion-base) var(--ease-out-smooth);
}

.media-card:hover .card-title {
  color: var(--spotify-glow, #22d3ee);
}

/* Track Row / List Hover Effects */
.recent-row {
  position: relative;
  border-radius: 12px;
  transition: background-color var(--motion-fast) var(--ease-out-smooth);
}

.recent-row:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.recent-row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3.5px;
  border-radius: 4px;
  background: var(--spotify-glow, #22d3ee);
  transform: scaleY(0);
  transition: transform var(--motion-fast) var(--ease-out-smooth);
}

.recent-row:hover::before {
  transform: scaleY(1);
}

.recent-row .row-thumb {
  transition: transform var(--motion-fast) var(--ease-out-smooth);
}

.recent-row:hover .row-thumb {
  transform: scale(1.08);
  will-change: transform;
}

/* Accessibility: Prefers Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  .media-card,
  .media-card::before,
  .media-card::after,
  .media-card .cover-img,
  .media-card .cover-overlay,
  .media-card .play-btn,
  .media-card .card-title,
  .recent-row,
  .recent-row::before,
  .recent-row .row-thumb {
    transition: none !important;
    animation: none !important;
  }
  .media-card:hover {
    transform: none !important;
  }
}
```

- [ ] **Step 2: Run test suite to verify CSS validity**

Run: `cmd /c "npm run test"`
Expected: PASS

- [ ] **Step 3: Commit CSS changes**

```bash
git add app/globals.css
git commit -m "style: add GPU-optimized media-card and recent-row hover CSS rules"
```

---

### Task 2: Apply `.media-card` and Stagger Variables to Home & Albums Page Cards

**Files:**
- Modify: `app/(app)/page.tsx:740-840`
- Modify: `app/(app)/albums/page.tsx:40-60`

**Interfaces:**
- Consumes: `.media-card`, `.cover-img`, `.cover-overlay`, `.play-btn`, `.card-title`
- Produces: Enhanced card layouts with staggered `--i` entrance animation in `page.tsx` and `albums/page.tsx`

- [ ] **Step 1: Update Album Cards and Song Cards in `app/(app)/page.tsx`**

In `app/(app)/page.tsx`, update album card & song card JSX to use `.media-card` classes and `style={{ '--i': idx }}`:

```tsx
<Link
  key={album.id}
  href={`/album/${album.id}`}
  style={{ '--i': idx } as React.CSSProperties}
  className="media-card group p-3 flex flex-col gap-2 cursor-pointer outline-none"
>
  <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
    {album.cover_url ? (
      <img
        src={album.cover_url}
        alt={album.name}
        className="cover-img w-full h-full object-cover scale-[1.05]"
      />
    ) : (
      <DiscAlbum className="w-8 h-8 text-slate-500 cover-img" />
    )}
    <div className="cover-overlay" />
    <div className="badge-glass absolute top-2 left-2 px-1.5 py-0.5 rounded-full text-[8px] font-mono text-[var(--accent)] uppercase tracking-wider z-10">
      {album.album_type === 'single' ? 'Single' : 'Album'}
    </div>
    <div
      role="button"
      tabIndex={0}
      aria-label={`Phát album ${album.name}`}
      onClick={(e) => void handlePlayAlbum(e, album)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') void handlePlayAlbum(e, album)
      }}
      className="play-btn z-10"
    >
      <Play className="w-4 h-4 fill-current ml-0.5" />
    </div>
  </div>
  <div className="truncate">
    <p className="card-title text-xs font-bold text-white truncate">
      {album.name}
    </p>
    <p className="text-[10px] text-slate-400 truncate mt-0.5">
      {album.artist}
    </p>
  </div>
</Link>
```

- [ ] **Step 2: Update Cards in `app/(app)/albums/page.tsx`**

In `app/(app)/albums/page.tsx`, update album item grid to use `.media-card` and `cover-img`/`play-btn`.

- [ ] **Step 3: Run tests to verify JSX compilation**

Run: `cmd /c "npm run test"`
Expected: PASS

- [ ] **Step 4: Commit card component updates**

```bash
git add "app/(app)/page.tsx" "app/(app)/albums/page.tsx"
git commit -m "feat: apply media-card hover effects and stagger variables to home and album cards"
```

---

### Task 3: Apply `.recent-row` Hover Effects to TrackRow Component

**Files:**
- Modify: `components/track/TrackRow.tsx:315-385`

**Interfaces:**
- Consumes: `.recent-row`, `.row-thumb`
- Produces: Enhanced track row hover feedback with left indicator bar and thumb zoom in `TrackRow.tsx`

- [ ] **Step 1: Update `TrackRow.tsx` class names**

Add `recent-row` and `row-thumb` classes to `TrackRowComponent`:

```tsx
<div
  onClick={onPlayClick}
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
  style={
    isSelected
      ? {
          backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
          borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
        }
      : undefined
  }
  className={`recent-row song-row group flex items-center justify-between px-3 md:px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer select-none border ${
    showMenu ? 'relative z-40 bg-white/[0.08] border-white/10 text-white' : 'relative'
  } ${
    isSelected
      ? 'text-white'
      : isCurrent
      ? 'is-playing border-transparent text-white'
      : showMenu
      ? ''
      : 'border-transparent'
  }`}
>
  ...
  <div className="row-thumb w-9 h-9 bg-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
    <TrackCoverImage src={track.cover_url} alt={track.title} />
  </div>
```

- [ ] **Step 2: Run tests to verify TrackRow behavior**

Run: `cmd /c "npm run test"`
Expected: PASS

- [ ] **Step 3: Commit TrackRow changes**

```bash
git add components/track/TrackRow.tsx
git commit -m "feat: apply recent-row hover effect to TrackRow"
```

---

### Task 4: Complete Verification across Themes and Accessibility

**Files:**
- All modified files

- [ ] **Step 1: Run automated test suite**

Run: `cmd /c "npm run test"`
Expected: 19 passed (115 passed)

- [ ] **Step 2: Verify accessibility fallback**
Check `prefers-reduced-motion` in CSS to ensure all animations disable properly.

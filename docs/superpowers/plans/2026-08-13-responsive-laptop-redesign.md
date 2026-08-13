# Responsive Laptop Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the responsive layout of MusicWeb for laptops (1024px–1366px wide) and compact-height viewports (<768px high) across Sidebar, PlayerBar, QueueDrawer, Main Grids, and FullView Overlay.

**Architecture:** Update Tailwind breakpoints (`lg:` vs `xl:`), dynamic flex/grid sizing, and container constraints so components adapt dynamically without layout clipping or text overlap when sidebars or QueueDrawer are open.

**Tech Stack:** Next.js (App Router), React, Tailwind CSS, Lucide Icons.

---

### Task 1: Responsive Sidebar Width & Compact Mode Adjustments

**Files:**
- Modify: `components/sidebar/Sidebar.tsx:140-260`

- [ ] **Step 1: Update Sidebar container responsive width**

In `components/sidebar/Sidebar.tsx`, update the root `aside` element's width from `w-64` to `lg:w-52 xl:w-64`.

- [ ] **Step 2: Adjust internal spacing and plaque sizes for compact laptop mode**

Update padding and gaps in `Sidebar.tsx` navigation items so labels scale cleanly without wrapping or clipping at `w-52`.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cmd /c "npx tsc --noEmit"`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add components/sidebar/Sidebar.tsx
git commit -m "style(sidebar): adapt width and spacing for laptop screens (1024px-1279px)"
```

---

### Task 2: PlayerBar Height & Control Scaling for Compact Viewports

**Files:**
- Modify: `components/player/PlayerBar.tsx:600-780`
- Modify: `app/(app)/layout.tsx:45-53`

- [ ] **Step 1: Reduce PlayerBar height and adjust left/right section flex baselines**

In `components/player/PlayerBar.tsx`:
- Change desktop player bar container from `h-[96px] py-3.5 px-6 lg:px-8` to `h-[80px] xl:h-[88px] py-2.5 px-4 lg:px-5 xl:px-8`.
- Change left track metadata section from `flex-[0_0_240px] lg:flex-[0_0_260px]` to `flex-[0_0_190px] lg:flex-[0_0_210px] xl:flex-[0_0_260px]`.
- Change right volume slider from `w-full` in desktop container to `w-16 lg:w-20 xl:w-28`.

- [ ] **Step 3: Adjust main layout scroll container bottom padding**

In `app/(app)/layout.tsx`:
- Change main scrollable container bottom padding from `lg:pb-40` to `lg:pb-28 xl:pb-36`.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cmd /c "npx tsc --noEmit"`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add components/player/PlayerBar.tsx app/(app)/layout.tsx
git commit -m "style(playerbar): reduce height and optimize control scaling for laptops"
```

---

### Task 3: QueueDrawer Sizing Adjustments for Laptop Screens

**Files:**
- Modify: `components/player/QueueDrawer.tsx:70-110`

- [ ] **Step 1: Adjust QueueDrawer width on lg breakpoint**

In `components/player/QueueDrawer.tsx`, update the desktop drawer container class from `w-80` to `w-72 xl:w-80` (288px on `lg`, 320px on `xl`).

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cmd /c "npx tsc --noEmit"`
Expected: PASS

- [ ] **Step 3: Commit changes**

```bash
git add components/player/QueueDrawer.tsx
git commit -m "style(queuedrawer): adjust width on laptop breakpoint to preserve main content space"
```

---

### Task 4: Responsive Main Grid Breakpoints

**Files:**
- Modify: `app/(app)/page.tsx:100-300`
- Modify: `app/(app)/albums/page.tsx:50-150`

- [ ] **Step 1: Update grid column classes in Home Feed (`page.tsx`)**

In `app/(app)/page.tsx`, update album/track card grid containers from `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6` to `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6`.

- [ ] **Step 2: Update grid column classes in Albums Page (`albums/page.tsx`)**

In `app/(app)/albums/page.tsx`, update grid containers to match `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5`.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cmd /c "npx tsc --noEmit"`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add app/\(app\)/page.tsx app/\(app\)/albums/page.tsx
git commit -m "style(grid): optimize card grid columns for laptop viewports"
```

---

### Task 5: FullView NowPlayingOverlay & Stage Scaling

**Files:**
- Modify: `components/player/NowPlayingStage.tsx:190-210`
- Modify: `components/player/NowPlayingOverlay.tsx:325-345`

- [ ] **Step 1: Scale 3D album vinyl cover size on lg screens**

In `components/player/NowPlayingStage.tsx`:
- Change vinyl cover container size from `lg:w-[280px] lg:h-[280px]` to `lg:w-[230px] lg:h-[230px] xl:w-[280px] xl:h-[280px]`.
- Change left container max-width from `lg:max-w-[420px]` to `lg:max-w-[360px] xl:max-w-[420px]`.

- [ ] **Step 2: Scale lyrics column width in NowPlayingOverlay**

In `components/player/NowPlayingOverlay.tsx`:
- Update right lyrics column width wrapper to `lg:w-[54%] xl:w-[48%] max-w-[640px]`.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cmd /c "npx tsc --noEmit"`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add components/player/NowPlayingStage.tsx components/player/NowPlayingOverlay.tsx
git commit -m "style(fullview): scale 3D vinyl and lyrics column for laptop screens"
```

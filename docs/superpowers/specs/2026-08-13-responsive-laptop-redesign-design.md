# Design Spec: Responsive Layout Redesign for Laptops & Compact Screens

## Goal Description
Enhance the responsive user interface of MusicWeb for laptops (1024px–1366px screen width) and compact-height screens (viewports with <768px height). The current fixed widths for Sidebar (256px), QueueDrawer (320px), and PlayerBar (96px height) squeeze the main content area down to under 440px on 13"-14" laptops when QueueDrawer is open, causing element overlapping, crowded PlayerBar controls, and clipped FullView lyrics.

This redesign introduces dynamic sidebar width adaptation, responsive PlayerBar scaling, compact QueueDrawer sizing, adaptive CSS grids for track/album cards, and refined FullView 3D vinyl & lyrics scaling.

---

## Component Architecture & Responsive Changes

### 1. Sidebar Component (`components/sidebar/Sidebar.tsx`)
- **Laptop Screens (`lg`: 1024px – 1279px)**:
  - Collapse sidebar width from `w-64` (256px) down to `w-52` (208px).
  - Shrink padding and text label sizes to preserve vertical alignment.
- **Desktop Screens (`xl`: 1280px+)**:
  - Retain standard full width `w-64` (256px).

### 2. PlayerBar Component (`components/player/PlayerBar.tsx`)
- **Height Adjustments**:
  - Reduce height on desktop/laptop mode from `h-[96px]` to `lg:h-[80px] xl:h-[88px]`.
  - Adjust main scroll container bottom padding (`main-content-scroll`) from `lg:pb-40` to `lg:pb-28 xl:pb-36`.
- **Left Track Metadata**:
  - Scale width from fixed `260px` down to `lg:flex-[0_0_200px] xl:flex-[0_0_260px]`.
  - Ensure title and artist marquee handle small widths cleanly.
- **Center Controls & Right Volume Bar**:
  - Shrink volume bar slider width to `w-16 lg:w-20 xl:w-28`.
  - Adjust padding: `px-4 lg:px-5 xl:px-8`.

### 3. QueueDrawer Component (`components/player/QueueDrawer.tsx`)
- **Width Adjustments**:
  - On `lg` screens (1024px – 1279px), shrink drawer width from `w-80` (320px) to `w-72` (288px).
  - Ensures the central `<main>` area retains at least **550px** width when both Sidebar and QueueDrawer are active.

### 4. Page Grid Layouts (`app/(app)/page.tsx`, `app/(app)/albums/page.tsx`)
- **Responsive Columns**:
  - Update layout grid breakpoints:
    `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6`
  - Ensures all Album and Track cover cards maintain minimum **140px – 180px** width.

### 5. FullView / Now Playing Overlay (`components/player/NowPlayingOverlay.tsx`, `components/player/NowPlayingStage.tsx`, `components/player/LyricsView.tsx`)
- **3D Album Stage**:
  - Scale vinyl cover on `lg` (1024px – 1279px) from `280px` to `lg:w-[230px] lg:h-[230px] xl:w-[280px] xl:h-[280px]`.
  - Shrink left column max-width on `lg` from `420px` to `360px`.
- **Lyrics View Column**:
  - Expand right lyrics column width to `lg:w-[54%] xl:w-[48%] max-w-[640px]`.
  - Responsive lyric font sizes:
    - Active lyric line: `text-lg lg:text-xl xl:text-3xl font-extrabold`.
    - Upcoming lyric lines: `text-sm lg:text-base xl:text-lg`.
  - Adjust vertical gap for compact viewport heights (<768px).

---

## Verification Plan

### Automated Checks
- Run `npx tsc --noEmit` to verify zero TypeScript errors.

### Manual Verification
- Test layout responsiveness at 1024px, 1280px, and 1536px widths.
- Test QueueDrawer toggle behavior on laptop screens.
- Test FullView Overlay lyrics display and vinyl 3D scaling.

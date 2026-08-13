# Mobile/Tablet Clarity & Profile Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make the interface readable and unclipped from 390px through 1023px, and hide logout behind the user avatar menu.

**Architecture:** Keep the existing component structure. Move the desktop boundary from `md` to `lg`, centralize profile-menu open/close semantics in a small pure helper, and use responsive CSS tokens for contrast, safe-area offsets, and layering. The existing Supabase + NextAuth logout sequence remains unchanged.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind utility classes, CSS custom properties, Vitest.

## Global Constraints

- Treat widths below 1024px as mobile/tablet layout.
- Preserve Aurora Glass styling and existing animations.
- Controls should target at least 44px where practical.
- Logout stays hidden until the avatar is activated.
- Verify at 390px, 768px, and 1023px with visual screenshots.

---

### Task 1: Define and test profile-menu interaction semantics

**Files:**
- Create: `components/navigation/profileMenuInteraction.ts`
- Create: `components/navigation/__tests__/profileMenuInteraction.test.ts`

**Interfaces:**
- `shouldToggleProfileMenu(isOpen: boolean): boolean`
- `shouldCloseProfileMenu(target: EventTarget | null, menu: Element | null, trigger: Element | null): boolean`

- [ ] **Step 1: Write failing tests** for toggle inversion and outside-click detection; include clicks inside menu and trigger as non-closing cases.
- [ ] **Step 2: Run the focused test and confirm it fails because the helper is missing.**
- [ ] **Step 3: Implement the two pure helpers without DOM side effects.**
- [ ] **Step 4: Run the focused test and confirm it passes.**

---

### Task 2: Add the avatar menu to TopBar

**Files:**
- Modify: `components/navigation/TopBar.tsx`
- Test: `components/navigation/__tests__/profileMenuInteraction.test.ts` (the Task 1 tests are the regression contract)

**Interfaces:**
- TopBar owns `isProfileMenuOpen`, uses the helper from Task 1, and closes on outside pointer and Escape.
- The existing `handleLogout` remains the only logout implementation.

- [ ] **Step 1: Add an avatar button with `aria-expanded`, `aria-controls`, and a menu containing identity, role, and “Đăng xuất”.**
- [ ] **Step 2: Add outside-click, Escape, route-change, and post-logout close behavior using `shouldCloseProfileMenu`.**
- [ ] **Step 3: Remove the always-visible logout icon from the TopBar.**
- [ ] **Step 4: Run the focused helper test and TypeScript.**

---

### Task 3: Switch responsive boundaries to tablet-safe mobile layout

**Files:**
- Modify: `app/(app)/layout.tsx`
- Modify: `components/navigation/MobileHeaderNav.tsx`
- Modify: `components/sidebar/Sidebar.tsx`
- Modify: `components/navigation/TopBar.tsx`
- Modify: `components/player/PlayerBar.tsx`
- Modify: `components/player/NowPlayingOverlay.tsx`

- [ ] **Step 1: Replace desktop-only `md` visibility utilities with `lg` for sidebar, mobile header, bottom nav, drawer, desktop playerbar, and mobile player/fullscreen variants.**
- [ ] **Step 2: Replace desktop spacing utilities that activate at 768px only where they cause tablet overflow; retain `sm` for gradual spacing.**
- [ ] **Step 3: Ensure the main content bottom padding follows the mobile player/bottom-nav stack below `lg`, and desktop padding begins at `lg`.**
- [ ] **Step 4: Run TypeScript and focused navigation/player tests.**

---

### Task 4: Fix mobile playerbar safe-area and readability

**Files:**
- Modify: `app/globals.css`
- Modify: `app/(app)/layout.tsx`
- Modify: `components/player/PlayerBar.tsx`
- Create: `components/player/mobileLayout.ts`
- Create: `components/player/__tests__/mobileLayout.test.ts`

- [ ] **Step 1: Write failing tests for `miniPlayerClassName` containing a safe-area-aware bottom offset, minimum height, and overflow protection, plus `mobileContentPaddingClassName` containing bottom padding.**
- [ ] **Step 2: Run `npm.cmd test -- --pool=threads --maxWorkers=1 components/player/__tests__/mobileLayout.test.ts` and confirm it fails because the constants are missing.**
- [ ] **Step 3: Add the two constants and use them from the mobile player/layout classNames.**
- [ ] **Step 4: Set the mini player offset to include bottom-nav height plus safe-area inset, add an explicit minimum height, preserve the progress edge, and prevent viewport overflow.**
- [ ] **Step 5: Add matching mobile content padding, keep full-screen player above the mini player, increase mobile secondary text/surface contrast, and ensure navigation controls are at least 44px.**
- [ ] **Step 6: Run the focused layout test, TypeScript, and diff checks.**

---

### Task 5: Use the same profile behavior in the mobile drawer

**Files:**
- Modify: `components/navigation/MobileHeaderNav.tsx`
- Modify: `components/navigation/profileMenuInteraction.ts`
- Test: `components/navigation/__tests__/profileMenuInteraction.test.ts`

- [ ] **Step 1: Add a failing test for profile-menu close after route navigation/logout.**
- [ ] **Step 2: Run it and confirm the failure.**
- [ ] **Step 3: Make the drawer user footer a 44px avatar trigger that opens the same identity/logout affordance; remove the permanently visible logout icon.**
- [ ] **Step 4: Close the drawer/profile affordance after navigation and logout.**
- [ ] **Step 5: Run focused tests and TypeScript.**

---

### Task 6: Verification and visual review

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-mobile-tablet-clarity-profile-menu-design.md` only if verification notes need recording.

- [ ] **Step 1: Run the focused navigation/player tests.**
- [ ] **Step 2: Run `npx.cmd tsc --noEmit`.**
- [ ] **Step 3: Run `git diff --check`.**
- [ ] **Step 4: Run `npm.cmd run build`.**
- [ ] **Step 5: Capture before/after screenshots at 390px, 768px, and 1023px; verify no clipping/overlap and verify logout is hidden until avatar activation.**

# Welcome Announcement Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a centered Welcome Announcement Modal with author info, social contact buttons, and a "Do not show again" checkbox persisted in LocalStorage.

**Architecture:** A client-side modal component (`WelcomeAnnouncementModal`) mounted at `app/(app)/layout.tsx` that reads and writes `localStorage.getItem('musicweb_hide_welcome_modal')`. Also integrated with a trigger button in `app/(app)/settings/page.tsx`.

**Tech Stack:** Next.js 15 (App Router), React 19, Lucide React icons, Tailwind CSS, LocalStorage API.

## Global Constraints
- Must handle client-side rendering safely (prevent Next.js SSR hydration mismatch).
- Must match MusicWeb dark glassmorphism design tokens (`var(--elevation-1-bg)`, `var(--elevation-2-bg)`, `var(--primary-spotify)`).
- Mobile and desktop responsive.

---

### Task 1: Create WelcomeAnnouncementModal Component

**Files:**
- Create: `components/modals/WelcomeAnnouncementModal.tsx`

- [ ] **Step 1: Write `WelcomeAnnouncementModal.tsx`**
Implement the component with:
- Check `localStorage.getItem('musicweb_hide_welcome_modal')` on mount.
- If not suppressed, open modal automatically.
- Checkbox `dontShowAgain` (default `false` or toggleable).
- Author message & social buttons (Facebook, Instagram, Gmail).
- Close button and "Đã hiểu" CTA button which saves `localStorage` if `dontShowAgain` is checked.
- Listen to custom DOM event `musicweb:open-welcome-modal` so it can be re-opened on demand from Settings.

- [ ] **Step 2: Commit Task 1**
```bash
git add components/modals/WelcomeAnnouncementModal.tsx
git commit -m "feat: add WelcomeAnnouncementModal component"
```

---

### Task 2: Mount Modal in App Layout

**Files:**
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Add `<WelcomeAnnouncementModal />` to `AppLayout`**
Import and render `<WelcomeAnnouncementModal />` within `AppLayout` so it mounts on every page visit inside the main app.

- [ ] **Step 2: Commit Task 2**
```bash
git add app/\(app\)/layout.tsx
git commit -m "feat: integrate WelcomeAnnouncementModal into AppLayout"
```

---

### Task 3: Add Re-open / Reset Button in Settings Page

**Files:**
- Modify: `app/(app)/settings/page.tsx`

- [ ] **Step 1: Update Settings Page**
Add a button in the Notifications section of `SettingsPage` to dispatch `musicweb:open-welcome-modal` (or reset `musicweb_hide_welcome_modal` and open).

- [ ] **Step 2: Commit Task 3**
```bash
git add app/\(app\)/settings/page.tsx
git commit -m "feat: add re-open welcome modal action in Settings"
```

---

### Task 4: Verification and Testing

- [ ] **Step 1: Verify TypeScript & Build**
Run `npm run build` or Next.js type-check to confirm zero syntax/type errors.

- [ ] **Step 2: Manual testing of storage & dismissal**
Verify modal appears when storage is clear, suppresses when checked, and opens upon clicking button in Settings.

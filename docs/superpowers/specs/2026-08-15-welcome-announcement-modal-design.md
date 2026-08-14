# Welcome Announcement Modal Design Specification

## Overview
This feature introduces a prominent, beautifully styled Welcome Announcement Modal that appears in the center of the screen when users visit MusicWeb. It shares the author's message and contact channels, featuring a "Do not remind again" checkbox to prevent future popups based on local storage.

## Goals & Requirements
- **Automatic Popup**: Pops up once on web entrance if the user has not opted out via "Do not show again".
- **Center Modal Display**: Centered on screen with backdrop blur, glassmorphism design, responsive on both desktop and mobile.
- **Author Message & Socials**: Displays author greeting message and clickable links for Facebook, Instagram, and Gmail.
- **Do Not Remind / Suppress Preference**:
  - Checkbox labeled "Không hiển thị lại thông báo này" (Do not show this notification again).
  - Stored in `localStorage` (`musicweb_hide_welcome_modal`).
  - If checked when dismissed, the modal will not open automatically on future visits.
  - If dismissed without checking, the modal will show again on the next session/page load.
- **Settings Integration**:
  - Settings page retains the author message section.
  - Add a quick action button in Settings ("Xem lại thông báo" / "Khôi phục thông báo chào mừng") allowing users to preview or reset their preference anytime.

## Architecture & Component Design

### 1. `components/modals/WelcomeAnnouncementModal.tsx`
- **State**:
  - `isOpen: boolean` (initially false, checks `localStorage` on client mount)
  - `dontShowAgain: boolean` (default: false or checked by user)
  - `mounted: boolean` (prevents SSR hydration mismatch)
- **Lifecycle / Storage logic**:
  - On `useEffect`: Read `localStorage.getItem('musicweb_hide_welcome_modal')`. If not equal to `'true'`, set `isOpen(true)`.
  - On `handleClose`:
    - If `dontShowAgain === true`, write `localStorage.setItem('musicweb_hide_welcome_modal', 'true')`.
    - Set `isOpen(false)`.
- **UI Structure**:
  - Backdrop: `fixed inset-0 z-[100] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200`
  - Modal Box: `relative w-full max-w-lg bg-[var(--elevation-2-bg,#0e1322)] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden`
  - Header:
    - Glowing Bell / Sparkle icon badge
    - Title: "Lời nhắn từ Tác giả 🎵"
    - Close button (X) top-right
  - Body:
    - Author thank-you & feedback text
    - Social links: Facebook, Instagram, Gmail with hover micro-interactions
  - Footer:
    - Checkbox: "Không hiển thị lại thông báo này"
    - CTA Button: "Đã hiểu / Bắt đầu trải nghiệm"

### 2. Integration in `app/(app)/layout.tsx`
- Render `<WelcomeAnnouncementModal />` at the root layout of the app so it is mounted when users enter any part of the application.

### 3. Integration in `app/(app)/settings/page.tsx`
- Retain the current author notification card.
- Add an interactive button: "Xem lại thông báo chào mừng" / "Mở lại pop-up thông báo" to re-trigger the modal and allow testing or resetting the `localStorage` key.

## Verification & Testing
- Test first visit: Modal should pop up in center with backdrop blur.
- Test closing without tick: Modal closes, refresh page -> Modal appears again.
- Test closing with tick: Modal closes, refresh page -> Modal does NOT appear.
- Test re-opening from Settings: Clicking "Xem lại thông báo" opens the modal and allows changing the setting.
- Test responsiveness: Mobile and desktop layouts fit smoothly without overflow or layout shift.

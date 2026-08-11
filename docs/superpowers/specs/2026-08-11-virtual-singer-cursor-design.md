# VirtualSinger Custom Cursor Theme Design Spec

**Date:** 2026-08-11  
**Topic:** VirtualSinger Custom Cursor Integration in MusicWeb  
**Status:** Approved by User  

---

## 1. Overview & Goal

The goal is to allow users of MusicWeb to switch between different cursor styles via the Theme Settings panel (`ThemeSelector`). Specifically, users will be able to enable the **VirtualSinger (Hatsune Miku)** animated cursor set (`.ani` files located in `D:\download\ani file-animation-VirtualSinger`), use the existing **Lottie Synth** cursor, or use the **Default** browser cursor.

---

## 2. Proposed Changes & Architecture

### 2.1 Asset Copying & Organization
- Copy cursor `.ani` files from `D:\download\ani file-animation-VirtualSinger` into `public/cursors/virtual-singer/`:
  - `Normal.ani` (Default pointer)
  - `Link.ani` (Hover on buttons, links, interactive elements)
  - `Text.ani` (Input fields, textareas)
  - `Working.ani` / `Busy.ani` (Loading states)
  - `Help.ani` (Help icon state)

### 2.2 Theme Context Extension ([ThemeContext.tsx](file:///d:/MusicWeb/components/theme/ThemeContext.tsx))
- Define `CursorStyle = 'lottie' | 'virtual-singer' | 'default'`.
- Add `cursorStyle` state to `ThemeContext` (defaulting to `'lottie'`).
- Persist `cursorStyle` in `localStorage` under key `musicweb-cursor-style`.
- Inject a CSS root attribute/class on `<html>` or `<body>` when `cursorStyle === 'virtual-singer'`, e.g., `data-cursor="virtual-singer"`.

### 2.3 Custom Cursor Component ([CustomCursor.tsx](file:///d:/MusicWeb/components/theme/CustomCursor.tsx))
- Check `cursorStyle` from `useTheme()`.
- If `cursorStyle !== 'lottie'`, render `null` or hide the Lottie cursor element so it doesn't conflict with native cursor styles.

### 2.4 CSS Styles ([globals.css](file:///d:/MusicWeb/app/globals.css))
- Add CSS rules for `[data-cursor="virtual-singer"]`:
  ```css
  [data-cursor="virtual-singer"],
  [data-cursor="virtual-singer"] * {
    cursor: url('/cursors/virtual-singer/Normal.ani'), auto;
  }

  [data-cursor="virtual-singer"] a,
  [data-cursor="virtual-singer"] button,
  [data-cursor="virtual-singer"] [role="button"],
  [data-cursor="virtual-singer"] input[type="button"],
  [data-cursor="virtual-singer"] input[type="submit"] {
    cursor: url('/cursors/virtual-singer/Link.ani'), pointer !important;
  }

  [data-cursor="virtual-singer"] input[type="text"],
  [data-cursor="virtual-singer"] input[type="search"],
  [data-cursor="virtual-singer"] textarea {
    cursor: url('/cursors/virtual-singer/Text.ani'), text !important;
  }
  ```

### 2.5 Theme Settings UI ([ThemeSelector.tsx](file:///d:/MusicWeb/components/theme/ThemeSelector.tsx))
- Add a **Cursor Style Selector** section below the Color Theme section in `ThemeSelector.tsx`.
- Option cards:
  - **Lottie Synth** (Current glowing animation cursor)
  - **VirtualSinger** (Hatsune Miku `.ani` cursor set)
  - **Default** (Standard system cursor)

---

## 3. Verification Plan

1. **Asset Check**: Ensure `.ani` files exist in `public/cursors/virtual-singer/`.
2. **Persistence Check**: Select "VirtualSinger" in `ThemeSelector`, refresh page, verify choice is restored from `localStorage`.
3. **Cursor Behavior Check**:
   - Verify default pointer shows `Normal.ani`.
   - Hover over buttons and track items to verify `Link.ani`.
   - Focus text input to verify `Text.ani`.
   - Switching back to "Lottie Synth" restores Lottie animation.

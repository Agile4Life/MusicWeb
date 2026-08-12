# Typography Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp hệ thống font chữ của MusicWeb sang Dual Font System (`Space Grotesk` + `Inter` + `JetBrains Mono`) tự động host bằng `next/font/google` với đầy đủ hỗ trợ tiếng Việt.

**Architecture:** Sử dụng `next/font/google` trong `app/layout.tsx` nạp 3 font family với `subsets: ['latin', 'vietnamese']` và gán CSS variables (`--font-space-grotesk`, `--font-inter`, `--font-jetbrains-mono`). Mapping các biến này vào `:root` và `@theme` trong `app/globals.css` để cung cấp các lớp `font-display`, `font-sans`, `font-mono` cho Tailwind CSS v4.

**Tech Stack:** Next.js 15 (`next/font/google`), React 19, Tailwind CSS v4, TypeScript.

## Global Constraints
- Nạp font từ `next/font/google` hỗ trợ `subsets: ['latin', 'vietnamese']` và `display: 'swap'`.
- Loại bỏ `@import url(...)` cho font CDN `Inter` trong `app/globals.css`.
- Khai báo CSS variables trong `:root`:
  - `--font-display`: `var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif`
  - `--font-sans`: `var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif`
  - `--font-mono`: `var(--font-jetbrains-mono), 'JetBrains Mono', monospace`
- Giữ nguyên các font trang trí đặc thù (`.font-graffiti`, `.font-signature`, `.font-tag`).

---

### Task 1: Update Root Layout (`app/layout.tsx`) with Google Fonts

**Files:**
- Modify: `app/layout.tsx:1-55`

**Interfaces:**
- Consumes: `next/font/google` (`Space_Grotesk`, `Inter`, `JetBrains_Mono`)
- Produces: CSS variables `--font-space-grotesk`, `--font-inter`, `--font-jetbrains-mono` on `<html>`

- [ ] **Step 1: Update imports and font declarations in `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin', 'vietnamese'],
  weight: ['600', '700'],
  display: 'swap',
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500'],
  display: 'swap',
})
```

- [ ] **Step 2: Update HTML element class list in `app/layout.tsx`**

```tsx
<html lang="vi" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans h-full antialiased dark`}>
```

- [ ] **Step 3: Run TypeScript check to verify layout syntax**

Run: `cmd /c npx tsc --noEmit`
Expected: PASS with 0 errors

- [ ] **Step 4: Commit changes**

```bash
git add app/layout.tsx
git commit -m "feat(typography): configure Space Grotesk, Inter, and JetBrains Mono fonts in layout"
```

---

### Task 2: Configure CSS Variables & Tailwind v4 Theme Tokens in `app/globals.css`

**Files:**
- Modify: `app/globals.css:1-60`

**Interfaces:**
- Consumes: Font CSS variables from `app/layout.tsx` (`--font-space-grotesk`, `--font-inter`, `--font-jetbrains-mono`)
- Produces: Utility classes `font-display`, `font-sans`, `font-mono` via Tailwind CSS v4 `@theme`

- [ ] **Step 1: Clean up old Inter Google Font import in `app/globals.css`**

Remove line 2:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap');
```
Keep lines 1 (`Caveat`, `Permanent Marker`, `Rock Salt`, `Sedgwick Ave`) and 3 (`@import "tailwindcss";`).

- [ ] **Step 2: Define `:root` typography variables and Tailwind `@theme` block**

In `app/globals.css`:
```css
@theme {
  --font-display: var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif;
  --font-sans: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), 'JetBrains Mono', monospace;
}

:root {
  --font-display: var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif;
  --font-sans: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), 'JetBrains Mono', monospace;
  ...
}
```

- [ ] **Step 3: Run TypeScript typecheck to verify build**

Run: `cmd /c npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add app/globals.css
git commit -m "style(typography): map font variables and Tailwind v4 theme tokens"
```

---

### Task 3: Apply `font-display` Class to Key Section Headings & Verify

**Files:**
- Modify: `app/(app)/page.tsx` (or main landing page heading components)

**Interfaces:**
- Consumes: `font-display` class from Tailwind CSS theme

- [ ] **Step 1: Audit main section headers and ensure `font-display` is applied to H1/H2 titles**

Apply `font-display` to major page section headings (e.g. `font-display font-bold text-2xl`).

- [ ] **Step 2: Run TypeScript check to verify all files**

Run: `cmd /c npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit final changes**

```bash
git add app/(app)/page.tsx
git commit -m "style(typography): apply font-display class to primary section headers"
```

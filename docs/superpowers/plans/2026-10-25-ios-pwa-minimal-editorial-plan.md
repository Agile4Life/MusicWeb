# iOS PWA Minimal Editorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp toàn diện trải nghiệm Progressive Web App (PWA) trên iOS (iPhone/iPad WebKit Standalone & Safari) cho MusicWeb với ngôn ngữ thiết kế **Minimal Editorial (`minimal-flat`)** chuẩn mực: đồng bộ manifest/viewport `viewport-fit=cover`, safe-area tai thỏ & Dynamic Island, cache App Shell offline, hoàn thiện giao diện Minimal Editorial trên toàn bộ thanh điều hướng di động, thanh tìm kiếm, mini-player, trình phát toàn màn hình (`MobileFullviewPlayer`), và banner hướng dẫn cài đặt PWA trên iOS.

**Architecture:**
1. Chuẩn hóa tầng cấu hình PWA (`public/manifest.json`, `app/layout.tsx`, `lib/pwaManifestConfig.ts`, `ThemeContext.tsx`) với `viewport-fit=cover`, màu nền/theme `#141017` (Plum Obsidian) và đồng bộ `<meta name="theme-color">` động khi chuyển đổi theme.
2. Mở rộng `public/sw.js` thành kiến trúc Dual-Cache (`musicweb-shell-v3` cho App Shell & static assets + `musicweb-audio-v2` cho audio streams) giúp ứng dụng mở tức thì từ màn hình chính iOS ngay cả khi mạng chập chờn.
3. Chuẩn hóa hình học Safe Area (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) và đồng bộ triệt để bảng màu & typography **Minimal Editorial** (`#141017` void, `#1D1720` surface, `#F4ECE1` paper, `#B9AC9C` paper-dim, `#E8A94F` amber accent, `Fraunces` serif, `IBM Plex Mono` timecode) trên mọi bề mặt di động (`MobileScrollHeader`, `LiquidNavBar`, `PlayerBar`, `MobileFullviewPlayer`, `IOSInstallPrompt`).

**Tech Stack:** Next.js 16.2 (App Router), React 19, TypeScript, Tailwind CSS v4, Framer Motion 13, Web App Manifest & Service Worker API, Vitest.

## Global Constraints

- **Palette Minimal Editorial (`minimal-flat`) cố định:** `--void: #141017`, `--surface: #1D1720`, `--surface-2: #251E29`, `--paper: #F4ECE1`, `--paper-dim: #B9AC9C`, `--muted: #8B8090`, `--accent-strong: #E8A94F`, `--hair: rgba(244, 236, 230, 0.08)`, `--hair-strong: rgba(244, 236, 230, 0.14)`.
- **Typography Minimal Editorial:** Tiêu đề trang, tên bài hát chính ở Fullview và lời bài hát dùng `Fraunces` (`var(--font-fraunces), Georgia, serif`); nhãn phụ/timecode dùng `IBM Plex Mono` (`var(--font-ibm-plex-mono), monospace` với `tabular-nums`); điều hướng & danh sách dùng `Inter`.
- **iOS WebKit Standalone Ergonomics:** Bắt buộc có `viewportFit: 'cover'`, `appleWebApp.statusBarStyle: 'black-translucent'`, cỡ chữ `<input>` trên mobile tối thiểu `16px` để chặn iOS Safari tự động phóng to (auto-zoom) khi focus, và bù trừ `env(safe-area-inset-top, 0px)` cho header dính đỉnh.
- **Zero Regression:** Giữ nguyên trải nghiệm của `liquid-glass` và `classic` khi người dùng chuyển sang các chế độ đó; toàn bộ unit test hiện hữu và mới phải PASS 100%.

---

### Task 1: Chuẩn Hóa Web App Manifest, iOS Viewport (`viewport-fit=cover`) & Theme-Color Động

**Files:**
- Create: `lib/pwaManifestConfig.ts`
- Modify: `public/manifest.json`
- Modify: `app/layout.tsx`
- Modify: `components/theme/ThemeContext.tsx`
- Test: `lib/__tests__/iosPwaMinimalEditorial.test.ts`

**Interfaces:**
- Produces:
  - `MINIMAL_EDITORIAL_PWA_COLORS = { background: '#141017', surface: '#1D1720', paper: '#F4ECE1', paperDim: '#B9AC9C', muted: '#8B8090', accent: '#E8A94F' }`
  - `resolvePwaThemeColor(themeStyle: string, fallbackBgSpace?: string): string`
  - `isIOSUserAgent(ua: string, maxTouchPoints?: number): boolean`
  - `isStandaloneDisplayMode(win?: { navigator?: { standalone?: boolean }; matchMedia?: (q: string) => { matches: boolean } }): boolean`
  - `shouldShowIOSInstallPrompt(params: { ua: string; maxTouchPoints?: number; isStandalone: boolean; isDismissed: boolean }): boolean`

- [ ] **Step 1: Viết unit test kiểm tra cấu hình PWA, màu theme-color và nhận diện iOS Standalone**
- [ ] **Step 2: Tạo `lib/pwaManifestConfig.ts` xuất các hằng số và hàm thuần túy**
- [ ] **Step 3: Cập nhật `public/manifest.json` với `background_color: "#141017"`, `theme_color: "#141017"`, `display_override`, `shortcuts` và icon chuẩn iOS**
- [ ] **Step 4: Cập nhật `app/layout.tsx` (`viewportFit: 'cover'`, `userScalable: false`, cập nhật `meta[name="theme-color"]`) và `components/theme/ThemeContext.tsx`**

---

### Task 2: Nâng Cấp Service Worker (`public/sw.js`) Với App Shell & Static Asset Cache

**Files:**
- Modify: `public/sw.js`
- Test: `lib/__tests__/iosPwaMinimalEditorial.test.ts`

**Interfaces:**
- Consumes: Request `navigate`, `/_next/static/*`, `/api/drive-stream`
- Produces: `SHELL_CACHE_NAME = 'musicweb-shell-v3'` và `AUDIO_CACHE_NAME = 'musicweb-audio-v2'`

- [ ] **Step 1: Bổ sung test kiểm tra cấu trúc và chiến lược cache của `public/sw.js`**
- [ ] **Step 2: Cập nhật `public/sw.js` để pre-cache App Shell, lưu cache khi điều hướng (`navigate`), stale-while-revalidate cho static assets (`/_next/static/`, icons, fonts), và giữ nguyên `handleAudioFetch` + `KEEP_ALIVE`**

---

### Task 3: Xử Lý Safe-Area iOS Standalone & Chống Auto-Zoom Ô Tìm Kiếm

**Files:**
- Modify: `components/navigation/MobileScrollHeader.tsx`
- Modify: `components/navigation/MobileHeaderNav.tsx`
- Modify: `app/globals.css`
- Test: `lib/__tests__/iosPwaMinimalEditorial.test.ts`

**Interfaces:**
- Consumes: CSS `env(safe-area-inset-top, 0px)`, `env(safe-area-inset-bottom, 0px)`
- Produces: Header, thanh tìm kiếm nổi, và ngăn kéo menu bên trái (`.mobile-drawer`) không bị đè bởi Dynamic Island / Status Bar trên iOS PWA; ô input tìm kiếm `text-[16px] sm:text-sm` không gây zoom trên iOS.

- [ ] **Step 1: Cập nhật `MobileScrollHeader.tsx` bù `env(safe-area-inset-top, 0px)` cho `<header>` và `searchRowRef`, đồng thời nâng font-size input lên `16px` trên mobile**
- [ ] **Step 2: Cập nhật `MobileHeaderNav.tsx` bù safe-area top/bottom cho `.mobile-drawer` và đồng bộ màu Minimal Editorial cho drawer & profile menu**
- [ ] **Step 3: Bổ sung quy tắc CSS iOS standalone safe-area và touch ergonomics trong `app/globals.css`**

---

### Task 4: Đồng Bộ Minimal Editorial (`minimal-flat`) Cho Mobile Header, Search Capsule, LiquidNavBar & Mini-Player

**Files:**
- Modify: `components/navigation/MobileScrollHeader.tsx`
- Modify: `components/navigation/LiquidNavBar.tsx`
- Modify: `components/player/PlayerBar.tsx`
- Modify: `app/globals.css`
- Test: `lib/__tests__/iosPwaMinimalEditorial.test.ts`

**Interfaces:**
- Consumes: `useTheme().themeStyle === 'minimal-flat'`
- Produces:
  - `MobileScrollHeader`: Logo plaque `#1D1720` viền mảnh `rgba(244, 236, 230, 0.12)`; Search pill `#1D1720` viền `rgba(244, 236, 230, 0.16)` bo góc `16px` (ẩn tia sáng kính trắng khi ở `minimal-flat`); Dropdown gợi ý nền đặc `#1D1720`, chữ `#F4ECE1` / `#B9AC9C`, nút phát `#E8A94F`.
  - `LiquidNavBar`: Dock 5 tab và Capsule thu gọn chuyển sang bề mặt ấm `#1D1720` (`rgba(29, 23, 32, 0.96)`), viền `1px solid rgba(244, 236, 230, 0.12)`, bo góc `22px`, chỉ báo tab đang chọn màu hổ phách ấm (`rgba(232, 169, 79, 0.14)`, viền `rgba(232, 169, 79, 0.35)`), chữ/icon `#F4ECE1` & `#E8A94F`, tắt vòng cầu vồng sắc sai khi ở `minimal-flat`.
  - `PlayerBar` (Mobile Mini-Player): Bề mặt `#1D1720` viền `rgba(244, 236, 230, 0.14)`, bo góc `18px`, nút Play tròn `#E8A94F` chữ `#141017`, thanh tiến trình mảnh `#E8A94F` dưới đáy mini-player.

- [ ] **Step 1: Cập nhật `MobileScrollHeader.tsx` với style Minimal Editorial tường minh cho logo pill, search capsule và autocomplete dropdown**
- [ ] **Step 2: Cập nhật `LiquidNavBar.tsx` hỗ trợ `isMinimalFlat` cho cả trạng thái Expanded (5-tab) và Collapsed (Capsule)**
- [ ] **Step 3: Cập nhật `PlayerBar.tsx` (Mobile Floating Mini-Player) với thanh tiến trình mảnh `#E8A94F` và bề mặt Minimal Editorial**

---

### Task 5: Đồng Bộ Minimal Editorial Cho Trình Phát Toàn Màn Hình iOS (`MobileFullviewPlayer.tsx`)

**Files:**
- Modify: `components/player/MobileFullviewPlayer.tsx`
- Modify: `app/globals.css`
- Test: `lib/__tests__/iosPwaMinimalEditorial.test.ts`

**Interfaces:**
- Consumes: `isMinimal = themeStyle === 'minimal-flat'` trong `MobileFullviewPlayer.tsx`
- Produces:
  - Nền `#141017` kết hợp quầng sáng hổ phách ấm (`radial-gradient` `#E8A94F` / `#C98A3D`) trầm ấm chuẩn phòng thu đĩa than.
  - Tab Cover: Khung ảnh bìa bo góc `18px` viền `1px solid rgba(244, 236, 230, 0.14)`, tiêu đề bài hát font `Fraunces` (`#F4ECE1`), tên nghệ sĩ `#B9AC9C`, nút Album màu `#E8A94F` (thay vì cyan).
  - Tab Lyrics: Dòng đang hát dùng font `Fraunces` in nghiêng (`italic`), chữ `#F4ECE1`, vạch trích dẫn bên trái `3px solid #E8A94F`, phiên âm Romaji màu `#E8A94F`; các dòng khác dùng `Fraunces` thường màu `#B9AC9C`.
  - Tab Queue & Footer: Tiêu đề "Tiếp tục phát" font `Fraunces`, nút Shuffle/Repeat active màu `#E8A94F`, thanh tiến trình & âm lượng màu `#E8A94F`, bộ đếm thời gian `IBM Plex Mono` (`tabular-nums`, `#8B8090`), và Bottom Sheet tùy chọn bài hát nền `#1D1720` viền `rgba(244, 236, 230, 0.14)`.

- [ ] **Step 1: Cập nhật `MobileFullviewPlayer.tsx` áp dụng Minimal Editorial cho Background, Cover Tab, Lyrics Tab, Queue Tab, Footer Scrubber/Timecodes và Context Menu Bottom Sheet**
- [ ] **Step 2: Bổ sung các lớp hoàn thiện `.mobile-fullview-overlay` trong `app/globals.css`**

---

### Task 6: Banner Hướng Dẫn Cài Đặt PWA Trên iOS Safari (`IOSInstallPrompt.tsx`)

**Files:**
- Create: `components/pwa/IOSInstallPrompt.tsx`
- Modify: `app/(app)/layout.tsx`
- Test: `lib/__tests__/iosPwaMinimalEditorial.test.ts`

**Interfaces:**
- Consumes: `shouldShowIOSInstallPrompt` từ `lib/pwaManifestConfig.ts`, `useTheme()`
- Produces: `<IOSInstallPrompt />` hiển thị tinh tế trên iOS Safari (khi chưa cài vào Home Screen), thiết kế chuẩn Minimal Editorial (`#1D1720`, viền `#E8A94F/30`, tiêu đề `Fraunces`), hướng dẫn thao tác **Chia sẻ (Share)** → **Thêm vào MH chính (Add to Home Screen)** và lưu trạng thái đóng vào `localStorage`.

- [ ] **Step 1: Tạo `components/pwa/IOSInstallPrompt.tsx`**
- [ ] **Step 2: Tích hợp `<IOSInstallPrompt />` vào `app/(app)/layout.tsx`**
- [ ] **Step 3: Chạy toàn bộ test suite (`npm test`), kiểm tra build (`npm run build`) và cập nhật đồ thị (`graphify update .`)**

# Kế Hoạch Tối Ưu Hóa Hiệu Năng Safari iOS (MusicWeb)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tối ưu hóa hiệu năng toàn diện và xử lý triệt để các hạn chế khi chạy MusicWeb trên trình duyệt Safari của iOS (WebKit Engine), đảm bảo cử chỉ kéo vuốt 120Hz mượt mà, loại bỏ repaint/GPU lag, xử lý giới hạn audio của iOS và tối ưu hiển thị Safe Area.

**Architecture:** Sử dụng kiến trúc compositing GPU độc lập (tách layer fixed background, dùng CSS transform thay vì React re-render ở touchmove, thay thế CSS `filter: blur` trên từng dòng lyrics bằng alpha compositing, thiết lập fallback thông minh cho SVG displacement filter trên mobile, và tinh chỉnh Three.js Canvas DPR/hạt).

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Framer Motion 13, Three.js / @react-three/fiber, WebKit / iOS Web Standards.

## Global Constraints
- Tuân thủ nghiêm ngặt nguyên tắc Apple Design (WWDC Fluid Interfaces): Damping 1.0 (critically damped), phản hồi tức thì dưới 16ms, cử chỉ 1:1, không re-render React trong chu kỳ touchmove.
- Không gây ảnh hưởng (zero regression) đến trải nghiệm người dùng trên Desktop / Chrome / Firefox.
- Tất cả bài test hiện có (`npm run test`) phải PASS 100%.

---

### Task 1: Khắc phục hiện tượng Full-Screen Repaint do `background-attachment: fixed`

**Files:**
- Modify: `app/globals.css:154-165, 488-498`
- Test: `components/player/__tests__/mobileSafariOptimization.test.ts`

**Interfaces:**
- Consumes: CSS tokens từ `app/globals.css`
- Produces: Layer nền cố định tách biệt không kích hoạt full-page repaint khi scroll

- [ ] **Step 1: Viết test kiểm tra thuộc tính CSS và rule tối ưu Safari iOS**
Tạo file `components/player/__tests__/mobileSafariOptimization.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isIOSDevice } from '@/lib/audioPlayback'

describe('iOS Safari Compatibility & Performance Optimizations', () => {
  it('detects iOS user agent accurately for conditional optimizations', () => {
    const originalNavigator = globalThis.navigator
    
    // Simulate iPhone Safari
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      },
      configurable: true,
    })

    expect(isIOSDevice()).toBe(true)

    // Cleanup
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    })
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận**
Run: `npm run test`
Expected: PASS

- [ ] **Step 3: Chỉnh sửa `app/globals.css` loại bỏ `background-attachment: fixed` trên body**
Trong `app/globals.css`, thay thế `background-attachment: fixed;` bằng một pseudo-element `body::before` cố định:
```css
/* Tách layer fixed background để GPU tối ưu trên WebKit */
body {
  position: relative;
  background-color: var(--bg-space, #0a0e1a);
  color: #f3f4f6;
  overflow: hidden;
  user-select: none;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background-image:
    linear-gradient(145deg, var(--bg-space, #0a0e1a) 0%, var(--bg-space-end, #12172b) 100%),
    radial-gradient(circle at 85% 5%, color-mix(in srgb, var(--spotify-glow, #22d3ee) 3.5%, transparent) 0%, transparent 50%),
    radial-gradient(circle at 15% 95%, color-mix(in srgb, var(--primary-spotify, #22d3ee) 2.5%, transparent) 0%, transparent 55%);
  transform: translateZ(0);
  will-change: transform;
}
```

- [ ] **Step 4: Chạy lại test**
Run: `npm run test`
Expected: PASS

---

### Task 2: Tối ưu Cử chỉ Kéo Vuốt Player & Triệt tiêu React 19 Re-renders ở 120Hz

**Files:**
- Modify: `components/player/MobileFullviewPlayer.tsx:103-114, 317-393, 516-544`
- Test: `components/player/__tests__/mobileSafariOptimization.test.ts`

**Interfaces:**
- Consumes: Cử chỉ chạm `onTouchStart`, `onTouchMove`, `onTouchEnd`
- Produces: CSS Transform trực tiếp trên DOM node qua ref trong suốt chu trình drag, chỉ cập nhật state khi kết thúc/bắt đầu gesture.

- [ ] **Step 1: Viết test cho logic chuyển động kéo thả**
Bổ sung vào `components/player/__tests__/mobileSafariOptimization.test.ts`:
```ts
  it('calculates swipe dismiss decision correctly with momentum', () => {
    const shouldDismiss = (dragY: number, velocity: number) => {
      return dragY > 110 || (dragY > 40 && velocity > 0.45)
    }

    expect(shouldDismiss(120, 0.1)).toBe(true) // distance threshold
    expect(shouldDismiss(50, 0.5)).toBe(true)  // velocity flick threshold
    expect(shouldDismiss(30, 0.2)).toBe(false) // not enough
  })
```

- [ ] **Step 2: Cập nhật `MobileFullviewPlayer.tsx`**
Áp dụng direct DOM transform trong `handleDragTouchMove` thay vì gọi `setDragY(deltaY)` liên tục trên mỗi touchmove event:
```tsx
// Trong handleDragTouchMove:
if (isDraggingRef.current) {
  if (e.cancelable) {
    e.preventDefault()
  }
  const currentDrag = deltaY > 0 ? deltaY : deltaY * 0.18
  dragYRef.current = currentDrag
  if (containerRef.current) {
    const progress = Math.min(1, Math.max(0, currentDrag / 500))
    const scale = currentDrag > 0 ? Math.max(0.92, 1 - progress * 0.08) : 1
    const radius = currentDrag > 0 ? Math.min(36, 16 + currentDrag * 0.12) : 0
    const opacity = currentDrag > 0 ? Math.max(0.35, 1 - progress * 0.55) : 1
    
    containerRef.current.style.transform = `translateY(${Math.max(0, currentDrag)}px) scale(${scale})`
    containerRef.current.style.opacity = `${opacity}`
    containerRef.current.style.borderRadius = `${radius}px ${radius}px 0 0`
  }
}
```

- [ ] **Step 3: Chạy test xác nhận**
Run: `npm run test`
Expected: PASS

---

### Task 3: Tối ưu Render Lời Bài Hát (Lyrics) - Loại Bỏ CSS `filter: blur` Khi Cuộn

**Files:**
- Modify: `components/player/MobileFullviewPlayer.tsx:700-785`

**Interfaces:**
- Consumes: `activeIndex`, `lyrics`, `isSynced`
- Produces: Danh sách lyrics sử dụng thuần GPU `opacity` và `scale` thay vì rasterization-heavy `filter: blur(...)`

- [ ] **Step 1: Cập nhật CSS lyrics rendering trong `MobileFullviewPlayer.tsx`**
Thay thế logic tính `blurPx` và áp dụng `filter: blur(...)` bằng GPU-accelerated opacity & scale:
```tsx
let opacity = 1.0
let scale = 1.0

if (!isSyncedMode) {
  opacity = 0.95
} else if (isActive) {
  opacity = 1.0
  scale = 1.02
} else {
  const distance = Math.abs(idx - activeIndex)
  const isPast = idx < activeIndex
  if (distance === 1) {
    opacity = isPast ? 0.45 : 0.4
  } else if (distance === 2) {
    opacity = isPast ? 0.3 : 0.25
  } else {
    opacity = isPast ? 0.2 : 0.15
  }
}
```
Và trong thẻ render:
```tsx
style={{
  opacity,
  transform: `scale(${scale})`,
  transformOrigin: 'left center',
  willChange: 'opacity, transform',
}}
```

- [ ] **Step 2: Chạy test xác nhận**
Run: `npm run test`
Expected: PASS

---

### Task 4: Xử Lý Giới Hạn Volume Slider Trên iOS Safari

**Files:**
- Modify: `components/player/MobileFullviewPlayer.tsx:970-1016`

**Interfaces:**
- Consumes: `isIOSDevice()` từ `lib/audioPlayback`
- Produces: Ẩn thanh volume slider không hoạt động trên iOS, thay bằng thông báo hoặc mở rộng không gian điều khiển bài hát.

- [ ] **Step 1: Nhúng `isIOSDevice()` vào `MobileFullviewPlayer.tsx`**
```tsx
import { isIOSDevice } from '@/lib/audioPlayback'

// Trong component:
const [isIOS, setIsIOS] = useState(false)
useEffect(() => {
  setIsIOS(isIOSDevice())
}, [])
```

- [ ] **Step 2: Ẩn thanh volume khi `isIOS === true`**
```tsx
{/* ─── Volume Slider (Ẩn trên iOS vì Apple vô hiệu hóa audio.volume bằng phần mềm) ─── */}
{!isIOS && (
  <div className="flex items-center gap-3 px-0.5 pb-2">
    {/* Volume Slider Controls */}
  </div>
)}
```

- [ ] **Step 3: Chạy test xác nhận**
Run: `npm run test`
Expected: PASS

---

### Task 5: Tối Ưu Fallback Cho Liquid Glass & SVG Displacement Maps Trên Mobile

**Files:**
- Modify: `components/navigation/LiquidNavBar.tsx` & `components/theme/LiquidGlassFilterDefs.tsx`

**Interfaces:**
- Consumes: Viewport & Device type
- Produces: Fallback CSS Glassmorphism siêu nhẹ trên Mobile/iOS, tránh loop Canvas 2D per-pixel generator.

- [ ] **Step 1: Cập nhật `LiquidNavBar.tsx` và `LiquidGlassFilterDefs.tsx`**
Bỏ qua bước sinh SVG Displacement map và Canvas 2D per-pixel nếu là màn hình cảm ứng hoặc mobile.

- [ ] **Step 2: Chạy test xác nhận**
Run: `npm run test`
Expected: PASS

---

### Task 6: Tối Ưu 3D Particle Scene Trên Màn Hình Di Động

**Files:**
- Modify: `components/player/ParticleScene.tsx:7-11, 375-388`

**Interfaces:**
- Consumes: `window.innerWidth`, `window.devicePixelRatio`
- Produces: Dynamic particle count (1.800 hạt trên mobile vs 8.120 trên desktop) và DPR tối đa 1.5 trên mobile.

- [ ] **Step 1: Điều chỉnh số lượng hạt và DPR trong `ParticleScene.tsx`**
```tsx
const isMobileScreen = typeof window !== 'undefined' && window.innerWidth < 768
const bgCount = isMobileScreen ? 1000 : BG_COUNT
const midCount = isMobileScreen ? 600 : MID_COUNT
const fgCount = isMobileScreen ? 200 : FG_COUNT

<Canvas
  dpr={isMobileScreen ? [1, 1.5] : [1, 2]}
  gl={{ antialias: !isMobileScreen, alpha: true, powerPreference: 'high-performance' }}
>
```

- [ ] **Step 2: Chạy test xác nhận**
Run: `npm run test`
Expected: PASS

---

### Task 7: Đồng Bộ Viewport Units `100dvh` & Safe Area Đáy Cho Toàn Bộ Mobile Layout

**Files:**
- Modify: `components/player/MobileFullviewPlayer.tsx:533-545`
- Modify: `app/globals.css:667-670`

**Interfaces:**
- Consumes: CSS `100dvh`, `env(safe-area-inset-bottom)`
- Produces: Giao diện tràn viền không bị thanh Dynamic URL bar hay Home bar đè lên.

- [ ] **Step 1: Cập nhật class container trong `MobileFullviewPlayer.tsx`**
```tsx
className={`mobile-fullview-overlay fixed inset-0 h-[100dvh] max-h-[100dvh] z-[100] flex flex-col select-none overflow-hidden touch-pan-y ${
  isNowPlayingOpen ? 'pointer-events-auto' : 'pointer-events-none'
}`}
```

- [ ] **Step 2: Chạy toàn bộ test suite để xác nhận**
Run: `npm run test`
Expected: All tests pass.

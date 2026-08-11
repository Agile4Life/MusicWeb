# Sidebar Navigation Gliding Indicator & Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a smooth gliding indicator pill, icon/text hover nudging, and click ripple animation to the Sidebar navigation in `MusicWeb`, synchronized with the active theme colors.

**Architecture:** Update `app/globals.css` with CSS transition rules for `.nav-indicator`, `.sidebar-item .icon`, `.sidebar-item .label`, and `@keyframes rip`. Add React state and event listeners in `Sidebar.tsx` to position the gliding indicator on `mouseenter`/`mouseleave` and trigger ripple element creation on `click`.

**Tech Stack:** Next.js, React (TypeScript), Tailwind CSS / Vanilla CSS (`app/globals.css`).

## Global Constraints
- Must use theme CSS variables `var(--spotify-glow, #22d3ee)` and `var(--primary-spotify, #06b6d4)`.
- Smooth `transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)` transitions.
- Applied consistently to both "Khám phá" and "Playlist" sidebar sections.

---

### Task 1: Add CSS Rules for Gliding Indicator, Nudging, and Ripple Effect

**Files:**
- Modify: `app/globals.css:610-635`

**Interfaces:**
- Consumes: Theme variables `var(--spotify-glow)` & `var(--theme-gradient-1)`
- Produces: CSS classes `.nav-indicator`, `.sidebar-item .icon`, `.sidebar-item .label`, `.ripple`, `@keyframes rip`

- [ ] **Step 1: Edit `app/globals.css` to add navigation styling**

Add the following CSS rules under the Sidebar section in `app/globals.css`:

```css
/* Gliding Pill Indicator */
.nav-indicator {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 12px;
  background: var(--theme-gradient-1, rgba(6, 182, 212, 0.12));
  border: 1px solid var(--theme-glow-shadow, rgba(6, 182, 212, 0.25));
  box-shadow: 0 0 12px var(--theme-glow-shadow, rgba(6, 182, 212, 0.15));
  opacity: 0;
  pointer-events: none;
  z-index: 0;
  transition:
    transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    height 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.25s ease;
}

/* Sidebar Item Nudge & Ripple Support */
.sidebar-item {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-control, 12px);
  color: var(--text-secondary, #94a3b8);
  transition: color 0.25s ease;
  overflow: hidden;
  user-select: none;
}

.sidebar-item .icon,
.sidebar-item svg {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), color 0.25s ease;
}

.sidebar-item span {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), color 0.25s ease;
}

.sidebar-item:hover {
  color: var(--text-primary, #ffffff);
}

.sidebar-item:hover .icon,
.sidebar-item:hover svg {
  transform: translateX(3px) scale(1.05);
}

.sidebar-item:hover span {
  transform: translateX(3px);
}

.sidebar-item.active {
  color: var(--spotify-glow, #22d3ee);
}

/* Click Ripple Animation */
.ripple {
  position: absolute;
  border-radius: 50%;
  background: var(--theme-glow-shadow, rgba(6, 182, 212, 0.3));
  transform: scale(0);
  animation: rip 0.55s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

@keyframes rip {
  to {
    transform: scale(3.2);
    opacity: 0;
  }
}
```

- [ ] **Step 2: Verify CSS builds cleanly without errors**

Run: `cmd /c "npm run test"`
Expected: Tests pass cleanly.

- [ ] **Step 3: Commit CSS changes**

```bash
git add app/globals.css
git commit -m "style: add sidebar gliding indicator and ripple CSS rules"
```

---

### Task 2: Implement Gliding Indicator & Ripple Logic in Sidebar Component

**Files:**
- Modify: `components/sidebar/Sidebar.tsx`

**Interfaces:**
- Consumes: `.nav-indicator`, `.sidebar-item`, `.ripple` CSS rules from Task 1
- Produces: Dynamic gliding indicator positioning and ripple creation on navigation clicks in `Sidebar.tsx`

- [ ] **Step 1: Add indicator position states and handlers in `Sidebar.tsx`**

Update `Sidebar.tsx` to maintain indicator position state for the "Khám phá" and "Playlist" sections, and add hover and click ripple handlers:

```tsx
const [exploreIndicator, setExploreIndicator] = useState<{ top: number; height: number; opacity: number }>({
  top: 0,
  height: 40,
  opacity: 0,
})

const [playlistIndicator, setPlaylistIndicator] = useState<{ top: number; height: number; opacity: number }>({
  top: 0,
  height: 36,
  opacity: 0,
})

const handleItemHover = (e: React.MouseEvent<HTMLElement>, setIndicator: React.Dispatch<React.SetStateAction<{ top: number; height: number; opacity: number }>>) => {
  const target = e.currentTarget
  setIndicator({
    top: target.offsetTop,
    height: target.offsetHeight,
    opacity: 1,
  })
}

const handleSectionLeave = (setIndicator: React.Dispatch<React.SetStateAction<{ top: number; height: number; opacity: number }>>) => {
  setIndicator((prev) => ({ ...prev, opacity: 0 }))
}

const handleItemClick = (e: React.MouseEvent<HTMLElement>) => {
  const item = e.currentTarget
  const rect = item.getBoundingClientRect()
  const ripple = document.createElement('span')
  ripple.className = 'ripple'
  const size = Math.max(rect.width, rect.height)
  ripple.style.width = ripple.style.height = `${size}px`
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`
  item.appendChild(ripple)
  ripple.addEventListener('animationend', () => ripple.remove())
}
```

- [ ] **Step 2: Attach indicator element and event handlers to `nav` ("Khám phá") and Playlist container**

In `nav` section ("Khám phá"):
```tsx
<nav className="flex flex-col gap-1 relative" onMouseLeave={() => handleSectionLeave(setExploreIndicator)}>
  <div
    className="nav-indicator"
    style={{
      transform: `translateY(${exploreIndicator.top}px)`,
      height: `${exploreIndicator.height}px`,
      opacity: exploreIndicator.opacity,
    }}
  />
  ...
  <Link
    onMouseEnter={(e) => handleItemHover(e, setExploreIndicator)}
    onClick={handleItemClick}
    ...
  >
```

In Playlist section:
```tsx
<div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-1 relative" onMouseLeave={() => handleSectionLeave(setPlaylistIndicator)}>
  <div
    className="nav-indicator"
    style={{
      transform: `translateY(${playlistIndicator.top}px)`,
      height: `${playlistIndicator.height}px`,
      opacity: playlistIndicator.opacity,
    }}
  />
  ...
  <Link
    onMouseEnter={(e) => handleItemHover(e, setPlaylistIndicator)}
    onClick={(e) => {
      handleItemClick(e)
    }}
    ...
  >
```

- [ ] **Step 3: Run test suite to verify no syntax errors**

Run: `cmd /c "npm run test"`
Expected: All tests pass.

- [ ] **Step 4: Commit `Sidebar.tsx` changes**

```bash
git add components/sidebar/Sidebar.tsx
git commit -m "feat: add gliding indicator and ripple effect to Sidebar navigation"
```

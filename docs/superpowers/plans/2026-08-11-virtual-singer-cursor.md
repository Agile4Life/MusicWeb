# VirtualSinger Custom Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the VirtualSinger (Hatsune Miku) `.ani` cursor set into MusicWeb with a Theme Settings selector allowing users to choose between Lottie Synth, VirtualSinger, or Default system cursors.

**Architecture:** Copy `.ani` files to `public/cursors/virtual-singer/`, extend `ThemeContext` to manage `cursorStyle` state (`'lottie' | 'virtual-singer' | 'default'`) with `localStorage` persistence, add CSS cursor rules in `app/globals.css`, update `CustomCursor.tsx` to conditionally render, and add cursor selection UI to `ThemeSelector.tsx`.

**Tech Stack:** Next.js, React, Tailwind CSS, LocalStorage, CSS `cursor: url(...)`.

## Global Constraints

- Preserve all existing theme settings and functionality.
- Default `cursorStyle` must be `'lottie'` for backwards compatibility.
- Store cursor preference in `localStorage` under `musicweb-cursor-style`.

---

### Task 1: Copy Cursor Assets to Public Directory

**Files:**
- Create: `public/cursors/virtual-singer/Normal.ani`
- Create: `public/cursors/virtual-singer/Link.ani`
- Create: `public/cursors/virtual-singer/Text.ani`
- Create: `public/cursors/virtual-singer/Working.ani`
- Create: `public/cursors/virtual-singer/Help.ani`
- Create: `public/cursors/virtual-singer/Busy.ani`

**Interfaces:**
- Consumes: Files in `D:\download\ani file-animation-VirtualSinger`
- Produces: Web-accessible static cursor files at `/cursors/virtual-singer/*.ani`

- [ ] **Step 1: Copy cursor files using PowerShell command**

```powershell
Copy-Item -Path "D:\download\ani file-animation-VirtualSinger\*.ani" -Destination "public\cursors\virtual-singer" -Recurse -Force
```

- [ ] **Step 2: Verify copied files exist**

Run: `ls public/cursors/virtual-singer`
Expected: `Normal.ani`, `Link.ani`, `Text.ani`, `Working.ani`, `Help.ani`, `Busy.ani`, etc.

- [ ] **Step 3: Commit assets**

```bash
git add public/cursors/virtual-singer
git commit -m "assets: add VirtualSinger .ani cursor files"
```

---

### Task 2: Update ThemeContext, CustomCursor, and Global CSS

**Files:**
- Modify: `components/theme/ThemeContext.tsx`
- Modify: `components/theme/CustomCursor.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `localStorage` item `musicweb-cursor-style`
- Produces: `cursorStyle` & `setCursorStyle` in `ThemeContext`

- [ ] **Step 1: Extend `ThemeContext.tsx` with `cursorStyle` and `setCursorStyle`**

In `components/theme/ThemeContext.tsx`:
Add type `CursorStyle = 'lottie' | 'virtual-singer' | 'default'`.
Extend `ThemeContextType` interface:
```typescript
export type CursorStyle = 'lottie' | 'virtual-singer' | 'default'

interface ThemeContextType {
  currentTheme: ThemeConfig
  setTheme: (id: ThemeId) => void
  cursorStyle: CursorStyle
  setCursorStyle: (style: CursorStyle) => void
}
```
Inside `ThemeProvider`:
Add state `const [cursorStyle, setCursorStyleState] = useState<CursorStyle>('lottie')`.
In `useEffect`:
Read `const savedCursor = localStorage.getItem('musicweb-cursor-style') as CursorStyle`.
If `savedCursor && ['lottie', 'virtual-singer', 'default'].includes(savedCursor)`, call `applyCursorStyle(savedCursor)`.

Define `applyCursorStyle`:
```typescript
const applyCursorStyle = (style: CursorStyle) => {
  setCursorStyleState(style)
  document.documentElement.setAttribute('data-cursor', style)
}

const setCursorStyle = (style: CursorStyle) => {
  localStorage.setItem('musicweb-cursor-style', style)
  applyCursorStyle(style)
}
```
Pass `cursorStyle` and `setCursorStyle` to `ThemeContext.Provider`.

- [ ] **Step 2: Update `CustomCursor.tsx` to respect `cursorStyle`**

In `components/theme/CustomCursor.tsx`:
Import `useTheme` from `./ThemeContext`.
Inside `CustomCursor()`:
```typescript
const { cursorStyle } = useTheme()
if (cursorStyle !== 'lottie') return null
```

- [ ] **Step 3: Add CSS Rules in `app/globals.css`**

Add CSS rules at the end of `app/globals.css`:
```css
/* VirtualSinger Custom Cursor */
html[data-cursor="virtual-singer"],
html[data-cursor="virtual-singer"] body,
html[data-cursor="virtual-singer"] * {
  cursor: url('/cursors/virtual-singer/Normal.ani'), auto;
}

html[data-cursor="virtual-singer"] a,
html[data-cursor="virtual-singer"] button,
html[data-cursor="virtual-singer"] [role="button"],
html[data-cursor="virtual-singer"] input[type="button"],
html[data-cursor="virtual-singer"] input[type="submit"] {
  cursor: url('/cursors/virtual-singer/Link.ani'), pointer !important;
}

html[data-cursor="virtual-singer"] input[type="text"],
html[data-cursor="virtual-singer"] input[type="search"],
html[data-cursor="virtual-singer"] textarea {
  cursor: url('/cursors/virtual-singer/Text.ani'), text !important;
}

/* Default Cursor mode: reset custom cursor overrides */
html[data-cursor="default"],
html[data-cursor="default"] * {
  cursor: auto !important;
}
```

- [ ] **Step 4: Verify build/type check**

Run: `npm run build`
Expected: Build succeeds with 0 TypeScript/lint errors.

- [ ] **Step 5: Commit changes**

```bash
git add components/theme/ThemeContext.tsx components/theme/CustomCursor.tsx app/globals.css
git commit -m "feat: add cursorStyle state to ThemeContext and CSS cursor rules"
```

---

### Task 3: Update ThemeSelector UI with Cursor Style Controls

**Files:**
- Modify: `components/theme/ThemeSelector.tsx`

**Interfaces:**
- Consumes: `cursorStyle` and `setCursorStyle` from `useTheme()`
- Produces: UI toggle cards for cursor style selection

- [ ] **Step 1: Add Cursor Style Selection section to `ThemeSelector.tsx`**

Import `Sparkles`, `MousePointer` from `lucide-react`.
Access `cursorStyle` and `setCursorStyle` from `useTheme()`.
Add a section below the color themes:
```tsx
<div className="flex flex-col gap-4 pt-4 border-t border-white/[0.08]">
  <div className="flex items-center gap-2 text-sm font-bold text-white">
    <MousePointer className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
    <span>Kiểu con trỏ chuột (Cursor Style)</span>
  </div>

  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
    {[
      { id: 'lottie', name: 'Lottie Synth', desc: 'Con trỏ phát sáng động' },
      { id: 'virtual-singer', name: 'VirtualSinger', desc: 'Hatsune Miku Anime' },
      { id: 'default', name: 'Hệ thống (Default)', desc: 'Con trỏ mặc định' },
    ].map((item) => {
      const isSelected = cursorStyle === item.id
      return (
        <button
          key={item.id}
          onClick={() => setCursorStyle(item.id as any)}
          className={`relative flex flex-col items-start p-3.5 rounded-2xl transition-all cursor-pointer text-left border ${
            isSelected
              ? 'bg-white/[0.08] border-white/20'
              : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10'
          }`}
        >
          <p className="font-bold text-xs text-white mb-0.5">{item.name}</p>
          <p className="text-[11px] text-slate-400">{item.desc}</p>
          {isSelected && (
            <div
              className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-black"
              style={{ backgroundColor: currentTheme.accentColor }}
            >
              <Check className="w-2.5 h-2.5 stroke-[3]" />
            </div>
          )}
        </button>
      )
    })}
  </div>
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build passes cleanly.

- [ ] **Step 3: Commit changes**

```bash
git add components/theme/ThemeSelector.tsx
git commit -m "feat: add Cursor Style selection controls to ThemeSelector"
```

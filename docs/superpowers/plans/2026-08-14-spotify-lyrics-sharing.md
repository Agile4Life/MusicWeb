# Spotify Lyrics Sharing (9:16 Story Card & Web Share API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Spotify-style lyrics sharing feature with line selection (1 to 5 lines), high-resolution 9:16 Story Card generation (1080x1920), and Web Share API / PNG download / clipboard copy directly from PlayerBar and LyricsView.

**Architecture:** 
A client-side HTML5 Canvas 2D engine (`lib/lyricsShareCanvas.ts`) renders 1080x1920 Story cards with responsive typography, cover art, and aesthetic theme gradients. A dedicated modal component (`components/player/LyricsShareModal.tsx`) provides 1-to-5 lines selection with live card preview and controls for Web Share API (`navigator.share`), PNG download, and clipboard copy. Entry point buttons are added to `PlayerBar.tsx` and `LyricsView.tsx`.

**Tech Stack:** React 19, TypeScript, Next.js, HTML5 Canvas 2D, Web Share API (`navigator.share`), Clipboard API, Lucide icons, Vitest.

## Global Constraints
- Max 5 lines, Min 1 line selection constraint.
- 9:16 Story aspect ratio (1080 × 1920 px) high-resolution output.
- No external heavy dependencies (use native HTML5 Canvas 2D).
- Zero crash on CORS cover image failure (fallback gracefully).
- Full responsive support (Desktop, Tablet, Mobile).

---

### Task 1: Canvas 2D Card Rendering Engine (`lib/lyricsShareCanvas.ts`)

**Files:**
- Create: `lib/lyricsShareCanvas.ts`
- Test: `lib/__tests__/lyricsShareCanvas.test.ts`

**Interfaces:**
- Produces: 
  - `export interface LyricCardTheme { id: string; name: string; background: string[]; textColor: string; accentColor: string; }`
  - `export const LYRIC_CARD_THEMES: LyricCardTheme[]`
  - `export interface GenerateCardOptions { title: string; artist: string; coverUrl?: string | null; selectedLines: string[]; themeId?: string; }`
  - `export async function renderLyricCardToCanvas(options: GenerateCardOptions): Promise<HTMLCanvasElement>`
  - `export async function generateLyricCardBlob(options: GenerateCardOptions): Promise<Blob>`
  - `export async function generateLyricCardDataUrl(options: GenerateCardOptions): Promise<string>`
  - `export function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[]`

- [ ] **Step 1: Write the unit test for lyricsShareCanvas**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `lib/lyricsShareCanvas.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: Lyrics Share Studio Modal Component (`components/player/LyricsShareModal.tsx`)

**Files:**
- Create: `components/player/LyricsShareModal.tsx`

**Interfaces:**
- Consumes:
  - `Track` from `@/types`
  - `LyricLine` from `@/lib/lrcParser`
  - `generateLyricCardBlob`, `generateLyricCardDataUrl`, `LYRIC_CARD_THEMES` from `@/lib/lyricsShareCanvas`
- Produces:
  - `export interface LyricsShareModalProps { isOpen: boolean; onClose: () => void; track: Track; lyrics: LyricLine[]; initialActiveIndex?: number; }`
  - `export const LyricsShareModal: React.FC<LyricsShareModalProps>`

- [ ] **Step 1: Implement `components/player/LyricsShareModal.tsx`** with:
  - 1-to-5 lines selection with limit guards and counter.
  - Live 9:16 Card Preview.
  - Theme palette switchers.
  - Web Share API (`navigator.share`) with File blob.
  - Download PNG action (`<a download="..."/>`).
  - Copy Image action (`navigator.clipboard.write`).
- [ ] **Step 2: Verify component types and compile correctness**
- [ ] **Step 3: Commit**

---

### Task 3: Integrate Share Button into `LyricsView.tsx` & `PlayerBar.tsx`

**Files:**
- Modify: `components/player/LyricsView.tsx`
- Modify: `components/player/PlayerBar.tsx`
- Modify: `components/player/NowPlayingOverlay.tsx`

**Interfaces:**
- Connects `LyricsShareModal` when user clicks `Share2` button on `PlayerBar` or in `LyricsView` header.

- [ ] **Step 1: Add Share button and state to `LyricsView.tsx`**
- [ ] **Step 2: Add Share button and state to `PlayerBar.tsx`**
- [ ] **Step 3: Wire Share button into `NowPlayingOverlay.tsx`**
- [ ] **Step 4: Run test suite to verify no regression**
- [ ] **Step 5: Commit**

---

### Task 4: Full Verification & Walkthrough

- [ ] **Step 1: Run full vitest test suite (`cmd /c npx vitest run`)**
- [ ] **Step 2: Verify UI and interactions in browser**
- [ ] **Step 3: Create walkthrough.md summary**

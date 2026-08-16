# FullView Interactive Multi-Layer Particle System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a high-density, multi-layer 3D particle background for the FullView player that spans the full viewport with smooth mouse parallax tilt and interactive cursor repulsion/dispersion.

**Architecture:** Refactor `ParticleScene.tsx` using Three.js / React Three Fiber (`@react-three/fiber`) with 3 distinct particle depth layers (~1000 particles total in Float32Array buffers): Background Dust (~500), Midground Stardust (~350), and Foreground Interactive Bokeh (~150) featuring real-time mouse repulsion and spring return physics.

**Tech Stack:** React 19, Next.js 15, Three.js, `@react-three/fiber`, Tailwind CSS.

## Global Constraints
- High performance 60fps WebGL execution with zero buffer allocations in the animation render loop (`useFrame`).
- Gated behind `useCanUse3D` hook for devices with hardware acceleration.
- Respects `prefers-reduced-motion` settings.
- Seamless responsive integration with album disk, lyrics column, and player bar.

---

### Task 1: Refactor `components/player/ParticleScene.tsx` for Full-Viewport Multi-Layer Density & Dynamic Motion

**Files:**
- Modify: `components/player/ParticleScene.tsx`

**Interfaces:**
- Consumes: `analyserData?: Uint8Array`, `isPlaying: boolean` from `NowPlayingStage.tsx`
- Produces: `ParticleScene` React component exported as default

- [ ] **Step 1: Implement wide viewport distribution and multi-layer typed arrays**
Generate 3 distinct buffer geometries:
- `bgPositions` (~500 particles spread across `x: [-10, 10]`, `y: [-7, 7]`, `z: [-6, -2]`)
- `midPositions` (~350 particles spread across `x: [-9, 9]`, `y: [-6, 6]`, `z: [-3, 0]`)
- `fgPositions` and `fgOriginalPositions` (~150 particles spread across `x: [-8, 8]`, `y: [-5, 5]`, `z: [-1, 2]`) with velocity/offset tracking arrays for cursor repulsion.

- [ ] **Step 2: Implement smooth mouse tracking, parallax layers, and cursor repulsion in `useFrame`**
- Unproject or calculate normalized mouse coordinates `(mx, my)` in 3D world space.
- Apply distinct rotation/translation parallax coefficients per layer:
  - BG Layer: slow drift + subtle parallax (`mx * 0.15`)
  - MID Layer: orbital drift + medium parallax (`mx * 0.35`) + audio reactivity scaling
  - FG Layer: responsive parallax (`mx * 0.65`) + local repulsion where nearby particles displace outward when cursor enters radius `R <= 2.2` and spring back smoothly.

- [ ] **Step 3: Render optimized point materials with accent glowing circular texture**
- Setup radial texture with soft luminous core and smooth falloff.
- Depth sorting and blending configured (`depthWrite={false}`, `transparent={true}`, `blending={THREE.AdditiveBlending}`).

---

### Task 2: Verify and Polish FullView Integration & Performance

**Files:**
- Modify/Verify: `components/player/NowPlayingStage.tsx` (ensure canvas container covers full background cleanly)
- Modify/Verify: `app/globals.css` (verify `.particle-canvas` styling if needed)

- [ ] **Step 1: Inspect parallax layer positioning and overlay containment**
Ensure `.particle-canvas` fills 100% of the stage without clipping across mobile, tablet, and ultrawide desktop screens.

- [ ] **Step 2: Verify build and TypeScript type-checking**
Run: `npm run build` or `npx tsc --noEmit`

- [ ] **Step 3: Visual validation**
Verify particle density, smooth mouse response, and lack of UI interference with lyrics or album controls.

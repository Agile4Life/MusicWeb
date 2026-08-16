# FullView Interactive Multi-Layer Particle System Design

## 1. Overview
Enhance the background particle system in FullView (`components/player/ParticleScene.tsx` & `NowPlayingStage.tsx`) to deliver an immersive, cinematic ambient atmosphere. The updated system expands particle coverage across the entire viewport, multiplies particle density (~1000 particles across 3 distinct depth layers), provides multi-layer 3D parallax responsive to mouse movement, and adds localized soft repulsion / dispersion around the user's cursor.

---

## 2. Architecture & Components

### 2.1 Spatial Distribution & Layering
Instead of confining particles to a narrow spherical shell around the center album cover, particles will be distributed across a broad 3D coordinate space covering the entire viewport (`x: [-9, 9]`, `y: [-6, 6]`, `z: [-5, 2]`):

1. **Background Layer (`bgParticles` - ~500 particles)**:
   - **Role**: Fine cosmic dust / ambient starfield.
   - **Characteristics**: Small radius (`size: 0.035`), low opacity (`0.18 - 0.25`), subtle drift, mild parallax factor (`0.15x`).
   - **Performance**: Static buffer with group rotation & parallax translation.

2. **Midground Layer (`midParticles` - ~350 particles)**:
   - **Role**: Shimmering ambient stardust with dynamic float.
   - **Characteristics**: Medium size (`0.055`), medium opacity (`0.28`), responsive to audio analyser frequencies (`scale` & pulsation) and medium parallax factor (`0.4x`).

3. **Foreground Interactive Layer (`fgParticles` - ~150 particles)**:
   - **Role**: Floating glowing bokeh particles that directly interact with the mouse.
   - **Characteristics**: Larger size (`0.08 - 0.14`), soft radial glow, dynamic accent color derived from track cover (`--accent` / extracted palette).
   - **Interactive Cursor Physics**:
     - Mouse ray / coordinates mapped into 3D world space.
     - Proximity repulsion field: particles within distance $R \approx 2.2$ units receive a smooth repulsive velocity pushing them gently away from the cursor.
     - Natural spring damping return: particles smoothly interpolate back to their flowing baseline coordinates.
     - Parallax factor (`0.75x`) for rich depth sensation.

---

## 3. Motion & Interaction Model

### 3.1 Pointer Tracking & Parallax
- Global smoothed pointer coordinates with lerp damping (`damping = 0.05`) for fluid inertia.
- Mouse movement tilts and translates each layer at different rates (Parallax 3D), creating realistic visual depth behind the lyrics and player stage.

### 3.2 Cursor Repulsion Field (Foreground Layer)
- In `useFrame`, calculate distance vector $\vec{d} = \vec{p}_i - \vec{cursor}_{3D}$.
- If $\|\vec{d}\| < R$, calculate normalized repulsion force $F = (1 - \|\vec{d}\| / R)^2 \times \text{forceMagnitude}$.
- Displace particle offset smoothly and restore via spring damping $\Delta x \leftarrow \Delta x \cdot 0.92$.

### 3.3 Audio Reactivity
- Modulate particle scale and gentle pulsation based on audio frequency data (`analyserData`).
- Preserves smooth animation when paused or buffering.

---

## 4. Accessibility & Performance
- **Frame Rate Target**: Solid 60 FPS on standard hardware. Zero memory allocations per animation frame.
- **Hardware Acceleration Check**: Fully gated behind `canUse3D` hook (WebGL fallback handles low-end devices).
- **Reduced Motion**: Respects `prefers-reduced-motion` media query by disabling parallax and cursor repulsion.

---

## 5. Verification Plan
- **Visual Inspection**: Verify particles fill the entire background seamlessly behind both album stage and lyrics view.
- **Mouse Interaction**: Verify fluid parallax tilt across the whole screen and responsive particle dispersion when moving the cursor.
- **Color & Audio Integration**: Confirm particles adopt the track's accent glow and react smoothly to playback.
- **Responsive Testing**: Test across desktop and laptop viewport sizes without clipping or performance drops.

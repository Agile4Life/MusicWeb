# Design Spec: Sidebar Navigation Gliding Indicator & Hover Effects

## Goal
Enhance the Sidebar navigation in `MusicWeb` with a smooth gliding hover indicator pill, hover nudging for icons/labels, and click ripple effects, applied consistently across both the "Khám phá" (Navigation) and "Playlist" sections, fully synchronized with the site's dynamic theme colors (`var(--spotify-glow)` and `var(--primary-spotify)`).

## Proposed Architecture & Design

### 1. Style System & Animation (`app/globals.css`)
- **Gliding Indicator (`.nav-indicator`)**:
  - Positioned absolutely inside relative container (`nav` or playlist list).
  - Smooth transform transitions (`transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`, `opacity 0.25s ease`, `height 0.25s ease`).
  - Colors: Styled with `var(--theme-gradient-1, rgba(6,182,212,0.12))` background, inset border with `var(--spotify-glow, #22d3ee)` at subtle opacity, and ambient glow box-shadow.
- **Sidebar Items (`.sidebar-item`)**:
  - `position: relative`, `overflow: hidden`, `z-index: 1`.
  - Icon nudging: `transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`, moves `translateX(3px) scale(1.05)` on hover.
  - Label nudging: `transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`, moves `translateX(3px)` on hover.
- **Click Ripple Effect (`.ripple`)**:
  - Keyframe `@keyframes rip` scaling from `scale(0)` to `scale(3.2)` with fading opacity.

### 2. React Component State & Handlers (`components/sidebar/Sidebar.tsx`)
- Maintain state for active indicator positions:
  - `exploreIndicator`: `{ top: number; height: number; opacity: number }`
  - `playlistIndicator`: `{ top: number; height: number; opacity: number }`
- Event Handlers:
  - `handleItemMouseEnter(section, targetElement)`: Calculates `offsetTop` and `offsetHeight` relative to section container and updates indicator state.
  - `handleSectionMouseLeave(section)`: Moves indicator back to the active link item in that section, or sets `opacity: 0` if no active item.
  - `handleItemClick(e)`: Creates a temporary `.ripple` element inside the clicked item at mouse event offsets `(e.clientX, e.clientY)`.

## Verification Plan
1. Test hovering each item in "Khám phá" — indicator should glide smoothly to the item position, text and icon nudge right slightly.
2. Test hovering items in "Playlist" section — indicator should glide smoothly across playlist items.
3. Test clicking an item — ripple effect expands from click coordinate and fades out.
4. Verify theme color changes — indicator glow matches current active theme gradient and accent color.
5. Run unit tests (`cmd /c "npm run test"`) to ensure no regressions.

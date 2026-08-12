# Task 2: Configure CSS Variables & Tailwind v4 Theme Tokens in `app/globals.css`

**Files:**
- Modify: `app/globals.css:1-60`

**Interfaces:**
- Consumes: Font CSS variables from `app/layout.tsx` (`--font-space-grotesk`, `--font-inter`, `--font-jetbrains-mono`)
- Produces: Utility classes `font-display`, `font-sans`, `font-mono` via Tailwind CSS v4 `@theme`

## Steps
1. Remove line 2 in `app/globals.css`:
   `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap');`
2. Add `@theme` block in `app/globals.css`:
```css
@theme {
  --font-display: var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif;
  --font-sans: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), 'JetBrains Mono', monospace;
}
```
3. Update `:root` in `app/globals.css`:
```css
:root {
  --font-display: var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif;
  --font-sans: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), 'JetBrains Mono', monospace;
  ...
}
```
4. Run `cmd /c npx tsc --noEmit` to verify syntax.

# Task 1: Update Root Layout (`app/layout.tsx`) with Google Fonts

**Files:**
- Modify: `app/layout.tsx:1-55`

**Interfaces:**
- Consumes: `next/font/google` (`Space_Grotesk`, `Inter`, `JetBrains_Mono`)
- Produces: CSS variables `--font-space-grotesk`, `--font-inter`, `--font-jetbrains-mono` on `<html>`

## Steps
1. Import `Space_Grotesk`, `Inter`, `JetBrains_Mono` from `next/font/google`.
2. Configure fonts:
   - `spaceGrotesk`: `variable: '--font-space-grotesk'`, `subsets: ['latin', 'vietnamese']`, `weight: ['600', '700']`, `display: 'swap'`
   - `inter`: `variable: '--font-inter'`, `subsets: ['latin', 'vietnamese']`, `weight: ['400', '500', '600', '700']`, `display: 'swap'`
   - `jetbrainsMono`: `variable: '--font-jetbrains-mono'`, `subsets: ['latin', 'vietnamese']`, `weight: ['400', '500']`, `display: 'swap'`
3. Update `<html lang="vi">` class list in `app/layout.tsx` to: `${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans h-full antialiased dark`.
4. Run `cmd /c npx tsc --noEmit` to verify type safety.
5. Commit changes.

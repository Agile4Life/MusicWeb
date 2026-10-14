# Intro animation polish

**Goal:** Make the existing favicon and MuSic signature entrance more expressive and reveal the app promptly.

**Design:** Retain theme colors and the glass plaque. Add two subtle sound-wave rings, one light sweep, and a small equalizer. The bottom border must have a continuously traveling highlight, per the user request. Stagger the plaque, icon, and signature inside a 2100 ms hold; fade a separate exit wrapper over 280 ms. Reduced motion uses a 180 ms gentle entrance and exit with static decorations.

**Architecture:** Extend the current client component and global CSS, sharing timing constants via CSS properties. Preserve auth readiness, public routes, E2E bypass, and the maximum-wait fallback. Read the canonical gaming-mode preference and legacy key. Keep shared sidebar/AppLogoIcon keyframes. No dependencies or new assets.

- [x] Add and run a failing startup time-budget regression check.
- [x] Update timing constants and markup, including safe preference reads.
- [x] Implement coordinated CSS entrance, a continuously traveling bottom border, equalizer, independent exit, responsive layout, and reduced motion.
- [x] Check Chromium desktop/mobile screenshots and frames, readiness/fallback, bypass, and reduced motion.
- [x] Run focused unit tests, ESLint, TypeScript, and independent code review.

Verification: 5/5 focused unit tests, ESLint, and TypeScript passed. Chromium checks passed for desktop/mobile layouts, reduced motion, moving border, normal completion, gaming/onboarding bypasses, storage failure recovery, delayed auth, and auth timeout. Independent animation review approved.

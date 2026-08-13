# Mobile/Tablet Clarity & Profile Menu Design

## Goal

Make the MusicWeb interface readable and usable on phones and tablets, especially at the current 768px boundary shown in the supplied screenshots. Move logout behind the user avatar so the header stays compact and the destructive action is intentional.

## Design direction

Preserve the existing Aurora Glass visual language, but reduce visual competition on small screens: stronger surface opacity, clearer text contrast, restrained blur/glow, and touch targets of at least 44px. Animation remains enabled; it should support state changes rather than obscure text or controls.

## Responsive behavior

- Treat widths below 1024px as mobile/tablet layout.
- Use `lg` as the desktop boundary for the persistent sidebar, desktop playerbar, and desktop-only navigation behavior.
- Keep the mobile header, bottom navigation, drawer, and mobile player active through 1023px.
- Reserve bottom safe-area space so the player and bottom navigation do not cover page content or one another.
- At tablet widths, constrain drawer/player surfaces to the viewport and prevent horizontal overflow.

### Mobile playerbar layering

- Keep the mini player visible below 1024px and position it above the bottom navigation with an explicit, safe-area-aware offset.
- Give the mini player an explicit minimum height that includes the cover/control row, horizontal padding, and progress indicator; it must not clip its rounded border or lower edge.
- Add matching bottom padding to the scrollable content so the last content row remains reachable above both the mini player and bottom navigation.
- Keep the mini player width within the viewport, including its border and safe-area padding, and prevent the title/control row from forcing horizontal overflow.
- Ensure the full-screen mobile player overlay remains above the mini player and bottom navigation, with no intermediate clipping container.

## Mobile readability pass

- Increase contrast for primary and secondary labels using the existing theme tokens rather than isolated colors.
- Make controls and navigation items at least 44px high/wide where practical.
- Use more opaque panel backgrounds and a lower blur radius on dense mobile surfaces.
- Keep active navigation state identifiable through both color and surface/border treatment.
- Ensure long track names, artist names, and labels truncate without overlapping neighboring controls.
- Keep playerbar controls visually grouped and leave enough vertical separation from bottom navigation.

## Avatar profile menu

- Replace the always-visible logout icon in `TopBar` with a single avatar trigger on mobile/tablet.
- The trigger opens a compact anchored menu on wider tablet widths and a bottom-aligned sheet/popover on narrow phones, using the same state and actions.
- The menu displays the current display name/email, role, and a clearly labeled “Đăng xuất” action.
- Close on outside click, Escape, route navigation, and after logout.
- Keep the existing Supabase + NextAuth logout sequence unchanged.
- The mobile drawer user footer should use the same avatar-menu behavior or link to the same profile action, avoiding a second permanently visible logout control.
- Unauthenticated users continue to see the existing login action.

## Component boundaries

- `TopBar.tsx`: avatar trigger, profile menu state, outside/Escape close behavior.
- `MobileHeaderNav.tsx`: mobile/tablet trigger integration and drawer user area.
- `app/(app)/layout.tsx`: responsive utility boundaries and safe-area layout spacing.
- `PlayerBar.tsx` and relevant CSS: switch desktop-only behavior from `md` to `lg` and protect mobile stacking.
- `app/globals.css`: mobile/tablet tokens, surface contrast, touch targets, safe-area spacing, playerbar height/offset, and breakpoint-specific layering.
- Add a small reusable interaction helper only if the profile-menu close behavior cannot be shared cleanly through existing patterns.

## Verification

- Add focused tests for profile-menu visibility/toggle semantics and logout action exposure.
- Run TypeScript, focused tests, diff checks, and production build.
- Perform a visual pass at representative widths: 390px, 768px, and 1023px, capturing before/after screenshots. Confirm no overlap among header, content, playerbar, drawer, and bottom navigation; confirm the mini player is fully visible with its border/progress edge intact; confirm logout is hidden until avatar activation.

## Out of scope

- Redesigning desktop navigation beyond changing the responsive boundary.
- Changing authentication providers, session handling, or logout semantics.
- Removing existing animations globally.

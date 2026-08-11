---
name: add-custom-cursor
description: Use when adding a new custom animated/static cursor character set (.ani, .cur, PNGs) to the MusicWeb application.
---

# Add Custom Cursor Skill

Use this skill whenever the user provides a folder path or zip download containing `.ani`, `.cur`, or PNG files for a new cursor character set.

## Automatic Execution Procedure

Run the automated CLI script:

```bash
npm run add-cursor "<source-folder-path>" "<cursor-id>" "<Character Display Name>" "<Description/Anime Title>" "[themeColor]"
```

### Parameters:
- `<source-folder-path>`: Path to the directory containing `.ani`, `.cur`, or `.png` files.
- `<cursor-id>`: Kebab-case identifier (e.g. `raiden-shogun`, `hu-tao`, `zero-two`).
- `<Character Display Name>`: Display title shown in settings UI (e.g. `Raiden Shogun (Inazuma)`).
- `<Description>`: Subtitle shown under character card (e.g. `Genshin Impact Anime`).
- `[themeColor]`: Optional card badge accent color (`purple`, `cyan`, `amber`, `emerald`, `rose`, `blue`).

### What this command does automatically:
1. Parses DIB/ANI/PNG headers, extracts 32-bit RGBA 100% transparent pixel arrays, fixes bottom-up row pitch, and outputs PNGs into `public/cursors/<id>/static/`.
2. Registers the new character in `lib/cursors.ts` (`CURSOR_CONFIGS`).
3. ThemeSelector UI, ThemeContext, and globals.css dynamically render the new character cursor instantly without any manual code edits!

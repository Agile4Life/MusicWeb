# Song battle initialization and add UX

Scope: spotify-lab builder, source import, playback, community publishing.

1. Add browser regressions for a fresh deck, two-track start, duplicate source identities, import cancellation, native playback and champion playback.
2. SourcePicker: cancel obsolete requests, share source identity with merging, report actual added counts, expose retry on playlist loading errors.
3. Builder: reset selection for explicit new-deck creation; derive a usable bracket size; catch initialization errors; preserve normal tab switching.
4. Playback: support MusicWeb in PreviewPlayer, show preview during battles, prevent simultaneous native autoplay, keep completed/mobile battles scrollable.
5. Publishing: identify unsupported local sources before submitting, validate trimmed fields, initialize creator from resolved session.
6. Run songBattle unit suites, browser regressions and existing community/battle flows, TypeScript and targeted ESLint. Record environmental limitations rather than claiming live provider coverage.

Use the existing public-source validation contract: local/Drive tracks remain playable locally but cannot be published as public decks. Do not expose private stream URLs through public decks.

UX follow-up: keep existing components and layout; add feedback for search-result additions, preview controls within the selected list, and undo for clearing the list. Existing working-copy debug logs in SourcePicker are preserved. Concurrent motion edits in BattleView/CSS are preserved.

Validation: 31 logic/API tests passed; 10 SQL tests passed with the repository's low-memory V8 options; 8 browser UX regressions passed. Targeted ESLint and diff whitespace checks passed. Full TypeScript check reports an unrelated existing error in lib/playback/__tests__/playbackSourceService.test.ts:592 (findFallback is not a ClientResolutionService property). Browser tests mock providers; live Spotify/YouTube/SoundCloud/Drive playback is not certified by these checks.

Final existing-flow regression run: all 14 battle/community browser tests passed, bringing browser coverage to 22 passing cases.

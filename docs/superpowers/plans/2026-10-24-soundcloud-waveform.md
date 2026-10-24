# SoundCloud cover waveform

Goal: Replace the SoundCloud embed in song battles and previews with a cover player featuring play/pause, time, and a waveform seek control.

Use the existing seekable `/api/soundcloud/stream` endpoint. Keep playback in a native audio element and use a native range input over an SVG waveform for pointer, touch and keyboard access. Decode peaks lazily after playback starts; retain a neutral seek rail if decoding is unavailable. Pause other native players on play and release media and decoding resources on unmount.

- [x] Test waveform peak extraction, including silence and short input (16 focused unit tests passed).
- [x] Implement the shared cover player and integrate both SoundCloud entry points.
- [x] Verify lint, TypeScript, focused unit tests and browser playback/seek interactions with a controlled audio fixture. ESLint and browser test passed, including preview, waveform decoding, seek, keyboard, exclusive playback, desktop/mobile sizing and match cleanup. Full TypeScript check reports a pre-existing unrelated error at `lib/playback/__tests__/playbackSourceService.test.ts:592` (`findFallback` is not part of `ClientResolutionService`).

interface AudioSourceTarget {
  src: string
  volume: number
  currentTime: number
  load?: () => void
}

export function isSameAudioSource(currentSrc: string, newUrl: string): boolean {
  if (!currentSrc || !newUrl) return false
  if (currentSrc === newUrl) return true
  try {
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsedCurrent = new URL(currentSrc, currentOrigin)
    const parsedNew = new URL(newUrl, currentOrigin)
    return parsedCurrent.pathname === parsedNew.pathname && parsedCurrent.search === parsedNew.search
  } catch {
    return currentSrc === newUrl
  }
}

export function setAudioSourceForPlayback(
  audio: AudioSourceTarget & { muted?: boolean; error?: MediaError | null },
  url: string,
  volume: number,
  startTime = 0,
) {
  const srcChanged = !isSameAudioSource(audio.src, url)
  if (srcChanged) {
    audio.src = url
    // Explicitly call load() to reset the audio element's internal state.
    // This is critical when the element was in an error state (e.g. from an
    // expired SoundCloud CDN URL) — simply assigning src may not fully reset
    // the error flag on all browsers, causing the subsequent play() to fail.
    if (typeof audio.load === 'function') {
      audio.load()
    }
  }
  const safeVolume = typeof volume === 'number' && !isNaN(volume) ? Math.max(0, Math.min(1, volume)) : 0.8
  audio.volume = safeVolume
  if ('muted' in audio) {
    audio.muted = safeVolume === 0
  }
  // Only set currentTime when the source did NOT change — if it did, the new
  // resource hasn't loaded metadata yet so seeking would throw or be ignored.
  // For new sources, the caller should wait for 'loadedmetadata' or rely on
  // startSeconds parameters in the URL instead.
  if (!srcChanged || startTime === 0) {
    try {
      audio.currentTime = startTime
    } catch {}
  }
}

interface AudioSourceTarget {
  src: string
  volume: number
  currentTime: number
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
  audio: AudioSourceTarget & { muted?: boolean },
  url: string,
  volume: number,
  startTime = 0,
) {
  if (!isSameAudioSource(audio.src, url)) {
    audio.src = url
  }
  const safeVolume = typeof volume === 'number' && !isNaN(volume) ? Math.max(0, Math.min(1, volume)) : 0.8
  audio.volume = safeVolume
  if ('muted' in audio) {
    audio.muted = safeVolume === 0
  }
  try {
    audio.currentTime = startTime
  } catch {}
}

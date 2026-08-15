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
  audio: AudioSourceTarget,
  url: string,
  volume: number,
  startTime = 0,
) {
  if (!isSameAudioSource(audio.src, url)) {
    audio.src = url
  }
  audio.volume = volume
  try {
    audio.currentTime = startTime
  } catch {}
}

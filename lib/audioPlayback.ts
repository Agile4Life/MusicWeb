export async function playAudioElement(audio: Pick<HTMLAudioElement, 'play'>): Promise<void> {
  await audio.play()
}

/**
 * Detect iOS devices (Safari, Chrome, all browsers on iOS use WebKit).
 * iPadOS 13+ reports as macOS, so also check for touch-capable Macs.
 */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua)
  const ipadOs = ua.includes('Macintosh') && navigator.maxTouchPoints > 1
  return iOS || ipadOs
}

export function shouldUseHtml5Audio(track: { source?: string; youtube_id?: string; audio_url?: string }): boolean {
  return track.source !== 'youtube' && !track.youtube_id
}

export function redactAudioSource(source: string): string {
  if (!source) return ''
  const queryIndex = source.indexOf('?')
  return queryIndex >= 0 ? `${source.slice(0, queryIndex)}?[redacted]` : source
}

export function toPersistedTrack<T extends {
  source?: string
  audio_url?: string
  file_path?: string
}>(track: T): T {
  if (track.source !== 'nhaccuatui') return track

  return {
    ...track,
    audio_url: undefined,
    file_path: '',
  }
}

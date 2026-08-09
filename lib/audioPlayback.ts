export async function playAudioElement(audio: Pick<HTMLAudioElement, 'play'>): Promise<void> {
  await audio.play()
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

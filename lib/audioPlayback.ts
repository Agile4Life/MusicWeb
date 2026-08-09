export async function playAudioElement(audio: Pick<HTMLAudioElement, 'play'>): Promise<void> {
  await audio.play()
}

export function shouldUseHtml5Audio(track: { source?: string; youtube_id?: string }): boolean {
  return track.source !== 'youtube' && !track.youtube_id
}

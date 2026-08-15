interface AudioSourceTarget {
  src: string
  volume: number
  currentTime: number
}

export function setAudioSourceForPlayback(
  audio: AudioSourceTarget,
  url: string,
  volume: number,
  startTime = 0,
) {
  if (audio.src !== url) {
    audio.src = url
  }
  audio.volume = volume
  try {
    audio.currentTime = startTime
  } catch {}
}

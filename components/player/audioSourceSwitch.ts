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
  audio.src = url
  audio.volume = volume
  audio.currentTime = startTime
}

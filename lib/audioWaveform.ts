/** Normalized peak amplitude for equal time slices, including silent audio. */
export function waveformPeaks(samples: Float32Array, count = 72): number[] {
  const peaks = Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * samples.length / count)
    const end = Math.floor((index + 1) * samples.length / count)
    let peak = 0
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]))
    return peak
  })
  const max = Math.max(...peaks)
  return max ? peaks.map(peak => peak / max) : peaks
}

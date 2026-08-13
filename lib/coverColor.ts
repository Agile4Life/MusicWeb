const SAMPLE_SIZE = 32
const accentCache = new Map<string, string>()

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function deriveAccentFromPixels(
  pixels: Uint8ClampedArray,
  fallback: string,
) {
  let red = 0
  let green = 0
  let blue = 0
  let weightTotal = 0

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const brightest = Math.max(r, g, b)
    const darkest = Math.min(r, g, b)
    const saturation = brightest - darkest

    if (alpha < 0.5 || saturation < 24 || brightest < 28 || brightest > 248) continue

    const weight = alpha * (0.35 + saturation / 255)
    red += r * weight
    green += g * weight
    blue += b * weight
    weightTotal += weight
  }

  if (weightTotal === 0) return fallback

  return `rgb(${clampChannel(red / weightTotal)} ${clampChannel(green / weightTotal)} ${clampChannel(blue / weightTotal)})`
}

export function extractCoverAccent(
  source: string | null | undefined,
  fallback = 'rgb(6 182 212)',
): Promise<string> {
  if (!source || typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(fallback)
  }

  const cached = accentCache.get(source)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'

    const finish = (color: string) => {
      if (color !== fallback) accentCache.set(source, color)
      resolve(color)
    }

    image.onerror = () => finish(fallback)
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return finish(fallback)

        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
        finish(deriveAccentFromPixels(pixels, fallback))
      } catch {
        // A tainted canvas is expected for unsupported cross-origin URLs.
        finish(fallback)
      }
    }
    image.src = source
  })
}

export function clearCoverAccentCache() {
  accentCache.clear()
}

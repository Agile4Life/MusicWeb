// Liquid Glass optical filters & displacement math utilities
// Inspired by Apple VisionOS refraction and liquid-glass-react

export interface Vec2 {
  x: number
  y: number
}

export type RefractionMode = 'standard' | 'polar' | 'prominent' | 'shader'

function smoothStep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

/**
 * Generate a procedural displacement map via 2D Canvas for fluid refraction
 */
export function generateProceduralDisplacementMap(width = 256, height = 256, cornerRadius = 0.5): string {
  if (typeof document === 'undefined') return ''

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const imgData = ctx.createImageData(width, height)
  const data = imgData.data

  const halfW = 0.5
  const halfH = 0.5
  const radius = Math.min(halfW, halfH) * cornerRadius

  for (let y = 0; y < height; y++) {
    const ny = y / height - 0.5
    for (let x = 0; x < width; x++) {
      const nx = x / width - 0.5
      const idx = (y * width + x) * 4

      const d = roundedRectSDF(nx, ny, halfW * 0.7, halfH * 0.7, radius)
      const displacement = smoothStep(0.6, 0, d - 0.08)
      const factor = smoothStep(0, 1, displacement)

      const dispX = nx * factor + 0.5
      const dispY = ny * factor + 0.5

      // R channel encodes X displacement, B channel encodes Y displacement, G channel encodes intensity
      data[idx] = Math.floor(Math.max(0, Math.min(255, dispX * 255)))
      data[idx + 1] = Math.floor(Math.max(0, Math.min(255, (1 - factor) * 255)))
      data[idx + 2] = Math.floor(Math.max(0, Math.min(255, dispY * 255)))
      data[idx + 3] = 255
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

// Optimized SVG Data URLs for ultra-fast inline displacement maps without external network requests
export const SVG_DISPLACEMENT_MAPS = {
  standard: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23808080"/><stop offset="70%" stop-color="%23a040c0"/><stop offset="100%" stop-color="%23ff00ff"/></radialGradient></defs><rect width="256" height="256" fill="url(%23g)"/></svg>`,
  polar: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="%23808080"/><stop offset="50%" stop-color="%2320a0d0"/><stop offset="85%" stop-color="%23c020a0"/><stop offset="100%" stop-color="%23ff00ff"/></radialGradient></defs><rect width="256" height="256" fill="url(%23g)"/></svg>`,
  prominent: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23808080"/><stop offset="60%" stop-color="%233060c0"/><stop offset="90%" stop-color="%23e01080"/><stop offset="100%" stop-color="%23ffffff"/></radialGradient></defs><rect width="256" height="256" fill="url(%23g)"/></svg>`,
}

export function getDisplacementMapUri(mode: RefractionMode, customShaderUri?: string): string {
  if (mode === 'shader' && customShaderUri) {
    return customShaderUri
  }
  return SVG_DISPLACEMENT_MAPS[mode] || SVG_DISPLACEMENT_MAPS.standard
}

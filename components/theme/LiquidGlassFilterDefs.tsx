'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useTheme } from './ThemeContext'

// ─── Fragment Shader Types & SDF Math (Canvas 2D approach) ───

export interface Vec2 {
  x: number
  y: number
}

export type FragmentShaderType = 'liquidGlass'

function smoothstep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

function roundedRectSDF(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const qx = Math.abs(x) - halfW + radius
  const qy = Math.abs(y) - halfH + radius
  return Math.min(Math.max(qx, qy), 0) + length2(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function polarSDF(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const dist = length2(x, y)
  const edge = dist - Math.min(halfW, halfH)
  const rounded = roundedRectSDF(x, y, halfW, halfH, radius)
  return Math.max(edge, rounded)
}

function texture(x: number, y: number): Vec2 {
  return { x, y }
}

const fragmentShaders = {
  liquidGlass: (
    uv: Vec2,
    halfW: number,
    halfH: number,
    radius: number
  ): Vec2 => {
    const ix = uv.x - 0.5
    const iy = uv.y - 0.5
    const d = roundedRectSDF(ix, iy, halfW, halfH, radius)
    const disp = smoothstep(0.8, 0, d - 0.15)
    const scaled = smoothstep(0, 1, disp)
    return texture(ix * scaled + 0.5, iy * scaled + 0.5)
  },
  liquidGlassPolar: (
    uv: Vec2,
    halfW: number,
    halfH: number,
    radius: number
  ): Vec2 => {
    const ix = uv.x - 0.5
    const iy = uv.y - 0.5
    const d = polarSDF(ix, iy, halfW, halfH, radius)
    const disp = smoothstep(0.8, 0, d - 0.15)
    const scaled = smoothstep(0, 1, disp)
    return texture(ix * scaled + 0.5, iy * scaled + 0.5)
  },
}

// ─── Canvas 2D Displacement Map Generator ───

export class ShaderDisplacementGenerator {
  private canvas!: HTMLCanvasElement
  private context: CanvasRenderingContext2D | null = null
  private canvasDPI = 1

  constructor(private width: number, private height: number) {
    if (typeof window === 'undefined') return
    this.canvas = document.createElement('canvas')
    this.canvas.width = width * this.canvasDPI
    this.canvas.height = height * this.canvasDPI
    this.canvas.style.display = 'none'
    this.context = this.canvas.getContext('2d')
  }

  generate(
    shader: 'liquidGlass' | 'liquidGlassPolar',
    halfW: number,
    halfH: number,
    radius: number
  ): string {
    if (!this.context) return ''
    const w = this.width * this.canvasDPI
    const h = this.height * this.canvasDPI
    const fragFn = fragmentShaders[shader]

    let maxScale = 0
    const rawValues: number[] = []

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const uv: Vec2 = { x: x / w, y: y / h }
        const pos = fragFn(uv, halfW, halfH, radius)
        const dx = pos.x * w - x
        const dy = pos.y * h - y
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
        rawValues.push(dx, dy)
      }
    }

    maxScale = Math.max(maxScale, 1)

    const imageData = this.context.createImageData(w, h)
    const data = imageData.data

    let rawIdx = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = rawValues[rawIdx++]
        const dy = rawValues[rawIdx++]
        const edgeDist = Math.min(x, y, w - x - 1, h - y - 1)
        const edgeFactor = Math.min(1, edgeDist / 2)
        const r = (dx * edgeFactor) / maxScale + 0.5
        const g = (dy * edgeFactor) / maxScale + 0.5
        const pixelIdx = (y * w + x) * 4
        data[pixelIdx] = Math.round(Math.max(0, Math.min(255, r * 255)))
        data[pixelIdx + 1] = Math.round(Math.max(0, Math.min(255, g * 255)))
        data[pixelIdx + 2] = Math.round(Math.max(0, Math.min(255, g * 255)))
        data[pixelIdx + 3] = 255
      }
    }

    this.context.putImageData(imageData, 0, 0)
    return this.canvas.toDataURL()
  }

  destroy() {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
  }
}

// ─── SVG Filter Builder (matching liquid-glass-react exactly) ───

function buildSVGFilter(
  id: string,
  displacementSrc: string,
  displacementScale: number,
  aberrationIntensity: number,
  mode: 'standard' | 'polar' | 'prominent' | 'shader',
  width: number,
  height: number
) {
  const shaderMode = mode === 'shader' ? 1 : -1
  const blurStdDev = Math.max(0.1, 0.5 - aberrationIntensity * 0.1)
  const edgeStart = Math.max(30, 80 - aberrationIntensity * 2)

  return (
    <svg
      key={id}
      style={{ position: 'absolute', width, height }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-edge-mask`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="black" stopOpacity="0" />
          <stop offset={`${edgeStart}%`} stopColor="black" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </radialGradient>

        <filter
          id={id}
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            id="feimage"
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISPLACEMENT_MAP"
            href={displacementSrc}
            preserveAspectRatio="xMidYMid slice"
          />

          <feColorMatrix
            in="DISPLACEMENT_MAP"
            type="matrix"
            values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
            result="EDGE_INTENSITY"
          />
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA
              type="discrete"
              tableValues={`0 ${aberrationIntensity * 0.05} 1`}
            />
          </feComponentTransfer>

          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={displacementScale * shaderMode}
            xChannelSelector="R"
            yChannelSelector="B"
            result="RED_DISPLACED"
          />
          <feColorMatrix
            in="RED_DISPLACED"
            type="matrix"
            values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
            result="RED_CHANNEL"
          />

          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={displacementScale * shaderMode * (1 - aberrationIntensity * 0.05)}
            xChannelSelector="R"
            yChannelSelector="B"
            result="GREEN_DISPLACED"
          />
          <feColorMatrix
            in="GREEN_DISPLACED"
            type="matrix"
            values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
            result="GREEN_CHANNEL"
          />

          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={displacementScale * shaderMode * (1 - aberrationIntensity * 0.1)}
            xChannelSelector="R"
            yChannelSelector="B"
            result="BLUE_DISPLACED"
          />
          <feColorMatrix
            in="BLUE_DISPLACED"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
            result="BLUE_CHANNEL"
          />

          <feBlend
            in="GREEN_CHANNEL"
            in2="BLUE_CHANNEL"
            mode="screen"
            result="GB_COMBINED"
          />
          <feBlend
            in="RED_CHANNEL"
            in2="GB_COMBINED"
            mode="screen"
            result="RGB_COMBINED"
          />
          <feGaussianBlur
            in="RGB_COMBINED"
            stdDeviation={blurStdDev}
            result="ABERRATED_BLURRED"
          />
          <feComposite
            in="ABERRATED_BLURRED"
            in2="EDGE_MASK"
            operator="in"
            result="EDGE_ABERRATION"
          />
          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feComposite
            in="CENTER_ORIGINAL"
            in2="INVERTED_MASK"
            operator="in"
            result="CENTER_CLEAN"
          />
          <feComposite
            in="EDGE_ABERRATION"
            in2="CENTER_CLEAN"
            operator="over"
          />
        </filter>
      </defs>
    </svg>
  )
}

// ─── Static Displacement Maps (base64 pre-computed) ───

const STATIC_DISPLACEMENT_MAPS = {
  standard:
    'data:image/jpeg;base64,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',
  polar:
    'data:image/jpeg;base64,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',
  prominent:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
}

// ─── Main Component ───

export type LiquidRefractionMode = 'standard' | 'polar' | 'prominent' | 'shader'

export interface LiquidGlassFilterDefsProps {
  width?: number
  height?: number
  refractionMode?: LiquidRefractionMode
  displacementScale?: number
  aberrationIntensity?: number
  /** For 'shader' mode: shape ratio (0-1). 0.3 = rounded pill, 0.5 = circular */
  shapeRatio?: number
  /** For 'shader' mode: corner radius ratio */
  cornerRatio?: number
}

export function LiquidGlassFilterDefs({
  width = 300,
  height = 80,
  refractionMode = 'standard',
  displacementScale = 45,
  aberrationIntensity = 2,
  shapeRatio = 0.3,
  cornerRatio = 0.6,
}: LiquidGlassFilterDefsProps) {
  const { themeStyle } = useTheme()
  const [shaderMapUrl, setShaderMapUrl] = useState<string>('')
  const generatorRef = useRef<ShaderDisplacementGenerator | null>(null)

  // Generate shader displacement map when in shader mode
  useEffect(() => {
    if (refractionMode !== 'shader') return
    if (typeof window === 'undefined') return

    const gen = new ShaderDisplacementGenerator(width, height)
    generatorRef.current = gen

    const mapUrl = gen.generate(
      'liquidGlass',
      shapeRatio,
      0.15,
      cornerRatio
    )
    setShaderMapUrl(mapUrl)

    return () => {
      gen.destroy()
      generatorRef.current = null
    }
  }, [refractionMode, width, height, shapeRatio, cornerRatio])

  if (themeStyle !== 'liquid-glass') return null

  const mode = refractionMode
  const svgId = `lg-${mode}-${width}x${height}`

  let displacementSrc = ''
  if (mode === 'standard') displacementSrc = STATIC_DISPLACEMENT_MAPS.standard
  else if (mode === 'polar') displacementSrc = STATIC_DISPLACEMENT_MAPS.polar
  else if (mode === 'prominent') displacementSrc = STATIC_DISPLACEMENT_MAPS.prominent
  else if (mode === 'shader') displacementSrc = shaderMapUrl || STATIC_DISPLACEMENT_MAPS.standard

  const scale =
    mode === 'prominent'
      ? displacementScale * 1.9
      : mode === 'shader'
        ? displacementScale * 1.2
        : mode === 'polar'
          ? displacementScale * 1.4
          : displacementScale

  return (
    <svg
      id={svgId}
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        {/* Standard: rounded rect SDF */}
        <filter
          id={`lg-standard`}
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            x="0" y="0" width="100%" height="100%"
            result="DISPLACEMENT_MAP"
            href={STATIC_DISPLACEMENT_MAPS.standard}
            preserveAspectRatio="xMidYMid slice"
          />
          <feColorMatrix in="DISPLACEMENT_MAP" type="matrix"
            values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
            result="EDGE_INTENSITY"/>
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`}/>
          </feComponentTransfer>
          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED"/>
          <feColorMatrix in="RED_DISPLACED" type="matrix"
            values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale * (1 - aberrationIntensity * 0.05)} xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED"/>
          <feColorMatrix in="GREEN_DISPLACED" type="matrix"
            values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale * (1 - aberrationIntensity * 0.1)} xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED"/>
          <feColorMatrix in="BLUE_DISPLACED" type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL"/>
          <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED"/>
          <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED"/>
          <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1)} result="ABERRATED_BLURRED"/>
          <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION"/>
          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0"/>
          </feComponentTransfer>
          <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN"/>
          <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over"/>
        </filter>

        {/* Polar: spherical lens SDF */}
        <filter
          id={`lg-polar`}
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            x="0" y="0" width="100%" height="100%"
            result="DISPLACEMENT_MAP"
            href={STATIC_DISPLACEMENT_MAPS.polar}
            preserveAspectRatio="xMidYMid slice"
          />
          <feColorMatrix in="DISPLACEMENT_MAP" type="matrix"
            values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
            result="EDGE_INTENSITY"/>
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05 * 1.2} 1`}/>
          </feComponentTransfer>
          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED"/>
          <feColorMatrix in="RED_DISPLACED" type="matrix"
            values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale * (1 - aberrationIntensity * 0.05 * 1.2)} xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED"/>
          <feColorMatrix in="GREEN_DISPLACED" type="matrix"
            values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale * (1 - aberrationIntensity * 0.1 * 1.2)} xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED"/>
          <feColorMatrix in="BLUE_DISPLACED" type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL"/>
          <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED"/>
          <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED"/>
          <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1 * 1.2)} result="ABERRATED_BLURRED"/>
          <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION"/>
          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0"/>
          </feComponentTransfer>
          <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN"/>
          <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over"/>
        </filter>

        {/* Prominent: high contrast crystal bevel */}
        <filter
          id={`lg-prominent`}
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            x="0" y="0" width="100%" height="100%"
            result="DISPLACEMENT_MAP"
            href={STATIC_DISPLACEMENT_MAPS.prominent}
            preserveAspectRatio="xMidYMid slice"
          />
          <feColorMatrix in="DISPLACEMENT_MAP" type="matrix"
            values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
            result="EDGE_INTENSITY"/>
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05 * 1.5} 1`}/>
          </feComponentTransfer>
          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED"/>
          <feColorMatrix in="RED_DISPLACED" type="matrix"
            values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale * (1 - aberrationIntensity * 0.05 * 1.5)} xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED"/>
          <feColorMatrix in="GREEN_DISPLACED" type="matrix"
            values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL"/>
          <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
            scale={scale * (1 - aberrationIntensity * 0.1 * 1.5)} xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED"/>
          <feColorMatrix in="BLUE_DISPLACED" type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL"/>
          <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED"/>
          <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED"/>
          <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1 * 1.5)} result="ABERRATED_BLURRED"/>
          <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION"/>
          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0"/>
          </feComponentTransfer>
          <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN"/>
          <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over"/>
        </filter>

        {/* Shader: Canvas 2D dynamic displacement */}
        {refractionMode === 'shader' && shaderMapUrl && (
          <filter
            id={`lg-shader`}
            x="-35%"
            y="-35%"
            width="170%"
            height="170%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              x="0" y="0" width="100%" height="100%"
              result="DISPLACEMENT_MAP"
              href={shaderMapUrl}
              preserveAspectRatio="xMidYMid slice"
            />
            <feColorMatrix in="DISPLACEMENT_MAP" type="matrix"
              values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0"
              result="EDGE_INTENSITY"/>
            <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
              <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`}/>
            </feComponentTransfer>
            <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"/>
            <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
              scale={scale} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED"/>
            <feColorMatrix in="RED_DISPLACED" type="matrix"
              values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL"/>
            <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
              scale={scale * (1 - aberrationIntensity * 0.05)} xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED"/>
            <feColorMatrix in="GREEN_DISPLACED" type="matrix"
              values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL"/>
            <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP"
              scale={scale * (1 - aberrationIntensity * 0.1)} xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED"/>
            <feColorMatrix in="BLUE_DISPLACED" type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL"/>
            <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED"/>
            <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED"/>
            <feGaussianBlur in="RGB_COMBINED" stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1)} result="ABERRATED_BLURRED"/>
            <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION"/>
            <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
              <feFuncA type="table" tableValues="1 0"/>
            </feComponentTransfer>
            <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN"/>
            <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over"/>
          </filter>
        )}
      </defs>
    </svg>
  )
}

'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTheme } from './ThemeContext'
import { DISPLACEMENT_MAPS } from '@/lib/theme/liquidGlassFilters'

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

const STATIC_DISPLACEMENT_MAPS = DISPLACEMENT_MAPS

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

function renderFilterDef(
  id: string,
  href: string,
  scale: number,
  aberrationIntensity: number,
  aberrationMultiplier = 1
) {
  const effectiveAberration = aberrationIntensity * aberrationMultiplier
  const stdDev = Math.max(0.1, 0.5 - effectiveAberration * 0.1)

  return (
    <filter
      key={id}
      id={id}
      x="-35%"
      y="-35%"
      width="170%"
      height="170%"
      colorInterpolationFilters="sRGB"
    >
      <feImage
        x="0"
        y="0"
        width="100%"
        height="100%"
        result="DISPLACEMENT_MAP"
        href={href}
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
          tableValues={`0 ${effectiveAberration * 0.05} 1`}
        />
      </feComponentTransfer>
      <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="DISPLACEMENT_MAP"
        scale={scale}
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
        scale={scale * (1 - effectiveAberration * 0.05)}
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
        scale={scale * (1 - effectiveAberration * 0.1)}
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
        stdDeviation={stdDev}
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
  )
}

export function LiquidGlassFilterDefs({
  width = 300,
  height = 80,
  refractionMode,
  displacementScale,
  aberrationIntensity,
  shapeRatio = 0.3,
  cornerRatio = 0.6,
}: LiquidGlassFilterDefsProps) {
  const { themeStyle, liquidGlassConfig } = useTheme()
  const [shaderMapUrl, setShaderMapUrl] = useState<string>('')
  const generatorRef = useRef<ShaderDisplacementGenerator | null>(null)

  const mode: LiquidRefractionMode =
    refractionMode ?? liquidGlassConfig?.refractionMode ?? 'standard'
  const resolvedScale =
    displacementScale ?? liquidGlassConfig?.refractionIntensity ?? 45
  const resolvedAberration =
    aberrationIntensity ??
    (liquidGlassConfig?.chromaticAberration === false ? 0 : 2)

  // Generate shader displacement map when in shader mode
  useEffect(() => {
    if (mode !== 'shader') return
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
  }, [mode, width, height, shapeRatio, cornerRatio])

  if (themeStyle !== 'liquid-glass') return null

  const svgId = `lg-${mode}-${width}x${height}`

  const scale =
    mode === 'prominent'
      ? resolvedScale * 1.9
      : mode === 'shader'
        ? resolvedScale * 1.2
        : mode === 'polar'
          ? resolvedScale * 1.4
          : resolvedScale

  const shaderHref = shaderMapUrl || STATIC_DISPLACEMENT_MAPS.standard

  return (
    <svg
      id={svgId}
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        {/* Standard: rounded rect SDF */}
        {renderFilterDef('liquid-glass-standard', STATIC_DISPLACEMENT_MAPS.standard, scale, resolvedAberration, 1)}
        {renderFilterDef('lg-standard', STATIC_DISPLACEMENT_MAPS.standard, scale, resolvedAberration, 1)}

        {/* Polar: spherical lens SDF */}
        {renderFilterDef('liquid-glass-polar', STATIC_DISPLACEMENT_MAPS.polar, scale, resolvedAberration, 1.2)}
        {renderFilterDef('lg-polar', STATIC_DISPLACEMENT_MAPS.polar, scale, resolvedAberration, 1.2)}

        {/* Prominent: high contrast crystal bevel */}
        {renderFilterDef('liquid-glass-prominent', STATIC_DISPLACEMENT_MAPS.prominent, scale, resolvedAberration, 1.5)}
        {renderFilterDef('lg-prominent', STATIC_DISPLACEMENT_MAPS.prominent, scale, resolvedAberration, 1.5)}

        {/* Shader: Canvas 2D dynamic displacement */}
        {renderFilterDef('liquid-glass-shader', shaderHref, scale, resolvedAberration, 1)}
        {renderFilterDef('lg-shader', shaderHref, scale, resolvedAberration, 1)}

        {/* Subtle: gentle refraction */}
        {renderFilterDef('liquid-glass-subtle', STATIC_DISPLACEMENT_MAPS.standard, scale * 0.5, resolvedAberration, 0.5)}
        {renderFilterDef('lg-subtle', STATIC_DISPLACEMENT_MAPS.standard, scale * 0.5, resolvedAberration, 0.5)}
      </defs>
    </svg>
  )
}

'use client'

import React, { useEffect, useState } from 'react'
import { SVG_DISPLACEMENT_MAPS, generateProceduralDisplacementMap } from '@/lib/theme/liquidGlassFilters'
import { useTheme } from './ThemeContext'

export function LiquidGlassFilterDefs() {
  const { themeStyle, liquidGlassConfig } = useTheme()
  const [shaderMap, setShaderMap] = useState<string>('')

  useEffect(() => {
    if (themeStyle === 'liquid-glass' && liquidGlassConfig?.refractionMode === 'shader') {
      const generated = generateProceduralDisplacementMap(256, 256, 0.4)
      setShaderMap(generated)
    }
  }, [themeStyle, liquidGlassConfig?.refractionMode])

  // If classic mode is active, render lightweight empty container
  if (themeStyle !== 'liquid-glass') {
    return null
  }

  const scale = liquidGlassConfig?.refractionIntensity ?? 24
  const aberration = liquidGlassConfig?.chromaticAberration ? 2.2 : 0

  return (
    <svg
      id="liquid-glass-filters-svg"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      aria-hidden="true"
    >
      <defs>
        {/* === Filter Standard === */}
        <filter id="liquid-glass-standard" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feImage
            href={SVG_DISPLACEMENT_MAPS.standard}
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISP_MAP"
            preserveAspectRatio="none"
          />
          {aberration > 0 ? (
            <>
              {/* Red Displaced */}
              <feDisplacementMap in="SourceGraphic" in2="DISP_MAP" scale={scale * 1.1} xChannelSelector="R" yChannelSelector="B" result="RED_RAW" />
              <feColorMatrix in="RED_RAW" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="RED_CH" />

              {/* Green Displaced */}
              <feDisplacementMap in="SourceGraphic" in2="DISP_MAP" scale={scale * (1.1 - aberration * 0.05)} xChannelSelector="R" yChannelSelector="B" result="GREEN_RAW" />
              <feColorMatrix in="GREEN_RAW" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="GREEN_CH" />

              {/* Blue Displaced */}
              <feDisplacementMap in="SourceGraphic" in2="DISP_MAP" scale={scale * (1.1 - aberration * 0.1)} xChannelSelector="R" yChannelSelector="B" result="BLUE_RAW" />
              <feColorMatrix in="BLUE_RAW" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="BLUE_CH" />

              {/* Blend RGB channels */}
              <feBlend in="GREEN_CH" in2="BLUE_CH" mode="screen" result="GB" />
              <feBlend in="RED_CH" in2="GB" mode="screen" result="DISPLACED_BLEND" />
              <feGaussianBlur in="DISPLACED_BLEND" stdDeviation="0.4" result="FINAL_SMOOTH" />
              <feMerge>
                <feMergeNode in="FINAL_SMOOTH" />
              </feMerge>
            </>
          ) : (
            <feDisplacementMap in="SourceGraphic" in2="DISP_MAP" scale={scale} xChannelSelector="R" yChannelSelector="B" />
          )}
        </filter>

        {/* === Filter Polar === */}
        <filter id="liquid-glass-polar" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feImage
            href={SVG_DISPLACEMENT_MAPS.polar}
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISP_MAP_POLAR"
            preserveAspectRatio="none"
          />
          <feDisplacementMap in="SourceGraphic" in2="DISP_MAP_POLAR" scale={scale * 1.25} xChannelSelector="R" yChannelSelector="B" />
        </filter>

        {/* === Filter Prominent === */}
        <filter id="liquid-glass-prominent" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feImage
            href={SVG_DISPLACEMENT_MAPS.prominent}
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISP_MAP_PROMINENT"
            preserveAspectRatio="none"
          />
          <feDisplacementMap in="SourceGraphic" in2="DISP_MAP_PROMINENT" scale={scale * 1.5} xChannelSelector="R" yChannelSelector="B" />
        </filter>

        {/* === Filter Procedural Shader === */}
        <filter id="liquid-glass-shader" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feImage
            href={shaderMap || SVG_DISPLACEMENT_MAPS.standard}
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISP_MAP_SHADER"
            preserveAspectRatio="none"
          />
          <feDisplacementMap in="SourceGraphic" in2="DISP_MAP_SHADER" scale={scale} xChannelSelector="R" yChannelSelector="B" />
        </filter>

        {/* === Subtle Card Glass === */}
        <filter id="liquid-glass-subtle" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feImage
            href={SVG_DISPLACEMENT_MAPS.standard}
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISP_SUBTLE"
            preserveAspectRatio="none"
          />
          <feDisplacementMap in="SourceGraphic" in2="DISP_SUBTLE" scale={scale * 0.4} xChannelSelector="R" yChannelSelector="B" />
        </filter>
      </defs>
    </svg>
  )
}

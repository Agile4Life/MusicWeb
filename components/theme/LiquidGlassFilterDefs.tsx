'use client'

import React, { useEffect, useState } from 'react'
import { DISPLACEMENT_MAPS, RefractionMode } from '@/lib/theme/liquidGlassFilters'
import { useTheme } from './ThemeContext'

function createFilterNodes(
  id: string,
  mapHref: string,
  displacementScale: number,
  aberrationIntensity: number
) {
  return (
    <filter id={id} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
      <feImage
        x="0"
        y="0"
        width="100%"
        height="100%"
        result="DISPLACEMENT_MAP"
        href={mapHref}
        preserveAspectRatio="xMidYMid slice"
      />

      {/* Create edge mask using the displacement map itself */}
      <feColorMatrix
        in="DISPLACEMENT_MAP"
        type="matrix"
        values="0.3 0.3 0.3 0 0
                0.3 0.3 0.3 0 0
                0.3 0.3 0.3 0 0
                0 0 0 1 0"
        result="EDGE_INTENSITY"
      />
      <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
        <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`} />
      </feComponentTransfer>

      {/* Center original clean graphic */}
      <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

      {/* Red channel displacement */}
      <feDisplacementMap
        in="SourceGraphic"
        in2="DISPLACEMENT_MAP"
        scale={displacementScale}
        xChannelSelector="R"
        yChannelSelector="B"
        result="RED_DISPLACED"
      />
      <feColorMatrix
        in="RED_DISPLACED"
        type="matrix"
        values="1 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 1 0"
        result="RED_CHANNEL"
      />

      {/* Green channel displacement with slight offset */}
      <feDisplacementMap
        in="SourceGraphic"
        in2="DISPLACEMENT_MAP"
        scale={displacementScale * (1 - aberrationIntensity * 0.05)}
        xChannelSelector="R"
        yChannelSelector="B"
        result="GREEN_DISPLACED"
      />
      <feColorMatrix
        in="GREEN_DISPLACED"
        type="matrix"
        values="0 0 0 0 0
                0 1 0 0 0
                0 0 0 0 0
                0 0 0 1 0"
        result="GREEN_CHANNEL"
      />

      {/* Blue channel displacement with slight offset */}
      <feDisplacementMap
        in="SourceGraphic"
        in2="DISPLACEMENT_MAP"
        scale={displacementScale * (1 - aberrationIntensity * 0.1)}
        xChannelSelector="R"
        yChannelSelector="B"
        result="BLUE_DISPLACED"
      />
      <feColorMatrix
        in="BLUE_DISPLACED"
        type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0
                0 0 1 0 0
                0 0 0 1 0"
        result="BLUE_CHANNEL"
      />

      {/* Combine RGB channels via screen blend mode */}
      <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
      <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />

      {/* Subtle blur to smooth the aberration */}
      <feGaussianBlur in="RGB_COMBINED" stdDeviation="0.3" result="ABERRATED_BLURRED" />

      {/* Composite with edge mask */}
      <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />

      {/* Invert mask for crystal clean center */}
      <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
        <feFuncA type="table" tableValues="1 0" />
      </feComponentTransfer>
      <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />

      {/* Blend edge aberration over clean center */}
      <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
    </filter>
  )
}

export function LiquidGlassFilterDefs() {
  const { themeStyle, liquidGlassConfig } = useTheme()

  if (themeStyle !== 'liquid-glass') {
    return null
  }

  const baseScale = liquidGlassConfig?.refractionIntensity ?? 45
  const aberration = liquidGlassConfig?.chromaticAberration ? 2.5 : 0

  return (
    <svg
      id="liquid-glass-filters-svg"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      aria-hidden="true"
    >
      <defs>
        {/* Standard Mode: Smooth Refraction (Scale 45) */}
        {createFilterNodes('liquid-glass-standard', DISPLACEMENT_MAPS.standard, baseScale, aberration)}

        {/* Polar Mode: Spherical Lens Refraction (Scale 65) */}
        {createFilterNodes('liquid-glass-polar', DISPLACEMENT_MAPS.polar, baseScale * 1.4, aberration * 1.2)}

        {/* Prominent Mode: High-Contrast Crystal Bevel Refraction (Scale 90) */}
        {createFilterNodes('liquid-glass-prominent', DISPLACEMENT_MAPS.prominent, baseScale * 1.9, aberration * 1.5)}

        {/* Shader Mode: Liquid Dynamic Wave (Scale 55) */}
        {createFilterNodes('liquid-glass-shader', DISPLACEMENT_MAPS.prominent, baseScale * 1.2, aberration)}

        {/* Subtle Card Glass */}
        {createFilterNodes('liquid-glass-subtle', DISPLACEMENT_MAPS.standard, baseScale * 0.4, 0)}
      </defs>
    </svg>
  )
}

'use client'

import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 400 // Keep low under 500 for optimal 60fps performance

interface ParticlesProps {
  analyserData?: Uint8Array
  isPlaying: boolean
}

function Particles({ analyserData, isPlaying }: ParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const [accentColor, setAccentColor] = useState('#06b6d4')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (color) setAccentColor(color)
    }
  }, [])

  const basePositions = useMemo(() => {
    const arr = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const radius = 2.2 + Math.random() * 1.2
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      arr[i * 3 + 2] = radius * Math.cos(phi)
    }
    return arr
  }, [])

  useFrame((state) => {
    if (!pointsRef.current) return
    const t = state.clock.getElapsedTime()

    // Slow ambient rotation
    pointsRef.current.rotation.y = t * 0.05

    // Audio reactive pulse / breathing
    if (isPlaying && analyserData && analyserData.length > 0) {
      let sum = 0
      for (let i = 0; i < analyserData.length; i++) {
        sum += analyserData[i]
      }
      const avg = sum / analyserData.length
      const scale = 1 + (avg / 255) * 0.15
      pointsRef.current.scale.setScalar(scale)
    } else {
      pointsRef.current.scale.setScalar(1)
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={PARTICLE_COUNT}
          array={basePositions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        color={accentColor}
        transparent
        opacity={0.7}
        sizeAttenuation
      />
    </points>
  )
}

export default function ParticleScene({ analyserData, isPlaying }: ParticlesProps) {
  return (
    <Canvas
      className="particle-canvas"
      camera={{ position: [0, 0, 5], fov: 45 }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: true }}
    >
      <Particles analyserData={analyserData} isPlaying={isPlaying} />
    </Canvas>
  )
}

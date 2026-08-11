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
  const pointsRef1 = useRef<THREE.Points>(null)
  const pointsRef2 = useRef<THREE.Points>(null)
  const [accentColor, setAccentColor] = useState('#06b6d4')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (color) setAccentColor(color)
    }
  }, [])

  // 70% background particles, 30% foreground particles
  const bgCount = Math.floor(PARTICLE_COUNT * 0.7)
  const fgCount = PARTICLE_COUNT - bgCount

  const bgPositions = useMemo(() => {
    const arr = new Float32Array(bgCount * 3)
    for (let i = 0; i < bgCount; i++) {
      const radius = 1.4 + Math.random() * 0.8
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      arr[i * 3 + 2] = radius * Math.cos(phi)
    }
    return arr
  }, [bgCount])

  const fgPositions = useMemo(() => {
    const arr = new Float32Array(fgCount * 3)
    for (let i = 0; i < fgCount; i++) {
      const radius = 1.2 + Math.random() * 0.7
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      arr[i * 3 + 2] = radius * Math.cos(phi)
    }
    return arr
  }, [fgCount])

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    let scale = 1

    if (isPlaying && analyserData && analyserData.length > 0) {
      let sum = 0
      for (let i = 0; i < analyserData.length; i++) {
        sum += analyserData[i]
      }
      const avg = sum / analyserData.length
      scale = 1 + (avg / 255) * 0.15
    }

    if (pointsRef1.current) {
      pointsRef1.current.rotation.y = t * 0.04
      pointsRef1.current.scale.setScalar(scale)
    }
    if (pointsRef2.current) {
      pointsRef2.current.rotation.y = -t * 0.06
      pointsRef2.current.scale.setScalar(scale * 1.05)
    }
  })

  return (
    <group>
      {/* 70% Faint Background Particles */}
      <points ref={pointsRef1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[bgPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.025}
          color={accentColor}
          transparent
          opacity={0.45}
          sizeAttenuation
        />
      </points>

      {/* 30% Brighter Foreground Particles */}
      <points ref={pointsRef2}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[fgPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.05}
          color={accentColor}
          transparent
          opacity={0.75}
          sizeAttenuation
        />
      </points>
    </group>
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

'use client'

import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 160 // Tinh giản mật độ ~70%, gợi bụi trong ánh đèn sân khấu

function createCircleTexture() {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

interface ParticlesProps {
  analyserData?: Uint8Array
  isPlaying: boolean
}

function Particles({ analyserData, isPlaying }: ParticlesProps) {
  const pointsRef1 = useRef<THREE.Points>(null)
  const pointsRef2 = useRef<THREE.Points>(null)
  const pointsRef3 = useRef<THREE.Points>(null)
  const targetMouseRef = useRef({ x: 0, y: 0 })
  const currentMouseRef = useRef({ x: 0, y: 0 })
  const [accentColor, setAccentColor] = useState('#C98A3D')

  const circleMap = useMemo(() => createCircleTexture(), [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (color) setAccentColor(color)

      const handlePointerMove = (e: PointerEvent) => {
        const nx = (e.clientX / window.innerWidth - 0.5) * 2
        const ny = (e.clientY / window.innerHeight - 0.5) * 2
        targetMouseRef.current = { x: nx, y: ny }
      }

      window.addEventListener('pointermove', handlePointerMove)
      return () => window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [])

  // Three restrained depth layers: far, middle, and near.
  const bgCount = Math.floor(PARTICLE_COUNT * 0.6)
  const midCount = Math.floor(PARTICLE_COUNT * 0.25)
  const fgCount = PARTICLE_COUNT - bgCount - midCount

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

  const midPositions = useMemo(() => {
    const arr = new Float32Array(midCount * 3)
    for (let i = 0; i < midCount; i++) {
      const radius = 1.3 + Math.random() * 0.75
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      arr[i * 3 + 2] = radius * Math.cos(phi)
    }
    return arr
  }, [midCount])

  useFrame((state) => {
    const dx = Math.abs(targetMouseRef.current.x - currentMouseRef.current.x)
    const dy = Math.abs(targetMouseRef.current.y - currentMouseRef.current.y)
    if (!isPlaying && dx < 0.001 && dy < 0.001) {
      return
    }

    const t = state.clock.getElapsedTime()

    currentMouseRef.current.x += (targetMouseRef.current.x - currentMouseRef.current.x) * 0.04
    currentMouseRef.current.y += (targetMouseRef.current.y - currentMouseRef.current.y) * 0.04

    const mx = currentMouseRef.current.x
    const my = currentMouseRef.current.y

    let scale = 1

    if (isPlaying && analyserData && analyserData.length > 0) {
      let sum = 0
      for (let i = 0; i < analyserData.length; i++) {
        sum += analyserData[i]
      }
      const avg = sum / analyserData.length
      scale = 1 + (avg / 255) * 0.1
    }

    if (pointsRef1.current) {
      pointsRef1.current.rotation.y = t * 0.015 + mx * 0.25
      pointsRef1.current.rotation.x = my * 0.25
      pointsRef1.current.scale.setScalar(scale)
    }
    if (pointsRef2.current) {
      pointsRef2.current.rotation.y = -t * 0.025 + mx * 0.4
      pointsRef2.current.rotation.x = my * 0.4
      pointsRef2.current.scale.setScalar(scale * 1.03)
    }
    if (pointsRef3.current) {
      pointsRef3.current.rotation.y = t * 0.04 - mx * 0.5
      pointsRef3.current.rotation.x = -my * 0.5
      pointsRef3.current.scale.setScalar(scale * 1.06)
    }
  })

  return (
    <group>
      {/* 60% Faint Background Circular Dust */}
      <points ref={pointsRef1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[bgPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.035}
          map={circleMap}
          color={accentColor}
          transparent
          opacity={0.18}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {/* 25% Middle-depth Circular Dust */}
      <points ref={pointsRef3}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[midPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.045}
          map={circleMap}
          color={accentColor}
          transparent
          opacity={0.25}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {/* 15% Foreground Circular Dust */}
      <points ref={pointsRef2}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[fgPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.06}
          map={circleMap}
          color={accentColor}
          transparent
          opacity={0.32}
          depthWrite={false}
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
      dpr={1}
      gl={{ antialias: false, alpha: true }}
    >
      <Particles analyserData={analyserData} isPlaying={isPlaying} />
    </Canvas>
  )
}

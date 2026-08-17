'use client'

import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Số lượng hạt của 3 tầng (Tổng: 8,120 hạt)
const BG_COUNT = 4480   // Tầng xa: vệt sao băng trắng tinh khôi
const MID_COUNT = 2520  // Tầng giữa: sao lấp lánh trắng sáng tự nhiên
const FG_COUNT = 1120   // Tầng gần: sao lấp lánh lớn, sáng rực rỡ, ĐỒNG BỘ MÀU THEME

/** Texture sao lấp lánh: đa giác 4 cánh sắc cạnh (không chỉ dựa gradient mềm) + lõi sáng rực */
function createSparkleTexture() {
  if (typeof document === 'undefined') return undefined
  const size = 192
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  const c = size / 2
  const outerR = size * 0.46
  const innerR = size * 0.055

  // Đa giác 4 cánh (8 đỉnh xen kẽ ngoài/trong) -> viền sắc nét thật sự, không phụ thuộc gradient
  ctx.save()
  ctx.translate(c, c)
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i
    const r = i % 2 === 0 ? outerR : innerR
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  const starGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR)
  starGrad.addColorStop(0, 'rgba(255,255,255,1)')
  starGrad.addColorStop(0.45, 'rgba(255,255,255,0.9)')
  starGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = starGrad
  ctx.fill()
  ctx.restore()

  // Quầng sáng rất nhẹ bao quanh, chỉ để mềm bối cảnh, không lấn át hình sao
  const halo = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5)
  halo.addColorStop(0, 'rgba(255,255,255,0.18)')
  halo.addColorStop(0.5, 'rgba(255,255,255,0.06)')
  halo.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'source-over'

  // Lõi sáng sắc nét ở tâm
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.075)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(c, c, size * 0.075, 0, Math.PI * 2)
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

/** Texture vệt sao băng: thân thon gọn sắc nét, đầu là điểm sáng rực nhỏ gọn */
function createCometTexture() {
  if (typeof document === 'undefined') return undefined
  const w = 220
  const h = 56
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  const cy = h / 2

  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.quadraticCurveTo(w * 0.55, cy - 5, w * 0.9, cy - 3)
  ctx.quadraticCurveTo(w * 0.98, cy, w * 0.9, cy + 3)
  ctx.quadraticCurveTo(w * 0.55, cy + 5, 0, cy)
  ctx.closePath()
  const tailGrad = ctx.createLinearGradient(0, cy, w * 0.9, cy)
  tailGrad.addColorStop(0, 'rgba(255,255,255,0)')
  tailGrad.addColorStop(0.6, 'rgba(255,255,255,0.35)')
  tailGrad.addColorStop(0.88, 'rgba(255,255,255,0.85)')
  tailGrad.addColorStop(1, 'rgba(255,255,255,1)')
  ctx.fillStyle = tailGrad
  ctx.fill()

  const headGlow = ctx.createRadialGradient(w * 0.9, cy, 0, w * 0.9, cy, 12)
  headGlow.addColorStop(0, 'rgba(255,255,255,1)')
  headGlow.addColorStop(0.5, 'rgba(255,255,255,0.6)')
  headGlow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = headGlow
  ctx.beginPath()
  ctx.arc(w * 0.9, cy, 12, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,1)'
  ctx.beginPath()
  ctx.arc(w * 0.9, cy, 3.5, 0, Math.PI * 2)
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  texture.center.set(0.5, 0.5)
  texture.rotation = -0.42
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

const twinkleVertexShader = `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uScale;
  varying float vTwinkle;
  void main() {
    vTwinkle = 0.65 + 0.35 * sin(uTime * 1.2 + aPhase);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const twinkleFragmentShader = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vTwinkle;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tex.a * uOpacity * vTwinkle);
  }
`

function makeTwinkleGeometry(count: number, spreadX: number, spreadY: number, zMin: number, zRange: number, baseSize: number) {
  const positions = new Float32Array(count * 3)
  const phases = new Float32Array(count)
  const sizes = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spreadX
    positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY
    positions[i * 3 + 2] = zMin + Math.random() * zRange
    phases[i] = Math.random() * Math.PI * 2
    sizes[i] = baseSize * (0.7 + Math.random() * 0.6)
  }
  return { positions, phases, sizes }
}

interface ParticlesProps {
  analyserData?: Uint8Array
  isPlaying: boolean
  accentColor?: string
  glowColor?: string
}

function Particles({ analyserData, isPlaying, accentColor: propAccent, glowColor: propGlow }: ParticlesProps) {
  const bgPointsRef = useRef<THREE.Points>(null)
  const midPointsRef = useRef<THREE.Points>(null)
  const fgPointsRef = useRef<THREE.Points>(null)
  const midMatRef = useRef<THREE.ShaderMaterial>(null)
  const fgMatRef = useRef<THREE.ShaderMaterial>(null)
  const targetMouseRef = useRef({ x: 0, y: 0 })
  const currentMouseRef = useRef({ x: 0, y: 0 })

  // Màu theme người dùng chọn (chỉ áp dụng cho tầng Foreground)
  const [themeColorHex, setThemeColorHex] = useState(propGlow || propAccent || '#22d3ee')
  const sparkleMap = useMemo(() => createSparkleTexture(), [])
  const cometMap = useMemo(() => createCometTexture(), [])

  const whiteColor = useMemo(() => new THREE.Color('#ffffff'), [])
  const fgColor = useMemo(() => {
    try {
      let c = (themeColorHex || '#22d3ee').trim()
      if (/^#[0-9a-fA-F]{8}$/.test(c)) {
        c = c.slice(0, 7)
      }
      return new THREE.Color(c)
    } catch {
      return new THREE.Color('#22d3ee')
    }
  }, [themeColorHex])

  useEffect(() => {
    if (propGlow || propAccent) {
      setThemeColorHex(propGlow || propAccent!)
    }
  }, [propAccent, propGlow])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const updateThemeColors = () => {
        const rootStyle = getComputedStyle(document.documentElement)
        const themeGlow = rootStyle.getPropertyValue('--spotify-glow').trim()
        const themeAccent = rootStyle.getPropertyValue('--primary-spotify').trim() || rootStyle.getPropertyValue('--accent').trim()
        const activeColor = themeGlow || themeAccent || propGlow || propAccent || '#22d3ee'
        setThemeColorHex(activeColor)
      }

      updateThemeColors()

      const handlePointerMove = (e: PointerEvent) => {
        const nx = (e.clientX / window.innerWidth - 0.5) * 2
        const ny = (e.clientY / window.innerHeight - 0.5) * 2
        targetMouseRef.current = { x: nx, y: -ny }
      }
      const handlePointerLeave = () => {
        targetMouseRef.current = { x: 0, y: 0 }
      }
      window.addEventListener('pointermove', handlePointerMove, { passive: true })
      window.addEventListener('mouseleave', handlePointerLeave)
      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('mouseleave', handlePointerLeave)
      }
    }
  }, [propAccent, propGlow])

  // Tầng nền: vệt sao băng, trải rộng toàn màn hình
  const bg = useMemo(() => makeTwinkleGeometry(BG_COUNT, 26, 18, -5.0, 3.0, 0.09), [])
  // Tầng giữa: sao lấp lánh cỡ vừa
  const mid = useMemo(() => makeTwinkleGeometry(MID_COUNT, 22, 15, -2.0, 2.5, 0.095), [])
  // Tầng cận cảnh: sao lấp lánh lớn, sáng nhất
  const fg = useMemo(() => makeTwinkleGeometry(FG_COUNT, 18, 12, 0.5, 2.0, 0.12), [])

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const scale = state.size.height * 0.5

    // Smooth inertia mouse tracking
    currentMouseRef.current.x += (targetMouseRef.current.x - currentMouseRef.current.x) * 0.035
    currentMouseRef.current.y += (targetMouseRef.current.y - currentMouseRef.current.y) * 0.035
    const mx = currentMouseRef.current.x
    const my = currentMouseRef.current.y

    // 1. Tầng Nền: Trôi êm, hoàn toàn tĩnh khi chuột đứng yên
    if (bgPointsRef.current) {
      bgPointsRef.current.position.x = mx * 0.4
      bgPointsRef.current.position.y = my * 0.3
      bgPointsRef.current.rotation.y = t * 0.005 + mx * 0.08
      bgPointsRef.current.rotation.x = -my * 0.06
    }
    // 2. Tầng Giữa: Trôi êm ả, không rung lắc
    if (midPointsRef.current) {
      midPointsRef.current.position.x = mx * 0.85
      midPointsRef.current.position.y = my * 0.65
      midPointsRef.current.rotation.y = -t * 0.008 + mx * 0.16
      midPointsRef.current.rotation.x = -my * 0.12
    }
    // 3. Tầng Cận Cảnh: Mượt mà tuyệt đối
    if (fgPointsRef.current) {
      fgPointsRef.current.position.x = mx * 1.35
      fgPointsRef.current.position.y = my * 1.05
      fgPointsRef.current.rotation.y = t * 0.01 + mx * 0.24
      fgPointsRef.current.rotation.x = -my * 0.18
    }

    if (midMatRef.current) {
      midMatRef.current.uniforms.uTime.value = t * 0.8
      midMatRef.current.uniforms.uScale.value = scale
    }
    if (fgMatRef.current) {
      fgMatRef.current.uniforms.uTime.value = t
      fgMatRef.current.uniforms.uScale.value = scale
      fgMatRef.current.uniforms.uColor.value = fgColor
    }
  })

  return (
    <group>
      {/* 1. Tầng Nền: vệt sao băng trắng tinh khôi, trôi êm */}
      <points ref={bgPointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[bg.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.09}
          map={cometMap}
          color="#ffffff"
          transparent
          opacity={0.4}
          depthWrite={false}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 2. Tầng Giữa: sao lấp lánh trắng sáng tự nhiên, mỗi hạt nhấp nháy độc lập */}
      <points ref={midPointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[mid.positions, 3]} />
          <bufferAttribute attach="attributes-aPhase" args={[mid.phases, 1]} />
          <bufferAttribute attach="attributes-aSize" args={[mid.sizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={midMatRef}
          vertexShader={twinkleVertexShader}
          fragmentShader={twinkleFragmentShader}
          uniforms={{
            uTime: { value: 0 },
            uScale: { value: 400 },
            uMap: { value: sparkleMap },
            uColor: { value: whiteColor },
            uOpacity: { value: 0.8 },
          }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 3. Tầng Cận Cảnh: ĐỒNG BỘ MÀU THEME CỦA USER, sáng rực rỡ nhất */}
      <points ref={fgPointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[fg.positions, 3]} />
          <bufferAttribute attach="attributes-aPhase" args={[fg.phases, 1]} />
          <bufferAttribute attach="attributes-aSize" args={[fg.sizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={fgMatRef}
          vertexShader={twinkleVertexShader}
          fragmentShader={twinkleFragmentShader}
          uniforms={{
            uTime: { value: 0 },
            uScale: { value: 400 },
            uMap: { value: sparkleMap },
            uColor: { value: fgColor },
            uOpacity: { value: 0.95 },
          }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

export default function ParticleScene({ analyserData, isPlaying, accentColor, glowColor }: ParticlesProps) {
  const [isHidden, setIsHidden] = useState(false)

  useEffect(() => {
    const handleVisibility = () => {
      setIsHidden(typeof document !== 'undefined' && document.hidden)
    }
    if (typeof document !== 'undefined') {
      setIsHidden(document.hidden)
      document.addEventListener('visibilitychange', handleVisibility)
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
    }
  }, [])

  // When tab is hidden / gaming, stop rendering WebGL canvas completely to drop GPU to 0%
  if (isHidden) {
    return null
  }

  return (
    <Canvas
      className="particle-canvas w-full h-full"
      camera={{ position: [0, 0, 5], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <Particles
        analyserData={analyserData}
        isPlaying={isPlaying}
        accentColor={accentColor}
        glowColor={glowColor}
      />
    </Canvas>
  )
}


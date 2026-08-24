"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  generateSceneData,
  type FlowerParticle,
  type LeafParticle,
  type TerrainTile,
  type TreeSegment,
} from "./treeGenerator";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { clamp, lerp } from "./hashNoise";

const TMP = new THREE.Object3D();
const COLOR = new THREE.Color();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const QUAT = new THREE.Quaternion();
const TARGET = new THREE.Vector3();

function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function phase(t: number, start: number, end: number): number {
  return ease(clamp((t - start) / Math.max(0.0001, end - start), 0, 1));
}

function mixColor(a: string, b: string, t: number): string {
  const aa = new THREE.Color(a);
  const bb = new THREE.Color(b);
  return `#${aa.lerp(bb, clamp(t, 0, 1)).getHexString()}`;
}

function TerrainMesh({ tiles, cellSize, theme, progressRef }: {
  tiles: TerrainTile[];
  cellSize: number;
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!ref.current) return;
    tiles.forEach((tile, i) => {
      COLOR.set(tile.qrColor);
      ref.current!.setColorAt(i, COLOR);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [tiles]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;

    tiles.forEach((tile, i) => {
      const stonePhase = phase(p, 0.18, 0.82);
      const darkHeight = tile.isDark ? 0.055 : 0.035;
      const treeGroundHeight = tile.isDark ? 0.12 : 0.08;
      const height = lerp(darkHeight, treeGroundHeight, stonePhase);
      const width = cellSize * lerp(1.005, 0.94, stonePhase);

      TMP.position.set(tile.x, height * 0.5 - 0.01, tile.z);
      TMP.rotation.set(0, 0, 0);
      TMP.scale.set(width, height, width);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);

      const qrToGround = phase(p, 0.28, 0.8);
      const target = mixColor(tile.qrColor, tile.stoneColor, qrToGround);
      COLOR.set(target);
      mesh.setColorAt(i, COLOR);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, tiles.length]} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.88} metalness={0} />
    </instancedMesh>
  );
}

function Platform({ size, theme, progressRef }: {
  size: number;
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const p = progressRef.current;
    if (ref.current) {
      const m = ref.current.material as THREE.MeshStandardMaterial;
      m.color.set(mixColor("#f7f4ed", theme.stoneTileColors[0], phase(p, 0.22, 0.78)));
    }
    if (rimRef.current) rimRef.current.visible = p > 0.2;
  });

  return (
    <group position={[0, -0.05, 0]}>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={[size + 1, 0.08, size + 1]} />
        <meshStandardMaterial color="#f7f4ed" roughness={0.98} />
      </mesh>
      <mesh ref={rimRef} position={[0, -0.045, 0]} receiveShadow>
        <boxGeometry args={[size + 1.45, 0.06, size + 1.45]} />
        <meshStandardMaterial color="#b8ad9c" roughness={0.92} />
      </mesh>
    </group>
  );
}

function BranchMesh({ segments, theme, progressRef }: {
  segments: TreeSegment[];
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!ref.current) return;
    COLOR.set(theme.trunkColor);
    for (let i = 0; i < segments.length; i++) ref.current.setColorAt(i, COLOR);
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [segments, theme]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    const grow = phase(p, 0.22, 0.82);
    const settle = 0.55 + 0.45 * grow;

    segments.forEach((seg, i) => {
      A.set(seg.start.x * grow, seg.start.y * grow, seg.start.z * grow);
      B.set(seg.end.x * grow, seg.end.y * grow, seg.end.z * grow);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const dir = B.clone().sub(A);
      const len = dir.length();
      if (len < 0.001) {
        TMP.scale.set(0, 0, 0);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
        return;
      }
      dir.normalize();
      QUAT.setFromUnitVectors(UP, dir);
      const radius = ((seg.radiusStart + seg.radiusEnd) * 0.5) * settle;

      TMP.position.copy(mid);
      TMP.quaternion.copy(QUAT);
      TMP.scale.set(radius, len, radius);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
      <cylinderGeometry args={[0.72, 1, 1, 8]} />
      <meshStandardMaterial color={theme.trunkColor} roughness={0.84} metalness={0.02} />
    </instancedMesh>
  );
}

function LeavesMesh({ leaves, progressRef }: { leaves: LeafParticle[]; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!ref.current) return;
    leaves.forEach((leaf, i) => {
      COLOR.set(leaf.colorHex);
      ref.current!.setColorAt(i, COLOR);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [leaves]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const grow = phase(progressRef.current, 0.38, 0.92);
    const time = state.clock.elapsedTime;

    leaves.forEach((leaf, i) => {
      const flutter = Math.sin(time * 1.7 + leaf.x * 2.1 + leaf.z * 1.7) * 0.035;
      const s = leaf.scale * grow * (1 + flutter);
      TMP.position.set(leaf.x * grow, leaf.y * grow, leaf.z * grow);
      TMP.rotation.set(leaf.rotX + flutter, leaf.rotY + time * 0.008, leaf.rotZ + flutter);
      TMP.scale.setScalar(s);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, leaves.length]} castShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.66} flatShading />
    </instancedMesh>
  );
}

function FlowersMesh({ flowers, progressRef }: { flowers: FlowerParticle[]; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    flowers.forEach((flower, i) => {
      COLOR.set(flower.colorHex);
      ref.current!.setColorAt(i, COLOR);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [flowers]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const grow = phase(progressRef.current, 0.58, 0.96);
    flowers.forEach((flower, i) => {
      TMP.position.set(flower.x * grow, flower.y * grow, flower.z * grow);
      TMP.scale.setScalar(flower.scale * grow);
      TMP.rotation.set(Math.PI * 0.5, 0, flower.scale * 4);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, flowers.length]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.35} />
    </instancedMesh>
  );
}

function TreeParticles({ theme, progressRef }: { theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 110;
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 3.2 + (i % 11) * 0.12;
      values[i * 3] = Math.cos(a) * r;
      values[i * 3 + 1] = 1.7 + (i % 9) * 0.22;
      values[i * 3 + 2] = Math.sin(a) * r;
    }
    return values;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    const grow = phase(progressRef.current, 0.65, 1);
    ref.current.visible = grow > 0.01;
    ref.current.rotation.y = state.clock.elapsedTime * 0.05;
    const mat = ref.current.material as THREE.PointsMaterial;
    mat.opacity = grow * 0.55;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={theme.particleColor} size={0.07} transparent depthWrite={false} opacity={0} />
    </points>
  );
}

function CameraRig({ progressRef, gridSize, cellSize, userAngleRef }: {
  progressRef: React.MutableRefObject<number>;
  gridSize: number;
  cellSize: number;
  userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const { camera, size } = useThree();
  const dimension = gridSize * cellSize;

  useFrame((state) => {
    const p = ease(progressRef.current);
    const aspect = size.width / Math.max(1, size.height);
    const fov = (38 * Math.PI) / 180;
    const flatDistance = Math.max(18, (dimension * 0.74) / Math.tan(fov / 2) / Math.max(0.55, aspect));
    const user = userAngleRef.current;
    const azimuth = Math.PI * 0.25 + state.clock.elapsedTime * 0.035 + user.azimuth;
    const elevation = clamp(0.58 + user.elevation, 0.35, 1.0);
    const distance = dimension * 1.55;

    const treePos = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * Math.cos(elevation) * distance,
    );

    camera.position.set(
      lerp(0, treePos.x, p),
      lerp(flatDistance, treePos.y, p),
      lerp(0.001, treePos.z, p),
    );
    TARGET.set(0, lerp(0, 2.5, p), 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(TARGET);
  });

  return null;
}

function Lights({ theme, progressRef }: { theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const key = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    if (!key.current) return;
    const p = progressRef.current;
    key.current.position.set(lerp(0, 12, p), 22, lerp(0, 14, p));
    key.current.intensity = lerp(1.15, 1.55, p);
  });
  return (
    <>
      <ambientLight color={theme.ambientColor} intensity={1.35} />
      <directionalLight ref={key} color={theme.sunColor} position={[0, 22, 0]} intensity={1.2} castShadow shadow-mapSize-width={1536} shadow-mapSize-height={1536} />
      <hemisphereLight color="#fffaf0" groundColor="#b7a993" intensity={0.42} />
    </>
  );
}

function SceneContent({ matrix, url, season, isFlat, userAngleRef }: {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const theme = SEASON_THEMES[season];
  const data = useMemo(() => generateSceneData(matrix, url, season), [matrix, url, season]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const speed = target > progressRef.current ? 2.35 : 2.8;
    progressRef.current += (target - progressRef.current) * Math.min(1, delta * speed);
    if (Math.abs(target - progressRef.current) < 0.0015) progressRef.current = target;
  });

  return (
    <>
      <Lights theme={theme} progressRef={progressRef} />
      <CameraRig progressRef={progressRef} gridSize={data.gridSize} cellSize={data.cellSize} userAngleRef={userAngleRef} />
      <Platform size={data.platformSize} theme={theme} progressRef={progressRef} />
      <TerrainMesh tiles={data.tiles} cellSize={data.cellSize} theme={theme} progressRef={progressRef} />
      <BranchMesh segments={data.tree.segments} theme={theme} progressRef={progressRef} />
      <LeavesMesh leaves={data.tree.leaves} progressRef={progressRef} />
      <FlowersMesh flowers={data.tree.flowers} progressRef={progressRef} />
      <TreeParticles theme={theme} progressRef={progressRef} />
    </>
  );
}

export interface QRTreeSceneProps {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  onToggleFlat: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function QRTreeScene({ matrix, url, season, isFlat, onToggleFlat, className, style }: QRTreeSceneProps) {
  const theme = SEASON_THEMES[season];
  const userAngleRef = useRef({ azimuth: 0, elevation: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%", touchAction: "none", cursor: "grab", ...style }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          drag.moved = true;
          userAngleRef.current.azimuth += dx * 0.004;
          userAngleRef.current.elevation = clamp(userAngleRef.current.elevation - dy * 0.004, -0.22, 0.35);
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        if (drag && !drag.moved) onToggleFlat();
        dragRef.current = null;
      }}
      onPointerLeave={() => { dragRef.current = null; }}
    >
      <Canvas
        camera={{ fov: 38, near: 0.1, far: 220, position: [0, 20, 0.001] }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        shadows
        style={{ background: theme.bgColor }}
      >
        <color attach="background" args={[theme.bgColor]} />
        <fog attach="fog" args={[theme.bgColor, 34, 90]} />
        <SceneContent matrix={matrix} url={url} season={season} isFlat={isFlat} userAngleRef={userAngleRef} />
      </Canvas>
    </div>
  );
}

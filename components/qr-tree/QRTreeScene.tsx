"use client";

import React, { MutableRefObject, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { clamp, lerp } from "./hashNoise";
import {
  generateSceneData,
  type TreeSegment,
  type LeafParticle,
  type FlowerParticle,
  type CanopyBlob,
  type TerrainTile,
} from "./treeGenerator";

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const DIR = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Q = new THREE.Quaternion();
const TARGET = new THREE.Vector3();

function smooth(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function phase(t: number, start: number, end: number) {
  return smooth((t - start) / Math.max(0.0001, end - start));
}

function mixHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, clamp(t, 0, 1)).getHexString()}`;
}

// ---------------------------------------------------------------------------
// 1. Ground Base Platform (Courtyard Foundation)
// ---------------------------------------------------------------------------
function Ground({
  size,
  theme,
  progressRef,
}: {
  size: number;
  theme: SeasonTheme;
  progressRef: MutableRefObject<number>;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const p = phase(progressRef.current, 0.1, 0.7);
    if (ref.current) {
      (ref.current.material as THREE.MeshStandardMaterial).color.set(
        mixHex("#f4ede1", theme.stoneTileColors[1] || "#e4ddcc", p)
      );
    }
  });

  return (
    <group position={[0, -0.06, 0]}>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={[size + 0.6, 0.1, size + 0.6]} />
        <meshStandardMaterial color="#f4ede1" roughness={0.92} />
      </mesh>
      <mesh ref={rim} position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[size + 0.85, 0.08, size + 0.85]} />
        <meshStandardMaterial color="#c2b6a2" roughness={0.88} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 2. QR Matrix Tiles / 100% Convergent Checkered Courtyard Grid
// ---------------------------------------------------------------------------
function QRTiles({
  tiles,
  theme,
  progressRef,
  cellSize,
}: {
  tiles: TerrainTile[];
  theme: SeasonTheme;
  progressRef: MutableRefObject<number>;
  cellSize: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    const qrMorph = phase(p, 0.1, 0.7);

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      // Converge smoothly to uniform floor height in Tree mode
      const h = lerp(tile.isDark ? 0.07 : 0.02, 0.028, qrMorph);
      const s = cellSize * 0.92;

      DUMMY.position.set(tile.x, h * 0.5 - 0.005, tile.z);
      DUMMY.scale.set(s, h, s);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);

      // 100% color convergence to clean garden paving tiles
      COLOR.set(tile.qrColor);
      const targetColor = tile.isDark
        ? tile.stoneColor
        : theme.stoneTileColors[0] || "#ede7d8";
      COLOR.lerp(new THREE.Color(targetColor), qrMorph);

      // Organic subtle stone variation to give natural texture
      const tint = 1 + (tile.variation - 0.5) * 0.06 * qrMorph;
      COLOR.multiplyScalar(tint);

      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, tiles.length]} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.88} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 3. Tree Branches & Twigs
// ---------------------------------------------------------------------------
function Branches({
  segments,
  theme,
  progressRef,
}: {
  segments: TreeSegment[];
  theme: SeasonTheme;
  progressRef: MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const p = progressRef.current;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      let growth = 0;
      if (seg.depth === 0) {
        growth = phase(p, 0.05, 0.45);
      } else if (seg.depth === 1) {
        growth = phase(p, 0.18, 0.68);
      } else {
        growth = phase(p, 0.35, 0.85);
      }

      if (growth < 0.001) {
        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
        continue;
      }

      A.set(seg.start.x, seg.start.y * growth, seg.start.z);
      B.set(
        seg.start.x + (seg.end.x - seg.start.x) * growth,
        seg.start.y + (seg.end.y - seg.start.y) * growth,
        seg.start.z + (seg.end.z - seg.start.z) * growth
      );

      DIR.copy(B).sub(A);
      const len = DIR.length();
      if (len < 0.001) {
        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
        continue;
      }

      DIR.normalize();
      Q.setFromUnitVectors(UP, DIR);

      DUMMY.position.copy(A).add(B).multiplyScalar(0.5);
      DUMMY.quaternion.copy(Q);
      const avgRadius = ((seg.radiusStart + seg.radiusEnd) / 2) * (0.35 + 0.65 * growth);
      DUMMY.scale.set(avgRadius, len, avgRadius);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
      <cylinderGeometry args={[0.82, 1.18, 1, 8]} />
      <meshStandardMaterial color={theme.trunkColor} roughness={0.82} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 4. Canopy Silhouette Base Blobs (Solid, lush silhouette crown volume)
// ---------------------------------------------------------------------------
function CanopyBlobs({
  blobs,
  progressRef,
}: {
  blobs: CanopyBlob[];
  progressRef: MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || blobs.length === 0) return;

    const p = progressRef.current;
    const tree = phase(p, 0.18, 0.85);
    const time = state.clock.elapsedTime;

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const sway = Math.sin(time * 0.85 + i * 0.4) * 0.015 * tree;

      const currX = lerp(b.qrX, b.x, tree);
      const currY = lerp(0.04, b.y, tree);
      const currZ = lerp(b.qrZ, b.z, tree);

      DUMMY.position.set(currX, currY, currZ);
      DUMMY.rotation.set(0, time * 0.04 + i, 0);
      const scale = b.radius * tree * (0.96 + sway);
      DUMMY.scale.set(scale, scale * 0.88, scale);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
      COLOR.set(b.colorHex);
      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (blobs.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, blobs.length]} castShadow receiveShadow>
      <sphereGeometry args={[1, 14, 12]} />
      <meshStandardMaterial roughness={0.85} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 5. Fibonacci Surface Leaves (Dense, smooth leaf layer)
// ---------------------------------------------------------------------------
function Leaves({
  leaves,
  progressRef,
}: {
  leaves: LeafParticle[];
  progressRef: MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;

    const p = progressRef.current;
    const tree = phase(p, 0.15, 0.92);
    const time = state.clock.elapsedTime;

    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i];
      const swayX = Math.sin(time * 1.2 + i * 0.15) * 0.02 * tree;
      const swayY = Math.cos(time * 1.05 + i * 0.12) * 0.015 * tree;

      const currX = lerp(l.qrX, l.x, tree) + swayX;
      const currY = lerp(0.04, l.y, tree) + swayY;
      const currZ = lerp(l.qrZ, l.z, tree);

      DUMMY.position.set(currX, currY, currZ);
      DUMMY.rotation.set(l.rotX, l.rotY + time * 0.15 * tree, l.rotZ);

      const s = l.scale * (0.2 + 0.8 * tree);
      DUMMY.scale.set(s, s * 0.65, s);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
      COLOR.set(l.colorHex);
      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, leaves.length]} castShadow receiveShadow>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial roughness={0.65} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 6. Flower Blossoms
// ---------------------------------------------------------------------------
function Flowers({
  flowers,
  progressRef,
}: {
  flowers: FlowerParticle[];
  progressRef: MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || flowers.length === 0) return;

    const p = progressRef.current;
    const tree = phase(p, 0.3, 0.95);
    const time = state.clock.elapsedTime;

    for (let i = 0; i < flowers.length; i++) {
      const f = flowers[i];
      const currX = lerp(f.qrX, f.x, tree);
      const currY = lerp(0.04, f.y, tree) + Math.sin(time + i) * 0.01 * tree;
      const currZ = lerp(f.qrZ, f.z, tree);

      DUMMY.position.set(currX, currY, currZ);
      DUMMY.rotation.set(0, time * 0.3 + i, 0);
      const s = f.scale * tree;
      DUMMY.scale.setScalar(s);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
      COLOR.set(f.colorHex);
      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (flowers.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, flowers.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.48} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 7. Atmosphere Falling Particles (Anchored tightly to Canopy)
// ---------------------------------------------------------------------------
function AtmosphereParticles({
  theme,
  progressRef,
  canopyCenter,
  spread,
}: {
  theme: SeasonTheme;
  progressRef: MutableRefObject<number>;
  canopyCenter: { x: number; y: number; z: number };
  spread: number;
}) {
  const count = 26;
  const ref = useRef<THREE.InstancedMesh>(null);
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: canopyCenter.x + (Math.random() - 0.5) * spread,
      y: canopyCenter.y + Math.random() * 1.3,
      z: canopyCenter.z + (Math.random() - 0.5) * spread,
      speed: 0.5 + Math.random() * 0.6,
      rotSpeed: (Math.random() - 0.5) * 2,
      scale: theme.rainMode ? 0.03 : 0.055 + Math.random() * 0.035,
    }));
  }, [theme.rainMode, canopyCenter.x, canopyCenter.y, canopyCenter.z, spread]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.4, 0.95);
    if (tree < 0.01) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const time = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      p.y -= p.speed * 0.014 * (theme.rainMode ? 2.4 : 1.0);
      if (p.y < 0.05) {
        p.y = canopyCenter.y + 1.0 + Math.random() * 0.5;
        p.x = canopyCenter.x + (Math.random() - 0.5) * spread;
        p.z = canopyCenter.z + (Math.random() - 0.5) * spread;
      }
      const driftX = p.x + Math.sin(time * 0.6 + i) * 0.15;
      const driftZ = p.z + Math.cos(time * 0.55 + i) * 0.15;

      DUMMY.position.set(driftX, p.y, driftZ);
      if (theme.rainMode) {
        DUMMY.scale.set(0.01 * tree, 0.14 * tree, 0.01 * tree);
        DUMMY.rotation.set(0.1, 0, 0);
      } else {
        DUMMY.scale.setScalar(p.scale * tree);
        DUMMY.rotation.set(time * p.rotSpeed + i, time * p.rotSpeed * 0.5, i);
      }
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      {theme.rainMode ? (
        <cylinderGeometry args={[1, 1, 1, 4]} />
      ) : (
        <sphereGeometry args={[1, 6, 4]} />
      )}
      <meshStandardMaterial
        color={theme.particleColor}
        roughness={0.7}
        transparent
        opacity={0.85}
      />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 8. Camera Rig (Isometric Perspective & Clean Zoom/Orbit)
// ---------------------------------------------------------------------------
function CameraRig({
  progressRef,
  platformSize,
  canopyCenter,
  userAngleRef,
}: {
  progressRef: MutableRefObject<number>;
  platformSize: number;
  canopyCenter: { x: number; y: number; z: number };
  userAngleRef: MutableRefObject<{ azimuth: number; elevation: number; zoom: number }>;
}) {
  const { camera, size } = useThree();

  useFrame(() => {
    const p = smooth(progressRef.current);
    const aspect = size.width / Math.max(1, size.height);
    const fov = (35 * Math.PI) / 180;

    // Top-down distance so QR code fits comfortably inside screen with padding
    const qrDistance = Math.max(18, (platformSize * 0.85) / Math.tan(fov / 2) / Math.max(0.6, aspect) * 1.45);

    // 3D Tree distance so entire tree crown and ground platform are framed
    const baseTreeDist = Math.max(17, (platformSize * 0.85) / Math.tan(fov / 2) / Math.max(0.6, aspect) * 1.35);
    const treeDistance = baseTreeDist * userAngleRef.current.zoom;

    const user = userAngleRef.current;
    const azimuth = Math.PI * 0.25 + user.azimuth;
    const elevation = clamp(0.58 + user.elevation, 0.22, 1.15);

    const tx = Math.sin(azimuth) * Math.cos(elevation) * treeDistance;
    const ty = Math.sin(elevation) * treeDistance;
    const tz = Math.cos(azimuth) * Math.cos(elevation) * treeDistance;

    camera.position.set(lerp(0, tx, p), lerp(qrDistance, ty, p), lerp(0.001, tz, p));
    TARGET.set(0, lerp(0, canopyCenter.y * 0.65, p), 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(TARGET);
  });

  return null;
}

// ---------------------------------------------------------------------------
// 9. Lighting
// ---------------------------------------------------------------------------
function Lighting({
  theme,
  progressRef,
}: {
  theme: SeasonTheme;
  progressRef: MutableRefObject<number>;
}) {
  const light = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    if (!light.current) return;
    const p = progressRef.current;
    light.current.position.set(lerp(0, 8, p), 16, lerp(0, 10, p));
    light.current.intensity = lerp(1.1, 1.45, p);
  });

  return (
    <>
      <ambientLight color={theme.ambientColor} intensity={1.25} />
      <directionalLight
        ref={light}
        color={theme.sunColor}
        position={[0, 16, 0]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <hemisphereLight color="#fffaf0" groundColor="#b7aa94" intensity={0.32} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 10. Main 3D Scene Controller
// ---------------------------------------------------------------------------
function Scene({
  matrix,
  url,
  season,
  isFlat,
  userAngleRef,
}: {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  userAngleRef: MutableRefObject<{ azimuth: number; elevation: number; zoom: number }>;
}) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const theme = SEASON_THEMES[season];

  const sceneData = useMemo(() => generateSceneData(matrix, url, season), [matrix, url, season]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const speed = target > progressRef.current ? 1.5 : 1.9;
    progressRef.current += (target - progressRef.current) * Math.min(1, delta * speed);
    if (Math.abs(target - progressRef.current) < 0.001) progressRef.current = target;
  });

  return (
    <>
      <Lighting theme={theme} progressRef={progressRef} />
      <CameraRig
        progressRef={progressRef}
        platformSize={sceneData.platformSize}
        canopyCenter={sceneData.tree.canopyCenter}
        userAngleRef={userAngleRef}
      />
      <Ground size={sceneData.platformSize} theme={theme} progressRef={progressRef} />
      <QRTiles
        tiles={sceneData.tiles}
        theme={theme}
        progressRef={progressRef}
        cellSize={sceneData.cellSize}
      />
      <Branches segments={sceneData.tree.segments} theme={theme} progressRef={progressRef} />
      <CanopyBlobs blobs={sceneData.tree.canopyBlobs} progressRef={progressRef} />
      <Leaves leaves={sceneData.tree.leaves} progressRef={progressRef} />
      <Flowers flowers={sceneData.tree.flowers} progressRef={progressRef} />
      <AtmosphereParticles
        theme={theme}
        progressRef={progressRef}
        canopyCenter={sceneData.tree.canopyCenter}
        spread={sceneData.tree.canopyRadius * 1.6}
      />
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

export default function QRTreeScene({
  matrix,
  url,
  season,
  isFlat,
  onToggleFlat,
  className,
  style,
}: QRTreeSceneProps) {
  const theme = SEASON_THEMES[season];
  const userAngleRef = useRef({ azimuth: 0, elevation: 0, zoom: 1.0 });
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      d.moved = true;
      userAngleRef.current.azimuth += dx * 0.0035;
      userAngleRef.current.elevation = clamp(
        userAngleRef.current.elevation - dy * 0.003,
        -0.25,
        0.35
      );
      d.startX = e.clientX;
      d.startY = e.clientY;
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (d && !d.moved) onToggleFlat();
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    userAngleRef.current.zoom = clamp(
      userAngleRef.current.zoom + e.deltaY * 0.001,
      0.65,
      1.75
    );
  };

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: "100%",
        cursor: "grab",
        touchAction: "none",
        ...style,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
    >
      <Canvas
        camera={{ fov: 35, near: 0.1, far: 200, position: [0, 22, 0.001] }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        shadows
        style={{ background: theme.bgColor }}
      >
        <color attach="background" args={[theme.bgColor]} />
        <fog attach="fog" args={[theme.bgColor, 45, 110]} />
        <Scene
          matrix={matrix}
          url={url}
          season={season}
          isFlat={isFlat}
          userAngleRef={userAngleRef}
        />
      </Canvas>
    </div>
  );
}

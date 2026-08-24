"use client";
// ---------------------------------------------------------------------------
// QRTreeScene.tsx — Three.js (R3F) 3D Scene matching tree.icqr.com
//
// • Flat Mode: 100% clean, square, seamless green pixel-art QR code.
// • 3D Mode: Beautiful organic bonsai tree with 650 fine, lush leaf clusters,
//   natural multi-branch wooden trunk, stone paver plaza, and stylized grass tufts.
// ---------------------------------------------------------------------------

import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  generateSceneData,
  type TerrainTile,
  type TreeSegment,
  type LeafParticle,
} from "./treeGenerator";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { lerp } from "./hashNoise";

// Shared calculation objects
const _obj = new THREE.Object3D();
const _col = new THREE.Color();
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _upY = new THREE.Vector3(0, 1, 0);
const _camUp = new THREE.Vector3();
const _target = new THREE.Vector3();

// ===================================================================
// IslandPlaza — Stone Pedestal Platform Base
// ===================================================================
function IslandPlaza({
  platformSize,
  theme,
  progressRef,
}: {
  platformSize: number;
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const slabRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);

  const slabSize = platformSize + 1.2;
  const rimSize = slabSize + 0.5;

  useFrame(() => {
    const p = progressRef.current;
    if (slabRef.current) {
      const mat = slabRef.current.material as THREE.MeshStandardMaterial;
      mat.color.set(lerpColor("#f7f4ed", theme.stoneTileColors[0], p));
    }
    if (rimRef.current) {
      rimRef.current.visible = p > 0.05;
    }
  });

  return (
    <group position={[0, -0.04, 0]}>
      {/* Main ground slab */}
      <mesh ref={slabRef} position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[slabSize, 0.08, slabSize]} />
        <meshStandardMaterial color="#f7f4ed" roughness={0.95} metalness={0.0} />
      </mesh>
      {/* Outer stone rim border */}
      <mesh ref={rimRef} position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[rimSize, 0.07, rimSize]} />
        <meshStandardMaterial color="#9e988a" roughness={0.85} metalness={0.05} />
      </mesh>
    </group>
  );
}

// ===================================================================
// TerrainTilesMesh — QR Pixel Tiles (Flat) <-> Stone Floor (3D)
// ===================================================================
function TerrainTilesMesh({
  tiles,
  cellSize,
  theme,
  progressRef,
}: {
  tiles: TerrainTile[];
  cellSize: number;
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = tiles.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    tiles.forEach((tile, i) => {
      _col.set(tile.qrColor);
      mesh.setColorAt(i, _col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [tiles]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const p = progressRef.current;

    // Flat: 100.2% cell width (seamless, zero gaps) -> 3D: 98% (subtle paver joints)
    const curSize = cellSize * lerp(1.002, 0.98, p);

    tiles.forEach((tile, i) => {
      _obj.position.set(tile.x, 0.005, tile.z);
      _obj.rotation.set(0, 0, 0);
      _obj.quaternion.identity();
      _obj.scale.set(curSize, 0.01, curSize);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);

      // Interpolate color: Flat = QR green pixel art -> 3D = Stone paver plaza
      const targetColor = p < 0.15 ? tile.qrColor : lerpColor(tile.qrColor, tile.stoneColor, (p - 0.15) / 0.85);
      _col.set(targetColor);
      mesh.setColorAt(i, _col);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.95} metalness={0.0} />
    </instancedMesh>
  );
}

// ===================================================================
// StylizedGrassMesh — Multi-blade Grass Tufts along Perimeter
// ===================================================================
function StylizedGrassMesh({
  tiles,
  theme,
  progressRef,
}: {
  tiles: TerrainTile[];
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const grassTiles = useMemo(() => tiles.filter((t) => t.isGrass), [tiles]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = grassTiles.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    grassTiles.forEach((_, i) => {
      const colHex = theme.grassColors[i % theme.grassColors.length];
      _col.set(colHex);
      mesh.setColorAt(i, _col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [grassTiles, theme]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const p = progressRef.current;
    const time = state.clock.elapsedTime;
    const vis = Math.max(0, Math.min(1, (p - 0.2) / 0.75));

    grassTiles.forEach((gt, i) => {
      if (vis <= 0.001) {
        _obj.position.set(gt.x, -2, gt.z);
        _obj.scale.set(0, 0, 0);
        _obj.quaternion.identity();
        _obj.updateMatrix();
        mesh.setMatrixAt(i, _obj.matrix);
        return;
      }

      // Wind sway
      const wind = Math.sin(time * 2.5 + gt.x * 1.8 + gt.z * 1.8) * 0.15 * vis;
      const s = gt.grassScale * vis * 0.85;

      _obj.position.set(gt.x, s * 0.5, gt.z);
      _obj.rotation.set(wind, gt.grassRot, wind * 0.5);
      _obj.scale.set(s * 0.45, s, s * 0.45);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      {/* Slender tapered 4-sided grass clump */}
      <cylinderGeometry args={[0.08, 0.4, 1, 4]} />
      <meshStandardMaterial roughness={0.65} metalness={0.0} flatShading />
    </instancedMesh>
  );
}

// ===================================================================
// TreeBranchesMesh — Wooden Trunk & Branch Architecture
// ===================================================================
function TreeBranchesMesh({
  segments,
  theme,
  progressRef,
}: {
  segments: TreeSegment[];
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = segments.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    _col.set(theme.trunkColor);
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, _col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [theme, count]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const p = progressRef.current;
    const treeVis = Math.max(0, Math.min(1, (p - 0.1) / 0.65));

    segments.forEach((seg, i) => {
      if (treeVis <= 0.001) {
        _obj.position.set(0, -5, 0);
        _obj.scale.set(0, 0, 0);
        _obj.quaternion.identity();
        _obj.updateMatrix();
        mesh.setMatrixAt(i, _obj.matrix);
        return;
      }

      const s = seg.start;
      const e = seg.end;

      _v3a.set(s.x * treeVis, s.y * treeVis, s.z * treeVis);
      _v3b.set(e.x * treeVis, e.y * treeVis, e.z * treeVis);

      const mx = (_v3a.x + _v3b.x) / 2;
      const my = (_v3a.y + _v3b.y) / 2;
      const mz = (_v3a.z + _v3b.z) / 2;

      _v3b.sub(_v3a);
      const len = _v3b.length();
      if (len < 0.001) {
        _obj.scale.set(0, 0, 0);
        _obj.updateMatrix();
        mesh.setMatrixAt(i, _obj.matrix);
        return;
      }
      _v3b.normalize();

      _quat.setFromUnitVectors(_upY, _v3b);
      const radius = ((seg.radiusStart + seg.radiusEnd) / 2) * treeVis;

      _obj.position.set(mx, my, mz);
      _obj.quaternion.copy(_quat);
      _obj.scale.set(radius, len, radius);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      <cylinderGeometry args={[0.75, 1, 1, 8]} />
      <meshStandardMaterial color={theme.trunkColor} roughness={0.85} metalness={0.02} />
    </instancedMesh>
  );
}

// ===================================================================
// LushLeavesMesh — 650 Fine-Grained Stylized Leaf Clusters
// ===================================================================
function LushLeavesMesh({
  leaves,
  theme,
  progressRef,
}: {
  leaves: LeafParticle[];
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = leaves.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    leaves.forEach((lf, i) => {
      _col.set(lf.colorHex);
      mesh.setColorAt(i, _col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [leaves]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const p = progressRef.current;
    const vis = Math.max(0, Math.min(1, (p - 0.22) / 0.75));
    const time = state.clock.elapsedTime;

    leaves.forEach((lf, i) => {
      if (vis <= 0.001) {
        _obj.position.set(0, -5, 0);
        _obj.scale.set(0, 0, 0);
        _obj.quaternion.identity();
        _obj.updateMatrix();
        mesh.setMatrixAt(i, _obj.matrix);
        return;
      }

      // Natural subtle canopy flutter
      const flutter = Math.sin(time * 2.0 + lf.x * 2.5 + lf.z * 2.5) * 0.08;
      const s = lf.scale * vis * (1 + flutter);

      _obj.position.set(lf.x * vis, lf.y * vis, lf.z * vis);
      _obj.rotation.set(lf.rotX + flutter, lf.rotY + time * 0.02, lf.rotZ + flutter * 0.5);
      _obj.scale.setScalar(s);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      {/* Low-poly icosahedron for fine organic leaf facets */}
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.6} metalness={0.0} flatShading />
    </instancedMesh>
  );
}

// ===================================================================
// FloatingButterflies — Fluttering particles around the lush tree
// ===================================================================
const BUTTERFLY_COUNT = 8;

function FloatingButterflies({
  progressRef,
}: {
  progressRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const butterflyColors = ["#8ee452", "#f7adc5", "#ffe066", "#7bd844"];
    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      _col.set(butterflyColors[i % butterflyColors.length]);
      mesh.setColorAt(i, _col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const p = progressRef.current;
    const vis = Math.max(0, Math.min(1, (p - 0.6) / 0.4));
    const time = state.clock.elapsedTime;

    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      if (vis <= 0.01) {
        _obj.position.set(0, -5, 0);
        _obj.scale.set(0, 0, 0);
        _obj.quaternion.identity();
        _obj.updateMatrix();
        mesh.setMatrixAt(i, _obj.matrix);
        continue;
      }

      const angle = time * 0.6 + (i * Math.PI * 2) / BUTTERFLY_COUNT;
      const radius = 2.8 + Math.sin(time * 0.8 + i) * 0.8;
      const bx = Math.sin(angle) * radius;
      const bz = Math.cos(angle) * radius;
      const by = 2.6 + Math.sin(time * 1.5 + i * 2) * 1.2;

      _obj.position.set(bx, by, bz);
      _obj.rotation.set(0, angle, 0);
      _obj.scale.setScalar(0.12 * vis);
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, BUTTERFLY_COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.3} metalness={0.1} />
    </instancedMesh>
  );
}

// ===================================================================
// CameraRig — Perfect Top-Down Flat QR <-> Isometric 3D Tree Angle
// ===================================================================
function CameraRig({
  progressRef,
  gridSize,
  cellSize,
  userAngleRef,
}: {
  progressRef: React.MutableRefObject<number>;
  gridSize: number;
  cellSize: number;
  userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const { camera, size } = useThree();
  const baseDim = gridSize * cellSize; // e.g. 25 * 0.5 = 12.5

  useFrame((state) => {
    const p = progressRef.current;
    const time = state.clock.elapsedTime;
    const aspect = size.width / Math.max(1, size.height);

    // Height in Flat Mode so QR fits cleanly in center of screen
    const fovRad = (38 * Math.PI) / 180;
    const vertDist = (baseDim * 0.85) / Math.tan(fovRad / 2);
    const horizDist = (baseDim * 0.85) / (Math.tan(fovRad / 2) * aspect);
    const flatHeight = Math.max(vertDist, horizDist, 20);

    // 3D Isometric View (Matching exact 3D angle from Screenshot 2: ~33 deg elevation, ~45 deg azimuth)
    const baseIsometricAzimuth = Math.PI * 0.25; // 45 degrees
    const autoOrbit = time * 0.05;
    const user = userAngleRef.current;
    const curAzimuth = baseIsometricAzimuth + autoOrbit + user.azimuth;
    const curElevation = 0.58 + user.elevation; // ~33 deg elevation

    const orbDist = baseDim * 1.65;
    const orbX = Math.sin(curAzimuth) * Math.cos(curElevation) * orbDist;
    const orbY = Math.sin(curElevation) * orbDist + Math.sin(time * 0.5) * 0.12;
    const orbZ = Math.cos(curAzimuth) * Math.cos(curElevation) * orbDist;

    // Interpolate camera position
    camera.position.set(
      lerp(0, orbX, p),
      lerp(flatHeight, orbY, p),
      lerp(0.0001, orbZ, p)
    );

    // Target: Flat mode looks at [0, 0, 0], 3D mode looks at tree center [0, 2.8, 0]
    _target.set(0, lerp(0, 2.8, p), 0);

    // Up vector interpolation (avoids gimbal lock)
    _camUp.set(0, lerp(0, 1, p), lerp(-1, 0, p)).normalize();
    camera.up.copy(_camUp);

    camera.lookAt(_target);
  });

  return null;
}

// ===================================================================
// DynamicLighting — Direct overhead in Flat mode -> angled sun in 3D
// ===================================================================
function DynamicLighting({
  theme,
  progressRef,
}: {
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const dirLightRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const p = progressRef.current;
    if (!dirLightRef.current) return;
    // Flat: straight down [0, 30, 0] -> 3D: angled warm sun [14, 22, 16]
    dirLightRef.current.position.set(lerp(0, 14, p), 24, lerp(0, 16, p));
    dirLightRef.current.intensity = lerp(1.1, 1.5, p);
    dirLightRef.current.castShadow = p > 0.05;
  });

  return (
    <>
      <ambientLight color={theme.ambientColor} intensity={1.2} />
      <directionalLight
        ref={dirLightRef}
        color={theme.sunColor}
        intensity={1.2}
        position={[0, 24, 0]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0002}
      />
      <directionalLight color="#dbeafe" intensity={0.4} position={[-12, 14, -10]} />
      <directionalLight color="#fef3c7" intensity={0.25} position={[0, -10, 0]} />
    </>
  );
}

// ===================================================================
// SceneContent — Main scene graph
// ===================================================================
function SceneContent({
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
  userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const theme = SEASON_THEMES[season];

  const sceneData = useMemo(() => generateSceneData(matrix, url, season), [matrix, url, season]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const diff = target - progressRef.current;
    const speed = diff > 0 ? 2.4 : 2.8;
    progressRef.current += diff * Math.min(delta * speed, 0.08);
    if (Math.abs(diff) < 0.002) progressRef.current = target;
  });

  return (
    <>
      <DynamicLighting theme={theme} progressRef={progressRef} />

      <CameraRig
        progressRef={progressRef}
        gridSize={sceneData.gridSize}
        cellSize={sceneData.cellSize}
        userAngleRef={userAngleRef}
      />

      {/* Stone Plaza Ground Base */}
      <IslandPlaza
        platformSize={sceneData.platformSize}
        theme={theme}
        progressRef={progressRef}
      />

      {/* QR Pixel Art Grid (Flat) <-> Stone Floor (3D) */}
      <TerrainTilesMesh
        key={`tiles-${sceneData.gridSize}-${season}`}
        tiles={sceneData.tiles}
        cellSize={sceneData.cellSize}
        theme={theme}
        progressRef={progressRef}
      />

      {/* Stylized Grass Tufts around perimeter */}
      <StylizedGrassMesh
        key={`grass-${sceneData.gridSize}-${season}`}
        tiles={sceneData.tiles}
        theme={theme}
        progressRef={progressRef}
      />

      {/* Wooden Trunk & Branches */}
      {sceneData.tree.segments.length > 0 && (
        <TreeBranchesMesh
          key={`trunk-${sceneData.tree.segments.length}`}
          segments={sceneData.tree.segments}
          theme={theme}
          progressRef={progressRef}
        />
      )}

      {/* 650 Fine Organic Leaf Clusters */}
      {sceneData.tree.leaves.length > 0 && (
        <LushLeavesMesh
          key={`leaves-${sceneData.tree.leaves.length}-${season}`}
          leaves={sceneData.tree.leaves}
          theme={theme}
          progressRef={progressRef}
        />
      )}

      {/* Floating Butterflies / Particles */}
      <FloatingButterflies progressRef={progressRef} />
    </>
  );
}

// ===================================================================
// QRTreeScene — Public Canvas wrapper with touch & drag orbit support
// ===================================================================
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
  const userAngleRef = useRef({ azimuth: 0, elevation: 0 });
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
      userAngleRef.current.azimuth += dx * 0.005;
      userAngleRef.current.elevation = Math.max(-0.25, Math.min(0.45, userAngleRef.current.elevation - dy * 0.005));
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
    }
  };

  const handlePointerUp = () => {
    if (dragRef.current && !dragRef.current.moved) {
      onToggleFlat();
    }
    dragRef.current = null;
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => (dragRef.current = null)}
    >
      <Canvas
        camera={{ fov: 38, near: 0.1, far: 200, position: [0, 22, 0.0001] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        shadows
        style={{ background: theme.bgColor }}
      >
        <color attach="background" args={[theme.bgColor]} />
        <fog attach="fog" args={[theme.bgColor, 32, 90]} />

        <SceneContent
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

// Utility: Color interpolation
function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bl = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.substring(0, 2), 16),
    g: parseInt(v.substring(2, 4), 16),
    b: parseInt(v.substring(4, 6), 16),
  };
}

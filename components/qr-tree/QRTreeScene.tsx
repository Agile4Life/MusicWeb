"use client";

import React, { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { hash31, clamp, lerp, mulberry32 } from "./hashNoise";

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

type LeafCell = {
  x: number;
  z: number;
  layer: number;
  height: number;
  scale: number;
  rotation: number;
  color: string;
};

type Branch = {
  start: [number, number, number];
  end: [number, number, number];
  radius: number;
};

type Grass = {
  x: number;
  z: number;
  scale: number;
  rotation: number;
};

function cellIsFinder(r: number, c: number, n: number) {
  return (
    (r < 7 && c < 7) ||
    (r < 7 && c >= n - 7) ||
    (r >= n - 7 && c < 7)
  );
}

function buildStructure(matrix: boolean[][], url: string, theme: SeasonTheme) {
  const n = matrix.length;
  const mid = (n - 1) / 2;
  const cell = Math.min(0.46, 13.2 / n);
  const seed = hash31(url);
  const rnd = mulberry32(seed ^ 0x52f0ab7);
  const maxRadius = Math.max(1, Math.hypot(mid, mid));
  const heightMap = Array.from({ length: n }, () => Array(n).fill(0));
  const leaves: LeafCell[] = [];
  const grass: Grass[] = [];

  // Every dark QR module stays at its original X/Z. We only derive a layer.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      let neighbours = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && matrix[rr][cc]) neighbours++;
        }
      }
      const x = c - mid;
      const z = r - mid;
      const centerWeight = 1 - clamp(Math.hypot(x, z) / maxRadius, 0, 1);
      const density = neighbours / 8;
      const finderPenalty = cellIsFinder(r, c, n) ? 0.72 : 1;
      const raw = (centerWeight * 0.56 + density * 0.44) * finderPenalty;
      heightMap[r][c] = Math.max(0, Math.min(5, Math.round(raw * 5)));
    }
  }

  const palette = theme.foliageColors.length ? theme.foliageColors : ["#69c73d"];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      const layer = heightMap[r][c];
      const t = layer / 5;
      const x = (c - mid) * cell;
      const z = (r - mid) * cell;
      leaves.push({
        x,
        z,
        layer,
        height: 0.28 + layer * 0.40,
        scale: cell * (0.86 + t * 0.10) * (0.95 + rnd() * 0.05),
        rotation: rnd() * Math.PI * 2,
        color: palette[Math.min(palette.length - 1, Math.round(t * (palette.length - 1)))] || "#69c73d",
      });

      const outer = r < 2 || c < 2 || r >= n - 2 || c >= n - 2;
      if (outer && layer <= 1 && rnd() > 0.55) {
        grass.push({ x, z, scale: 0.16 + rnd() * 0.12, rotation: rnd() * Math.PI * 2 });
      }
    }
  }

  // Deterministic support branches point only toward the highest QR leaf cells.
  const selected = leaves
    .filter((leaf) => leaf.layer >= 3)
    .sort((a, b) => b.layer - a.layer || Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  const branches: Branch[] = [];
  const usedAngles: number[] = [];
  for (const leaf of selected) {
    const angle = Math.atan2(leaf.z, leaf.x);
    if (usedAngles.some((a) => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) < 0.34)) continue;
    usedAngles.push(angle);
    if (usedAngles.length > 9) break;
    branches.push({
      start: [0, 0.38 + leaf.layer * 0.14, 0],
      end: [leaf.x * 0.74, Math.max(1.2, leaf.height * 0.65), leaf.z * 0.74],
      radius: Math.max(0.06, 0.14 - usedAngles.length * 0.008),
    });
  }

  return { leaves, branches, grass, cell, span: n * cell };
}

function QRBase({ matrix, theme, progressRef }: { matrix: boolean[][]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = matrix.length;
  const cell = Math.min(0.46, 13.2 / n);
  const mid = (n - 1) / 2;
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const dark = matrix[r][c];
        const x = (c - mid) * cell;
        const z = (r - mid) * cell;
        const h = dark ? lerp(0.055, 0.11, p) : 0.035;
        DUMMY.position.set(x, h * 0.5 - 0.01, z);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.set(cell * 0.995, h, cell * 0.995);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
        COLOR.set(dark ? (theme.qrDarkPalette[2] || "#4f9638") : (theme.qrLightPalette[1] || "#e7dfcf"));
        mesh.setColorAt(i, COLOR);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n * n]} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.92} metalness={0} />
    </instancedMesh>
  );
}

function LeafField({ leaves, progressRef }: { leaves: LeafCell[]; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.14, 0.92);
    const time = state.clock.elapsedTime;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const flutter = Math.sin(time * 1.15 + i * 0.37) * 0.025 * tree;
      const y = 0.18 + leaf.height * tree;
      const scale = leaf.scale * (0.78 + 0.22 * tree);
      DUMMY.position.set(leaf.x, y, leaf.z);
      DUMMY.rotation.set(0.1 * Math.sin(time * 0.9 + i), leaf.rotation + flutter, 0.16 * Math.cos(time * 1.1 + i));
      DUMMY.scale.set(scale, scale * 0.72, scale * 0.82);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
      COLOR.set(leaf.color);
      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, leaves.length]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.6} flatShading />
    </instancedMesh>
  );
}

function BranchField({ branches, theme, progressRef }: { branches: Branch[]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.22, 0.74);
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i];
      A.set(branch.start[0] * tree, branch.start[1] * tree, branch.start[2] * tree);
      B.set(branch.end[0] * tree, branch.end[1] * tree, branch.end[2] * tree);
      DIR.copy(B).sub(A);
      const length = DIR.length();
      if (length < 0.001) {
        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
        continue;
      }
      DIR.normalize();
      Q.setFromUnitVectors(UP, DIR);
      DUMMY.position.copy(A).add(B).multiplyScalar(0.5);
      DUMMY.quaternion.copy(Q);
      DUMMY.scale.set(branch.radius, length, branch.radius);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (!branches.length) return null;
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, branches.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.68, 1, 1, 8]} />
        <meshStandardMaterial color={theme.trunkColor} roughness={0.8} metalness={0} />
      </instancedMesh>
      <mesh position={[0, 0.5 * phase(progressRef.current, 0.18, 0.78), 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.36, 1.1, 8]} />
        <meshStandardMaterial color={theme.trunkColor} roughness={0.82} />
      </mesh>
    </>
  );
}

function GrassField({ grass, theme, progressRef }: { grass: Grass[]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.32, 0.88);
    for (let i = 0; i < grass.length; i++) {
      const g = grass[i];
      DUMMY.position.set(g.x, g.scale * 0.42 * tree, g.z);
      DUMMY.rotation.set(Math.sin(state.clock.elapsedTime * 2 + i) * 0.1 * tree, g.rotation, 0);
      DUMMY.scale.set(g.scale * 0.42, g.scale * tree, g.scale * 0.42);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
      COLOR.set(theme.grassColors[i % theme.grassColors.length]);
      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  if (!grass.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, grass.length]}>
      <coneGeometry args={[0.12, 1, 4]} />
      <meshStandardMaterial roughness={0.78} flatShading />
    </instancedMesh>
  );
}

function CameraRig({ progressRef, span, userAngleRef }: { progressRef: React.MutableRefObject<number>; span: number; userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }> }) {
  const { camera, size } = useThree();
  useFrame(() => {
    const p = smooth(progressRef.current);
    const aspect = size.width / Math.max(1, size.height);
    const fov = (38 * Math.PI) / 180;
    const qrDistance = Math.max(17, (span * 0.74) / Math.tan(fov / 2) / Math.max(0.58, aspect));
    const user = userAngleRef.current;
    const azimuth = Math.PI * 0.25 + user.azimuth;
    const elevation = clamp(0.58 + user.elevation, 0.38, 0.9);
    const treeDistance = Math.max(12.5, span * 1.1);
    const tx = Math.sin(azimuth) * Math.cos(elevation) * treeDistance;
    const ty = Math.sin(elevation) * treeDistance;
    const tz = Math.cos(azimuth) * Math.cos(elevation) * treeDistance;
    camera.position.set(lerp(0, tx, p), lerp(qrDistance, ty, p), lerp(0.001, tz, p));
    TARGET.set(0, lerp(0, 2.1, p), 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(TARGET);
  });
  return null;
}

function Lighting({ theme, progressRef }: { theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    if (!light.current) return;
    const p = progressRef.current;
    light.current.position.set(lerp(0, 10, p), 20, lerp(0, 12, p));
    light.current.intensity = lerp(1.15, 1.5, p);
  });
  return (
    <>
      <ambientLight color={theme.ambientColor} intensity={1.4} />
      <directionalLight ref={light} color={theme.sunColor} position={[0, 20, 0]} intensity={1.15} castShadow shadow-mapSize-width={1536} shadow-mapSize-height={1536} />
      <hemisphereLight color="#fffaf0" groundColor="#b6aa96" intensity={0.36} />
    </>
  );
}

function Scene({ matrix, url, season, isFlat, userAngleRef }: { matrix: boolean[][]; url: string; season: Season; isFlat: boolean; userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }> }) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const theme = SEASON_THEMES[season];
  const structure = useMemo(() => buildStructure(matrix, url, theme), [matrix, url, theme]);
  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const speed = target > progressRef.current ? 1.9 : 2.2;
    progressRef.current += (target - progressRef.current) * Math.min(1, delta * speed);
    if (Math.abs(target - progressRef.current) < 0.001) progressRef.current = target;
  });
  return (
    <>
      <Lighting theme={theme} progressRef={progressRef} />
      <CameraRig progressRef={progressRef} span={structure.span} userAngleRef={userAngleRef} />
      <QRBase matrix={matrix} theme={theme} progressRef={progressRef} />
      <BranchField branches={structure.branches} theme={theme} progressRef={progressRef} />
      <LeafField leaves={structure.leaves} progressRef={progressRef} />
      <GrassField grass={structure.grass} theme={theme} progressRef={progressRef} />
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
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
      userAngleRef.current.azimuth += dx * 0.004;
      userAngleRef.current.elevation = clamp(userAngleRef.current.elevation - dy * 0.004, -0.18, 0.32);
      drag.startX = e.clientX;
      drag.startY = e.clientY;
    }
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag && !drag.moved) onToggleFlat();
    dragRef.current = null;
  };
  return (
    <div className={className} style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none", ...style }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { dragRef.current = null; }}>
      <Canvas camera={{ fov: 38, near: 0.1, far: 180, position: [0, 20, 0.001] }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} shadows style={{ background: theme.bgColor }}>
        <color attach="background" args={[theme.bgColor]} />
        <fog attach="fog" args={[theme.bgColor, 34, 90]} />
        <Scene matrix={matrix} url={url} season={season} isFlat={isFlat} userAngleRef={userAngleRef} />
      </Canvas>
    </div>
  );
}

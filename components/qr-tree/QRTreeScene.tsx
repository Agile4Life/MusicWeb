"use client";

import React, { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { hash31, mulberry32, clamp, lerp } from "./hashNoise";

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const VEC_A = new THREE.Vector3();
const VEC_B = new THREE.Vector3();
const VEC_DIR = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const QUAT = new THREE.Quaternion();
const TARGET = new THREE.Vector3();

function smoothstep(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function phase(t: number, start: number, end: number) {
  return smoothstep((t - start) / Math.max(0.0001, end - start));
}

function mixHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, clamp(t, 0, 1)).getHexString()}`;
}

type QRRun = {
  x: number;
  z: number;
  length: number;
  width: number;
  angle: number;
  layer: number;
  height: number;
  color: string;
};

type SupportBranch = {
  start: [number, number, number];
  end: [number, number, number];
  radius: number;
};

type GrassBlade = {
  x: number;
  z: number;
  scale: number;
  rotation: number;
};

interface QRStructure {
  runs: QRRun[];
  branches: SupportBranch[];
  grass: GrassBlade[];
  span: number;
}

function buildHeightMap(matrix: boolean[][]) {
  const n = matrix.length;
  const mid = (n - 1) / 2;
  const maxRadius = Math.max(1, Math.hypot(mid, mid));
  const heights = Array.from({ length: n }, () => Array<number>(n).fill(0));

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;

      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && matrix[rr][cc]) neighbors++;
        }
      }

      const dx = c - mid;
      const dz = r - mid;
      const centerWeight = 1 - Math.min(1, Math.hypot(dx, dz) / maxRadius);
      const densityWeight = neighbors / 8;
      const raw = centerWeight * 0.72 + densityWeight * 0.28;
      heights[r][c] = Math.max(0, Math.min(4, Math.round(raw * 4)));
    }
  }

  return heights;
}

function buildRuns(matrix: boolean[][], heights: number[][], theme: SeasonTheme, cell: number) {
  const n = matrix.length;
  const mid = (n - 1) / 2;
  const palette = theme.foliageColors.length ? theme.foliageColors : ["#69c73d"];
  const runs: QRRun[] = [];

  // Every contiguous dark QR stroke becomes a leaf. No random canopy is created.
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!matrix[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c + 1 < n && matrix[r][c + 1]) c++;
      const end = c;
      const length = end - start + 1;
      const centerC = (start + end) / 2;
      let layerSum = 0;
      for (let x = start; x <= end; x++) layerSum += heights[r][x];
      const layer = Math.round(layerSum / length);
      const paletteIndex = Math.min(palette.length - 1, Math.round((layer / 4) * (palette.length - 1)));

      runs.push({
        x: (centerC - mid) * cell,
        z: (r - mid) * cell,
        length: Math.max(0.62, length * cell * 0.92),
        width: cell * (length === 1 ? 0.68 : 0.82),
        angle: 0,
        layer,
        height: 0.16 + layer * 0.34,
        color: palette[paletteIndex],
      });
      c++;
    }
  }

  // Preserve prominent vertical QR strokes as additional leaves.
  for (let c = 0; c < n; c++) {
    let r = 0;
    while (r < n) {
      if (!matrix[r][c]) {
        r++;
        continue;
      }
      const start = r;
      while (r + 1 < n && matrix[r + 1][c]) r++;
      const end = r;
      const length = end - start + 1;
      if (length < 3) {
        r++;
        continue;
      }

      const centerR = (start + end) / 2;
      let layerSum = 0;
      for (let y = start; y <= end; y++) layerSum += heights[y][c];
      const layer = Math.round(layerSum / length);
      const paletteIndex = Math.min(palette.length - 1, Math.round((layer / 4) * (palette.length - 1)));

      runs.push({
        x: (c - mid) * cell,
        z: (centerR - mid) * cell,
        length: Math.max(0.62, length * cell * 0.88),
        width: cell * 0.68,
        angle: Math.PI / 2,
        layer,
        height: 0.16 + layer * 0.34,
        color: palette[paletteIndex],
      });
      r++;
    }
  }

  return runs;
}

function buildBranches(runs: QRRun[], cell: number): SupportBranch[] {
  if (!runs.length) return [];
  const branches: SupportBranch[] = [];
  const center = runs.reduce((acc, run) => ({ x: acc.x + run.x, z: acc.z + run.z }), { x: 0, z: 0 });
  center.x /= runs.length;
  center.z /= runs.length;

  // Supports are sampled from high QR strokes, so even the trunk/branch structure is QR-derived.
  const selected = runs
    .filter((run) => run.layer >= 2 && run.length >= cell * 2)
    .sort((a, b) => b.layer - a.layer)
    .slice(0, 24);

  for (const run of selected) {
    branches.push({
      start: [center.x * 0.14, 0.28 + run.layer * 0.18, center.z * 0.14],
      end: [run.x, run.height - 0.05, run.z],
      radius: 0.016 + run.layer * 0.004,
    });
  }

  return branches;
}

function buildGrass(matrix: boolean[][], heights: number[][], cell: number, seed: number): GrassBlade[] {
  const rnd = mulberry32(seed ^ 0x4b1d);
  const n = matrix.length;
  const mid = (n - 1) / 2;
  const grass: GrassBlade[] = [];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c] || heights[r][c] > 1) continue;
      const outer = r < 2 || c < 2 || r >= n - 2 || c >= n - 2;
      if (!outer || rnd() > 0.35) continue;
      grass.push({
        x: (c - mid) * cell,
        z: (r - mid) * cell,
        scale: 0.13 + rnd() * 0.15,
        rotation: rnd() * Math.PI,
      });
    }
  }
  return grass;
}

function buildStructure(matrix: boolean[][], theme: SeasonTheme, url: string): QRStructure {
  const cell = 0.43;
  const heights = buildHeightMap(matrix);
  const runs = buildRuns(matrix, heights, theme, cell);
  return {
    runs,
    branches: buildBranches(runs, cell),
    grass: buildGrass(matrix, heights, cell, hash31(url)),
    span: matrix.length * cell,
  };
}

function QRBase({ matrix, theme, progressRef }: { matrix: boolean[][]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = matrix.length;
  const cell = 0.43;
  const mid = (n - 1) / 2;

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const dark = matrix[r][c];
        const h = dark ? lerp(0.055, 0.09, p) : 0.035;
        DUMMY.position.set((c - mid) * cell, h * 0.5 - 0.015, (r - mid) * cell);
        DUMMY.scale.set(cell * 0.985, h, cell * 0.985);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
        COLOR.set(dark ? theme.qrDarkPalette[2] : theme.qrLightPalette[1]);
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

function LeafRuns({ runs, progressRef }: { runs: QRRun[]; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.04, 0.94);
    const time = state.clock.elapsedTime;

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const radial = Math.hypot(run.x, run.z);
      const taper = 0.88 + clamp(1 - radial / 8.5, 0, 1) * 0.12;
      const height = run.height * tree * taper;
      const sway = Math.sin(time * 1.2 + run.x * 1.7 + run.z * 0.9) * 0.025 * tree;

      // The geometry never changes its X/Z identity: each visible leaf is a QR stroke.
      DUMMY.position.set(run.x, height + 0.035, run.z);
      DUMMY.rotation.set(sway * 0.4, run.angle + sway, run.angle === 0 ? sway : -sway);
      DUMMY.scale.set(run.length, run.width, run.width * 0.72);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);

      COLOR.set(run.color);
      // Darker foliage is reserved for higher QR layers.
      COLOR.multiplyScalar(0.9 + run.layer * 0.055);
      mesh.setColorAt(i, COLOR);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, runs.length]} castShadow>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={0.56} metalness={0.01} flatShading />
    </instancedMesh>
  );
}

function Supports({ branches, theme, progressRef }: { branches: SupportBranch[]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.18, 0.8);
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      VEC_A.set(b.start[0] * tree, b.start[1] * tree, b.start[2] * tree);
      VEC_B.set(b.end[0] * tree, b.end[1] * tree, b.end[2] * tree);
      VEC_DIR.copy(VEC_B).sub(VEC_A);
      const length = VEC_DIR.length();
      if (length < 0.001) {
        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
        continue;
      }
      VEC_DIR.normalize();
      QUAT.setFromUnitVectors(UP, VEC_DIR);
      DUMMY.position.copy(VEC_A).add(VEC_B).multiplyScalar(0.5);
      DUMMY.quaternion.copy(QUAT);
      DUMMY.scale.set(b.radius, length, b.radius);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!branches.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, branches.length]} castShadow>
      <cylinderGeometry args={[0.7, 1, 1, 6]} />
      <meshStandardMaterial color={theme.trunkColor} roughness={0.8} metalness={0.01} />
    </instancedMesh>
  );
}

function Grass({ grass, theme, progressRef }: { grass: GrassBlade[]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.4, 0.9);
    for (let i = 0; i < grass.length; i++) {
      const g = grass[i];
      const sway = Math.sin(state.clock.elapsedTime * 2.2 + g.x + g.z) * 0.1 * tree;
      DUMMY.position.set(g.x, g.scale * 0.5 * tree, g.z);
      DUMMY.rotation.set(sway, g.rotation, sway * 0.5);
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
      <meshStandardMaterial roughness={0.8} flatShading />
    </instancedMesh>
  );
}

function CameraRig({ progressRef, span, userAngleRef }: { progressRef: React.MutableRefObject<number>; span: number; userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }> }) {
  const { camera, size } = useThree();

  useFrame(() => {
    const p = smoothstep(progressRef.current);
    const aspect = size.width / Math.max(1, size.height);
    const fov = (36 * Math.PI) / 180;
    const qrDistance = Math.max(16, (span * 0.76) / Math.tan(fov / 2) / Math.max(0.58, aspect));
    const user = userAngleRef.current;
    const azimuth = Math.PI * 0.25 + user.azimuth;
    const elevation = clamp(0.58 + user.elevation, 0.38, 0.92);
    const treeDistance = Math.max(12, span * 1.12);

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
    light.current.intensity = lerp(1.15, 1.55, p);
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
  const structure = useMemo(() => buildStructure(matrix, theme, url), [matrix, theme, url]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const speed = target > progressRef.current ? 1.9 : 2.25;
    progressRef.current += (target - progressRef.current) * Math.min(1, delta * speed);
    if (Math.abs(target - progressRef.current) < 0.001) progressRef.current = target;
  });

  return (
    <>
      <Lighting theme={theme} progressRef={progressRef} />
      <CameraRig progressRef={progressRef} span={structure.span} userAngleRef={userAngleRef} />
      <QRBase matrix={matrix} theme={theme} progressRef={progressRef} />
      <LeafRuns runs={structure.runs} progressRef={progressRef} />
      <Supports branches={structure.branches} theme={theme} progressRef={progressRef} />
      <Grass grass={structure.grass} theme={theme} progressRef={progressRef} />
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
      userAngleRef.current.elevation = clamp(userAngleRef.current.elevation - dy * 0.004, -0.18, 0.34);
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
      <Canvas camera={{ fov: 36, near: 0.1, far: 180, position: [0, 20, 0.001] }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} shadows style={{ background: theme.bgColor }}>
        <color attach="background" args={[theme.bgColor]} />
        <fog attach="fog" args={[theme.bgColor, 34, 90]} />
        <Scene matrix={matrix} url={url} season={season} isFlat={isFlat} userAngleRef={userAngleRef} />
      </Canvas>
    </div>
  );
}

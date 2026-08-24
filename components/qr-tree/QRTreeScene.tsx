"use client";

import React, { MutableRefObject, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { clamp, hash31, lerp, mulberry32 } from "./hashNoise";

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

type Leaf = {
  qrX: number;
  qrZ: number;
  treeX: number;
  treeY: number;
  treeZ: number;
  layer: number;
  scale: number;
  color: string;
  rotation: number;
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

function isFinder(r: number, c: number, n: number) {
  return (
    (r < 7 && c < 7) ||
    (r < 7 && c >= n - 7) ||
    (r >= n - 7 && c < 7)
  );
}

/**
 * The important distinction from the previous versions:
 *
 * QR space and tree space are two representations of the SAME dark cells.
 * We do not leave the cells on a flat QR plane in tree mode. Every dark
 * module gets a deterministic target inside a compact, rounded canopy.
 * The animation interpolates between the exact QR coordinate and that tree
 * target. This is the missing "fold the QR into the tree" step.
 */
function buildStructure(matrix: boolean[][], url: string, theme: SeasonTheme) {
  const n = matrix.length;
  const mid = (n - 1) / 2;
  const seed = hash31(url);
  const rnd = mulberry32(seed ^ 0x6d2b79f5);
  const qrCell = Math.min(0.44, 12.8 / n);
  const canopyRadius = 4.0;
  const canopyHeight = 5.4;
  const leaves: Leaf[] = [];

  // Local topology is used to create a stable 0..5 layer. It affects height
  // and shade, but never changes the QR membership of the cell.
  const layerMap = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && matrix[rr][cc]) {
            neighbors++;
          }
        }
      }
      const nx = (c - mid) / Math.max(1, mid);
      const nz = (r - mid) / Math.max(1, mid);
      const radius = Math.min(1, Math.hypot(nx, nz));
      const center = 1 - radius;
      const density = neighbors / 8;
      const finderPenalty = isFinder(r, c, n) ? 0.78 : 1;
      layerMap[r][c] = Math.max(
        0,
        Math.min(5, Math.round((center * 0.48 + density * 0.52) * finderPenalty * 5)),
      );
    }
  }

  const foliage = theme.foliageColors.length ? theme.foliageColors : ["#69c73d"];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;

      const nx = (c - mid) / Math.max(1, mid);
      const nz = (r - mid) / Math.max(1, mid);
      const radial = Math.min(1, Math.hypot(nx, nz));
      const layer = layerMap[r][c];
      const layerT = layer / 5;

      // Fold the square QR plane into a rounded tree canopy.
      // Center -> taller and tighter. Edge -> lower and wider.
      const azimuth = Math.atan2(nz, nx);
      const ring = 0.75 + radial * 0.72;
      const targetRadius = canopyRadius * radial * ring;
      const angularWobble = (rnd() - 0.5) * 0.12;
      const heightProfile = Math.pow(1 - radial, 0.72);
      const tierLift = layerT * 1.35;

      const treeX = Math.cos(azimuth + angularWobble) * targetRadius;
      const treeZ = Math.sin(azimuth + angularWobble) * targetRadius;
      const treeY =
        1.55 +
        heightProfile * canopyHeight * 0.68 +
        layerT * 1.05 +
        (rnd() - 0.5) * (0.18 + radial * 0.12);

      const edgeScale = 0.86 + (1 - radial) * 0.20;
      const scale = qrCell * edgeScale * (0.84 + layerT * 0.12);
      const colorIndex = Math.min(
        foliage.length - 1,
        Math.round(layerT * (foliage.length - 1)),
      );

      leaves.push({
        qrX: (c - mid) * qrCell,
        qrZ: (r - mid) * qrCell,
        treeX,
        treeY,
        treeZ,
        layer,
        scale,
        color: foliage[colorIndex] || "#69c73d",
        rotation: rnd() * Math.PI * 2,
      });
    }
  }

  // Build a small real trunk and 8-10 structural branches. The leaf targets
  // decide where branches terminate; there is no random canopy independent of QR.
  const branchCandidates = leaves
    .filter((leaf) => leaf.layer >= 3)
    .sort((a, b) => b.layer - a.layer || a.treeY - b.treeY);

  const branches: Branch[] = [];
  const usedAngles: number[] = [];
  for (const leaf of branchCandidates) {
    const angle = Math.atan2(leaf.treeZ, leaf.treeX);
    const tooClose = usedAngles.some(
      (a) => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) < 0.42,
    );
    if (tooClose) continue;
    usedAngles.push(angle);
    if (usedAngles.length > 9) break;

    const branchStartY = 1.0 + (usedAngles.length % 3) * 0.72;
    branches.push({
      start: [0, branchStartY, 0],
      end: [leaf.treeX * 0.72, Math.max(2.0, leaf.treeY - 0.3), leaf.treeZ * 0.72],
      radius: 0.105 - usedAngles.length * 0.007,
    });
  }

  const grass: Grass[] = [];
  const half = 3;
  for (let z = -half; z <= half; z++) {
    for (const x of [-half, half]) {
      grass.push({ x: x + (rnd() - 0.5) * 0.24, z: z + (rnd() - 0.5) * 0.24, scale: 0.22 + rnd() * 0.12, rotation: rnd() * Math.PI });
      if (z !== -half && z !== half) {
        grass.push({ x: z + (rnd() - 0.5) * 0.24, z: x + (rnd() - 0.5) * 0.24, scale: 0.22 + rnd() * 0.12, rotation: rnd() * Math.PI });
      }
    }
  }

  return { leaves, branches, grass, qrCell, canopyRadius, platformSize: 7 };
}

function Ground({ size, theme, progressRef }: { size: number; theme: SeasonTheme; progressRef: MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const p = phase(progressRef.current, 0.18, 0.84);
    if (ref.current) {
      const material = ref.current.material as THREE.MeshStandardMaterial;
      material.color.set(mixHex("#f7f4ed", theme.stoneTileColors[1] || "#e4ddcc", p));
    }
    if (rim.current) rim.current.visible = p > 0.18;
  });

  return (
    <group position={[0, -0.07, 0]}>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={[size, 0.14, size]} />
        <meshStandardMaterial color="#f7f4ed" roughness={0.96} />
      </mesh>
      <mesh ref={rim} position={[0, -0.07, 0]} receiveShadow>
        <boxGeometry args={[size + 0.22, 0.09, size + 0.22]} />
        <meshStandardMaterial color="#c4bbaa" roughness={0.93} />
      </mesh>
    </group>
  );
}

function QRState({ matrix, theme, progressRef, qrCell }: { matrix: boolean[][]; theme: SeasonTheme; progressRef: MutableRefObject<number>; qrCell: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = matrix.length;
  const mid = (n - 1) / 2;

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    const qrVisible = 1 - phase(p, 0.12, 0.78);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const dark = matrix[r][c];
        const x = (c - mid) * qrCell;
        const z = (r - mid) * qrCell;
        const height = dark ? 0.08 * qrVisible : 0.035;
        const scale = qrCell * (dark ? 0.98 : 0.99);

        DUMMY.position.set(x, height * 0.5 - 0.01, z);
        DUMMY.scale.set(scale, height, scale);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);

        const lightColor = theme.qrLightPalette[1] || "#e7dfcf";
        const darkColor = theme.qrDarkPalette[2] || "#4f9638";
        COLOR.set(dark ? darkColor : lightColor);
        COLOR.multiplyScalar(dark ? Math.max(0.01, qrVisible) : 1);
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

function Leaves({ leaves, progressRef }: { leaves: Leaf[]; progressRef: MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.16, 0.96);
    const time = state.clock.elapsedTime;

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const sway = Math.sin(time * 1.1 + i * 0.23) * 0.025 * tree;
      DUMMY.position.set(
        lerp(leaf.qrX, leaf.treeX, tree),
        leaf.treeY * tree,
        lerp(leaf.qrZ, leaf.treeZ, tree),
      );
      DUMMY.rotation.set(0.12 * Math.sin(i + time), leaf.rotation + sway, 0.12 * Math.cos(i * 0.7 + time));
      DUMMY.scale.setScalar(leaf.scale * (0.28 + 0.72 * tree));
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
      <meshStandardMaterial roughness={0.64} metalness={0} flatShading />
    </instancedMesh>
  );
}

function Branches({ branches, theme, progressRef }: { branches: Branch[]; theme: SeasonTheme; progressRef: MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = ref.current;
    const tree = phase(progressRef.current, 0.18, 0.78);
    if (mesh) {
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        A.set(b.start[0] * tree, b.start[1] * tree, b.start[2] * tree);
        B.set(b.end[0] * tree, b.end[1] * tree, b.end[2] * tree);
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
        DUMMY.scale.set(b.radius, length, b.radius);
        DUMMY.updateMatrix();
        mesh.setMatrixAt(i, DUMMY.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (trunkRef.current) {
      trunkRef.current.scale.y = Math.max(0.001, tree);
      trunkRef.current.position.y = 0.5 * tree;
    }
  });

  return (
    <>
      <mesh ref={trunkRef} castShadow receiveShadow position={[0, 0, 0]}>
        <cylinderGeometry args={[0.25, 0.34, 1, 8]} />
        <meshStandardMaterial color={theme.trunkColor} roughness={0.82} metalness={0} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, branches.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.7, 1, 1, 8]} />
        <meshStandardMaterial color={theme.trunkColor} roughness={0.78} metalness={0} />
      </instancedMesh>
    </>
  );
}

function Grass({ grass, theme, progressRef }: { grass: Grass[]; theme: SeasonTheme; progressRef: MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const tree = phase(progressRef.current, 0.35, 0.88);
    for (let i = 0; i < grass.length; i++) {
      const g = grass[i];
      DUMMY.position.set(g.x, g.scale * 0.42 * tree, g.z);
      DUMMY.rotation.set(Math.sin(state.clock.elapsedTime * 2 + i) * 0.10 * tree, g.rotation, 0);
      DUMMY.scale.set(g.scale * 0.5, g.scale * tree, g.scale * 0.5);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
      COLOR.set(theme.grassColors[i % theme.grassColors.length]);
      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, grass.length]}>
      <coneGeometry args={[0.13, 1, 4]} />
      <meshStandardMaterial roughness={0.8} flatShading />
    </instancedMesh>
  );
}

function CameraRig({ progressRef, qrSpan, userAngleRef }: {
  progressRef: MutableRefObject<number>;
  qrSpan: number;
  userAngleRef: MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const { camera, size } = useThree();

  useFrame(() => {
    const p = smooth(progressRef.current);
    const aspect = size.width / Math.max(1, size.height);
    const fov = (36 * Math.PI) / 180;
    const qrDistance = Math.max(17, (qrSpan * 0.74) / Math.tan(fov / 2) / Math.max(0.58, aspect));
    const user = userAngleRef.current;
    const azimuth = Math.PI * 0.25 + user.azimuth;
    const elevation = clamp(0.63 + user.elevation, 0.38, 0.92);
    const treeDistance = 10.8;

    const tx = Math.sin(azimuth) * Math.cos(elevation) * treeDistance;
    const ty = Math.sin(elevation) * treeDistance;
    const tz = Math.cos(azimuth) * Math.cos(elevation) * treeDistance;

    camera.position.set(
      lerp(0, tx, p),
      lerp(qrDistance, ty, p),
      lerp(0.001, tz, p),
    );
    TARGET.set(0, lerp(0, 2.25, p), 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(TARGET);
  });

  return null;
}

function Lighting({ theme, progressRef }: { theme: SeasonTheme; progressRef: MutableRefObject<number> }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    if (!light.current) return;
    const p = progressRef.current;
    light.current.position.set(lerp(0, 7, p), 18, lerp(0, 10, p));
    light.current.intensity = lerp(1.1, 1.6, p);
  });
  return (
    <>
      <ambientLight color={theme.ambientColor} intensity={1.3} />
      <directionalLight ref={light} color={theme.sunColor} position={[0, 18, 0]} intensity={1.15} castShadow shadow-mapSize-width={1536} shadow-mapSize-height={1536} />
      <hemisphereLight color="#fffaf0" groundColor="#b7aa94" intensity={0.32} />
    </>
  );
}

function Scene({ matrix, url, season, isFlat, userAngleRef }: {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  userAngleRef: MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const theme = SEASON_THEMES[season];
  const structure = useMemo(() => buildStructure(matrix, url, theme), [matrix, url, theme]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const speed = target > progressRef.current ? 1.55 : 1.9;
    progressRef.current += (target - progressRef.current) * Math.min(1, delta * speed);
    if (Math.abs(target - progressRef.current) < 0.001) progressRef.current = target;
  });

  return (
    <>
      <Lighting theme={theme} progressRef={progressRef} />
      <CameraRig progressRef={progressRef} qrSpan={matrix.length * structure.qrCell} userAngleRef={userAngleRef} />
      <Ground size={structure.platformSize} theme={theme} progressRef={progressRef} />
      <QRState matrix={matrix} theme={theme} progressRef={progressRef} qrCell={structure.qrCell} />
      <Branches branches={structure.branches} theme={theme} progressRef={progressRef} />
      <Leaves leaves={structure.leaves} progressRef={progressRef} />
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
      userAngleRef.current.elevation = clamp(userAngleRef.current.elevation - dy * 0.004, -0.20, 0.30);
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
    <div
      className={className}
      style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none", ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { dragRef.current = null; }}
    >
      <Canvas
        camera={{ fov: 36, near: 0.1, far: 180, position: [0, 20, 0.001] }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        shadows
        style={{ background: theme.bgColor }}
      >
        <color attach="background" args={[theme.bgColor]} />
        <fog attach="fog" args={[theme.bgColor, 34, 90]} />
        <Scene matrix={matrix} url={url} season={season} isFlat={isFlat} userAngleRef={userAngleRef} />
      </Canvas>
    </div>
  );
}

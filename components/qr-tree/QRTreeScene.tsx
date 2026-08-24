"use client";

import React, { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { hash31, mulberry32, clamp, lerp } from "./hashNoise";

const TMP = new THREE.Object3D();
const TMP2 = new THREE.Object3D();
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

function phase(t: number, a: number, b: number) {
  return smooth((t - a) / Math.max(0.0001, b - a));
}

function mixHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, clamp(t, 0, 1)).getHexString()}`;
}

type Branch = {
  start: [number, number, number];
  end: [number, number, number];
  radius: number;
  depth: number;
};

type Leaf = {
  position: [number, number, number];
  scale: number;
  rotation: [number, number, number];
  color: string;
};

type Bloom = {
  position: [number, number, number];
  scale: number;
  color: string;
};

type Grass = {
  x: number;
  z: number;
  scale: number;
  rotation: number;
};

function findDarkCells(matrix: boolean[][], wanted: number[]) {
  const n = matrix.length;
  const mid = (n - 1) / 2;
  const out: { x: number; z: number; r: number; angle: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      const x = c - mid;
      const z = r - mid;
      const radius = Math.hypot(x, z);
      if (radius < 2.2 || radius > Math.max(4, n * 0.42)) continue;
      out.push({ x, z, r: radius, angle: Math.atan2(z, x) });
    }
  }
  out.sort((a, b) => a.r - b.r);
  return wanted.map((angle, i) => {
    let best = out[0];
    let bestScore = Infinity;
    for (const c of out) {
      const angular = Math.abs(Math.atan2(Math.sin(c.angle - angle), Math.cos(c.angle - angle)));
      const score = angular * 6 + Math.abs(c.r - (4.2 + (i % 3) * 0.7));
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  });
}

function buildTree(matrix: boolean[][], url: string, theme: SeasonTheme) {
  const seed = hash31(url);
  const rnd = mulberry32(seed ^ 0x51ed270b);
  const cell = 0.46;
  const segments: Branch[] = [];
  const leaves: Leaf[] = [];
  const blooms: Bloom[] = [];
  const grass: Grass[] = [];
  const n = matrix.length;
  const mid = (n - 1) / 2;

  // Root is placed on a real dark QR module near the center.
  let root = { x: 0, z: 0 };
  let best = Infinity;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      const d = Math.hypot(c - mid, r - mid);
      if (d < best) {
        best = d;
        root = { x: c - mid, z: r - mid };
      }
    }
  }

  const rootX = root.x * cell;
  const rootZ = root.z * cell;
  const trunkHeight = 4.3 + rnd() * 0.55;
  const trunkRadius = 0.28;

  for (let i = 0; i < 7; i++) {
    const t0 = i / 7;
    const t1 = (i + 1) / 7;
    segments.push({
      start: [rootX, t0 * trunkHeight + 0.12, rootZ],
      end: [rootX + Math.sin(t1 * 1.8) * 0.12, t1 * trunkHeight + 0.12, rootZ + Math.cos(t1 * 1.4) * 0.1],
      radius: trunkRadius * (1 - t0 * 0.48),
      depth: 0,
    });
  }

  // Branch directions are selected from actual dark QR modules.
  const angles = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + (rnd() - 0.5) * 0.22);
  const targets = findDarkCells(matrix, angles);
  const leafAnchors: [number, number, number][] = [];

  targets.forEach((target, i) => {
    const attach = 2.0 + (i / targets.length) * 1.65;
    const endX = target.x * cell * 0.82;
    const endZ = target.z * cell * 0.82;
    const endY = attach + 0.9 + rnd() * 0.65;

    segments.push({
      start: [rootX, attach, rootZ],
      end: [endX, endY, endZ],
      radius: 0.16 - i * 0.008,
      depth: 1,
    });
    leafAnchors.push([endX, endY, endZ]);

    const twigs = 2 + Math.floor(rnd() * 2);
    for (let t = 0; t < twigs; t++) {
      const side = t % 2 === 0 ? 1 : -1;
      const a = angles[i] + side * (0.34 + rnd() * 0.25);
      const len = 1.0 + rnd() * 0.8;
      const ex = endX + Math.cos(a) * len;
      const ez = endZ + Math.sin(a) * len;
      const ey = endY + 0.3 + rnd() * 0.65;
      segments.push({
        start: [endX, endY, endZ],
        end: [ex, ey, ez],
        radius: 0.075,
        depth: 2,
      });
      leafAnchors.push([ex, ey, ez]);
    }
  });

  // Compact voxel-like canopy instead of the previous oversized blob.
  const leafColors = theme.foliageColors;
  for (let i = 0; i < 300; i++) {
    const anchor = leafAnchors[i % leafAnchors.length];
    const spread = 0.82 + rnd() * 0.7;
    leaves.push({
      position: [
        anchor[0] + (rnd() - 0.5) * spread,
        Math.max(2.6, anchor[1] + (rnd() - 0.4) * spread * 0.9),
        anchor[2] + (rnd() - 0.5) * spread,
      ],
      scale: 0.22 + rnd() * 0.23,
      rotation: [rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI],
      color: leafColors[Math.floor(rnd() * leafColors.length)],
    });
  }

  for (let i = 0; i < 80; i++) {
    const angle = rnd() * Math.PI * 2;
    const radius = 1.1 + rnd() * 2.0;
    leaves.push({
      position: [rootX + Math.cos(angle) * radius, 3.5 + rnd() * 2.1, rootZ + Math.sin(angle) * radius],
      scale: 0.18 + rnd() * 0.2,
      rotation: [rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI],
      color: leafColors[Math.floor(rnd() * leafColors.length)],
    });
  }

  const flowerColors = seasonFlowers(theme);
  for (let i = 0; i < 46; i++) {
    const anchor = leafAnchors[i % leafAnchors.length];
    blooms.push({
      position: [anchor[0] + (rnd() - 0.5) * 0.8, anchor[1] + 0.35 + rnd() * 0.8, anchor[2] + (rnd() - 0.5) * 0.8],
      scale: 0.08 + rnd() * 0.05,
      color: flowerColors[Math.floor(rnd() * flowerColors.length)],
    });
  }

  // Grass is derived from the outer QR modules, so the terrain remains the source.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      const isEdge = r < 2 || c < 2 || r >= n - 2 || c >= n - 2;
      if (!isEdge || rnd() > 0.28) continue;
      grass.push({
        x: (c - mid) * cell,
        z: (r - mid) * cell,
        scale: 0.18 + rnd() * 0.18,
        rotation: rnd() * Math.PI,
      });
    }
  }

  return { segments, leaves, blooms, grass, cell };
}

function seasonFlowers(theme: SeasonTheme) {
  if (theme.name === "spring") return ["#f3b8cc", "#ffc8d9", "#f7adc5"];
  if (theme.name === "autumn") return ["#e0a83c", "#e6c34a", "#d97b29"];
  return ["#f4df8a", "#dceaa5", "#f0c97a"];
}

function QRBase({ matrix, theme, progressRef }: {
  matrix: boolean[][];
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = matrix.length;
  const cell = 0.46;
  const mid = (n - 1) / 2;

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    const terrain = phase(p, 0.1, 0.88);
    const qrDark = theme.qrDarkPalette[2] || "#4c9838";
    const qrLight = theme.qrLightPalette[1] || "#e7dfcf";

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const dark = matrix[r][c];
        const x = (c - mid) * cell;
        const z = (r - mid) * cell;
        const h = lerp(0.055, dark ? 0.46 : 0.085, terrain);
        const width = cell * lerp(0.99, 0.94, terrain);

        TMP.position.set(x, h * 0.5, z);
        TMP.scale.set(width, h, width);
        TMP.rotation.set(0, 0, 0);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);

        const target = dark
          ? mixHex(qrDark, theme.grassColors[1] || "#69c73d", terrain)
          : mixHex(qrLight, theme.stoneTileColors[1] || "#e1dac9", terrain);
        COLOR.set(target);
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

function Branches({ branches, theme, progressRef }: {
  branches: Branch[];
  theme: SeasonTheme;
  progressRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const grow = phase(progressRef.current, 0.18, 0.76);
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i];
      A.set(branch.start[0] * grow, branch.start[1] * grow, branch.start[2] * grow);
      B.set(branch.end[0] * grow, branch.end[1] * grow, branch.end[2] * grow);
      DIR.copy(B).sub(A);
      const length = DIR.length();
      if (length < 0.002) {
        TMP.scale.set(0, 0, 0);
        TMP.updateMatrix();
        mesh.setMatrixAt(i, TMP.matrix);
        continue;
      }
      DIR.normalize();
      Q.setFromUnitVectors(UP, DIR);
      TMP.position.copy(A).add(B).multiplyScalar(0.5);
      TMP.quaternion.copy(Q);
      const taper = branch.depth === 0 ? 1 : branch.depth === 1 ? 0.78 : 0.55;
      TMP.scale.set(branch.radius * taper, length, branch.radius * taper);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, branches.length]} castShadow receiveShadow>
      <cylinderGeometry args={[0.72, 1, 1, 7]} />
      <meshStandardMaterial color={theme.trunkColor} roughness={0.76} metalness={0.01} />
    </instancedMesh>
  );
}

function Leaves({ leaves, progressRef }: { leaves: Leaf[]; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    leaves.forEach((leaf, i) => {
      COLOR.set(leaf.color);
      ref.current!.setColorAt(i, COLOR);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [leaves]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const grow = phase(progressRef.current, 0.34, 0.94);
    const time = state.clock.elapsedTime;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const flutter = Math.sin(time * 1.25 + leaf.position[0] * 2.4 + leaf.position[2]) * 0.035;
      TMP.position.set(leaf.position[0] * grow, leaf.position[1] * grow, leaf.position[2] * grow);
      TMP.rotation.set(leaf.rotation[0] + flutter, leaf.rotation[1] + time * 0.01, leaf.rotation[2]);
      TMP.scale.setScalar(leaf.scale * grow * (1 + flutter));
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, leaves.length]} castShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.62} metalness={0} flatShading />
    </instancedMesh>
  );
}

function Blooms({ blooms, progressRef }: { blooms: Bloom[]; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    blooms.forEach((b, i) => {
      COLOR.set(b.color);
      ref.current!.setColorAt(i, COLOR);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [blooms]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const grow = phase(progressRef.current, 0.56, 0.96);
    blooms.forEach((b, i) => {
      TMP2.position.set(b.position[0] * grow, b.position[1] * grow, b.position[2] * grow);
      TMP2.scale.setScalar(b.scale * grow);
      TMP2.rotation.set(Math.PI * 0.5, 0, 0);
      TMP2.updateMatrix();
      mesh.setMatrixAt(i, TMP2.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, blooms.length]}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.35} metalness={0.02} />
    </instancedMesh>
  );
}

function Grass({ grass, theme, progressRef }: { grass: Grass[]; theme: SeasonTheme; progressRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    grass.forEach((_, i) => {
      COLOR.set(theme.grassColors[i % theme.grassColors.length]);
      ref.current!.setColorAt(i, COLOR);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [grass, theme]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const grow = phase(progressRef.current, 0.36, 0.8);
    const time = state.clock.elapsedTime;
    grass.forEach((g, i) => {
      const sway = Math.sin(time * 2.3 + g.x * 1.4 + g.z * 1.7) * 0.12 * grow;
      TMP.position.set(g.x, g.scale * 0.45 * grow, g.z);
      TMP.rotation.set(sway, g.rotation, sway * 0.5);
      TMP.scale.set(g.scale * 0.5, g.scale * grow, g.scale * 0.5);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!grass.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, grass.length]}>
      <coneGeometry args={[0.16, 1, 4]} />
      <meshStandardMaterial roughness={0.72} flatShading />
    </instancedMesh>
  );
}

function CameraRig({ progressRef, gridSize, cellSize, userAngleRef }: {
  progressRef: React.MutableRefObject<number>;
  gridSize: number;
  cellSize: number;
  userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const { camera, size } = useThree();
  const span = gridSize * cellSize;

  useFrame((state) => {
    const p = smooth(progressRef.current);
    const aspect = size.width / Math.max(1, size.height);
    const fov = (38 * Math.PI) / 180;
    const qrDistance = Math.max(16, (span * 0.73) / Math.tan(fov / 2) / Math.max(0.58, aspect));
    const user = userAngleRef.current;
    const azimuth = Math.PI * 0.25 + user.azimuth;
    const elevation = clamp(0.60 + user.elevation, 0.36, 0.95);
    const treeDistance = Math.max(12.5, span * 1.22);

    const treeX = Math.sin(azimuth) * Math.cos(elevation) * treeDistance;
    const treeY = Math.sin(elevation) * treeDistance;
    const treeZ = Math.cos(azimuth) * Math.cos(elevation) * treeDistance;

    camera.position.set(
      lerp(0, treeX, p),
      lerp(qrDistance, treeY, p),
      lerp(0.001, treeZ, p),
    );
    TARGET.set(0, lerp(0, 2.05, p), 0);
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
    light.current.position.set(lerp(0, 10, p), 18, lerp(0, 12, p));
    light.current.intensity = lerp(1.2, 1.65, p);
  });

  return (
    <>
      <ambientLight color={theme.ambientColor} intensity={1.45} />
      <directionalLight ref={light} color={theme.sunColor} position={[0, 18, 0]} intensity={1.25} castShadow shadow-mapSize-width={1536} shadow-mapSize-height={1536} />
      <hemisphereLight color="#fffaf0" groundColor="#b7aa94" intensity={0.35} />
    </>
  );
}

function Scene({ matrix, url, season, isFlat, userAngleRef }: {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  userAngleRef: React.MutableRefObject<{ azimuth: number; elevation: number }>;
}) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const theme = SEASON_THEMES[season];
  const tree = useMemo(() => buildTree(matrix, url, theme), [matrix, url, theme]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    const speed = target > progressRef.current ? 1.85 : 2.25;
    progressRef.current += (target - progressRef.current) * Math.min(1, delta * speed);
    if (Math.abs(target - progressRef.current) < 0.001) progressRef.current = target;
  });

  return (
    <>
      <Lighting theme={theme} progressRef={progressRef} />
      <CameraRig progressRef={progressRef} gridSize={matrix.length} cellSize={tree.cell} userAngleRef={userAngleRef} />
      <QRBase matrix={matrix} theme={theme} progressRef={progressRef} />
      <Branches branches={tree.segments} theme={theme} progressRef={progressRef} />
      <Leaves leaves={tree.leaves} progressRef={progressRef} />
      <Blooms blooms={tree.blooms} progressRef={progressRef} />
      <Grass grass={tree.grass} theme={theme} progressRef={progressRef} />
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
      userAngleRef.current.azimuth += dx * 0.0045;
      userAngleRef.current.elevation = clamp(userAngleRef.current.elevation - dy * 0.004, -0.2, 0.34);
      drag.startX = e.clientX;
      drag.startY = e.clientY;
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag && !drag.moved) onToggleFlat();
    dragRef.current = null;
  };

  const bg = SEASON_THEMES[season].bgColor;

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
        camera={{ fov: 38, near: 0.1, far: 160, position: [0, 20, 0.001] }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        shadows
        style={{ background: bg }}
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, 38, 90]} />
        <Scene matrix={matrix} url={url} season={season} isFlat={isFlat} userAngleRef={userAngleRef} />
      </Canvas>
    </div>
  );
}

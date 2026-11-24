"use client";

import React, {
  MutableRefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { appleRubberband } from "@/lib/motion";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { clamp, lerp } from "./hashNoise";
import {
  generateSceneData,
  type TreeSegment,
  type LeafParticle,
  type FlowerParticle,
  type CanopyBlob,
  type TerrainTile,
  type GrassBlade,
} from "./treeGenerator";

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const TARGET_COLOR = new THREE.Color();
const GROUND_BASE_COLOR = new THREE.Color("#f4ede1");
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const DIR = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Q = new THREE.Quaternion();
const TARGET = new THREE.Vector3();

const MIN_ELEV = -0.25;
const MAX_ELEV = 0.35;
const ELEV_RUBBER_DIM = 0.22;
const SPRING_RESPONSE = 0.58;
const SPRING_OMEGA = (2 * Math.PI) / SPRING_RESPONSE;

interface UserAngleState {
  azimuth: number;
  rawElevation: number;
  elevation: number;
  zoom: number;
  targetZoom: number;
  velAzimuth: number;
  velElevation: number;
  dragging: boolean;
}

function smooth(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function applyElevationRubberband(raw: number): number {
  if (raw > MAX_ELEV) {
    return MAX_ELEV + appleRubberband(raw - MAX_ELEV, ELEV_RUBBER_DIM, 0.55);
  }
  if (raw < MIN_ELEV) {
    return MIN_ELEV + appleRubberband(raw - MIN_ELEV, ELEV_RUBBER_DIM, 0.55);
  }
  return raw;
}

// Builds one irregular "lumpy blob" geometry by displacing every vertex of
// an icosahedron outward/inward by a deterministic pseudo-random amount.
function makeLumpyGeometry(
  detail: number,
  jitterMin: number,
  jitterMax: number,
  seedOffset: number
) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const h = Math.abs(Math.sin((i + seedOffset) * 12.9898) * 43758.5453) % 1;
    const jitter = jitterMin + h * (jitterMax - jitterMin);
    v.copy(n).multiplyScalar(jitter);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function phase(t: number, start: number, end: number) {
  return smooth((t - start) / Math.max(0.0001, end - start));
}

// ---------------------------------------------------------------------------
// 0. Smooth Season Background & Fog Lerp
// ---------------------------------------------------------------------------
function SeasonBackdrop({
  bgColor,
  reducedMotion,
}: {
  bgColor: string;
  reducedMotion: boolean;
}) {
  const [initialBg] = useState(bgColor);
  const bgRef = useRef<THREE.Color>(null);
  const fogRef = useRef<THREE.Fog>(null);
  const targetRef = useRef(new THREE.Color(bgColor));

  useEffect(() => {
    targetRef.current.set(bgColor);
    if (reducedMotion) {
      bgRef.current?.copy(targetRef.current);
      fogRef.current?.color.copy(targetRef.current);
    }
  }, [bgColor, reducedMotion]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    const bg = bgRef.current;
    if (!bg) return;
    const target = targetRef.current;
    const dr = Math.abs(bg.r - target.r);
    const dg = Math.abs(bg.g - target.g);
    const db = Math.abs(bg.b - target.b);
    if (dr < 0.0008 && dg < 0.0008 && db < 0.0008) {
      if (dr > 0 || dg > 0 || db > 0) {
        bg.copy(target);
        fogRef.current?.color.copy(target);
      }
      return;
    }
    const dt = Math.min(delta, 0.05);
    const alpha = 1 - Math.exp(-8 * dt);
    bg.lerp(target, alpha);
    fogRef.current?.color.copy(bg);
  });

  return (
    <>
      <color ref={bgRef} attach="background" args={[initialBg]} />
      <fog ref={fogRef} attach="fog" args={[initialBg, 45, 110]} />
    </>
  );
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
  const lastProgressRef = useRef(-1);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
  }, [theme, size]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    if (Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    const qrMorph = phase(p, 0.1, 0.7);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    TARGET_COLOR.set(theme.stoneTileColors[1] || "#e4ddcc");
    mat.color.copy(GROUND_BASE_COLOR).lerp(TARGET_COLOR, qrMorph);
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
  const lastProgressRef = useRef(-1);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
  }, [tiles, theme, cellSize]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = progressRef.current;
    if (Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    const qrMorph = phase(p, 0.1, 0.7);
    const lightTarget = theme.stoneTileColors[0] || "#ede7d8";

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

      // 100% color convergence to clean garden paving tiles (zero allocations)
      COLOR.set(tile.qrColor);
      TARGET_COLOR.set(tile.isDark ? tile.stoneColor : lightTarget);
      COLOR.lerp(TARGET_COLOR, qrMorph);

      // Organic subtle stone variation to give natural texture
      const tint = 1 + (tile.variation - 0.5) * 0.06 * qrMorph;
      COLOR.multiplyScalar(tint);

      mesh.setColorAt(i, COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      key={tiles.length}
      ref={ref}
      args={[undefined, undefined, tiles.length]}
      receiveShadow
    >
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
  const lastProgressRef = useRef(-1);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
  }, [segments, theme]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const p = progressRef.current;
    if (Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    if (phase(p, 0.05, 0.85) < 0.001) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

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
    <instancedMesh
      key={segments.length}
      ref={ref}
      args={[undefined, undefined, segments.length]}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[0.82, 1.18, 1, 8]} />
      <meshStandardMaterial color={theme.trunkColor} roughness={0.82} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 4. Canopy Silhouette Base Blobs
// ---------------------------------------------------------------------------
function CanopyBlobs({
  blobs,
  progressRef,
  reducedMotion,
}: {
  blobs: CanopyBlob[];
  progressRef: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lastProgressRef = useRef(-1);
  const blobGeometry = useMemo(() => makeLumpyGeometry(1, 0.62, 1.22, 99), []);

  useEffect(() => {
    return () => {
      blobGeometry.dispose();
    };
  }, [blobGeometry]);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
    const mesh = ref.current;
    if (!mesh || blobs.length === 0) return;
    for (let i = 0; i < blobs.length; i++) {
      COLOR.set(blobs[i].colorHex);
      mesh.setColorAt(i, COLOR);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [blobs]);

  useEffect(() => {
    lastProgressRef.current = -1;
  }, [reducedMotion]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || blobs.length === 0) return;

    const p = progressRef.current;
    const tree = phase(p, 0.18, 0.85);
    if (tree < 0.001) {
      mesh.visible = false;
      lastProgressRef.current = p;
      return;
    }
    mesh.visible = true;

    if (reducedMotion && Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    const time = reducedMotion ? 0 : state.clock.elapsedTime;

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const sway = reducedMotion ? 0 : Math.sin(time * 0.85 + i * 0.4) * 0.015 * tree;

      const currX = lerp(b.qrX, b.x, tree);
      const currY = lerp(0.04, b.y, tree);
      const currZ = lerp(b.qrZ, b.z, tree);

      DUMMY.position.set(currX, currY, currZ);
      DUMMY.rotation.set(0, reducedMotion ? i : time * 0.04 + i, 0);
      const scale = b.radius * tree * (0.96 + sway);
      DUMMY.scale.set(scale, scale * 0.88, scale);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (blobs.length === 0) return null;

  return (
    <instancedMesh
      key={blobs.length}
      ref={ref}
      args={[undefined, undefined, blobs.length]}
      castShadow
      receiveShadow
    >
      <primitive object={blobGeometry} attach="geometry" />
      <meshStandardMaterial roughness={0.7} flatShading />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 5. Fibonacci Surface Leaves
// ---------------------------------------------------------------------------
function Leaves({
  leaves,
  progressRef,
  reducedMotion,
}: {
  leaves: LeafParticle[];
  progressRef: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lastProgressRef = useRef(-1);
  const leafGeometry = useMemo(() => makeLumpyGeometry(1, 0.72, 1.18, 1), []);

  useEffect(() => {
    return () => {
      leafGeometry.dispose();
    };
  }, [leafGeometry]);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
    const mesh = ref.current;
    if (!mesh || leaves.length === 0) return;
    for (let i = 0; i < leaves.length; i++) {
      COLOR.set(leaves[i].colorHex);
      const variance = 0.85 + (((i * 92837 + 17) % 233) / 233) * 0.3;
      COLOR.multiplyScalar(variance);
      mesh.setColorAt(i, COLOR);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [leaves]);

  useEffect(() => {
    lastProgressRef.current = -1;
  }, [reducedMotion]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;

    const p = progressRef.current;
    const tree = phase(p, 0.15, 0.92);
    if (tree < 0.001) {
      mesh.visible = false;
      lastProgressRef.current = p;
      return;
    }
    mesh.visible = true;

    if (reducedMotion && Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    const time = reducedMotion ? 0 : state.clock.elapsedTime;

    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i];
      const swayX = reducedMotion ? 0 : Math.sin(time * 1.2 + i * 0.15) * 0.02 * tree;
      const swayY = reducedMotion ? 0 : Math.cos(time * 1.05 + i * 0.12) * 0.015 * tree;

      const currX = lerp(l.qrX, l.x, tree) + swayX;
      const currY = lerp(0.04, l.y, tree) + swayY;
      const currZ = lerp(l.qrZ, l.z, tree);

      DUMMY.position.set(currX, currY, currZ);
      DUMMY.rotation.set(l.rotX, reducedMotion ? l.rotY : l.rotY + time * 0.15 * tree, l.rotZ);

      const s = l.scale * (0.2 + 0.8 * tree);
      const jx = 0.8 + (((i * 15731) % 211) / 211) * 0.5;
      const jz = 0.8 + (((i * 42391 + 7) % 197) / 197) * 0.5;
      DUMMY.scale.set(s * jx, s * 0.58, s * jz);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      key={leaves.length}
      ref={ref}
      args={[undefined, undefined, leaves.length]}
      castShadow
      receiveShadow
    >
      <primitive object={leafGeometry} attach="geometry" />
      <meshStandardMaterial roughness={0.45} flatShading />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 6. Flower Blossoms
// ---------------------------------------------------------------------------
function Flowers({
  flowers,
  progressRef,
  reducedMotion,
}: {
  flowers: FlowerParticle[];
  progressRef: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lastProgressRef = useRef(-1);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
    const mesh = ref.current;
    if (!mesh || flowers.length === 0) return;
    for (let i = 0; i < flowers.length; i++) {
      COLOR.set(flowers[i].colorHex);
      mesh.setColorAt(i, COLOR);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [flowers]);

  useEffect(() => {
    lastProgressRef.current = -1;
  }, [reducedMotion]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || flowers.length === 0) return;

    const p = progressRef.current;
    const tree = phase(p, 0.3, 0.95);
    if (tree < 0.001) {
      mesh.visible = false;
      lastProgressRef.current = p;
      return;
    }
    mesh.visible = true;

    if (reducedMotion && Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    const time = reducedMotion ? 0 : state.clock.elapsedTime;

    for (let i = 0; i < flowers.length; i++) {
      const f = flowers[i];
      const currX = lerp(f.qrX, f.x, tree);
      const currY = lerp(0.04, f.y, tree) + (reducedMotion ? 0 : Math.sin(time + i) * 0.01 * tree);
      const currZ = lerp(f.qrZ, f.z, tree);

      DUMMY.position.set(currX, currY, currZ);
      DUMMY.rotation.set(0, reducedMotion ? i : time * 0.3 + i, 0);
      const s = f.scale * tree;
      DUMMY.scale.setScalar(s);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (flowers.length === 0) return null;

  return (
    <instancedMesh
      key={flowers.length}
      ref={ref}
      args={[undefined, undefined, flowers.length]}
      castShadow
      receiveShadow
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.48} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 7. Grass Tufts (persist at platform corners in both QR and Tree views)
// ---------------------------------------------------------------------------
function Grass({
  blades,
  progressRef,
  reducedMotion,
}: {
  blades: GrassBlade[];
  progressRef: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lastProgressRef = useRef(-1);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
    const mesh = ref.current;
    if (!mesh || blades.length === 0) return;
    for (let i = 0; i < blades.length; i++) {
      COLOR.set(blades[i].colorHex);
      mesh.setColorAt(i, COLOR);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [blades]);

  useEffect(() => {
    lastProgressRef.current = -1;
  }, [reducedMotion]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || blades.length === 0) return;

    const p = progressRef.current;
    if (reducedMotion && Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

    const treeGrow = phase(p, 0.2, 0.85);
    const grow = lerp(0.62, 1, treeGrow);
    const time = reducedMotion ? 0 : state.clock.elapsedTime;

    for (let i = 0; i < blades.length; i++) {
      const g = blades[i];
      const sway = reducedMotion ? 0 : Math.sin(time * 1.4 + i) * 0.06 * grow;

      DUMMY.position.set(g.x, 0.001, g.z);
      DUMMY.rotation.set(g.tilt + sway, g.rotY, 0);
      const s = g.scale * grow;
      DUMMY.scale.set(s * 0.5, s, s * 0.5);
      DUMMY.updateMatrix();

      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (blades.length === 0) return null;

  return (
    <instancedMesh
      key={blades.length}
      ref={ref}
      args={[undefined, undefined, blades.length]}
      castShadow
      receiveShadow
    >
      <coneGeometry args={[1, 1, 4]} />
      <meshStandardMaterial roughness={0.75} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// 8. Atmosphere Falling Particles (Anchored tightly to Canopy)
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
  const particlesRef = useRef<
    Array<{
      x: number;
      y: number;
      z: number;
      speed: number;
      rotSpeed: number;
      scale: number;
    }>
  >([]);

  useEffect(() => {
    particlesRef.current = Array.from({ length: count }, () => ({
      x: canopyCenter.x + (Math.random() - 0.5) * spread,
      y: canopyCenter.y + Math.random() * 1.3,
      z: canopyCenter.z + (Math.random() - 0.5) * spread,
      speed: 0.5 + Math.random() * 0.6,
      rotSpeed: (Math.random() - 0.5) * 2,
      scale: theme.rainMode ? 0.03 : 0.055 + Math.random() * 0.035,
    }));
  }, [theme.rainMode, canopyCenter.x, canopyCenter.y, canopyCenter.z, spread]);

  useFrame((state, delta) => {
    const mesh = ref.current;
    const particles = particlesRef.current;
    if (!mesh || particles.length === 0) return;
    const tree = phase(progressRef.current, 0.4, 0.95);
    if (tree < 0.01) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const time = state.clock.elapsedTime;
    const step = Math.min(delta, 0.05) * 60;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.y -= p.speed * 0.014 * (theme.rainMode ? 2.4 : 1.0) * step;
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
// 9. Camera Rig (Isometric Perspective, Inertial Orbit & Smooth Wheel Zoom)
// ---------------------------------------------------------------------------
function CameraRig({
  progressRef,
  platformSize,
  canopyCenter,
  userAngleRef,
  reducedMotion,
}: {
  progressRef: MutableRefObject<number>;
  platformSize: number;
  canopyCenter: { x: number; y: number; z: number };
  userAngleRef: MutableRefObject<UserAngleState>;
  reducedMotion: boolean;
}) {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (size.height > 480) {
      camera.setViewOffset(size.width, size.height, 0, 72, size.width, size.height);
    } else {
      camera.clearViewOffset();
    }
    return () => {
      camera.clearViewOffset();
    };
  }, [camera, size.width, size.height]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const p = progressRef.current;
    const user = userAngleRef.current;

    // Smooth wheel zoom toward targetZoom
    if (reducedMotion) {
      user.zoom = user.targetZoom;
    } else if (Math.abs(user.zoom - user.targetZoom) > 0.0004) {
      user.zoom = lerp(user.zoom, user.targetZoom, 1 - Math.exp(-10 * dt));
    } else {
      user.zoom = user.targetZoom;
    }

    // Post-drag inertial decay & rubberband elevation return
    if (!user.dragging) {
      if (!reducedMotion && p >= 0.2) {
        if (Math.abs(user.velAzimuth) > 0.002) {
          user.azimuth += user.velAzimuth * dt;
          user.velAzimuth *= Math.exp(-6 * dt);
        } else {
          user.velAzimuth = 0;
        }
        if (Math.abs(user.velElevation) > 0.002) {
          user.rawElevation = clamp(
            user.rawElevation + user.velElevation * dt,
            MIN_ELEV - 0.3,
            MAX_ELEV + 0.3
          );
          user.velElevation *= Math.exp(-6 * dt);
        } else {
          user.velElevation = 0;
        }
      } else {
        user.velAzimuth = 0;
        user.velElevation = 0;
      }

      const clampedEl = clamp(user.rawElevation, MIN_ELEV, MAX_ELEV);
      if (user.rawElevation !== clampedEl) {
        if (reducedMotion) {
          user.rawElevation = clampedEl;
        } else {
          user.rawElevation = lerp(user.rawElevation, clampedEl, 1 - Math.exp(-12 * dt));
          if (Math.abs(user.rawElevation - clampedEl) < 0.0005) {
            user.rawElevation = clampedEl;
          }
        }
        user.velElevation = 0;
      }
      user.elevation = applyElevationRubberband(user.rawElevation);
    }

    const aspect = size.width / Math.max(1, size.height);
    const effectiveAspect = Math.min(1, Math.max(0.6, aspect));
    const fov = (35 * Math.PI) / 180;

    // Top-down distance so QR code fits cleanly above the floating bottom control bar
    const qrDistance = Math.max(
      20,
      ((platformSize * 0.85) / Math.tan(fov / 2) / effectiveAspect) * 1.48
    );

    // 3D Tree distance so entire tree crown and ground platform are framed
    const baseTreeDist = Math.max(
      19,
      ((platformSize * 0.85) / Math.tan(fov / 2) / effectiveAspect) * 1.38
    );
    const treeDistance = baseTreeDist * user.zoom;

    const azimuth = Math.PI * 0.25 + user.azimuth;
    const elevation = clamp(0.58 + user.elevation, 0.14, 1.25);

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
// 10. Lighting
// ---------------------------------------------------------------------------
function Lighting({
  theme,
  progressRef,
}: {
  theme: SeasonTheme;
  progressRef: MutableRefObject<number>;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const lastProgressRef = useRef(-1);

  useLayoutEffect(() => {
    lastProgressRef.current = -1;
  }, [theme]);

  useFrame(() => {
    if (!light.current) return;
    const p = progressRef.current;
    if (Math.abs(p - lastProgressRef.current) < 1e-5) return;
    lastProgressRef.current = p;

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
// 11. Main 3D Scene Controller
// ---------------------------------------------------------------------------
function Scene({
  matrix,
  url,
  season,
  isFlat,
  reducedMotion,
  progressRef,
  userAngleRef,
}: {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  reducedMotion: boolean;
  progressRef: MutableRefObject<number>;
  userAngleRef: MutableRefObject<UserAngleState>;
}) {
  const velocityRef = useRef(0);
  const prevUrlRef = useRef(url);
  const theme = SEASON_THEMES[season];

  const sceneData = useMemo(() => generateSceneData(matrix, url, season), [matrix, url, season]);

  // Gently bloom new QR URL when already settled in 3D view
  useEffect(() => {
    if (prevUrlRef.current !== url) {
      prevUrlRef.current = url;
      if (!isFlat && !reducedMotion && progressRef.current > 0.2) {
        progressRef.current = 0.08;
        velocityRef.current = 0;
      }
    }
  }, [url, isFlat, reducedMotion, progressRef]);

  useFrame((_, delta) => {
    const target = isFlat ? 0 : 1;
    if (reducedMotion) {
      progressRef.current = target;
      velocityRef.current = 0;
      return;
    }

    const x0 = progressRef.current - target;
    const v0 = velocityRef.current;
    if (Math.abs(x0) < 0.001 && Math.abs(v0) < 0.001) {
      progressRef.current = target;
      velocityRef.current = 0;
      return;
    }

    // Exact frame-rate-independent critically-damped spring (zeta = 1, response = 0.58s)
    const dt = Math.min(delta, 0.05);
    const exp = Math.exp(-SPRING_OMEGA * dt);
    const c1 = x0;
    const c2 = v0 + SPRING_OMEGA * x0;
    const nextX = (c1 + c2 * dt) * exp;
    const nextV = (c2 - SPRING_OMEGA * (c1 + c2 * dt)) * exp;

    if (Math.abs(nextX) < 0.001 && Math.abs(nextV) < 0.001) {
      progressRef.current = target;
      velocityRef.current = 0;
    } else {
      progressRef.current = clamp(target + nextX, 0, 1);
      velocityRef.current = nextV;
    }
  });

  return (
    <>
      <SeasonBackdrop bgColor={theme.bgColor} reducedMotion={reducedMotion} />
      <Lighting theme={theme} progressRef={progressRef} />
      <CameraRig
        progressRef={progressRef}
        platformSize={sceneData.platformSize}
        canopyCenter={sceneData.tree.canopyCenter}
        userAngleRef={userAngleRef}
        reducedMotion={reducedMotion}
      />
      <Ground size={sceneData.platformSize} theme={theme} progressRef={progressRef} />
      <QRTiles
        tiles={sceneData.tiles}
        theme={theme}
        progressRef={progressRef}
        cellSize={sceneData.cellSize}
      />
      <Branches segments={sceneData.tree.segments} theme={theme} progressRef={progressRef} />
      <CanopyBlobs
        blobs={sceneData.tree.canopyBlobs}
        progressRef={progressRef}
        reducedMotion={reducedMotion}
      />
      <Leaves
        leaves={sceneData.tree.leaves}
        progressRef={progressRef}
        reducedMotion={reducedMotion}
      />
      <Flowers
        flowers={sceneData.tree.flowers}
        progressRef={progressRef}
        reducedMotion={reducedMotion}
      />
      <Grass
        blades={sceneData.grass}
        progressRef={progressRef}
        reducedMotion={reducedMotion}
      />
      {!reducedMotion && (
        <AtmosphereParticles
          theme={theme}
          progressRef={progressRef}
          canopyCenter={sceneData.tree.canopyCenter}
          spread={sceneData.tree.canopyRadius * 1.6}
        />
      )}
    </>
  );
}

export interface QRTreeSceneProps {
  matrix: boolean[][];
  url: string;
  season: Season;
  isFlat: boolean;
  reducedMotion?: boolean;
  onToggleFlat: () => void;
  onReady?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function QRTreeScene({
  matrix,
  url,
  season,
  isFlat,
  reducedMotion = false,
  onToggleFlat,
  onReady,
  className,
  style,
}: QRTreeSceneProps) {
  const progressRef = useRef(isFlat ? 0 : 1);
  const [isDragging, setIsDragging] = useState(false);
  const userAngleRef = useRef<UserAngleState>({
    azimuth: 0,
    rawElevation: 0,
    elevation: 0,
    zoom: 1.0,
    targetZoom: 1.0,
    velAzimuth: 0,
    velElevation: 0,
    dragging: false,
  });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    userAngleRef.current.velAzimuth = 0;
    userAngleRef.current.velElevation = 0;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastTime: performance.now(),
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 8) return;
      d.moved = true;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastTime = performance.now();
      if (progressRef.current >= 0.2) {
        userAngleRef.current.dragging = true;
        setIsDragging(true);
      }
      return;
    }

    const now = performance.now();
    // Ignore orbit accumulation while settled in 2D flat mode
    if (progressRef.current < 0.2) {
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastTime = now;
      return;
    }

    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    const dt = Math.max(0.004, (now - d.lastTime) / 1000);
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastTime = now;

    const user = userAngleRef.current;
    user.dragging = true;
    const dAzimuth = dx * 0.004;
    const dElevation = -dy * 0.0032;

    user.azimuth += dAzimuth;
    user.rawElevation = clamp(user.rawElevation + dElevation, MIN_ELEV - 0.38, MAX_ELEV + 0.38);
    user.elevation = applyElevationRubberband(user.rawElevation);

    if (!reducedMotion) {
      const instVelAz = clamp(dAzimuth / dt, -6, 6);
      const instVelEl = clamp(dElevation / dt, -4, 4);
      user.velAzimuth = lerp(user.velAzimuth, instVelAz, 0.35);
      user.velElevation = lerp(user.velElevation, instVelEl, 0.35);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const user = userAngleRef.current;
    user.dragging = false;

    if (cancelled) {
      user.velAzimuth = 0;
      user.velElevation = 0;
    } else if (!d.moved) {
      onToggleFlat();
    } else if (reducedMotion || performance.now() - d.lastTime > 80) {
      user.velAzimuth = 0;
      user.velElevation = 0;
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (progressRef.current < 0.2) return;
    userAngleRef.current.targetZoom = clamp(
      userAngleRef.current.targetZoom + e.deltaY * 0.001,
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
        cursor: isFlat ? "pointer" : isDragging ? "grabbing" : "grab",
        touchAction: "none",
        ...style,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishDrag(e, false)}
      onPointerCancel={(e) => finishDrag(e, true)}
      onWheel={onWheel}
    >
      <Canvas
        camera={{ fov: 35, near: 0.1, far: 200, position: [0, 22, 0.001] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        shadows
        onCreated={() => {
          onReady?.();
        }}
      >
        <Scene
          matrix={matrix}
          url={url}
          season={season}
          isFlat={isFlat}
          reducedMotion={reducedMotion}
          progressRef={progressRef}
          userAngleRef={userAngleRef}
        />
      </Canvas>
    </div>
  );
}

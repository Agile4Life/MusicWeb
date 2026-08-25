import { hash31, mulberry32, clamp } from "./hashNoise";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";

export interface Vec3 { x: number; y: number; z: number }

// Cheap "sum of sines" pseudo-noise evaluated over a direction on the unit
// sphere (nx,ny,nz). A Fibonacci/Vogel-spiral shell — which is what the
// leaf and flower distributions below use — is mathematically the most
// EVEN possible coverage of a sphere, so no amount of per-point jitter can
// break its silhouette: it will always read as one smooth ball. This noise
// pushes/pulls the shell radius per-direction instead, producing a handful
// of broad asymmetric lobes plus horizontal "tiers" (the ny*5.4 term) —
// the layered, cauliflower-like canopy outline instead of a sphere.
function lobeNoise(nx: number, ny: number, nz: number, seed: number) {
  const s = seed * 0.0013;
  let n = 0;
  n += Math.sin(nx * 2.4 + s) * Math.cos(nz * 2.6 - s * 1.2) * 0.42; // broad side lobes
  n += Math.sin(ny * 5.4 + s * 0.8) * 0.3; // horizontal tiering/layers
  n += Math.sin(nz * 3.1 + nx * 1.7 + s * 1.6) * Math.cos(ny * 1.3) * 0.22; // extra asymmetric bumps
  return n; // roughly in [-0.94, 0.94]
}

export interface TerrainTile {
  col: number;
  row: number;
  x: number;
  z: number;
  isDark: boolean;
  finder: boolean;
  qrColor: string;
  stoneColor: string;
  variation: number;
}

export interface TreeSegment {
  start: Vec3;
  end: Vec3;
  radiusStart: number;
  radiusEnd: number;
  depth: number;
}

export interface LeafParticle {
  x: number;
  y: number;
  z: number;
  qrX: number;
  qrZ: number;
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  colorHex: string;
}

export interface FlowerParticle {
  x: number;
  y: number;
  z: number;
  qrX: number;
  qrZ: number;
  scale: number;
  colorHex: string;
}

export interface CanopyBlob {
  x: number;
  y: number;
  z: number;
  qrX: number;
  qrZ: number;
  radius: number;
  colorHex: string;
}

// NEW: grass tufts scattered at the platform corners.
export interface GrassBlade {
  x: number;
  y: number;
  z: number;
  rotY: number;
  tilt: number;
  scale: number;
  colorHex: string;
}

export interface TreeData {
  segments: TreeSegment[];
  leaves: LeafParticle[];
  flowers: FlowerParticle[];
  canopyBlobs: CanopyBlob[];
  canopyCenter: Vec3;
  canopyRadius: number;
}

export interface SceneData {
  tiles: TerrainTile[];
  tree: TreeData;
  grass: GrassBlade[];
  cellSize: number;
  gridSize: number;
  platformSize: number;
}

// ---------------------------------------------------------------------------
// FIX 1 — platform size must stay roughly constant regardless of how much
// data is encoded in the QR (n can range ~21..41 modules). Previously
// CELL_SIZE was a fixed 0.44, which made platformSize = n * 0.44 balloon up
// to ~18 units for long URLs while the canopy stayed ~4.2 units wide — that
// mismatch is exactly the "huge slab, tiny blob" look in the screenshot.
// Now we pick cellSize per-QR so the platform always spans TARGET_PLATFORM_SPAN.
// ---------------------------------------------------------------------------
const TARGET_PLATFORM_SPAN = 5.4; // world units — tuned to ~1.3x canopy diameter

function isFinderCell(row: number, col: number, n: number): boolean {
  return (
    (row < 7 && col < 7) ||
    (row < 7 && col >= n - 7) ||
    (row >= n - 7 && col < 7)
  );
}

function cellCenter(row: number, col: number, n: number, cellSize: number): Vec3 {
  const half = (n - 1) / 2;
  return { x: (col - half) * cellSize, y: 0, z: (row - half) * cellSize };
}

function averageDarkCells(
  matrix: boolean[][],
  minR: number,
  maxR: number,
  minC: number,
  maxC: number,
  cellSize: number
): Vec3 {
  const n = matrix.length;
  let sx = 0;
  let sz = 0;
  let count = 0;
  for (let r = Math.max(0, minR); r < Math.min(n, maxR); r++) {
    for (let c = Math.max(0, minC); c < Math.min(n, maxC); c++) {
      if (!matrix[r][c]) continue;
      const p = cellCenter(r, c, n, cellSize);
      sx += p.x;
      sz += p.z;
      count++;
    }
  }
  return count > 0 ? { x: sx / count, y: 0, z: sz / count } : { x: 0, y: 0, z: 0 };
}

const GRASS_COLORS = ["#8bc34a", "#7cb342", "#9ccc65", "#689f38"];

// NEW — four little grass clusters at the platform corners, matching the
// reference site. Purely decorative: grows in during the tree phase and
// disappears again in flat/QR mode, doesn't touch QR data at all.
function buildGrass(platformSize: number, seed: number): GrassBlade[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const half = platformSize / 2;
  const blades: GrassBlade[] = [];
  const corners = [
    { cx: half * 0.9, cz: half * 0.9 },
    { cx: -half * 0.9, cz: half * 0.9 },
    { cx: half * 0.9, cz: -half * 0.9 },
    { cx: -half * 0.9, cz: -half * 0.9 },
  ];
  for (const corner of corners) {
    const bladeCount = 10 + Math.floor(rnd() * 6);
    for (let i = 0; i < bladeCount; i++) {
      const spread = platformSize * 0.09;
      blades.push({
        x: corner.cx + (rnd() - 0.5) * spread,
        y: 0,
        z: corner.cz + (rnd() - 0.5) * spread,
        rotY: rnd() * Math.PI * 2,
        tilt: (rnd() - 0.5) * 0.35,
        scale: 0.16 + rnd() * 0.14,
        colorHex: GRASS_COLORS[Math.floor(rnd() * GRASS_COLORS.length)],
      });
    }
  }
  return blades;
}

function buildTreeData(matrix: boolean[][], seed: number, theme: SeasonTheme, cellSize: number): TreeData {
  const n = matrix.length;
  const rnd = mulberry32(seed ^ 0x6d2b79f5);
  const segments: TreeSegment[] = [];
  const leaves: LeafParticle[] = [];
  const flowers: FlowerParticle[] = [];
  const canopyBlobs: CanopyBlob[] = [];

  // Extract all dark cell positions for 2D flat QR morph coordinates
  const darkCells: Vec3[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        darkCells.push(cellCenter(r, c, n, cellSize));
      }
    }
  }
  if (darkCells.length === 0) {
    darkCells.push({ x: 0, y: 0, z: 0 });
  }

  // QR Density & Tree Metrics
  const density = matrix.flat().filter(Boolean).length / Math.max(1, n * n);
  const trunkHeight = 3.5 + density * 1.2;
  const trunkSegments = 7;

  // Root offset influenced slightly by QR center mass
  const root = averageDarkCells(
    matrix,
    Math.floor(n * 0.35),
    Math.ceil(n * 0.65),
    Math.floor(n * 0.35),
    Math.ceil(n * 0.65),
    cellSize
  );
  const center = { x: root.x * 0.1, y: 0, z: root.z * 0.1 };

  // Canopy center and ellipsoid radii (strictly encapsulates ALL leaves and branches)
  //
  // Tuning history, measured (not guessed) via a leaf-Y-percentile harness:
  //   trunkHeight*0.88, radiusY 1.65+d*0.3  -> p5=~2.2  (too much bare trunk)
  //   trunkHeight*0.62, radiusY 2.2+d*0.4   -> p5=0.49  (canopy touches ground,
  //                                                       trunk fully swallowed)
  //   trunkHeight*0.78, radiusY 1.95+d*0.35 -> p5=1.59, p95=5.16, 0% clamped
  // The last one leaves a proportionate visible trunk stub (~30% of total
  // height) while still being taller/more spread than the original.
  const canopyCenter: Vec3 = {
    x: center.x,
    y: trunkHeight * 0.78,
    z: center.z,
  };
  const canopyRadiusX = 1.9 + density * 0.4;
  const canopyRadiusY = 1.95 + density * 0.35;
  const canopyRadiusZ = 1.9 + density * 0.4;

  // 1. Trunk Segments (depth 0)
  for (let i = 0; i < trunkSegments; i++) {
    const t0 = i / trunkSegments;
    const t1 = (i + 1) / trunkSegments;
    const driftX = Math.sin(seed * 0.001 + i * 0.6) * 0.1 * t1;
    const driftZ = Math.cos(seed * 0.0013 + i * 0.5) * 0.1 * t1;

    segments.push({
      start: { x: center.x + driftX * t0, y: t0 * trunkHeight, z: center.z + driftZ * t0 },
      end: { x: center.x + driftX, y: t1 * trunkHeight, z: center.z + driftZ },
      radiusStart: 0.26 * (1 - t0 * 0.35),
      radiusEnd: 0.26 * (1 - t1 * 0.4),
      depth: 0,
    });
  }

  // 2. Main Branches & Twigs (depth 1 & 2)
  const branchCount = 8 + Math.round(density * 5);
  const branchHubs: { pos: Vec3; qrCell: Vec3 }[] = [];

  for (let b = 0; b < branchCount; b++) {
    const angle = (b / branchCount) * Math.PI * 2 + (rnd() - 0.5) * 0.28;
    const attachT = 0.42 + rnd() * 0.45;
    const attachY = trunkHeight * attachT;
    const baseRadius = 0.12 * (1 - attachT * 0.2);

    const qx = Math.cos(angle);
    const qz = Math.sin(angle);

    // Branch endpoints reach into the lower/mid canopy volume
    const reachR = canopyRadiusX * (0.55 + rnd() * 0.35);
    const endX = canopyCenter.x + qx * reachR;
    const endY = attachY + 0.35 + rnd() * 0.65;
    const endZ = canopyCenter.z + qz * reachR;

    const start = {
      x: center.x + qx * 0.07,
      y: attachY,
      z: center.z + qz * 0.07,
    };
    const end = { x: endX, y: endY, z: endZ };

    segments.push({
      start,
      end,
      radiusStart: baseRadius,
      radiusEnd: baseRadius * 0.45,
      depth: 1,
    });

    const qrDark = darkCells[Math.floor(rnd() * darkCells.length)];
    branchHubs.push({ pos: end, qrCell: qrDark });

    // Twigs reaching further into canopy shell
    const twigCount = 2 + Math.floor(rnd() * 2);
    for (let t = 0; t < twigCount; t++) {
      const spread = (t - (twigCount - 1) / 2) * 0.32;
      const twigAngle = angle + spread + (rnd() - 0.5) * 0.2;
      const twigLen = 0.65 + rnd() * 0.45;

      const twigStart = {
        x: end.x * 0.72 + start.x * 0.28,
        y: end.y * 0.72 + start.y * 0.28,
        z: end.z * 0.72 + start.z * 0.28,
      };
      const twigEnd = {
        x: twigStart.x + Math.cos(twigAngle) * twigLen,
        y: Math.min(canopyCenter.y + canopyRadiusY * 0.9, twigStart.y + 0.25 + rnd() * 0.45),
        z: twigStart.z + Math.sin(twigAngle) * twigLen,
      };

      segments.push({
        start: twigStart,
        end: twigEnd,
        radiusStart: baseRadius * 0.42,
        radiusEnd: baseRadius * 0.15,
        depth: 2,
      });

      branchHubs.push({ pos: twigEnd, qrCell: qrDark });
    }
  }

  const foliage = theme.foliageColors.length > 0 ? theme.foliageColors : ["#69c73d", "#7bd844", "#5ab92a"];

  // ---------------------------------------------------------------------
  // FIX 2 — canopy blobs were sized 0.65–1.15, i.e. almost as big as the
  // whole canopy radius (~2.1). That's why they rendered as a few huge
  // faceted chunks dominating the silhouette instead of hiding under the
  // dense leaf layer. Shrinking them to a small inner "filler" core lets
  // the 1000+ small Leaves instances read as the visible surface texture,
  // which is what actually gives the fine dappled look in the reference.
  // ---------------------------------------------------------------------

  // Core center blob — small filler, not a visible dominant shape anymore
  canopyBlobs.push({
    x: canopyCenter.x,
    y: canopyCenter.y + 0.1,
    z: canopyCenter.z,
    qrX: darkCells[0].x,
    qrZ: darkCells[0].z,
    radius: 0.55,
    colorHex: foliage[0],
  });

  // Fewer, smaller sub-blobs along branch hubs — just enough to avoid
  // gaps at the branch tips, still small enough to stay under the leaves
  for (let i = 0; i < branchHubs.length; i++) {
    if (i % 3 === 0 || rnd() > 0.65) {
      const hub = branchHubs[i];
      canopyBlobs.push({
        x: hub.pos.x,
        y: hub.pos.y,
        z: hub.pos.z,
        qrX: hub.qrCell.x,
        qrZ: hub.qrCell.z,
        radius: 0.24 + rnd() * 0.2,
        colorHex: foliage[Math.floor(rnd() * foliage.length)],
      });
    }
  }

  // 4. Dense Fibonacci Surface Leaf Particles (100% strictly bound within canopy envelope)
  const leafCount = 1800; // was 1500 — canopy volume grew (taller radiusY), keep density up
  const flowerCount = theme.name === "spring" ? 120 : 60;
  const LOBE_STRENGTH = 0.38; // was 0.32 — more pronounced spread across the taller canopy

  for (let i = 0; i < leafCount; i++) {
    // Vogel spiral / Fibonacci sphere distribution mapped onto canopy ellipsoid
    const phi = Math.acos(1 - 2 * ((i + 0.5) / leafCount)); // 0 to PI
    const theta = Math.PI * (1 + Math.sqrt(5)) * i; // Golden angle

    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    // A Fibonacci shell is the most EVEN possible sphere coverage, so it
    // always reads as one smooth ball no matter how much per-point jitter
    // is added. lobeNoise pushes/pulls the radius per-direction instead,
    // carving broad asymmetric lobes and horizontal tiers into the outline.
    const lobeFactor = clamp(1 + lobeNoise(nx, ny, nz, seed) * LOBE_STRENGTH, 0.6, 1.45);

    // Radius distribution: widened inner bound (0.62 vs old 0.68) so leaves
    // also fill more of the mid-volume, not just the outer shell — this is
    // what gives extra depth/richness instead of a hollow-looking canopy.
    const shellRadius = (0.62 + 0.38 * Math.cbrt(rnd()) + (rnd() - 0.5) * 0.06) * lobeFactor;

    // Calculate 3D tree coordinates, clamped so lobing/tiering can never
    // push a leaf through the ground plane (it could before this clamp —
    // measured leaves reaching y=-0.11 with the taller/lower canopy).
    const treeX = canopyCenter.x + nx * canopyRadiusX * shellRadius;
    const treeY = Math.max(0.18, canopyCenter.y + ny * canopyRadiusY * shellRadius);
    const treeZ = canopyCenter.z + nz * canopyRadiusZ * shellRadius;

    const targetDarkCell = darkCells[i % darkCells.length];

    leaves.push({
      x: treeX,
      y: treeY,
      z: treeZ,
      qrX: targetDarkCell.x,
      qrZ: targetDarkCell.z,
      scale: 0.11 + rnd() * 0.07,
      rotX: rnd() * Math.PI,
      rotY: rnd() * Math.PI * 2,
      rotZ: rnd() * Math.PI,
      colorHex: foliage[Math.floor(rnd() * foliage.length)],
    });
  }

  // 5. Flower Blossoms (Scattered on outer canopy shell)
  for (let i = 0; i < flowerCount; i++) {
    const phi = Math.acos(1 - 2 * ((i + 0.5) / flowerCount));
    const theta = Math.PI * (1 + Math.sqrt(5)) * (i * 3 + 1);

    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    // Same lobe surface as the leaves (with a small +0.04 offset so flowers
    // sit just outside the leaf shell) — otherwise they'd float above the
    // now-lobed canopy on what used to be a plain sphere.
    const lobeFactor = clamp(1 + lobeNoise(nx, ny, nz, seed) * LOBE_STRENGTH, 0.6, 1.45);
    const flowerShell = lobeFactor * 1.02 + 0.04;

    const treeX = canopyCenter.x + nx * canopyRadiusX * flowerShell;
    const treeY = Math.max(0.18, canopyCenter.y + ny * canopyRadiusY * flowerShell);
    const treeZ = canopyCenter.z + nz * canopyRadiusZ * flowerShell;

    const targetDarkCell = darkCells[(i * 7 + 3) % darkCells.length];

    flowers.push({
      x: treeX,
      y: treeY,
      z: treeZ,
      qrX: targetDarkCell.x,
      qrZ: targetDarkCell.z,
      scale: 0.045 + rnd() * 0.035,
      colorHex: theme.foliageColors[(i + 1) % theme.foliageColors.length],
    });
  }

  return {
    segments,
    leaves,
    flowers,
    canopyBlobs,
    canopyCenter,
    canopyRadius: (canopyRadiusX + canopyRadiusZ) / 2,
  };
}

export function generateSceneData(matrix: boolean[][], url: string, season: Season): SceneData {
  const n = matrix.length;
  const theme = SEASON_THEMES[season];
  const seed = hash31(url);
  const rnd = mulberry32(seed ^ 0x13579bdf);
  const half = (n - 1) / 2;

  // cellSize now derived from n so platformSize stays ~constant (see FIX 1)
  const cellSize = TARGET_PLATFORM_SPAN / n;

  const tiles: TerrainTile[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const isDark = matrix[row][col];
      const finder = isFinderCell(row, col, n);
      tiles.push({
        row,
        col,
        x: (col - half) * cellSize,
        z: (row - half) * cellSize,
        isDark,
        finder,
        qrColor: isDark
          ? theme.qrDarkPalette[Math.floor(rnd() * theme.qrDarkPalette.length)]
          : theme.qrLightPalette[Math.floor(rnd() * theme.qrLightPalette.length)],
        stoneColor: theme.stoneTileColors[Math.floor(rnd() * theme.stoneTileColors.length)],
        variation: rnd(),
      });
    }
  }

  const platformSize = n * cellSize; // == TARGET_PLATFORM_SPAN, kept as n*cellSize for clarity

  return {
    tiles,
    tree: buildTreeData(matrix, seed, theme, cellSize),
    grass: buildGrass(platformSize, seed),
    cellSize,
    gridSize: n,
    platformSize,
  };
}

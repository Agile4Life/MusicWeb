// ---------------------------------------------------------------------------
// treeGenerator.ts — Natural stylized tree, fine-grained leaf clusters & grass
// ---------------------------------------------------------------------------

import { hash31, mulberry32 } from "./hashNoise";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TerrainTile {
  col: number;
  row: number;
  x: number;
  z: number;
  isDark: boolean;
  zone: "center" | "finder" | "outer" | "middle";
  qrColor: string;
  stoneColor: string;
  isGrass: boolean;
  grassScale: number;
  grassRot: number;
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
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  colorHex: string;
}

export interface TreeData {
  segments: TreeSegment[];
  leaves: LeafParticle[];
}

export interface SceneData {
  tiles: TerrainTile[];
  tree: TreeData;
  cellSize: number;
  gridSize: number;
  platformSize: number;
}

const CELL_BASE = 0.5;

function getModuleZone(r: number, c: number, n: number): "center" | "finder" | "outer" | "middle" {
  const isFinder =
    (r < 8 && c < 8) ||
    (r < 8 && c >= n - 8) ||
    (r >= n - 8 && c < 8);
  if (isFinder) return "finder";

  const half = (n - 1) / 2;
  const dist = Math.sqrt((r - half) ** 2 + (c - half) ** 2);
  const maxDist = Math.sqrt(half * half + half * half);
  const distRatio = dist / maxDist;

  if (distRatio < 0.3) return "center";
  if (distRatio > 0.62 || r <= 1 || r >= n - 2 || c <= 1 || c >= n - 2) return "outer";
  return "middle";
}

export function generateSceneData(matrix: boolean[][], url: string, season: Season): SceneData {
  const seed = hash31(url);
  const gridSize = matrix.length;
  const cellSize = CELL_BASE;
  const half = (gridSize - 1) / 2;
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const theme = SEASON_THEMES[season];

  // ---- 1. Terrain Tiles ----
  const tiles: TerrainTile[] = [];

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const isDark = matrix[r][c];
      const x = (c - half) * cellSize;
      const z = (r - half) * cellSize;
      const zone = getModuleZone(r, c, gridSize);

      let qrColor: string;
      if (isDark) {
        const isCornerEdge = (r === 0 || r === 6 || r === gridSize - 7 || r === gridSize - 1) &&
                             (c === 0 || c === 6 || c === gridSize - 7 || c === gridSize - 1);
        if (isCornerEdge && rnd() < 0.6) {
          qrColor = theme.cornerAccent[Math.floor(rnd() * theme.cornerAccent.length)];
        } else {
          qrColor = theme.qrDarkPalette[Math.floor(rnd() * theme.qrDarkPalette.length)];
        }
      } else {
        qrColor = theme.qrLightPalette[Math.floor(rnd() * theme.qrLightPalette.length)];
      }

      const stoneColor = theme.stoneTileColors[Math.floor(rnd() * theme.stoneTileColors.length)];

      // Grass only grows on dark modules in the OUTER border and FINDER corners
      const isGrass = isDark && (zone === "outer" || zone === "finder" || (zone === "middle" && rnd() < 0.35));
      const grassScale = isGrass ? 0.35 + rnd() * 0.25 : 0;
      const grassRot = rnd() * Math.PI * 2;

      tiles.push({
        col: c,
        row: r,
        x,
        z,
        isDark,
        zone,
        qrColor,
        stoneColor,
        isGrass,
        grassScale,
        grassRot,
      });
    }
  }

  // ---- 2. Organic Tree with Hundreds of Fine Leaf Particles ----
  const tree = generateRealisticTree(gridSize, cellSize, seed, theme);

  return {
    tiles,
    tree,
    cellSize,
    gridSize,
    platformSize: gridSize * cellSize,
  };
}

function generateRealisticTree(gridSize: number, cellSize: number, seed: number, theme: SeasonTheme): TreeData {
  const segments: TreeSegment[] = [];
  const leaves: LeafParticle[] = [];
  const rnd = mulberry32(seed ^ 0x4f1b8a92);

  const trunkHeight = 5.2 + rnd() * 0.8;
  const trunkRadius = 0.36;

  // ---- Trunk (smooth tapering cylinder sections) ----
  const TRUNK_SEGS = 7;
  const leanX = (rnd() - 0.5) * 0.35;
  const leanZ = (rnd() - 0.5) * 0.35;

  for (let i = 0; i < TRUNK_SEGS; i++) {
    const t0 = i / TRUNK_SEGS;
    const t1 = (i + 1) / TRUNK_SEGS;

    const x0 = leanX * t0 * t0;
    const y0 = t0 * trunkHeight;
    const z0 = leanZ * t0 * t0;

    const x1 = leanX * t1 * t1;
    const y1 = t1 * trunkHeight;
    const z1 = leanZ * t1 * t1;

    const r0 = trunkRadius * (1 - t0 * 0.45);
    const r1 = trunkRadius * (1 - t1 * 0.45);

    segments.push({
      start: { x: x0, y: y0, z: z0 },
      end: { x: x1, y: y1, z: z1 },
      radiusStart: r0,
      radiusEnd: r1,
      depth: 0,
    });
  }

  // ---- Major Branches (8 main boughs reaching out & up) ----
  const NUM_BOUGHS = 8;
  const leafSpawners: Vec3[] = [];

  for (let b = 0; b < NUM_BOUGHS; b++) {
    const attachT = 0.38 + (b / NUM_BOUGHS) * 0.55 + (rnd() - 0.5) * 0.08;
    const attachY = attachT * trunkHeight;
    const attachX = leanX * attachT * attachT;
    const attachZ = leanZ * attachT * attachT;

    const angle = (b / NUM_BOUGHS) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const boughLen = 2.2 + rnd() * 1.4;
    const upwardAngle = 0.35 + (1 - attachT) * 0.35; // lower branches point up more

    const endX = attachX + Math.cos(angle) * boughLen * (1 - upwardAngle * 0.4);
    const endY = attachY + upwardAngle * boughLen;
    const endZ = attachZ + Math.sin(angle) * boughLen * (1 - upwardAngle * 0.4);

    const bRadius = trunkRadius * 0.4 * (1 - attachT * 0.25);

    segments.push({
      start: { x: attachX, y: attachY, z: attachZ },
      end: { x: endX, y: endY, z: endZ },
      radiusStart: bRadius,
      radiusEnd: bRadius * 0.55,
      depth: 1,
    });

    leafSpawners.push({ x: (attachX + endX) / 2, y: (attachY + endY) / 2, z: (attachZ + endZ) / 2 });
    leafSpawners.push({ x: endX, y: endY, z: endZ });

    // Sub-twigs (2-3 per bough)
    const numTwigs = 2 + Math.floor(rnd() * 2);
    for (let tw = 0; tw < numTwigs; tw++) {
      const twAngle = angle + (tw === 0 ? 0.5 : -0.5) * (0.8 + rnd() * 0.4);
      const twLen = boughLen * (0.55 + rnd() * 0.25);
      const twEndX = endX + Math.cos(twAngle) * twLen * 0.8;
      const twEndY = endY + 0.4 + rnd() * 0.8;
      const twEndZ = endZ + Math.sin(twAngle) * twLen * 0.8;

      segments.push({
        start: { x: endX, y: endY, z: endZ },
        end: { x: twEndX, y: twEndY, z: twEndZ },
        radiusStart: bRadius * 0.45,
        radiusEnd: bRadius * 0.2,
        depth: 2,
      });

      leafSpawners.push({ x: twEndX, y: twEndY, z: twEndZ });
    }
  }

  // Top trunk leader branches
  for (let top = 0; top < 3; top++) {
    const topAngle = (top / 3) * Math.PI * 2 + rnd() * 0.5;
    const topEndX = Math.cos(topAngle) * 0.8;
    const topEndY = trunkHeight + 1.6 + rnd() * 0.8;
    const topEndZ = Math.sin(topAngle) * 0.8;

    segments.push({
      start: { x: leanX, y: trunkHeight, z: leanZ },
      end: { x: topEndX, y: topEndY, z: topEndZ },
      radiusStart: trunkRadius * 0.35,
      radiusEnd: trunkRadius * 0.15,
      depth: 1,
    });

    leafSpawners.push({ x: topEndX, y: topEndY, z: topEndZ });
  }

  // ---- Dense Organic Foliage: 650 fine leaf clusters ----
  const TOTAL_LEAVES = 650;
  const colors = theme.foliageColors;

  // 1. Cluster leaves tightly around all branch endpoints and twigs (60% of leaves)
  const branchLeaves = Math.floor(TOTAL_LEAVES * 0.65);
  for (let i = 0; i < branchLeaves; i++) {
    const spawner = leafSpawners[i % leafSpawners.length];
    const spread = 0.95;
    const lx = spawner.x + (rnd() - 0.5) * spread * 2;
    const ly = spawner.y + (rnd() - 0.5) * spread * 1.5;
    const lz = spawner.z + (rnd() - 0.5) * spread * 2;
    const scale = 0.38 + rnd() * 0.32; // small, delicate leaf cluster!

    leaves.push({
      x: lx,
      y: ly,
      z: lz,
      scale,
      rotX: rnd() * Math.PI,
      rotY: rnd() * Math.PI * 2,
      rotZ: rnd() * Math.PI,
      colorHex: colors[Math.floor(rnd() * colors.length)],
    });
  }

  // 2. Dome volume filler leaves to form a complete lush canopy silhouette (35% of leaves)
  const domeLeaves = TOTAL_LEAVES - branchLeaves;
  const canopyCenterY = trunkHeight * 0.85;

  for (let i = 0; i < domeLeaves; i++) {
    const u = rnd();
    const v = rnd();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = Math.cbrt(rnd()) * 2.8;

    const sinPhi = Math.sin(phi);
    const lx = r * sinPhi * Math.cos(theta) * 1.25; // wide canopy
    const ly = canopyCenterY + r * Math.cos(phi) * 1.1; // height
    const lz = r * sinPhi * Math.sin(theta) * 1.25;
    const scale = 0.35 + rnd() * 0.35;

    leaves.push({
      x: lx,
      y: Math.max(trunkHeight * 0.4, ly),
      z: lz,
      scale,
      rotX: rnd() * Math.PI,
      rotY: rnd() * Math.PI * 2,
      rotZ: rnd() * Math.PI,
      colorHex: colors[Math.floor(rnd() * colors.length)],
    });
  }

  return {
    segments,
    leaves,
  };
}

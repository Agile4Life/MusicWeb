import { hash31, mulberry32 } from "./hashNoise";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";

export interface Vec3 { x: number; y: number; z: number }

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
  scale: number;
  colorHex: string;
}

export interface TreeData {
  segments: TreeSegment[];
  leaves: LeafParticle[];
  flowers: FlowerParticle[];
}

export interface SceneData {
  tiles: TerrainTile[];
  tree: TreeData;
  cellSize: number;
  gridSize: number;
  platformSize: number;
}

const CELL_SIZE = 0.5;

function isFinderCell(row: number, col: number, n: number): boolean {
  return (
    (row < 7 && col < 7) ||
    (row < 7 && col >= n - 7) ||
    (row >= n - 7 && col < 7)
  );
}

function cellCenter(row: number, col: number, n: number): Vec3 {
  const half = (n - 1) / 2;
  return { x: (col - half) * CELL_SIZE, y: 0, z: (row - half) * CELL_SIZE };
}

function averageDarkCells(matrix: boolean[][], minR: number, maxR: number, minC: number, maxC: number): Vec3 {
  const n = matrix.length;
  let sx = 0;
  let sz = 0;
  let count = 0;
  for (let r = Math.max(0, minR); r < Math.min(n, maxR); r++) {
    for (let c = Math.max(0, minC); c < Math.min(n, maxC); c++) {
      if (!matrix[r][c]) continue;
      const p = cellCenter(r, c, n);
      sx += p.x;
      sz += p.z;
      count++;
    }
  }
  return count > 0 ? { x: sx / count, y: 0, z: sz / count } : { x: 0, y: 0, z: 0 };
}

function buildBranches(matrix: boolean[][], seed: number, theme: SeasonTheme): TreeData {
  const n = matrix.length;
  const rnd = mulberry32(seed ^ 0x6d2b79f5);
  const segments: TreeSegment[] = [];
  const leaves: LeafParticle[] = [];
  const flowers: FlowerParticle[] = [];

  const center = { x: 0, y: 0, z: 0 };
  const root = averageDarkCells(matrix, Math.floor(n * 0.32), Math.ceil(n * 0.68), Math.floor(n * 0.32), Math.ceil(n * 0.68));
  center.x = root.x * 0.15;
  center.z = root.z * 0.15;

  const density = matrix.flat().filter(Boolean).length / Math.max(1, n * n);
  const trunkHeight = 4.5 + density * 2.4;
  const trunkSegments = 8;

  for (let i = 0; i < trunkSegments; i++) {
    const t0 = i / trunkSegments;
    const t1 = (i + 1) / trunkSegments;
    const driftX = Math.sin(seed * 0.001 + i * 0.7) * 0.14 * t1;
    const driftZ = Math.cos(seed * 0.0013 + i * 0.55) * 0.14 * t1;
    segments.push({
      start: { x: center.x + driftX * t0, y: t0 * trunkHeight, z: center.z + driftZ * t0 },
      end: { x: center.x + driftX, y: t1 * trunkHeight, z: center.z + driftZ },
      radiusStart: 0.38 * (1 - t0 * 0.45),
      radiusEnd: 0.38 * (1 - t1 * 0.48),
      depth: 0,
    });
  }

  const branchCount = 10 + Math.round(density * 8);
  const spawners: Vec3[] = [];

  for (let b = 0; b < branchCount; b++) {
    const angle = (b / branchCount) * Math.PI * 2 + (rnd() - 0.5) * 0.34;
    const attachT = 0.42 + rnd() * 0.45;
    const attachY = trunkHeight * attachT;
    const baseRadius = 0.18 * (1 - attachT * 0.2);

    // Sample a QR quadrant so branch orientation is driven by the encoded pattern.
    const qx = Math.cos(angle);
    const qz = Math.sin(angle);
    const minR = qz < 0 ? 7 : Math.floor(n * 0.48);
    const maxR = qz < 0 ? Math.floor(n * 0.52) : n - 7;
    const minC = qx < 0 ? 7 : Math.floor(n * 0.48);
    const maxC = qx < 0 ? Math.floor(n * 0.52) : n - 7;
    const target = averageDarkCells(matrix, minR, maxR, minC, maxC);
    const targetRadius = Math.max(2.0, Math.min(4.2, Math.hypot(target.x, target.z) * 0.55 + 2.2));
    const length = targetRadius * (0.75 + rnd() * 0.35);

    const start = {
      x: center.x + qx * 0.12,
      y: attachY,
      z: center.z + qz * 0.12,
    };
    const end = {
      x: start.x + qx * length,
      y: attachY + 0.55 + rnd() * 1.05,
      z: start.z + qz * length,
    };

    segments.push({ start, end, radiusStart: baseRadius, radiusEnd: baseRadius * 0.48, depth: 1 });
    spawners.push(end);

    const twigCount = 3 + Math.floor(rnd() * 3);
    for (let t = 0; t < twigCount; t++) {
      const spread = (t - (twigCount - 1) / 2) * 0.24;
      const twigAngle = angle + spread + (rnd() - 0.5) * 0.22;
      const twigLen = length * (0.38 + rnd() * 0.28);
      const twigStart = {
        x: end.x * 0.75 + start.x * 0.25,
        y: end.y * 0.75 + start.y * 0.25,
        z: end.z * 0.75 + start.z * 0.25,
      };
      const twigEnd = {
        x: twigStart.x + Math.cos(twigAngle) * twigLen,
        y: twigStart.y + 0.45 + rnd() * 0.75,
        z: twigStart.z + Math.sin(twigAngle) * twigLen,
      };
      segments.push({
        start: twigStart,
        end: twigEnd,
        radiusStart: baseRadius * 0.5,
        radiusEnd: baseRadius * 0.16,
        depth: 2,
      });
      spawners.push(twigEnd);
    }
  }

  const leafCount = Math.min(900, 520 + Math.round(density * 500));
  const flowerCount = theme.name === "spring" ? 110 : 70;
  const foliage = theme.foliageColors;

  for (let i = 0; i < leafCount; i++) {
    const source = spawners[i % spawners.length];
    const cluster = 0.55 + rnd() * 1.15;
    const angle = rnd() * Math.PI * 2;
    const radius = Math.sqrt(rnd()) * cluster;
    leaves.push({
      x: source.x + Math.cos(angle) * radius,
      y: source.y + (rnd() - 0.35) * cluster * 1.2,
      z: source.z + Math.sin(angle) * radius,
      scale: 0.22 + rnd() * 0.28,
      rotX: rnd() * Math.PI,
      rotY: rnd() * Math.PI * 2,
      rotZ: rnd() * Math.PI,
      colorHex: foliage[Math.floor(rnd() * foliage.length)],
    });
  }

  for (let i = 0; i < flowerCount; i++) {
    const source = spawners[Math.floor(rnd() * spawners.length)];
    flowers.push({
      x: source.x + (rnd() - 0.5) * 1.2,
      y: source.y + (rnd() - 0.2) * 0.8,
      z: source.z + (rnd() - 0.5) * 1.2,
      scale: 0.08 + rnd() * 0.09,
      colorHex: theme.foliageColors[(i + 1) % theme.foliageColors.length],
    });
  }

  return { segments, leaves, flowers };
}

export function generateSceneData(matrix: boolean[][], url: string, season: Season): SceneData {
  const n = matrix.length;
  const theme = SEASON_THEMES[season];
  const seed = hash31(url);
  const rnd = mulberry32(seed ^ 0x13579bdf);
  const half = (n - 1) / 2;
  const tiles: TerrainTile[] = [];

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const isDark = matrix[row][col];
      const finder = isFinderCell(row, col, n);
      tiles.push({
        row,
        col,
        x: (col - half) * CELL_SIZE,
        z: (row - half) * CELL_SIZE,
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

  return {
    tiles,
    tree: buildBranches(matrix, seed, theme),
    cellSize: CELL_SIZE,
    gridSize: n,
    platformSize: n * CELL_SIZE,
  };
}

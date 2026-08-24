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
  cellSize: number;
  gridSize: number;
  platformSize: number;
}

const CELL_SIZE = 0.44;

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

function buildTreeData(matrix: boolean[][], seed: number, theme: SeasonTheme): TreeData {
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
        darkCells.push(cellCenter(r, c, n));
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
    Math.ceil(n * 0.65)
  );
  const center = { x: root.x * 0.1, y: 0, z: root.z * 0.1 };

  // Canopy center and ellipsoid radii (strictly encapsulates ALL leaves and branches)
  const canopyCenter: Vec3 = {
    x: center.x,
    y: trunkHeight * 0.88,
    z: center.z,
  };
  const canopyRadiusX = 1.9 + density * 0.4;
  const canopyRadiusY = 1.65 + density * 0.3;
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

  // 3. Canopy Silhouette Base Blobs (Creates a solid, smooth connected crown shape)
  // 1 Core center blob
  canopyBlobs.push({
    x: canopyCenter.x,
    y: canopyCenter.y + 0.1,
    z: canopyCenter.z,
    qrX: darkCells[0].x,
    qrZ: darkCells[0].z,
    radius: 1.15,
    colorHex: foliage[0],
  });

  // 5-7 Surrounding sub-blobs along branch hubs
  for (let i = 0; i < branchHubs.length; i++) {
    if (i % 2 === 0 || rnd() > 0.4) {
      const hub = branchHubs[i];
      canopyBlobs.push({
        x: hub.pos.x,
        y: hub.pos.y,
        z: hub.pos.z,
        qrX: hub.qrCell.x,
        qrZ: hub.qrCell.z,
        radius: 0.65 + rnd() * 0.35,
        colorHex: foliage[Math.floor(rnd() * foliage.length)],
      });
    }
  }

  // 4. Dense Fibonacci Surface Leaf Particles (100% strictly bound within canopy envelope)
  const leafCount = 1100;
  const flowerCount = theme.name === "spring" ? 120 : 60;

  for (let i = 0; i < leafCount; i++) {
    // Vogel spiral / Fibonacci sphere distribution mapped onto canopy ellipsoid
    const phi = Math.acos(1 - 2 * ((i + 0.5) / leafCount)); // 0 to PI
    const theta = Math.PI * (1 + Math.sqrt(5)) * i; // Golden angle

    // Radius distribution: bias towards the outer shell (0.65 -> 1.05) for dense lush surface
    const shellRadius = 0.68 + 0.32 * Math.cbrt(rnd()) + (rnd() - 0.5) * 0.08;

    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    // Calculate strict 3D tree coordinates (zero chance of dropping down to ground)
    const treeX = canopyCenter.x + nx * canopyRadiusX * shellRadius;
    const treeY = canopyCenter.y + ny * canopyRadiusY * shellRadius;
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

    const treeX = canopyCenter.x + nx * canopyRadiusX * 1.02;
    const treeY = canopyCenter.y + ny * canopyRadiusY * 1.02;
    const treeZ = canopyCenter.z + nz * canopyRadiusZ * 1.02;

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
    tree: buildTreeData(matrix, seed, theme),
    cellSize: CELL_SIZE,
    gridSize: n,
    platformSize: n * CELL_SIZE,
  };
}

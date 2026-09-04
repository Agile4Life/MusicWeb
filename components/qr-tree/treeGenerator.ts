import { hash31, mulberry32, clamp } from "./hashNoise";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";

export interface Vec3 { x: number; y: number; z: number }

// Cheap "sum of sines" pseudo-noise evaluated over a direction on the unit
// sphere (nx,ny,nz). Used only as a *secondary* surface wobble now (see
// FIX 3 below) — the primary silhouette shaping comes from the lobe
// clustering, not from this noise anymore.
function lobeNoise(nx: number, ny: number, nz: number, seed: number) {
  const s = seed * 0.0013;
  let n = 0;
  n += Math.sin(nx * 2.4 + s) * Math.cos(nz * 2.6 - s * 1.2) * 0.42;
  n += Math.sin(ny * 5.4 + s * 0.8) * 0.3;
  n += Math.sin(nz * 3.1 + nx * 1.7 + s * 1.6) * Math.cos(ny * 1.3) * 0.22;
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

// ---------------------------------------------------------------------------
// FIX 5 — GRID-ALIGNED "FINDER EYE" GRASS
//
// Old buildGrass() just scattered 10-16 blades randomly inside a small
// patch near each corner — no relationship to the QR module grid at all.
// That's why it read as a sparse, shapeless tuft instead of the dense,
// recognizable "eye" pattern in the reference screenshot.
//
// A real QR code's finder pattern is a fixed 7x7 module glyph: solid
// outer ring, one ring of empty space, solid 3x3 core. We place grass
// directly ON that glyph's cells — anchored to the exact same cellSize
// grid the QR tiles use — at all 4 platform corners (only 3 of those are
// true QR finder corners; the 4th is kept for visual symmetry, matching
// the reference). Because each covered cell gets its own blade cluster,
// density now tracks the module grid 1:1, and the eye shape itself is
// legible once the scene flattens into the 2D QR view.
// ---------------------------------------------------------------------------
const FINDER_PATTERN: boolean[][] = [
  [true, true, true, true, true, true, true],
  [true, false, false, false, false, false, true],
  [true, false, true, true, true, false, true],
  [true, false, true, true, true, false, true],
  [true, false, true, true, true, false, true],
  [true, false, false, false, false, false, true],
  [true, true, true, true, true, true, true],
];

function buildGrass(n: number, cellSize: number, seed: number): GrassBlade[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const half = (n - 1) / 2;
  const blades: GrassBlade[] = [];

  // Anchor (row, col) of each 7x7 corner block. Top-left/top-right/bottom-
  // left are real QR finder positions; bottom-right has no finder pattern
  // in an actual QR code but gets the same synthetic glyph for symmetry.
  const corners = [
    { rowStart: 0, colStart: 0 },
    { rowStart: 0, colStart: n - 7 },
    { rowStart: n - 7, colStart: 0 },
    { rowStart: n - 7, colStart: n - 7 },
  ];

  for (const corner of corners) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (!FINDER_PATTERN[r][c]) continue; // leave the light ring bare so the eye shape reads clearly

        const row = corner.rowStart + r;
        const col = corner.colStart + c;
        const cx = (col - half) * cellSize;
        const cz = (row - half) * cellSize;

        // 1-2 blades per covered cell, tightly clustered around the cell
        // center so the module reads as "filled" rather than a single
        // thin blade poking out of it.
        const bladeCount = 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < bladeCount; i++) {
          const jitter = cellSize * 0.3;
          blades.push({
            x: cx + (rnd() - 0.5) * jitter,
            y: 0,
            z: cz + (rnd() - 0.5) * jitter,
            rotY: rnd() * Math.PI * 2,
            tilt: (rnd() - 0.5) * 0.3,
            scale: 0.13 + rnd() * 0.09,
            colorHex: GRASS_COLORS[Math.floor(rnd() * GRASS_COLORS.length)],
          });
        }
      }
    }
  }
  return blades;
}

// ---------------------------------------------------------------------------
// FIX 3 — CLUSTERED LOBE CANOPY
//
// The old canopy was ONE Fibonacci/Vogel shell warped by lobeNoise(). A
// Vogel spiral is the most evenly-distributed possible point set on a
// sphere, so no matter how much you warp its radius with smooth sine
// noise, it still reads as a single round ball — which is exactly what
// the screenshot shows (a uniform green sphere with a couple of accidental
// gaps near the trunk).
//
// Real / stylized tree crowns don't read as one shell — they read as a
// union of several overlapping "florets" (cauliflower clumps), each with
// its own rounded silhouette, offset from a shared core. The gaps BETWEEN
// florets are what break the sphere illusion and give the outline its
// bumpy, layered, unmistakably-a-tree look.
//
// buildCanopyLobes() generates that cluster layout: one dominant core lobe
// plus 6-8 satellite lobes scattered around it (golden-angle ring + random
// jitter in angle/elevation/distance so they never line up into a ring).
// Each lobe gets its own local Fibonacci shell for leaves/flowers, sized
// and populated proportionally to its volume (radius^3).
// ---------------------------------------------------------------------------
interface CanopyLobe {
  offset: Vec3;   // lobe center, in canopy-radius units (pre axis-scaling)
  radius: number; // lobe size, in canopy-radius units
  leafShare: number; // fraction of total leaves/flowers this lobe gets
}

function buildCanopyLobes(rnd: () => number): CanopyLobe[] {
  const lobes: CanopyLobe[] = [];

  // Dominant central mass — anchors the silhouette, sits slightly low so
  // satellite lobes read as growth bulging outward/upward from it.
  lobes.push({ offset: { x: 0, y: -0.08, z: 0 }, radius: 1.0, leafShare: 0 });

  const satelliteCount = 6 + Math.floor(rnd() * 3); // 6-8 satellite florets
  const GOLDEN_ANGLE = 2.39996323; // radians
  for (let i = 0; i < satelliteCount; i++) {
    const angle = i * GOLDEN_ANGLE + rnd() * 0.5;
    // slight upward bias (real crowns bulge more above the attachment
    // point than below it) while still covering the full sphere so the
    // overall envelope stays roughly round, just lobed.
    const elevation = -0.5 + rnd() * 1.3; // -0.5..0.8
    const ringRadius = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const distFromCenter = 0.5 + rnd() * 0.4; // how far the lobe sits from the core

    lobes.push({
      offset: {
        x: Math.cos(angle) * ringRadius * distFromCenter,
        y: elevation * distFromCenter * 0.85,
        z: Math.sin(angle) * ringRadius * distFromCenter,
      },
      radius: 0.42 + rnd() * 0.34, // satellites are smaller than the core
      leafShare: 0,
    });
  }

  // Weight leaf allocation by lobe volume so big lobes look full and tiny
  // ones don't get overcrowded.
  const totalVolume = lobes.reduce((sum, l) => sum + Math.pow(l.radius, 3), 0);
  for (const lobe of lobes) lobe.leafShare = Math.pow(lobe.radius, 3) / totalVolume;

  return lobes;
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

  // Build the lobe cluster layout for this canopy (see FIX 3 above).
  const lobes = buildCanopyLobes(rnd);
  const maxLobeReach = Math.max(
    ...lobes.map((l) => Math.hypot(l.offset.x, l.offset.y, l.offset.z) + l.radius)
  );

  // Small filler blob under each lobe core — keeps gaps between florets
  // from showing bare empty space, without being big enough to read as
  // a dominant shape once the leaf particles cover it.
  for (const lobe of lobes) {
    canopyBlobs.push({
      x: canopyCenter.x + lobe.offset.x * canopyRadiusX,
      y: canopyCenter.y + lobe.offset.y * canopyRadiusY,
      z: canopyCenter.z + lobe.offset.z * canopyRadiusZ,
      qrX: darkCells[Math.floor(rnd() * darkCells.length)].x,
      qrZ: darkCells[Math.floor(rnd() * darkCells.length)].z,
      radius: lobe.radius * 0.42,
      colorHex: foliage[Math.floor(rnd() * foliage.length)],
    });
  }

  // Fewer, smaller sub-blobs along branch hubs — just enough to avoid
  // gaps at the branch tips, still small enough to stay under the leaves.
  for (let i = 0; i < branchHubs.length; i++) {
    if (i % 3 === 0 || rnd() > 0.65) {
      const hub = branchHubs[i];
      canopyBlobs.push({
        x: hub.pos.x,
        y: hub.pos.y,
        z: hub.pos.z,
        qrX: hub.qrCell.x,
        qrZ: hub.qrCell.z,
        radius: 0.2 + rnd() * 0.16,
        colorHex: foliage[Math.floor(rnd() * foliage.length)],
      });
    }
  }

  // 4. Dense leaf particles, distributed across lobes (100% strictly bound
  // within the widened canopy envelope, but now clustered instead of one
  // smooth shell).
  const leafCount = 1500;
  const flowerCount = theme.name === "spring" ? 120 : 60;
  const WOBBLE_STRENGTH = 0.18; // secondary surface texture, per-lobe (subtle now — the lobes do the heavy lifting)

  let leafCursor = 0;
  for (let li = 0; li < lobes.length; li++) {
    const lobe = lobes[li];
    const count =
      li === lobes.length - 1
        ? leafCount - leafCursor // give the remainder to the last lobe so totals match exactly
        : Math.round(leafCount * lobe.leafShare);

    for (let i = 0; i < count; i++) {
      const denom = Math.max(1, count);
      const phi = Math.acos(1 - 2 * ((i + 0.5) / denom));
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      // gentle secondary wobble so each lobe doesn't itself read as a
      // perfectly smooth mini-ball
      const wobble = clamp(1 + lobeNoise(nx, ny, nz, seed + li * 97) * WOBBLE_STRENGTH, 0.85, 1.15);
      const shellRadius = (0.6 + 0.4 * Math.cbrt(rnd())) * wobble;

      const lx = lobe.offset.x + nx * lobe.radius * shellRadius;
      const ly = lobe.offset.y + ny * lobe.radius * shellRadius * 0.92; // each lobe flattened slightly too
      const lz = lobe.offset.z + nz * lobe.radius * shellRadius;

      const treeX = canopyCenter.x + lx * canopyRadiusX;
      const treeY = canopyCenter.y + ly * canopyRadiusY;
      const treeZ = canopyCenter.z + lz * canopyRadiusZ;

      const targetDarkCell = darkCells[leafCursor % darkCells.length];

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
      leafCursor++;
    }
  }

  // 5. Flower Blossoms — same lobe clustering, sitting just outside each
  // lobe's leaf shell.
  let flowerCursor = 0;
  for (let li = 0; li < lobes.length; li++) {
    const lobe = lobes[li];
    const count =
      li === lobes.length - 1
        ? flowerCount - flowerCursor
        : Math.round(flowerCount * lobe.leafShare);

    for (let i = 0; i < count; i++) {
      const denom = Math.max(1, count);
      const phi = Math.acos(1 - 2 * ((i + 0.5) / denom));
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i * 3 + 1);

      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const wobble = clamp(1 + lobeNoise(nx, ny, nz, seed + li * 97) * WOBBLE_STRENGTH, 0.85, 1.15);
      const flowerShell = wobble * 1.02 + 0.04; // small offset outside the leaf shell

      const lx = lobe.offset.x + nx * lobe.radius * flowerShell;
      const ly = lobe.offset.y + ny * lobe.radius * flowerShell * 0.92;
      const lz = lobe.offset.z + nz * lobe.radius * flowerShell;

      const treeX = canopyCenter.x + lx * canopyRadiusX;
      const treeY = canopyCenter.y + ly * canopyRadiusY;
      const treeZ = canopyCenter.z + lz * canopyRadiusZ;

      const targetDarkCell = darkCells[(flowerCursor * 7 + 3) % darkCells.length];

      flowers.push({
        x: treeX,
        y: treeY,
        z: treeZ,
        qrX: targetDarkCell.x,
        qrZ: targetDarkCell.z,
        scale: 0.045 + rnd() * 0.035,
        colorHex: theme.foliageColors[(flowerCursor + 1) % theme.foliageColors.length],
      });
      flowerCursor++;
    }
  }

  return {
    segments,
    leaves,
    flowers,
    canopyBlobs,
    canopyCenter,
    // account for satellite lobes bulging past the base ellipsoid so any
    // downstream bounding/camera-framing code stays correct
    canopyRadius: ((canopyRadiusX + canopyRadiusZ) / 2) * maxLobeReach,
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
    grass: buildGrass(n, cellSize, seed),
    cellSize,
    gridSize: n,
    platformSize,
  };
}

"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import qrcodegen from "qrcode-generator";

/* ============================================================================
   QRTreeMorph
   ----------------------------------------------------------------------------
   Isometric "voxel" QR-code that morphs into a pixel-art tree (and back) on
   tap/click, reverse-engineered from a screen recording of tree.icqr.com.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Tunables — safe to tweak without touching the engine below.
// ---------------------------------------------------------------------------
export const CONFIG = {
  worldFit: 12, // both compositions are normalized to roughly this width, in world units
  qr: {
    demoSize: 25, // module count used for the local fallback demo pattern
    tileThickness: 0.16,
  },
  tree: {
    span: 7, // platform width in cells (kept smaller than the canopy so it overhangs, like the reference)
    platformThickness: 0.45,
    trunkLevels: 2,
    trunkLevelHeight: 0.95,
    canopyRadiusX: 4.3,
    canopyRadiusY: 2.6,
    canopyRadiusZ: 4.3,
    canopyLevelHeight: 0.92,
    canopyLevels: 6,
    canopyLatticeSpan: 5, // -5..5
  },
  anim: {
    duration: 460, // ms, per-voxel flight time
    stagger: 240, // ms, spread of start delays across all voxels
    overshootMin: 0.35,
    overshootMax: 1.3,
  },
  idleBobAmplitude: 0.045,
  idleBobSpeed: 0.0011,
};

// ---------------------------------------------------------------------------
// Color palettes (approximate hand-picked matches from the reference video)
// ---------------------------------------------------------------------------
export const PALETTES = {
  qrDark: ["#2f6b2a", "#3c7a30", "#4a8a3a", "#5a9a44", "#3a6f28"],
  qrLight: ["#eee6d3", "#e6ddc7", "#ddd3ba", "#e2d9c2"],
  platformGrass: ["#79b451", "#6ea746", "#84bd5c"],
  platformStone: ["#c9c2b2", "#bfb8a7", "#d3ccbc"],
  trunk: ["#6b4a30", "#5c3f28", "#7a5638"],
  canopy: {
    spring: ["#8fd35f", "#9fe072", "#7bc44f", "#b7ea94", "#6bb542"],
    summer: ["#4f9c34", "#5fae3d", "#6bbf46", "#3f7d2a", "#7fcf55"],
    autumn: ["#d97b29", "#e0a83c", "#c1531f", "#e6c34a", "#b8621f"],
  },
  springBlossom: "#f3b8cc",
};

export type Season = "spring" | "summer" | "autumn";
export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface Voxel {
  gx: number;
  gz: number;
  elevation: number;
  thickness: number;
  r: number;
  g: number;
  b: number;
  alpha?: number;
}

export interface TransitionParticle {
  kind: "move" | "spawn" | "despawn";
  delay: number;
  duration: number;
  overshoot: number;
  from: Voxel & { alpha: number };
  to: Voxel & { alpha: number };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string) {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.substring(0, 2), 16),
    g: parseInt(v.substring(2, 4), 16),
    b: parseInt(v.substring(4, 6), 16),
  };
}

export function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function rgbToCss(r: number, g: number, b: number, a = 1): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function shadeRgb(rgb: { r: number; g: number; b: number }, factor: number) {
  return {
    r: Math.max(0, Math.min(255, rgb.r * factor)),
    g: Math.max(0, Math.min(255, rgb.g * factor)),
    b: Math.max(0, Math.min(255, rgb.b * factor)),
  };
}

// ---------------------------------------------------------------------------
// QR Matrix Helpers
// ---------------------------------------------------------------------------
export function isInFinder(row: number, col: number, n: number): boolean {
  const zones = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  return zones.some(([r0, c0]) => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7);
}

export function finderValue(row: number, col: number, r0: number, c0: number): boolean {
  const lr = row - r0;
  const lc = col - c0;
  const onOuterRing = lr === 0 || lr === 6 || lc === 0 || lc === 6;
  const onInnerBox = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
  return onOuterRing || onInnerBox;
}

export function generateDemoMatrix(seedText: string, size: number): boolean[][] {
  const rnd = mulberry32(hashString(seedText || "icqr-demo"));
  const n = size;
  const matrix: boolean[][] = [];
  for (let row = 0; row < n; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < n; col++) {
      let dark: boolean;
      if (isInFinder(row, col, n)) {
        const zones = [
          [0, 0],
          [0, n - 7],
          [n - 7, 0],
        ];
        const zone = zones.find(([r0, c0]) => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7)!;
        dark = finderValue(row, col, zone[0], zone[1]);
      } else {
        dark = rnd() < 0.46;
      }
      line.push(dark);
    }
    matrix.push(line);
  }
  return matrix;
}

export function generateRealQRMatrix(text: string, errorCorrection: ErrorCorrectionLevel = "M"): boolean[][] {
  try {
    const qr = qrcodegen(0, errorCorrection);
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => qr.isDark(r, c))
    );
  } catch (err) {
    console.warn("QR code generation failed, using demo fallback:", err);
    return generateDemoMatrix(text, CONFIG.qr.demoSize);
  }
}

// ---------------------------------------------------------------------------
// Voxel builders — each returns a flat list of "target" voxel descriptors:
//   { gx, gz, elevation, thickness, r, g, b }
// ---------------------------------------------------------------------------
export function buildQRVoxels(matrix: boolean[][], seedText: string): Voxel[] {
  const rnd = mulberry32(hashString(seedText || "qr") ^ 0x9e3779b9);
  const n = matrix.length;
  const scale = CONFIG.worldFit / n;
  const half = (n - 1) / 2;
  const voxels: Voxel[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const dark = matrix[row][col];
      const palette = dark ? PALETTES.qrDark : PALETTES.qrLight;
      const hex = pick(palette, rnd);
      const rgb = hexToRgb(hex);
      voxels.push({
        gx: (col - half) * scale,
        gz: (row - half) * scale,
        elevation: 0,
        thickness: CONFIG.qr.tileThickness,
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
      });
    }
  }
  return voxels;
}

export function buildTreeVoxels(season: Season, seedText: string): Voxel[] {
  const shapeRnd = mulberry32(hashString(seedText || "tree") ^ 0x85ebca6b);
  const rnd = mulberry32(hashString((seedText || "tree") + season) ^ 0x27d4eb2f);
  const t = CONFIG.tree;
  const scale = CONFIG.worldFit / t.span;
  const half = (t.span - 1) / 2;
  const voxels: Voxel[] = [];

  // --- platform (grass center, stone border ring) ---
  for (let row = 0; row < t.span; row++) {
    for (let col = 0; col < t.span; col++) {
      const border = row === 0 || col === 0 || row === t.span - 1 || col === t.span - 1;
      const palette = border ? PALETTES.platformStone : PALETTES.platformGrass;
      const rgb = hexToRgb(pick(palette, rnd));
      voxels.push({
        gx: (col - half) * scale,
        gz: (row - half) * scale,
        elevation: 0,
        thickness: t.platformThickness,
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
      });
    }
  }

  // --- trunk ---
  for (let lvl = 0; lvl < t.trunkLevels; lvl++) {
    const rgb = hexToRgb(pick(PALETTES.trunk, rnd));
    voxels.push({
      gx: 0,
      gz: 0,
      elevation: t.platformThickness + lvl * t.trunkLevelHeight,
      thickness: t.trunkLevelHeight,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
    });
  }

  // --- canopy (bumpy ellipsoid blob) ---
  const canopyPalette = PALETTES.canopy[season] || PALETTES.canopy.summer;
  const baseElevation = t.platformThickness + t.trunkLevels * t.trunkLevelHeight;
  const span = t.canopyLatticeSpan;
  for (let lvl = 0; lvl < t.canopyLevels; lvl++) {
    for (let x = -span; x <= span; x++) {
      for (let z = -span; z <= span; z++) {
        const dx = x / t.canopyRadiusX;
        const dz = z / t.canopyRadiusZ;
        const dy = (lvl - (t.canopyLevels - 1) / 2) / t.canopyRadiusY;
        const dist = dx * dx + dy * dy + dz * dz;
        const noise = (shapeRnd() - 0.5) * 0.4;
        if (dist <= 1 + noise) {
          const lightBoost = 1 + (lvl / t.canopyLevels) * 0.22;
          let hex = pick(canopyPalette, rnd);
          const useBlossom = season === "spring" && rnd() < 0.06;
          if (useBlossom) hex = PALETTES.springBlossom;
          const rgb = shadeRgb(hexToRgb(hex), lightBoost);
          voxels.push({
            gx: x * scale,
            gz: z * scale,
            elevation: baseElevation + lvl * t.canopyLevelHeight,
            thickness: t.canopyLevelHeight,
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
          });
        }
      }
    }
  }

  return voxels;
}

// ---------------------------------------------------------------------------
// Transition engine
// ---------------------------------------------------------------------------
export function sortByAngle(list: Voxel[]): Voxel[] {
  return list
    .map((v, i) => ({ v, i, key: Math.atan2(v.gz, v.gx) }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((e) => e.v);
}

export function buildTransitionParticles(sourceList: Voxel[], targetList: Voxel[], rnd: () => number): TransitionParticle[] {
  const A = sortByAngle(sourceList);
  const B = sortByAngle(targetList);
  const paired = Math.min(A.length, B.length);
  const total = Math.max(A.length, B.length);
  const particles: TransitionParticle[] = [];

  const delayFor = (idx: number) => {
    const spread = (idx / Math.max(1, total - 1)) * CONFIG.anim.stagger;
    const jitter = rnd() * CONFIG.anim.stagger * 0.35;
    return spread * 0.65 + jitter;
  };

  for (let i = 0; i < paired; i++) {
    const from = A[i];
    const to = B[i];
    particles.push({
      kind: "move",
      delay: delayFor(i),
      duration: CONFIG.anim.duration,
      overshoot: CONFIG.anim.overshootMin + rnd() * (CONFIG.anim.overshootMax - CONFIG.anim.overshootMin),
      from: { ...from, alpha: 1 },
      to: { ...to, alpha: 1 },
    });
  }
  // extra source voxels shrink away in place
  for (let i = paired; i < A.length; i++) {
    const from = A[i];
    particles.push({
      kind: "despawn",
      delay: delayFor(i) * 0.6,
      duration: CONFIG.anim.duration * 0.8,
      overshoot: 0,
      from: { ...from, alpha: 1 },
      to: { ...from, thickness: 0.01, alpha: 0 },
    });
  }
  // extra target voxels grow in from nothing
  for (let i = paired; i < B.length; i++) {
    const to = B[i];
    particles.push({
      kind: "spawn",
      delay: CONFIG.anim.stagger * 0.4 + delayFor(i) * 0.8,
      duration: CONFIG.anim.duration * 0.9,
      overshoot: 0,
      from: { ...to, thickness: 0.01, alpha: 0 },
      to: { ...to, alpha: 1 },
    });
  }

  return particles;
}

export function sampleParticle(p: TransitionParticle, elapsed: number) {
  const localT = clamp01((elapsed - p.delay) / p.duration);
  const e = easeInOutCubic(localT);
  const eb = p.kind === "move" ? easeOutBack(localT) : e;
  const gx = lerp(p.from.gx, p.to.gx, e);
  const gz = lerp(p.from.gz, p.to.gz, e);
  const elevation = lerp(p.from.elevation, p.to.elevation, eb);
  let thickness = lerp(p.from.thickness, p.to.thickness, e);
  if (p.kind === "move") {
    thickness += Math.sin(localT * Math.PI) * p.overshoot;
  }
  const r = lerp(p.from.r, p.to.r, e);
  const g = lerp(p.from.g, p.to.g, e);
  const b = lerp(p.from.b, p.to.b, e);
  const alpha = lerp(p.from.alpha, p.to.alpha, e);
  return {
    gx,
    gz,
    elevation,
    thickness: Math.max(thickness, 0.01),
    r,
    g,
    b,
    alpha,
    done: localT >= 1,
  };
}

// ---------------------------------------------------------------------------
// Isometric drawing
// ---------------------------------------------------------------------------
export function drawVoxel(
  ctx: CanvasRenderingContext2D,
  screen: { originX: number; originY: number; pxPerUnit: number; tileW: number; tileH: number; heightPxPerUnit: number },
  voxel: { gx: number; gz: number; elevation: number; thickness: number; r: number; g: number; b: number; alpha?: number }
) {
  const sx = screen.originX + (voxel.gx - voxel.gz) * screen.pxPerUnit;
  const topElevPx = (voxel.elevation + voxel.thickness) * screen.heightPxPerUnit;
  const topY = screen.originY + (voxel.gx + voxel.gz) * screen.tileH - topElevPx;
  const sideH = voxel.thickness * screen.heightPxPerUnit;
  const alpha = voxel.alpha ?? 1;

  const rgb = { r: voxel.r, g: voxel.g, b: voxel.b };
  const topColor = rgbToCss(rgb.r, rgb.g, rgb.b, alpha);
  const leftShade = shadeRgb(rgb, 0.78);
  const rightShade = shadeRgb(rgb, 0.56);
  const leftColor = rgbToCss(leftShade.r, leftShade.g, leftShade.b, alpha);
  const rightColor = rgbToCss(rightShade.r, rightShade.g, rightShade.b, alpha);

  // top face
  ctx.fillStyle = topColor;
  ctx.beginPath();
  ctx.moveTo(sx, topY - screen.tileH);
  ctx.lineTo(sx + screen.tileW, topY);
  ctx.lineTo(sx, topY + screen.tileH);
  ctx.lineTo(sx - screen.tileW, topY);
  ctx.closePath();
  ctx.fill();

  if (sideH > 0.6) {
    // left face
    ctx.fillStyle = leftColor;
    ctx.beginPath();
    ctx.moveTo(sx - screen.tileW, topY);
    ctx.lineTo(sx, topY + screen.tileH);
    ctx.lineTo(sx, topY + screen.tileH + sideH);
    ctx.lineTo(sx - screen.tileW, topY + sideH);
    ctx.closePath();
    ctx.fill();

    // right face
    ctx.fillStyle = rightColor;
    ctx.beginPath();
    ctx.moveTo(sx + screen.tileW, topY);
    ctx.lineTo(sx, topY + screen.tileH);
    ctx.lineTo(sx, topY + screen.tileH + sideH);
    ctx.lineTo(sx + screen.tileW, topY + sideH);
    ctx.closePath();
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Props Interface
// ---------------------------------------------------------------------------
export interface QRTreeMorphProps {
  value?: string;
  modules?: boolean[][] | null;
  useRealQR?: boolean;
  season?: Season | null;
  defaultSeason?: Season;
  showSeasonPicker?: boolean;
  showHint?: boolean;
  width?: number;
  height?: number;
  onModeChange?: (mode: "qr" | "tree") => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function QRTreeMorph({
  value = "https://tree.icqr.com",
  modules = null,
  useRealQR = true,
  season: seasonProp = null,
  defaultSeason = "summer",
  showSeasonPicker = true,
  showHint = true,
  width = 340,
  height = 460,
  onModeChange,
  className,
  style,
}: QRTreeMorphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const currentVoxelsRef = useRef<Voxel[] | null>(null); // resting-state voxel list
  const transitionRef = useRef<{ particles: TransitionParticle[]; startTime: number } | null>(null);
  const modeRef = useRef<"qr" | "tree">("qr");
  const seasonRef = useRef<Season>(seasonProp || defaultSeason);
  const rndRef = useRef(mulberry32(hashString(value)));
  const screenRef = useRef({ originX: 0, originY: 0, pxPerUnit: 0, tileW: 0, tileH: 0, heightPxPerUnit: 0 });

  const [mode, setMode] = useState<"qr" | "tree">("qr");
  const [season, setSeason] = useState<Season>(seasonProp || defaultSeason);
  const [isAnimating, setIsAnimating] = useState(false);

  const qrMatrix = useMemo(() => {
    if (modules) return modules;
    if (useRealQR) return generateRealQRMatrix(value, "M");
    return generateDemoMatrix(value, CONFIG.qr.demoSize);
  }, [modules, useRealQR, value]);

  // initialize resting voxel list once or update when QR changes in QR mode
  if (!currentVoxelsRef.current) {
    currentVoxelsRef.current = buildQRVoxels(qrMatrix, value);
  }

  // Update voxel list if matrix/value changes while in static QR mode
  useEffect(() => {
    if (modeRef.current === "qr" && !transitionRef.current) {
      currentVoxelsRef.current = buildQRVoxels(qrMatrix, value);
    }
  }, [qrMatrix, value]);

  const layout = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pxPerUnit = (width * 0.7) / CONFIG.worldFit;
    screenRef.current = {
      originX: width / 2,
      originY: height * 0.62,
      pxPerUnit,
      tileW: pxPerUnit * 0.5,
      tileH: pxPerUnit * 0.25,
      heightPxPerUnit: pxPerUnit * 0.62,
    };
  }, [width, height]);

  useEffect(() => {
    layout();
  }, [layout]);

  const render = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const screen = screenRef.current;
      let drawList: (Voxel & { alpha?: number })[];

      const transition = transitionRef.current;
      if (transition) {
        const elapsed = now - transition.startTime;
        let allDone = true;
        drawList = [];
        for (let i = 0; i < transition.particles.length; i++) {
          const s = sampleParticle(transition.particles[i], elapsed);
          if (!s.done) allDone = false;
          if (s.alpha > 0.015) drawList.push(s); // skip fully-faded voxels
        }
        if (allDone) {
          currentVoxelsRef.current = transition.particles
            .filter((p) => p.to.alpha > 0)
            .map((p) => ({ ...p.to }));
          transitionRef.current = null;
          setIsAnimating(false);
        }
      } else {
        const bobAmp = CONFIG.idleBobAmplitude;
        const voxels = currentVoxelsRef.current || [];
        drawList = voxels.map((v, i) => {
          const bob = modeRef.current === "tree" ? Math.sin(now * CONFIG.idleBobSpeed + i) * bobAmp : 0;
          return { ...v, elevation: v.elevation + bob, alpha: 1 };
        });
      }

      drawList.sort((a, b) => a.gx + a.gz + a.elevation - (b.gx + b.gz + b.elevation));
      for (let i = 0; i < drawList.length; i++) {
        drawVoxel(ctx, screen, drawList[i]);
      }

      rafRef.current = requestAnimationFrame(render);
    },
    [width, height]
  );

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [render]);

  const startTransition = useCallback(
    (targetMode: "qr" | "tree", targetSeason: Season) => {
      const targetVoxels =
        targetMode === "tree" ? buildTreeVoxels(targetSeason, value) : buildQRVoxels(qrMatrix, value);
      const particles = buildTransitionParticles(currentVoxelsRef.current || [], targetVoxels, rndRef.current);
      transitionRef.current = { particles, startTime: performance.now() };
      modeRef.current = targetMode;
      seasonRef.current = targetSeason;
      setIsAnimating(true);
      setMode(targetMode);
      if (onModeChange) onModeChange(targetMode);
    },
    [qrMatrix, value, onModeChange]
  );

  const handleTap = useCallback(() => {
    if (isAnimating) return;
    const next = modeRef.current === "qr" ? "tree" : "qr";
    startTransition(next, seasonRef.current);
  }, [isAnimating, startTransition]);

  const handleSeasonChange = useCallback(
    (nextSeason: Season) => {
      if (isAnimating || nextSeason === seasonRef.current) return;
      setSeason(nextSeason);
      if (modeRef.current === "tree") {
        startTransition("tree", nextSeason);
      } else {
        seasonRef.current = nextSeason;
      }
    },
    [isAnimating, startTransition]
  );

  const hint = mode === "qr" ? "Chạm vào QR để hóa thành Cây Pixel" : "Chạm vào Cây để biến lại thành Mã QR";

  return (
    <div
      ref={containerRef}
      className={`select-none transition-all duration-300 ${className || ""}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: 24,
        borderRadius: 28,
        background: "linear-gradient(145deg, #f7f3e8 0%, #ebe3d0 100%)",
        boxShadow: "0 20px 40px -15px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.4) inset",
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleTap}
        style={{
          cursor: isAnimating ? "default" : "pointer",
          touchAction: "manipulation",
          filter: "drop-shadow(0 12px 24px rgba(47, 107, 42, 0.18))",
        }}
      />
      {showHint && (
        <div
          style={{
            fontSize: 13,
            color: "#736853",
            letterSpacing: 0.3,
            fontWeight: 500,
            textAlign: "center",
          }}
        >
          {hint}
        </div>
      )}
      {showSeasonPicker && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {(["spring", "summer", "autumn"] as Season[]).map((s) => {
            const isSelected = season === s;
            const seasonLabels = {
              spring: "🌸 Xuân",
              summer: "🌿 Hạ",
              autumn: "🍁 Thu",
            };
            return (
              <button
                key={s}
                type="button"
                onClick={() => handleSeasonChange(s)}
                disabled={isAnimating}
                style={{
                  padding: "7px 16px",
                  borderRadius: 999,
                  border: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isAnimating ? "default" : "pointer",
                  background: isSelected ? "#3a7a30" : "#dfd7c2",
                  color: isSelected ? "#ffffff" : "#625741",
                  boxShadow: isSelected ? "0 4px 12px rgba(58,122,48,0.35)" : "none",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  transform: isSelected ? "scale(1.05)" : "scale(1)",
                }}
              >
                {seasonLabels[s]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

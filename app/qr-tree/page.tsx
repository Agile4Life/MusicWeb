"use client";

import React, { useState } from "react";
import QRTreeMorph, { Season } from "@/components/QRTreeMorph";
import { Sparkles, QrCode, Trees, RefreshCw, Smartphone, ExternalLink, Check, Copy, Sliders, Layers, Palette } from "lucide-react";

export default function QRTreeDemoPage() {
  const [url, setUrl] = useState("https://tree.icqr.com");
  const [season, setSeason] = useState<Season>("summer");
  const [currentMode, setCurrentMode] = useState<"qr" | "tree">("qr");
  const [sizePreset, setSizePreset] = useState<"sm" | "md" | "lg">("md");
  const [copied, setCopied] = useState(false);
  const [useRealQR, setUseRealQR] = useState(true);

  const sizeMap = {
    sm: { width: 280, height: 380 },
    md: { width: 340, height: 460 },
    lg: { width: 420, height: 560 },
  };

  const samplePresets = [
    { label: "🌲 Tree ICQR", value: "https://tree.icqr.com" },
    { label: "🎵 MusicWeb App", value: "http://localhost:3000" },
    { label: "🐙 GitHub", value: "https://github.com" },
    { label: "🎧 Spotify", value: "https://open.spotify.com" },
    { label: "☕ Buy Me a Coffee", value: "https://buymeacoffee.com" },
  ];

  const handleCopyCode = () => {
    const code = `import QRTreeMorph from "@/components/QRTreeMorph";

<QRTreeMorph 
  value="${url}"
  defaultSeason="${season}"
  width={${sizeMap[sizePreset].width}}
  height={${sizeMap[sizePreset].height}}
/>`;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0d121c] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* Background Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/4 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-20 w-[500px] h-[500px] bg-amber-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 left-1/3 w-[450px] h-[450px] bg-emerald-800/15 rounded-full blur-3xl" />
      </div>

      {/* Navigation Header */}
      <header className="relative z-10 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-xl px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-amber-500 flex items-center justify-center shadow-lg shadow-emerald-900/40 text-white font-bold">
              <Trees className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-300 bg-clip-text text-transparent">
                QR Tree Morph 3D Voxel
              </h1>
              <p className="text-xs text-slate-400">Isometric Pixel Art & Real Scannable QR Matrix</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition"
            >
              ← Về Trang Chủ MusicWeb
            </a>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              60 FPS Canvas Engine
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Interactive Canvas Showcase */}
        <div className="lg:col-span-6 xl:col-span-7 flex flex-col items-center justify-center gap-6">
          <div className="w-full relative flex flex-col items-center p-8 rounded-3xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-2xl shadow-2xl shadow-black/60">
            
            {/* Morph Status Indicator */}
            <div className="w-full flex items-center justify-between mb-4 pb-4 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Trạng Thái:</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold transition-all ${
                  currentMode === "qr" 
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}>
                  {currentMode === "qr" ? "📱 Mã QR Isometric" : "🌳 Cây Pixel Bonsai"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUseRealQR(!useRealQR)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                    useRealQR
                      ? "bg-emerald-950/60 text-emerald-400 border-emerald-700/60 font-semibold"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                  title="Tự động sinh QR thật quét được bằng camera điện thoại"
                >
                  {useRealQR ? "✓ QR Thật (Quét Được)" : "Demo Pattern"}
                </button>
              </div>
            </div>

            {/* QR Tree Morph Canvas Component */}
            <div className="relative group">
              <QRTreeMorph
                key={`${url}-${season}-${sizePreset}-${useRealQR}`}
                value={url}
                useRealQR={useRealQR}
                season={season}
                defaultSeason="summer"
                width={sizeMap[sizePreset].width}
                height={sizeMap[sizePreset].height}
                onModeChange={(m) => setCurrentMode(m)}
              />
            </div>

            {/* Helpful Interaction Tip */}
            <div className="mt-6 flex items-center gap-2 text-xs text-slate-400 bg-slate-800/60 px-4 py-2 rounded-xl border border-slate-700/40">
              <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Mẹo quét mã:</strong> Khi ở dạng QR, bạn có thể đưa camera điện thoại lên màn hình để quét trực tiếp link <code className="text-emerald-300 font-mono">{url}</code>!
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Customizer & Controls */}
        <div className="lg:col-span-6 xl:col-span-5 flex flex-col gap-6">
          
          {/* Card 1: Input URL & Presets */}
          <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-xl shadow-xl">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-4">
              <QrCode className="w-4 h-4 text-emerald-400" />
              Nội Dung QR / Đường Dẫn (URL)
            </h2>

            <div className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Nhập đường link hoặc nội dung text..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-100 text-sm font-mono outline-none transition"
                />
              </div>

              {/* Quick Presets */}
              <div>
                <span className="text-xs text-slate-400 block mb-2 font-medium">Link mẫu nhanh:</span>
                <div className="flex flex-wrap gap-2">
                  {samplePresets.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setUrl(p.value)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition ${
                        url === p.value
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-medium"
                          : "bg-slate-800/70 text-slate-300 border-slate-700/60 hover:bg-slate-800"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Season & Canvas Configuration */}
          <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-xl shadow-xl space-y-5">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Palette className="w-4 h-4 text-amber-400" />
              Mùa & Kích Thước Canvas
            </h2>

            {/* Season Selector */}
            <div>
              <span className="text-xs text-slate-400 block mb-2 font-medium">Chọn Mùa Tán Cây:</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "spring", name: "Xuân (Hoa Đào)", emoji: "🌸", desc: "Tươi sáng, điểm hoa hồng" },
                  { id: "summer", name: "Hạ (Rực Rỡ)", emoji: "🌿", desc: "Xanh lục tươi mướt" },
                  { id: "autumn", name: "Thu (Lá Vàng)", emoji: "🍁", desc: "Cam vàng ấm áp" },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSeason(s.id as Season)}
                    className={`flex flex-col items-center text-center p-2.5 rounded-xl border transition ${
                      season === s.id
                        ? "bg-slate-800 border-amber-500/50 ring-1 ring-amber-500/30 text-white"
                        : "bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800/60"
                    }`}
                  >
                    <span className="text-lg">{s.emoji}</span>
                    <span className="text-xs font-semibold mt-1">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Canvas Dimensions */}
            <div>
              <span className="text-xs text-slate-400 block mb-2 font-medium">Kích Thước Khung Canvas:</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "sm", label: "Nhỏ (280x380)" },
                  { id: "md", label: "Vừa (340x460)" },
                  { id: "lg", label: "Lớn (420x560)" },
                ].map((sz) => (
                  <button
                    key={sz.id}
                    type="button"
                    onClick={() => setSizePreset(sz.id as "sm" | "md" | "lg")}
                    className={`py-2 px-3 text-xs rounded-xl border font-medium transition ${
                      sizePreset === sz.id
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950/50"
                        : "bg-slate-950/40 text-slate-400 border-slate-800 hover:bg-slate-800"
                    }`}
                  >
                    {sz.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Card 3: Code Snippet & Integration */}
          <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-xl shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Cách Nhúng Vào Project
              </h2>
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Đã copy!" : "Copy Code"}
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
              <code>{`import QRTreeMorph from "@/components/QRTreeMorph";

<QRTreeMorph 
  value="${url}" 
  defaultSeason="${season}"
/>`}</code>
            </pre>
          </div>

        </div>
      </main>
    </div>
  );
}

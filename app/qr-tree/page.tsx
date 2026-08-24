"use client";
// ---------------------------------------------------------------------------
// app/qr-tree/page.tsx — ICQR Magic Tree (Exact Match to tree.icqr.com)
// ---------------------------------------------------------------------------

import React, { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { type Season, SEASON_THEMES } from "@/components/qr-tree/seasonTheme";

const QRTreeScene = dynamic(() => import("@/components/qr-tree/QRTreeScene"), { ssr: false });

let qrcodegen: any = null;
function getQRGen() {
  if (!qrcodegen) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    qrcodegen = require("qrcode-generator");
  }
  return qrcodegen;
}

function generateQRMatrix(text: string): boolean[][] {
  try {
    const gen = getQRGen();
    const qr = gen(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  } catch {
    return Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => false));
  }
}

export default function QRTreePage() {
  const [url, setUrl] = useState("https://icqr.com/");
  const [inputValue, setInputValue] = useState("https://icqr.com/");
  const [season, setSeason] = useState<Season>("summer");
  const [isFlat, setIsFlat] = useState(true); // starts in Flat QR mode matching screenshot 1
  const [isMuted, setIsMuted] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  const matrix = useMemo(() => generateQRMatrix(url), [url]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;
    const finalUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setUrl(finalUrl);
    setIsFlat(false); // auto-morphs to tree on submit
  }, [inputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit]
  );

  const toggleFlat = useCallback(() => {
    setIsFlat((prev) => !prev);
  }, []);

  const theme = SEASON_THEMES[season];
  const hintText = isFlat ? "Tap to see the tree" : "Tap the tree to see QR code";

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        minHeight: "100dvh",
        overflow: "hidden",
        background: theme.bgColor,
        fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
        userSelect: "none",
      }}
    >
      {/* ---- Top Left: ICQR Logo Header ---- */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 22,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontFamily: "monospace",
            fontWeight: 900,
            fontSize: 24,
            letterSpacing: 2,
            color: "#3f352b",
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <span style={{ color: "#d4a017" }}>[</span>
          <span>ICQR</span>
          <span style={{ color: "#d4a017" }}>]</span>
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            backgroundColor: "#f5d342",
            color: "#4a3b00",
            padding: "2px 8px",
            borderRadius: 6,
            width: "fit-content",
            letterSpacing: 0.5,
          }}
        >
          {isFlat ? "👁️ 1 see QR" : "🌳 3D Tree"}
        </div>
      </div>

      {/* ---- Top Right: Info Icon ---- */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 22,
          zIndex: 20,
        }}
      >
        <button
          onClick={() => setShowInfo(!showInfo)}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "1px solid rgba(63, 53, 43, 0.2)",
            background: "rgba(247, 244, 237, 0.8)",
            color: "#3f352b",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}
          title="About ICQR Magic Tree"
        >
          ⓘ
        </button>
        {showInfo && (
          <div
            style={{
              position: "absolute",
              top: 36,
              right: 0,
              width: 240,
              padding: 14,
              borderRadius: 14,
              background: "rgba(247, 244, 237, 0.95)",
              border: "1px solid rgba(63, 53, 43, 0.15)",
              boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
              fontSize: 12,
              lineHeight: 1.5,
              color: "#5c4e3e",
              backdropFilter: "blur(12px)",
            }}
          >
            <strong>ICQR Magic Tree</strong>
            <p style={{ marginTop: 6, margin: 0 }}>
              Turns any URL into an artistic pixel-art QR code that morphs into a living 3D procedural tree.
            </p>
          </div>
        )}
      </div>

      {/* ---- Fullscreen 3D Canvas ---- */}
      <div style={{ position: "absolute", inset: 0 }}>
        <QRTreeScene
          matrix={matrix}
          url={url}
          season={season}
          isFlat={isFlat}
          onToggleFlat={toggleFlat}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* ---- Floating Controls Bottom Overlay ---- */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
          pointerEvents: "none",
        }}
      >
        {/* Helper Hint Pill */}
        <button
          onClick={toggleFlat}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "#6b5d4b",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.2,
            padding: "5px 16px",
            marginBottom: 12,
            borderRadius: 999,
            border: "1px solid rgba(158, 142, 121, 0.2)",
            background: "rgba(247, 244, 237, 0.85)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            pointerEvents: "auto",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            transition: "all 0.2s ease",
          }}
        >
          {hintText}
        </button>

        {/* Floating Controls Card */}
        <div
          style={{
            padding: "10px 14px 12px",
            width: "min(92vw, 440px)",
            boxSizing: "border-box",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderRadius: 20,
            background: "rgba(247, 243, 235, 0.92)",
            border: "1px solid rgba(220, 210, 195, 0.8)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 14px 35px rgba(60, 45, 20, 0.08)",
          }}
        >
          {/* Input Row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://your-link.com"
              style={{
                flex: 1,
                height: 42,
                backgroundColor: "rgba(255, 252, 247, 0.95)",
                borderRadius: 12,
                border: "1px solid rgba(175, 160, 140, 0.25)",
                color: "#3f352b",
                fontSize: 14,
                fontWeight: 500,
                padding: "0 14px",
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleSubmit}
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                border: "none",
                backgroundColor: "#b87333",
                color: "#ffffff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 2px 8px rgba(184, 115, 51, 0.3)",
                transition: "transform 0.15s ease, background 0.15s ease",
              }}
              title="Generate tree"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
          </div>

          {/* Season & Mute Row */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[
              { id: "spring" as Season, label: "Spring", icon: "🌸" },
              { id: "summer" as Season, label: "Summer", icon: "☀️" },
              { id: "autumn" as Season, label: "Autumn", icon: "🌧️" },
            ].map((s) => {
              const isActive = season === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSeason(s.id)}
                  style={{
                    flex: 1,
                    height: 38,
                    borderRadius: 10,
                    border: "none",
                    backgroundColor: isActive
                      ? "rgba(228, 218, 200, 0.95)"
                      : "rgba(215, 205, 190, 0.3)",
                    color: isActive ? "#3a2f22" : "#6e604e",
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    boxShadow: isActive ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              );
            })}

            {/* Mute Button */}
            <button
              onClick={() => setIsMuted(!isMuted)}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: "none",
                backgroundColor: "rgba(215, 205, 190, 0.3)",
                color: isMuted ? "#8a7d6d" : "#3a2f22",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              title={isMuted ? "Unmute sound" : "Mute sound"}
            >
              {isMuted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

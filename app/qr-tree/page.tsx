"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CloudRain, Flower2, Info, QrCode, Sun, Trees } from "lucide-react";
import { type Season, SEASON_THEMES } from "@/components/qr-tree/seasonTheme";
import styles from "./qr-tree.module.css";

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
  const [url, setUrl] = useState("https://musicweb.app/");
  const [inputValue, setInputValue] = useState("https://musicweb.app/");
  const [season, setSeason] = useState<Season>("summer");
  const [isFlat, setIsFlat] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showInfo) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowInfo(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showInfo]);

  const matrix = useMemo(() => generateQRMatrix(url), [url]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;
    const finalUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setUrl(finalUrl);
    setIsFlat(false);
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
  const hintText = isFlat ? "Nhấn để hóa thành Cây 3D" : "Nhấn vào cây để xem Mã QR";

  return (
    <div className={styles.page} style={{ background: theme.bgColor }}>
      {/* Top Left: MusicWeb Back Link & Mode Badge */}
      <div className={styles.topLeft}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={14} aria-hidden="true" />
            <span>MusicWeb</span>
          </Link>
          <div className={styles.wordmark}>
            <span className={styles.wordmarkBracket}>[</span>
            <span>QR TREE</span>
            <span className={styles.wordmarkBracket}>]</span>
          </div>
        </div>
        <div className={styles.modePill}>
          {isFlat ? <QrCode size={12} aria-hidden="true" /> : <Trees size={12} aria-hidden="true" />}
          <span>{isFlat ? "Chế độ Mã QR" : "Cây 3D Tương tác"}</span>
        </div>
      </div>

      {/* Top Right: Info Button & Popover */}
      <div className={styles.topRight} ref={infoRef}>
        <button
          type="button"
          className={styles.infoButton}
          onClick={() => setShowInfo((prev) => !prev)}
          title="Thông tin MusicWeb QR Tree"
          aria-expanded={showInfo}
          aria-label="Thông tin MusicWeb QR Tree"
        >
          <Info size={16} aria-hidden="true" />
        </button>
        {showInfo && (
          <div className={styles.infoPopover} role="dialog" aria-label="Giới thiệu QR Tree">
            <strong className={styles.infoPopoverTitle}>MusicWeb QR Tree</strong>
            <p className={styles.infoPopoverText}>
              Biến mọi đường dẫn bài hát hoặc liên kết thành mã QR nghệ thuật có thể chuyển đổi thành cây 3D theo mùa.
            </p>
          </div>
        )}
      </div>

      {/* Fullscreen 3D Canvas */}
      <div className={styles.canvasWrap}>
        <QRTreeScene
          matrix={matrix}
          url={url}
          season={season}
          isFlat={isFlat}
          onToggleFlat={toggleFlat}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* Floating Controls Bottom Overlay */}
      <div className={styles.controlsOverlay}>
        <button type="button" className={styles.hintPill} onClick={toggleFlat}>
          {isFlat ? <Trees size={13} aria-hidden="true" /> : <QrCode size={13} aria-hidden="true" />}
          <span>{hintText}</span>
        </button>

        <div className={styles.controlsCard}>
          {/* Input Row */}
          <div className={styles.inputRow}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://musicweb.app/"
              className={styles.urlInput}
              aria-label="Nhập URL tạo QR Tree"
            />
            <button
              type="button"
              onClick={handleSubmit}
              className={styles.submitButton}
              title="Tạo cây QR 3D"
            >
              <span>Tạo</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>

          {/* Season Selector Row */}
          <div className={styles.seasonRow}>
            {[
              { id: "spring" as Season, label: "Xuân", Icon: Flower2 },
              { id: "summer" as Season, label: "Hạ", Icon: Sun },
              { id: "autumn" as Season, label: "Thu", Icon: CloudRain },
            ].map(({ id, label, Icon }) => {
              const isActive = season === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSeason(id)}
                  className={`${styles.seasonButton} ${isActive ? styles.seasonButtonActive : ""}`}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

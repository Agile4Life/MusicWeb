"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudRain,
  Flower2,
  Info,
  QrCode,
  Sun,
  Trees,
} from "lucide-react";
import { EASE_OUT, SPRING_UI, popoverPanelProps } from "@/lib/motion";
import { type Season, SEASON_THEMES } from "@/components/qr-tree/seasonTheme";
import styles from "./qr-tree.module.css";

const QRTreeScene = dynamic(() => import("@/components/qr-tree/QRTreeScene"), { ssr: false });

type QRCodeFactory = (
  typeNumber: number,
  errorCorrectionLevel: "L" | "M" | "Q" | "H"
) => {
  addData: (data: string) => void;
  make: () => void;
  getModuleCount: () => number;
  isDark: (row: number, col: number) => boolean;
};

let qrcodegen: QRCodeFactory | null = null;
function getQRGen(): QRCodeFactory {
  if (!qrcodegen) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    qrcodegen = require("qrcode-generator") as QRCodeFactory;
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
    return Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => qr.isDark(r, c))
    );
  } catch {
    return Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => false));
  }
}

export default function QRTreePage() {
  const reducedMotion = Boolean(useReducedMotion());
  const [url, setUrl] = useState("https://musicweb.app/");
  const [inputValue, setInputValue] = useState("https://musicweb.app/");
  const [season, setSeason] = useState<Season>("summer");
  const [isFlat, setIsFlat] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [modeDip, setModeDip] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const prevFlatRef = useRef(isFlat);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    };
  }, []);

  // Gentle 180ms opacity dip on 2D <-> 3D toggle under reduced motion
  useEffect(() => {
    if (prevFlatRef.current === isFlat) return;
    prevFlatRef.current = isFlat;
    if (!reducedMotion) return;
    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    rafId = requestAnimationFrame(() => {
      setModeDip(true);
      timerId = setTimeout(() => setModeDip(false), 90);
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
    };
  }, [isFlat, reducedMotion]);

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
    setSubmitted(true);
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    submitTimerRef.current = setTimeout(() => setSubmitted(false), 1200);
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

  const handleCanvasReady = useCallback(() => {
    setCanvasReady(true);
  }, []);

  const theme = SEASON_THEMES[season];
  const hintText = isFlat ? "Nhấn để hóa thành Cây 3D" : "Nhấn vào cây để xem Mã QR";
  const pillTransition = { duration: 0.18, ease: EASE_OUT };

  return (
    <div className={styles.page} style={{ backgroundColor: theme.bgColor }}>
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isFlat ? "qr" : "tree"}
              className={styles.pillInner}
              initial={
                reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translate3d(0, 3px, 0)" }
              }
              animate={
                reducedMotion ? { opacity: 1 } : { opacity: 1, transform: "translate3d(0, 0, 0)" }
              }
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translate3d(0, -3px, 0)" }
              }
              transition={pillTransition}
            >
              {isFlat ? <QrCode size={12} aria-hidden="true" /> : <Trees size={12} aria-hidden="true" />}
              <span>{isFlat ? "Chế độ Mã QR" : "Cây 3D Tương tác"}</span>
            </motion.span>
          </AnimatePresence>
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
        <AnimatePresence>
          {showInfo && (
            <motion.div
              key="qr-info-popover"
              className={styles.infoPopover}
              role="dialog"
              aria-label="Giới thiệu QR Tree"
              style={{ transformOrigin: "calc(100% - 17px) top" }}
              {...popoverPanelProps(reducedMotion, "down")}
            >
              <strong className={styles.infoPopoverTitle}>MusicWeb QR Tree</strong>
              <p className={styles.infoPopoverText}>
                Biến mọi đường dẫn bài hát hoặc liên kết thành mã QR nghệ thuật có thể chuyển đổi thành cây 3D theo mùa.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fullscreen 3D Canvas */}
      <div
        className={`${styles.canvasWrap} ${canvasReady ? styles.canvasWrapReady : ""} ${modeDip ? styles.canvasWrapDipping : ""}`}
      >
        <QRTreeScene
          matrix={matrix}
          url={url}
          season={season}
          isFlat={isFlat}
          reducedMotion={reducedMotion}
          onToggleFlat={toggleFlat}
          onReady={handleCanvasReady}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* Floating Controls Bottom Overlay */}
      <div className={styles.controlsOverlay}>
        <button type="button" className={styles.hintPill} onClick={toggleFlat}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isFlat ? "to-tree" : "to-qr"}
              className={styles.pillInner}
              initial={
                reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translate3d(0, 3px, 0)" }
              }
              animate={
                reducedMotion ? { opacity: 1 } : { opacity: 1, transform: "translate3d(0, 0, 0)" }
              }
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translate3d(0, -3px, 0)" }
              }
              transition={pillTransition}
            >
              {isFlat ? <Trees size={13} aria-hidden="true" /> : <QrCode size={13} aria-hidden="true" />}
              <span>{hintText}</span>
            </motion.span>
          </AnimatePresence>
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
              className={`${styles.submitButton} ${submitted ? styles.submitButtonSuccess : ""}`}
              title="Tạo cây QR 3D"
            >
              <span>{submitted ? "Đã tạo" : "Tạo"}</span>
              <AnimatePresence mode="wait" initial={false}>
                {submitted ? (
                  <motion.span
                    key="check"
                    className={styles.iconSwap}
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(0.85)" }}
                    animate={reducedMotion ? { opacity: 1 } : { opacity: 1, transform: "scale(1)" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: EASE_OUT }}
                  >
                    <Check size={15} aria-hidden="true" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="arrow"
                    className={styles.iconSwap}
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(0.85)" }}
                    animate={reducedMotion ? { opacity: 1 } : { opacity: 1, transform: "scale(1)" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: EASE_OUT }}
                  >
                    <ArrowRight size={15} aria-hidden="true" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>

          {/* Season Selector Row */}
          <div className={styles.seasonRow} role="group" aria-label="Chọn mùa">
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
                  aria-pressed={isActive}
                  onClick={() => setSeason(id)}
                  className={`${styles.seasonButton} ${isActive ? styles.seasonButtonActive : ""}`}
                >
                  {isActive && (
                    <motion.span
                      layoutId={reducedMotion ? undefined : "qr-season-pill"}
                      className={styles.seasonPill}
                      initial={reducedMotion ? { opacity: 0 } : false}
                      animate={{ opacity: 1 }}
                      transition={reducedMotion ? { duration: 0.15, ease: "easeOut" } : SPRING_UI}
                      aria-hidden="true"
                    />
                  )}
                  <span className={styles.seasonLabel}>
                    <Icon size={14} aria-hidden="true" />
                    <span>{label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Titlebar } from "./titlebar";
import { SidebarPanel } from "./sidebar-panel";
import { GraphPanel } from "./graph-panel";
import { DetailPanel } from "./detail-panel";
import { SettingsPage } from "@/components/ui/settings-page";
import { getUiState, setUiState } from "@/lib/database";

const SIDEBAR_DEFAULT = 256; // w-64
const DETAIL_DEFAULT = 370;
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 320;
const DETAIL_MIN = 200;
const DETAIL_MAX = 480;
const CENTER_MIN = 120;

/** Clamp a panel width to its valid range, with NaN/Infinity protection. */
function clampWidth(w: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(w) || w <= 0) return fallback;
  return Math.max(min, Math.min(max, w));
}

/**
 * Shrink sidebar + detail so the center panel keeps at least CENTER_MIN px.
 * Called on DB restore and on every window resize.
 */
function fitPanels(
  sb: number,
  dt: number,
  containerWidth: number,
): { sidebar: number; detail: number } {
  const budget = containerWidth - CENTER_MIN;
  if (budget <= 0) return { sidebar: SIDEBAR_MIN, detail: DETAIL_MIN };
  if (sb + dt <= budget) return { sidebar: sb, detail: dt };

  // Proportionally shrink, respecting per-panel minimums
  const ratio = budget / (sb + dt);
  let newSb = Math.max(SIDEBAR_MIN, Math.round(sb * ratio));
  let newDt = Math.max(DETAIL_MIN, Math.round(dt * ratio));

  // If minimums still bust the budget, hard-cap
  if (newSb + newDt > budget) {
    newSb = SIDEBAR_MIN;
    newDt = Math.max(DETAIL_MIN, budget - newSb);
  }

  return { sidebar: newSb, detail: newDt };
}

export function AppLayout() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT);

  // ── Apply widths to both React state and the DOM refs ──────────────
  const applyWidths = useCallback((sb: number, dt: number) => {
    setSidebarWidth(sb);
    setDetailWidth(dt);
    if (sidebarRef.current) sidebarRef.current.style.width = `${sb}px`;
    if (detailRef.current) detailRef.current.style.width = `${dt}px`;
  }, []);

  // ── Restore saved widths on mount — retries if DB not initialized yet
  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const tryRestore = async () => {
      try {
        const [savedSidebar, savedDetail] = await Promise.all([
          getUiState("sidebar_width"),
          getUiState("detail_width"),
        ]);
        if (cancelled) return;

        // Parse and clamp to valid ranges
        const sb = savedSidebar
          ? clampWidth(Number(savedSidebar), SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT)
          : SIDEBAR_DEFAULT;
        const dt = savedDetail
          ? clampWidth(Number(savedDetail), DETAIL_MIN, DETAIL_MAX, DETAIL_DEFAULT)
          : DETAIL_DEFAULT;

        // Further clamp so both panels fit the current window
        const container = containerRef.current;
        const available = container ? container.clientWidth : window.innerWidth;
        const fitted = fitPanels(sb, dt, available);

        applyWidths(fitted.sidebar, fitted.detail);
      } catch {
        // DB not initialized yet — retry after a short delay
        if (!cancelled && retries < 5) {
          retries++;
          setTimeout(tryRestore, 500);
        }
      }
    };
    tryRestore();
    return () => { cancelled = true; };
  }, [applyWidths]);

  // ── Re-fit panels whenever the window (or container) resizes ───────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const available = container.clientWidth;
      // Read current actual widths from DOM (they may differ from state during drag)
      const currentSb = sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth;
      const currentDt = detailRef.current?.getBoundingClientRect().width ?? detailWidth;

      if (currentSb + currentDt + CENTER_MIN > available) {
        const fitted = fitPanels(currentSb, currentDt, available);
        applyWidths(fitted.sidebar, fitted.detail);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [applyWidths, sidebarWidth, detailWidth]);

  const saveSidebarWidth = useCallback((width: number) => {
    const clamped = clampWidth(width, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT);
    setSidebarWidth(clamped);
    setUiState("sidebar_width", String(clamped)).catch(() => {});
  }, []);

  const saveDetailWidth = useCallback((width: number) => {
    const clamped = clampWidth(width, DETAIL_MIN, DETAIL_MAX, DETAIL_DEFAULT);
    setDetailWidth(clamped);
    setUiState("detail_width", String(clamped)).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground select-none">
      {/* Custom titlebar — replaces native window chrome */}
      <Titlebar settingsOpen={settingsOpen} />

      {/* Settings fullpage view OR three-panel repo view */}
      {settingsOpen ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SettingsPage onClose={() => setSettingsOpen(false)} sidebarWidth={sidebarWidth} onSidebarResize={saveSidebarWidth} />
        </div>
      ) : (
        <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left sidebar — branches (flex-shrink default: shrinks when window narrows) */}
          <div ref={sidebarRef} style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN }}>
            <SidebarPanel onOpenSettings={() => setSettingsOpen(true)} />
          </div>

          <ResizeHandle
            side="left"
            panelRef={sidebarRef}
            minWidth={SIDEBAR_MIN}
            maxWidth={SIDEBAR_MAX}
            onResizeEnd={saveSidebarWidth}
          />

          {/* Center — commit graph (grows to fill, never shrinks below CENTER_MIN) */}
          <div className="grow shrink-0 basis-0 min-w-[120px]">
            <GraphPanel />
          </div>

          <ResizeHandle
            side="right"
            panelRef={detailRef}
            minWidth={DETAIL_MIN}
            maxWidth={DETAIL_MAX}
            onResizeEnd={saveDetailWidth}
          />

          {/* Right detail — commit info / diff (flex-shrink default: shrinks when window narrows) */}
          <div ref={detailRef} style={{ width: detailWidth, minWidth: DETAIL_MIN }}>
            <DetailPanel />
          </div>
        </div>
      )}
    </div>
  );
}

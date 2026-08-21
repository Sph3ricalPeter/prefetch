import { useCallback, useEffect, useRef, useState } from "react";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Titlebar } from "./titlebar";
import { SidebarPanel } from "./sidebar-panel";
import { GraphPanel } from "./graph-panel";
import { DetailPanel } from "./detail-panel";
import { StatusBar } from "./status-bar";
import { SettingsNav, SettingsContent, type SettingsTarget } from "@/components/ui/settings-page";
import { CloneDialog } from "@/components/ui/clone-dialog";
import { Toaster } from "@/components/ui/sonner";
import { getUiState, setUiState } from "@/lib/database";
import { useRepoStore } from "@/stores/repo-store";
const SIDEBAR_DEFAULT = 300;
const DETAIL_DEFAULT = 400;
const SIDEBAR_MIN = 250;
const SIDEBAR_MAX = 400;
const DETAIL_MIN = 350;
const DETAIL_MAX = 630;
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
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT);

  // The right detail column only makes sense for the commit graph, diffs, and
  // conflict resolution. When the CI job log takes over the center pane it
  // spans the whole card, so the detail column (and its handle) are dropped.
  // Mirrors the `showCiLog` condition in graph-panel.tsx.
  const showCiLog = useRepoStore(
    (s) => s.ciSelectedJobId != null && s.activeDiff === null && s.largeDiffPending === null,
  );

  // Does the detail column have anything to show? Mirrors the render branches in
  // detail-panel.tsx: a selected (and still-present) stash or commit, working-tree
  // changes, or an in-progress conflict. When false the panel would render only its
  // "Select a commit…" placeholder — so instead we collapse the column to zero width
  // and let the commit graph fill the whole card.
  const detailHasContent = useRepoStore((s) => {
    if (
      s.selectedStashIndex !== null &&
      s.stashes.some((st) => st.index === s.selectedStashIndex)
    )
      return true;
    if (s.selectedCommitId != null && s.commits.some((c) => c.id === s.selectedCommitId))
      return true;
    if (s.fileStatuses.length > 0) return true;
    if (s.conflictState?.in_progress) return true;
    return false;
  });

  // Collapse the detail column when it's empty (and not superseded by the CI log,
  // which already owns the full card).
  const detailCollapsed = !showCiLog && !detailHasContent;

  // Mirror collapse state into a ref so the imperative width writers (applyWidths /
  // the resize ResizeObserver, which run outside React render) don't pop a collapsed
  // panel back open or clobber the remembered expanded width.
  const detailCollapsedRef = useRef(detailCollapsed);
  useEffect(() => {
    detailCollapsedRef.current = detailCollapsed;
  }, [detailCollapsed]);

  // ── Apply widths to both React state and the DOM refs ──────────────
  const applyWidths = useCallback((sb: number, dt: number) => {
    setSidebarWidth(sb);
    setDetailWidth(dt);
    if (sidebarRef.current) sidebarRef.current.style.width = `${sb}px`;
    // Skip the detail DOM write while collapsed — React's inline style holds it at 0,
    // and a direct px write would briefly expand it.
    if (detailRef.current && !detailCollapsedRef.current)
      detailRef.current.style.width = `${dt}px`;
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
  // Both branches unmount the detail column while leaving `detailCollapsed`
  // false, so `detailRef` reads null and the fit maths below would size the
  // sidebar around a panel that isn't on screen.
  useEffect(() => {
    if (settingsTarget || showCiLog) return;
    const container = containerRef.current;
    if (!container) return;

    // Re-apply widths to the (possibly fresh) DOM refs
    if (sidebarRef.current) sidebarRef.current.style.width = `${sidebarWidth}px`;
    if (detailRef.current && !detailCollapsedRef.current)
      detailRef.current.style.width = `${detailWidth}px`;

    const observer = new ResizeObserver(() => {
      const available = container.clientWidth;
      const currentSb = sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth;

      // Detail collapsed → it takes no space, so only the sidebar can squeeze the
      // center. Shrink just the sidebar; never feed the 0-width detail back into
      // fitPanels (that would corrupt the remembered expanded width).
      if (detailCollapsedRef.current) {
        if (currentSb + CENTER_MIN > available) {
          const sb = Math.max(SIDEBAR_MIN, available - CENTER_MIN);
          setSidebarWidth(sb);
          if (sidebarRef.current) sidebarRef.current.style.width = `${sb}px`;
        }
        return;
      }

      const currentDt = detailRef.current?.getBoundingClientRect().width ?? detailWidth;
      if (currentSb + currentDt + CENTER_MIN > available) {
        const fitted = fitPanels(currentSb, currentDt, available);
        applyWidths(fitted.sidebar, fitted.detail);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [applyWidths, sidebarWidth, detailWidth, settingsTarget, showCiLog]);

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-shell text-foreground select-none">
      {/* Custom titlebar — replaces native window chrome */}
      <Titlebar settingsOpen={!!settingsTarget} onOpenClone={() => setCloneOpen(true)} onOpenSettings={(target) => setSettingsTarget(target ?? { tab: "general" })} />

      {/* The shell (padded container, sidebar column, handle, floating card,
          status bar) is permanent. Settings is not a separate page — it swaps
          the *content* of the sidebar and card slots, so panel widths survive
          the trip and both views share one set of surfaces. */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden pt-1 pr-2 pl-2 pb-1 bg-shell">
        {/* Left sidebar — blended into the shell, no divider (flex-shrink default: shrinks when window narrows) */}
        <div ref={sidebarRef} className="mr-1" style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN }}>
          {settingsTarget ? (
            <SettingsNav
              activeTab={settingsTarget.tab}
              onSelectTab={(tab) => setSettingsTarget({ tab })}
              onClose={() => setSettingsTarget(null)}
            />
          ) : (
            <SidebarPanel />
          )}
        </div>

        <ResizeHandle
          side="left"
          ghost
          panelRef={sidebarRef}
          minWidth={SIDEBAR_MIN}
          maxWidth={SIDEBAR_MAX}
          onResizeEnd={saveSidebarWidth}
        />

        {/* Floating card — commit graph (center) + detail (right) as two full-height columns.
            `basis-0` is load-bearing: without it the card's preferred width is its
            max-content, which balloons in the side-by-side diff (two columns of
            unwrapped code) and overflows the outer flex, squeezing the sidebar. With
            basis-0 the card grows purely from free space, so center content can't
            push the side panels around. */}
        <div className="relative ml-1 flex grow basis-0 min-w-0 overflow-hidden rounded-xl border border-border bg-background">
          {settingsTarget ? (
            <SettingsContent
              tab={settingsTarget.tab}
              focusProfileId={settingsTarget.profileId}
              onClose={() => setSettingsTarget(null)}
            />
          ) : (
            <>
              {/* Center — commit graph, diff viewer, or CI log viewer */}
              <div className="grow shrink-0 basis-0 min-w-[120px]">
                <GraphPanel />
              </div>

              {/* Right detail column — hidden while the CI log owns the center
                  pane (it spans the full card). Kept for graph / diff / conflicts.
                  When empty it collapses to zero width so the graph fills the card;
                  the handle is dropped while collapsed. */}
              {!showCiLog && (
                <>
                  {!detailCollapsed && (
                    <ResizeHandle
                      side="right"
                      ghost
                      className="ml-1"
                      panelRef={detailRef}
                      minWidth={DETAIL_MIN}
                      maxWidth={DETAIL_MAX}
                      onResizeEnd={saveDetailWidth}
                    />
                  )}

                  {/* Right detail — commit info / diff (flex-shrink default: shrinks when window narrows) */}
                  <div
                    ref={detailRef}
                    style={{
                      width: detailCollapsed ? 0 : detailWidth,
                      minWidth: detailCollapsed ? 0 : DETAIL_MIN,
                    }}
                  >
                    <DetailPanel />
                  </div>
                </>
              )}
            </>
          )}

          {/* Toasts anchor to the card's bottom-right, not the viewport's: above
              the status bar, and offset left past the detail column so they never
              cover it. `detailWidth` only updates on resize-end, so a toast raised
              mid-drag lags the handle — not worth reading the ref for. */}
          <Toaster
            offsetRight={settingsTarget || showCiLog || detailCollapsed ? 12 : detailWidth + 12}
          />
        </div>
      </div>
      <StatusBar onOpenSettings={(target) => setSettingsTarget(target ?? { tab: "general" })} />

      {cloneOpen && (
        <CloneDialog
          onClose={() => setCloneOpen(false)}
          onOpenSettings={(target) => {
            setCloneOpen(false);
            setSettingsTarget(target ?? { tab: "profiles" });
          }}
        />
      )}
    </div>
  );
}

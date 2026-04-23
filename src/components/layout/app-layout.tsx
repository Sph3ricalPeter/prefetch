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

export function AppLayout() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT);

  // Restore saved widths on mount — retries if DB not initialized yet
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
        if (savedSidebar) {
          const w = Number(savedSidebar);
          setSidebarWidth(w);
          if (sidebarRef.current) {
            sidebarRef.current.style.width = `${w}px`;
          }
        }
        if (savedDetail) {
          const w = Number(savedDetail);
          setDetailWidth(w);
          if (detailRef.current) {
            detailRef.current.style.width = `${w}px`;
          }
        }
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
  }, []);

  const saveSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(width);
    setUiState("sidebar_width", String(width)).catch(() => {});
  }, []);

  const saveDetailWidth = useCallback((width: number) => {
    setDetailWidth(width);
    setUiState("detail_width", String(width)).catch(() => {});
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
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left sidebar — branches */}
          <div ref={sidebarRef} className="shrink-0" style={{ width: sidebarWidth }}>
            <SidebarPanel onOpenSettings={() => setSettingsOpen(true)} />
          </div>

          <ResizeHandle
            side="left"
            panelRef={sidebarRef}
            minWidth={192}
            maxWidth={320}
            onResizeEnd={saveSidebarWidth}
          />

          {/* Center — commit graph */}
          <div className="flex-1 min-w-0">
            <GraphPanel />
          </div>

          <ResizeHandle
            side="right"
            panelRef={detailRef}
            minWidth={256}
            maxWidth={480}
            onResizeEnd={saveDetailWidth}
          />

          {/* Right detail — commit info / diff */}
          <div ref={detailRef} className="shrink-0" style={{ width: detailWidth }}>
            <DetailPanel />
          </div>
        </div>
      )}
    </div>
  );
}

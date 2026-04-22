import { useCallback, useEffect, useRef } from "react";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { SidebarPanel } from "./sidebar-panel";
import { GraphPanel } from "./graph-panel";
import { DetailPanel } from "./detail-panel";
import { getUiState, setUiState } from "@/lib/database";

const SIDEBAR_DEFAULT = 256; // w-64
const DETAIL_DEFAULT = 320;  // w-80

export function AppLayout() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Restore saved widths on mount
  useEffect(() => {
    (async () => {
      const [savedSidebar, savedDetail] = await Promise.all([
        getUiState("sidebar_width"),
        getUiState("detail_width"),
      ]);
      if (savedSidebar && sidebarRef.current) {
        sidebarRef.current.style.width = `${savedSidebar}px`;
      }
      if (savedDetail && detailRef.current) {
        detailRef.current.style.width = `${savedDetail}px`;
      }
    })();
  }, []);

  const saveSidebarWidth = useCallback((width: number) => {
    setUiState("sidebar_width", String(width)).catch(() => {});
  }, []);

  const saveDetailWidth = useCallback((width: number) => {
    setUiState("detail_width", String(width)).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground select-none">
      {/* Left sidebar — branches */}
      <div ref={sidebarRef} className="shrink-0" style={{ width: SIDEBAR_DEFAULT }}>
        <SidebarPanel />
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
      <div ref={detailRef} className="shrink-0" style={{ width: DETAIL_DEFAULT }}>
        <DetailPanel />
      </div>
    </div>
  );
}

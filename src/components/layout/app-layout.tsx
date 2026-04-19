import { useRef } from "react";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { SidebarPanel } from "./sidebar-panel";
import { GraphPanel } from "./graph-panel";
import { DetailPanel } from "./detail-panel";

export function AppLayout() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground select-none">
      {/* Left sidebar — branches */}
      <div ref={sidebarRef} className="w-64 shrink-0">
        <SidebarPanel />
      </div>

      <ResizeHandle
        side="left"
        panelRef={sidebarRef}
        minWidth={192}
        maxWidth={320}
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
      />

      {/* Right detail — commit info / diff */}
      <div ref={detailRef} className="w-80 shrink-0">
        <DetailPanel />
      </div>
    </div>
  );
}

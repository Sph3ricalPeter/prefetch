import { SidebarPanel } from "./sidebar-panel";
import { GraphPanel } from "./graph-panel";
import { DetailPanel } from "./detail-panel";

export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left sidebar — branches */}
      <div className="w-64 min-w-48 max-w-80 shrink-0 border-r border-border">
        <SidebarPanel />
      </div>

      {/* Center — commit graph */}
      <div className="flex-1 min-w-0">
        <GraphPanel />
      </div>

      {/* Right detail — commit info / diff */}
      <div className="w-80 min-w-64 max-w-[480px] shrink-0 border-l border-border">
        <DetailPanel />
      </div>
    </div>
  );
}

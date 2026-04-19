import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { SidebarPanel } from "./sidebar-panel";
import { GraphPanel } from "./graph-panel";
import { DetailPanel } from "./detail-panel";

export function AppLayout() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
          <SidebarPanel />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={30}>
          <GraphPanel />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          defaultSize={30}
          minSize={20}
          maxSize={45}
          collapsible
          collapsedSize={0}
        >
          <DetailPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

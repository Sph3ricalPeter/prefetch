import { useRef, useState } from "react";
import {
  ArrowLeft,
  Settings2,
  User,
  Database,
} from "lucide-react";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { GeneralSection } from "./settings/general-section";
import { ProfilesSection } from "./settings/profiles-section";
import { LfsSection } from "./settings/lfs-section";

type SettingsTab = "general" | "profiles" | "lfs";

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings2 className="h-3.5 w-3.5" /> },
  { id: "profiles", label: "Profiles", icon: <User className="h-3.5 w-3.5" /> },
  { id: "lfs", label: "LFS", icon: <Database className="h-3.5 w-3.5" /> },
];

interface SettingsPageProps {
  onClose: () => void;
  sidebarWidth?: number;
  onSidebarResize?: (width: number) => void;
}

export function SettingsPage({ onClose, sidebarWidth = 256, onSidebarResize }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const navRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full">
      {/* Left nav — resizable, shares width with main sidebar */}
      <div ref={navRef} className="shrink-0 bg-sidebar-background flex flex-col" style={{ width: sidebarWidth }}>
        {/* Back button */}
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors border-b border-border"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to repo
        </button>

        {/* Nav header */}
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
            Settings
          </h2>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-2 space-y-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                activeTab === tab.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Version info at bottom */}
        <div className="px-4 py-3 border-t border-border">
          <p className="text-caption text-faint">
            Prefetch v0.4.0
          </p>
        </div>
      </div>

      <ResizeHandle
        side="left"
        panelRef={navRef}
        minWidth={192}
        maxWidth={320}
        onResizeEnd={onSidebarResize}
      />

      {/* Right content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {activeTab === "general" && <GeneralSection />}
          {activeTab === "profiles" && <ProfilesSection />}
          {activeTab === "lfs" && <LfsSection />}
        </div>
      </div>
    </div>
  );
}

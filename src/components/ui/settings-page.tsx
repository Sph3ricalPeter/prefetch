import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Settings2,
  User,
  Database,
  Palette,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { GeneralSection } from "./settings/general-section";
import { AppearanceSection } from "./settings/appearance-section";
import { ProfilesSection } from "./settings/profiles-section";
import { LfsSection } from "./settings/lfs-section";

export type SettingsTab = "general" | "appearance" | "profiles" | "lfs";

export interface SettingsTarget {
  tab: SettingsTab;
  profileId?: string;
}

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings2 className="h-3.5 w-3.5" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="h-3.5 w-3.5" /> },
  { id: "profiles", label: "Profiles", icon: <User className="h-3.5 w-3.5" /> },
  { id: "lfs", label: "LFS", icon: <Database className="h-3.5 w-3.5" /> },
];

/**
 * Settings tab list — fills the sidebar slot in AppLayout, replacing SidebarPanel.
 * The slot owns the width, background and resize handle, so this renders
 * transparent on the shell just like the repo sidebar does.
 */
export function SettingsNav({
  activeTab,
  onSelectTab,
  onClose,
}: {
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex h-full flex-col bg-shell">
      <button
        onClick={onClose}
        className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to repo
      </button>

      <div className="my-1 mr-2 border-t border-border" />

      {/* Same collapsible header the repo sidebar uses for Branches / Stash / Tags */}
      <SectionHeader
        label="Settings"
        isOpen={open}
        onToggle={() => setOpen(!open)}
      />

      {open && (
        <nav className="pr-2 space-y-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
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
      )}
    </div>
  );
}

/**
 * Settings body — fills the center card slot in AppLayout, spanning the whole
 * card (the detail column is dropped while settings is open, same as the CI log).
 */
export function SettingsContent({
  tab,
  focusProfileId,
  onClose,
}: {
  tab: SettingsTab;
  focusProfileId?: string;
  onClose: () => void;
}) {
  // Mouse back button (button 3) closes settings
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [onClose]);

  return (
    // `scrollbar-gutter: stable both-edges` reserves the 6px scrollbar track on
    // both sides whether or not this tab scrolls. Without it the centered column
    // shifts 3px left the moment a scrollbar appears, so it visibly jumps between
    // tabs (General/Appearance scroll, LFS/Profiles don't).
    <div className="grow basis-0 min-w-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
      <div className="max-w-3xl mx-auto px-8 py-6">
        {tab === "general" && <GeneralSection />}
        {tab === "appearance" && <AppearanceSection />}
        {tab === "profiles" && <ProfilesSection focusProfileId={focusProfileId} />}
        {tab === "lfs" && <LfsSection />}
      </div>
    </div>
  );
}

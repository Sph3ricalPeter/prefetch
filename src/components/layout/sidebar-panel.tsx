import { useState } from "react";
import { Settings } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { BranchList } from "@/components/sidebar/branch-list";
import { StashList } from "@/components/sidebar/stash-list";
import { TagList } from "@/components/sidebar/tag-list";
import { SettingsModal } from "@/components/ui/settings-modal";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function SidebarPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const [filter, setFilter] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-sidebar-background">
        <p className="text-xs text-muted-foreground">No repo open</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-sidebar-background">
      {/* Filter input */}
      <div className="px-3 pt-2 pb-2">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded bg-background border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Branches */}
        <BranchList filter={filter} />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* Stash */}
        <StashList filter={filter} />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* Tags */}
        <TagList filter={filter} />
      </div>

      {/* Sidebar footer — forge status + settings */}
      <div className="border-t border-border px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground truncate flex items-center">
          {forgeStatus?.host && (
            <>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 shrink-0 ${
                  forgeStatus.has_token ? "bg-green-500" : "bg-yellow-500"
                }`}
              />
              {forgeStatus.owner}/{forgeStatus.repo}
            </>
          )}
          {lfsInfo?.initialized && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 shrink-0 cursor-default">
                  LFS
                </span>
              </TooltipTrigger>
              <TooltipContent>
                LFS active — {lfsInfo.file_count} file{lfsInfo.file_count !== 1 ? "s" : ""} tracked
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowSettings(true)}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

import { useState } from "react";
import { Settings } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { BranchList } from "@/components/sidebar/branch-list";
import { StashList } from "@/components/sidebar/stash-list";
import { TagList } from "@/components/sidebar/tag-list";
import { ProfileSwitcher } from "@/components/ui/profile-switcher";
import { ProfileModal } from "@/components/ui/profile-modal";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function SidebarPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const [filter, setFilter] = useState("");
  const [showProfiles, setShowProfiles] = useState(false);

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
      <div className="px-3 pt-2 pb-1.5">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md bg-background border border-border px-2.5 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
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

      {/* Sidebar footer — profile switcher + forge status + settings */}
      <div className="border-t border-border px-3 py-2 flex items-center gap-2">
        <ProfileSwitcher onManageProfiles={() => setShowProfiles(true)} />

        <span className="text-xs text-muted-foreground truncate flex items-center ml-auto">
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
                <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-caption font-medium text-dim shrink-0 cursor-default">
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
              onClick={onOpenSettings}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>

      {showProfiles && (
        <ProfileModal onClose={() => setShowProfiles(false)} />
      )}
    </div>
  );
}

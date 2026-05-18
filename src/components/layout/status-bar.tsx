import { Settings, Check, AlertTriangle } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { ForgeIcon } from "@/components/ui/forge-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { SettingsTarget } from "@/components/ui/settings-page";
import { useProfileStore } from "@/stores/profile-store";

export function StatusBar({ onOpenSettings }: { onOpenSettings: (target?: SettingsTarget) => void }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const commits = useRepoStore((s) => s.commits);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const activeProfile = useProfileStore((s) => s.activeProfile);

  if (!repoPath) return null;

  return (
    <div className="flex h-6 shrink-0 items-center border-t border-border bg-background px-3 text-xs text-muted-foreground select-none">
      <div className="flex-1" />

      {/* Right: forge status, commit count, LFS, settings */}
      <div className="flex items-center gap-3">
        {forgeStatus?.host && forgeStatus.kind && (
          forgeStatus.has_token ? (
            <span className="flex items-center gap-1.5">
              <ForgeIcon kind={forgeStatus.kind} className="h-3 w-3" />
              <span>{forgeStatus.owner}/{forgeStatus.repo}</span>
              <Check className="h-3 w-3 text-green-500" />
            </span>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onOpenSettings({ tab: "profiles", profileId: activeProfile?.id })}
                  className="flex items-center gap-1.5 rounded px-1 -mx-1 hover:bg-accent hover:text-foreground transition-colors"
                >
                  <ForgeIcon kind={forgeStatus.kind} className="h-3 w-3" />
                  <span>{forgeStatus.owner}/{forgeStatus.repo}</span>
                  <AlertTriangle className="h-3 w-3 text-yellow-500" />
                </button>
              </TooltipTrigger>
              <TooltipContent>No token configured — click to set up</TooltipContent>
            </Tooltip>
          )
        )}
        {commits.length > 0 && (
          <span>{commits.length.toLocaleString()} commits</span>
        )}
        {lfsInfo?.initialized && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="rounded bg-accent px-1.5 py-0.5 text-label font-medium text-dim cursor-default">
                LFS
              </span>
            </TooltipTrigger>
            <TooltipContent>
              LFS active — {lfsInfo.file_count} file{lfsInfo.file_count !== 1 ? "s" : ""} tracked
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onOpenSettings()}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

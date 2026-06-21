import { useMemo } from "react";
import { Settings, Check, AlertTriangle, GitCommit } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useRepoStore } from "@/stores/repo-store";
import { ForgeIcon } from "@/components/ui/forge-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { SettingsTarget } from "@/components/ui/settings-page";
import { useProfileStore } from "@/stores/profile-store";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export function StatusBar({ onOpenSettings }: { onOpenSettings: (target?: SettingsTarget) => void }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const commits = useRepoStore((s) => s.commits);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const activeProfile = useProfileStore((s) => s.activeProfile);

  const todayMetrics = useMemo(() => {
    if (!activeProfile || commits.length === 0) return null;
    const profileEmail = activeProfile.user_email.toLowerCase();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const endOfDay = startOfDay + 86400;
    const mine = commits
      .filter((c) => c.author_email.toLowerCase() === profileEmail && c.timestamp >= startOfDay && c.timestamp < endOfDay)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (mine.length === 0) return null;
    const span = mine[mine.length - 1].timestamp - mine[0].timestamp;
    return {
      count: mine.length,
      spanSec: span,
      avgGapSec: mine.length > 1 ? span / (mine.length - 1) : null,
    };
  }, [commits, activeProfile]);

  if (!repoPath) return null;

  return (
    <div className="flex h-6 shrink-0 items-center bg-shell px-3 text-xs text-muted-foreground select-none">
      <div className="flex-1" />

      {/* Right: forge status, user metrics, commit count, LFS, settings */}
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
                  className="flex items-center gap-1.5 rounded-md px-1 -mx-1 hover:bg-accent hover:text-foreground transition-colors"
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
        {todayMetrics && (
          <>
            <span className="text-border" aria-hidden>|</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1.5 cursor-default">
                  <GitCommit className="h-3 w-3" />
                  <span>
                    {todayMetrics.count} commit{todayMetrics.count !== 1 ? "s" : ""} today
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-0.5">
                  <div>
                    Total span: {todayMetrics.spanSec > 0 ? formatDuration(todayMetrics.spanSec) : "—"}
                  </div>
                  <div>
                    Avg between commits:{" "}
                    {todayMetrics.avgGapSec !== null ? formatDuration(todayMetrics.avgGapSec) : "—"}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {commits.length > 0 && (
          <span>{commits.length.toLocaleString()} commits</span>
        )}
        {lfsInfo?.initialized && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="rounded-md bg-accent px-1.5 py-0.5 text-label font-medium text-dim cursor-default">
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
            <IconButton
              size="sm"
              onClick={() => onOpenSettings()}
              className="shrink-0 hover:bg-accent"
            >
              <Settings className="h-3 w-3" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

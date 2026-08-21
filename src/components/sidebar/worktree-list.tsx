import { useState } from "react";
import { FolderGit2, FolderOpen, Lock, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { usePausedOperation } from "@/hooks/use-paused-operation";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { RemoveWorktreeDialog } from "@/components/ui/worktree-dialogs";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { SectionHeader } from "@/components/ui/section-header";
import { ACTION_ICONS } from "@/lib/action-icons";
import { cn } from "@/lib/utils";
import type { WorktreeInfo } from "@/types/git";

/** Last path segment — the whole path is long and its tail is what identifies it. */
function leafOf(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** What the row calls this worktree: its branch, or a short SHA when detached. */
function labelOf(wt: WorktreeInfo): string {
  return wt.branch ?? `${wt.head.slice(0, 7)} (detached)`;
}

export function WorktreeList() {
  const worktrees = useRepoStore((s) => s.worktrees);
  const filter = useRepoStore((s) => s.filterQuery);
  const pruneWorktrees = useRepoStore((s) => s.pruneWorktrees);
  const revealWorktree = useRepoStore((s) => s.revealWorktree);
  const pausedOperation = usePausedOperation();
  const isLoading = useRepoStore((s) => s.isLoading);
  const isOpen = useRepoStore((s) => s.sidebarSections.worktrees);
  const setSidebarSection = useRepoStore((s) => s.setSidebarSection);
  const [contextMenu, setContextMenu] = useState<{
    worktree: WorktreeInfo;
    x: number;
    y: number;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<WorktreeInfo | null>(null);

  // Every repo has a main worktree, so one entry says nothing — the section
  // only earns its space once a linked worktree exists.
  if (worktrees.length <= 1) return null;

  const hasPrunable = worktrees.some((w) => w.prunable != null);

  // Filter dims non-matching rows rather than hiding them.
  const q = filter.trim().toLowerCase();
  const isDimmed = (wt: WorktreeInfo) =>
    q !== "" &&
    !labelOf(wt).toLowerCase().includes(q) &&
    !wt.path.toLowerCase().includes(q);

  return (
    <div>
      {/* Divider lives here, not in sidebar-panel, so it disappears along with
          the section when there are no linked worktrees. */}
      <div className="my-1 border-t border-border" />

      <SectionHeader
        label="Worktrees"
        count={worktrees.length}
        isOpen={isOpen}
        onToggle={() => setSidebarSection("worktrees", !isOpen)}
      />

      {isOpen && (
        <div>
          {worktrees.map((wt) => (
            <div
              key={wt.path}
              onDoubleClick={() => revealWorktree(wt.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ worktree: wt, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                "group flex items-center gap-1.5 rounded-md px-2 py-1 my-1 text-xs cursor-pointer transition-colors",
                wt.is_current
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
                isDimmed(wt) && FILTER_DIM_CLASS,
              )}
            >
              <FolderGit2 className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1">
                <HighlightedText text={labelOf(wt)} />
              </span>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate text-label text-faint max-w-24 shrink-0">
                    {wt.is_current ? "current" : wt.is_main ? "main" : leafOf(wt.path)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{wt.path}</TooltipContent>
              </Tooltip>

              {wt.locked != null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="h-3 w-3 shrink-0 text-faint" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {wt.locked ? `Locked: ${wt.locked}` : "Locked"}
                  </TooltipContent>
                </Tooltip>
              )}

              {wt.prunable != null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {wt.prunable || "Stale — directory is missing"}
                  </TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    size="sm"
                    reveal="fade"
                    onClick={(e) => {
                      e.stopPropagation();
                      revealWorktree(wt.path);
                    }}
                    className="shrink-0 hover:bg-accent"
                  >
                    <FolderOpen className="h-3 w-3" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>Reveal in file manager</TooltipContent>
              </Tooltip>

              {/* The main worktree is the repository itself, and removing the
                  open one orphans the directory the app is running from. */}
              {!wt.is_main && !wt.is_current && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      size="sm"
                      variant="subtle"
                      reveal="fade"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmRemove(wt);
                      }}
                      disabled={isLoading || pausedOperation !== null}
                      className="shrink-0 hover:bg-destructive/20 hover:text-destructive-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </IconButton>
                  </TooltipTrigger>
                  <TooltipContent>Remove worktree</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildWorktreeContextMenuItems(
            contextMenu.worktree,
            hasPrunable,
            revealWorktree,
            setConfirmRemove,
            pruneWorktrees,
          )}
          onClose={() => setContextMenu(null)}
        />
      )}

      {confirmRemove && (
        <RemoveWorktreeDialog
          path={confirmRemove.path}
          label={labelOf(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

function buildWorktreeContextMenuItems(
  worktree: WorktreeInfo,
  hasPrunable: boolean,
  revealWorktree: (path: string) => void,
  confirmRemove: (wt: WorktreeInfo) => void,
  pruneWorktrees: () => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      label: "Reveal in file manager",
      onClick: () => revealWorktree(worktree.path),
      icon: ACTION_ICONS["Reveal Worktree"],
    },
    {
      label: "Copy path",
      onClick: () => navigator.clipboard.writeText(worktree.path),
      icon: ACTION_ICONS.Copy,
    },
  ];

  if (!worktree.is_main && !worktree.is_current) {
    items.push({ separator: true });
    items.push({
      label: "Remove worktree…",
      onClick: () => confirmRemove(worktree),
      writesRepo: true,
      destructive: true,
      icon: ACTION_ICONS["Remove Worktree"],
    });
  }

  // Only worth offering when git has something to clean up.
  if (hasPrunable) {
    items.push({ separator: true });
    items.push({
      label: "Prune stale worktrees",
      onClick: () => pruneWorktrees(),
      writesRepo: true,
      icon: ACTION_ICONS["Prune Worktrees"],
    });
  }

  return items;
}

import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  RefreshCw,
  ArrowLeft,
  FolderGit2,
  X,
  AlertTriangle,
} from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { CommitGraphCanvas } from "@/components/graph/commit-graph-canvas";
import { DiffViewer } from "@/components/staging/diff-viewer";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function GraphPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const commits = useRepoStore((s) => s.commits);
  const edges = useRepoStore((s) => s.edges);
  const totalLanes = useRepoStore((s) => s.totalLanes);
  const selectedCommitId = useRepoStore((s) => s.selectedCommitId);
  const selectedFilePath = useRepoStore((s) => s.selectedFilePath);
  const activeDiff = useRepoStore((s) => s.activeDiff);
  const isLoading = useRepoStore((s) => s.isLoading);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const stashes = useRepoStore((s) => s.stashes);
  const branches = useRepoStore((s) => s.branches);
  const tags = useRepoStore((s) => s.tags);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const headCommitId = useRepoStore((s) => s.headCommitId);
  const largeDiffPending = useRepoStore((s) => s.largeDiffPending);
  const diffLoading = useRepoStore((s) => s.diffLoading);

  const openRepository = useRepoStore((s) => s.openRepository);
  const selectCommit = useRepoStore((s) => s.selectCommit);
  const clearDiff = useRepoStore((s) => s.clearDiff);
  const loadPendingDiff = useRepoStore((s) => s.loadPendingDiff);
  const clearSelection = useRepoStore((s) => s.clearSelection);
  const loadStatus = useRepoStore((s) => s.loadStatus);
  const checkout = useRepoStore((s) => s.checkout);
  const undoInfo = useRepoStore((s) => s.undoInfo);
  const undoAction = useRepoStore((s) => s.undo);
  const remoteCheckoutPending = useRepoStore((s) => s.remoteCheckoutPending);
  const resetLocalToRemote = useRepoStore((s) => s.resetLocalToRemote);
  const cancelRemoteCheckout = useRepoStore((s) => s.cancelRemoteCheckout);
  const forcePushPending = useRepoStore((s) => s.forcePushPending);
  const forcePush = useRepoStore((s) => s.forcePush);
  const cancelForcePush = useRepoStore((s) => s.cancelForcePush);
  const conflictState = useRepoStore((s) => s.conflictState);
  const cherryPick = useRepoStore((s) => s.cherryPick);
  const rebaseOnto = useRepoStore((s) => s.rebaseOnto);
  const resetTo = useRepoStore((s) => s.resetTo);
  const abortOp = useRepoStore((s) => s.abortOperation);
  const continueOp = useRepoStore((s) => s.continueOperation);
  const currentBranch = useRepoStore((s) => s.currentBranch);

  const [commitContextMenu, setCommitContextMenu] = useState<{
    commitId: string;
    x: number;
    y: number;
  } | null>(null);
  const [confirmResetHard, setConfirmResetHard] = useState<string | null>(null);

  // Ctrl+Z undo shortcut (global)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        // Don't intercept if focused on an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (undoInfo?.can_undo) {
          e.preventDefault();
          undoAction();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoInfo, undoAction]);


  const handleOpenRepo = useCallback(async () => {
    const selected = await open({
      directory: true,
      title: "Open Git Repository",
    });
    if (selected) {
      await openRepository(selected);
    }
  }, [openRepository]);

  const recentRepos = useRepoStore((s) => s.recentRepos);
  const removeFromRecentRepos = useRepoStore((s) => s.removeFromRecentRepos);

  // No repo open — welcome screen
  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-background">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Open a repository to get started
          </p>
          <button
            onClick={handleOpenRepo}
            disabled={isLoading}
            className="rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {isLoading ? "Opening..." : "Open Repository"}
          </button>
        </div>

        {recentRepos.length > 0 && (
          <div className="mt-2 w-full max-w-sm">
            <p className="mb-2 text-label font-medium text-faint uppercase tracking-[0.08em] text-center">
              Recent Repositories
            </p>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border overflow-hidden">
              {recentRepos.map((repo) => {
                const profileName = repo.profile_id
                  ? useProfileStore.getState().profiles.find((p) => p.id === repo.profile_id)?.name
                  : null;
                return (
                  <div
                    key={repo.path}
                    className="group flex items-center gap-2 bg-card px-3 py-2 cursor-pointer transition-colors hover:bg-secondary"
                    onClick={() => openRepository(repo.path)}
                  >
                    <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-foreground truncate">
                        {repo.name}
                      </span>
                      <span className="text-label text-faint truncate">
                        {repo.path}
                      </span>
                    </div>
                    {profileName && (
                      <span className="shrink-0 rounded-sm bg-brand/10 px-1.5 py-0.5 text-caption font-medium text-brand-dim">
                        {profileName}
                      </span>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromRecentRepos(repo.path);
                          }}
                          className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Remove from recent</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Empty repo
  if (!isLoading && commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">No commits yet</p>
      </div>
    );
  }

  const showDiff = activeDiff !== null;
  const showLargeDiffGuard = largeDiffPending !== null;

  return (
    <div className="relative flex h-full flex-col bg-background">
      {/* Toolbar — only shown for diff breadcrumb, Change 5: buttons moved to titlebar */}
      {(showDiff || showLargeDiffGuard || (diffLoading && selectedFilePath)) && (
        <div className="shrink-0">
          <div className="flex min-h-9 items-center px-3 py-1">
            <button
              onClick={clearDiff}
              className="mr-2 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <span className="truncate text-xs font-medium text-foreground">
              {selectedFilePath}
            </span>
            <RefreshCw
              className={`ml-2 h-3 w-3 shrink-0 text-muted-foreground animate-spin transition-opacity duration-100 ${diffLoading ? "opacity-100" : "opacity-0"}`}
            />
          </div>
          <div className="mx-3 border-t border-border" />
        </div>
      )}

      {/* Conflict banner */}
      {conflictState?.in_progress && (() => {
        const unresolvedCount = fileStatuses.filter((f) => f.is_conflicted).length;
        return (
          <div className="flex items-center gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
            <span className="flex-1 text-xs text-yellow-200">
              {conflictState.operation.charAt(0).toUpperCase() + conflictState.operation.slice(1)} in progress
              {unresolvedCount > 0 && (
                <> — <span className="font-medium text-yellow-100">{unresolvedCount} conflict{unresolvedCount !== 1 ? "s" : ""} to resolve</span></>
              )}
            </span>
            <button
              onClick={continueOp}
              disabled={unresolvedCount > 0}
              className="rounded px-2 py-0.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
            </button>
            <button
              onClick={abortOp}
              className="rounded px-2 py-0.5 text-xs font-medium text-red-400 hover:bg-destructive/20 transition-colors"
            >
              Abort
            </button>
          </div>
        );
      })()}

      {/* Center content: graph, diff, or large diff guard */}
      <div className="flex-1 min-h-0">
        {showLargeDiffGuard ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Large diff — {largeDiffPending.totalChanges.toLocaleString()} changed lines
            </p>
            <button
              onClick={loadPendingDiff}
              disabled={largeDiffPending.loading}
              className="rounded-md bg-secondary px-4 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-40"
            >
              Load anyway
            </button>
          </div>
        ) : showDiff ? (
          <div className="h-full overflow-auto">
            <DiffViewer diff={activeDiff} />
          </div>
        ) : (
          <CommitGraphCanvas
            commits={commits}
            edges={edges}
            totalLanes={totalLanes}
            selectedCommitId={selectedCommitId}
            headCommitId={headCommitId}
            onSelectCommit={selectCommit}
            onCheckoutBranch={checkout}
            branches={branches}
            tags={tags}
            stashes={stashes}
            hasUncommittedChanges={fileStatuses.length > 0}
            fileStatusCount={fileStatuses.length}
            isWipSelected={selectedCommitId === null && selectedStashIndex === null}
            onClickWip={() => { clearSelection(); loadStatus(); }}
            onCommitContextMenu={(commitId, x, y) => setCommitContextMenu({ commitId, x, y })}
          />
        )}
      </div>

      {/* Commit context menu */}
      {commitContextMenu && (
        <ContextMenu
          x={commitContextMenu.x}
          y={commitContextMenu.y}
          items={buildCommitContextMenuItems(
            commitContextMenu.commitId,
            currentBranch,
            cherryPick,
            (id, mode) => {
              if (mode === "hard") {
                setConfirmResetHard(id);
              } else {
                resetTo(id, mode);
              }
            },
            rebaseOnto,
          )}
          onClose={() => setCommitContextMenu(null)}
        />
      )}

      {/* Remote checkout dialog */}
      {remoteCheckoutPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-sm">
            <p className="text-sm text-foreground mb-1">
              A local &apos;{remoteCheckoutPending.localName}&apos; already exists.
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Choose how to handle the remote branch checkout.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelRemoteCheckout}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  cancelRemoteCheckout();
                  checkout(remoteCheckoutPending.localName);
                }}
                className="rounded bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-accent transition-colors"
              >
                Switch to Local
              </button>
              <button
                onClick={resetLocalToRemote}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Reset Local to Remote
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset hard confirmation */}
      {confirmResetHard && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Reset hard?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will discard all changes and move the branch to {confirmResetHard.slice(0, 7)}. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmResetHard(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  resetTo(confirmResetHard, "hard");
                  setConfirmResetHard(null);
                }}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Reset Hard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force push confirmation */}
      {forcePushPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Force push?</p>
            <p className="text-xs text-muted-foreground mb-4">
              The remote branch has diverged from your local branch. Force pushing will overwrite the remote history. This uses --force-with-lease for safety.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelForcePush}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={forcePush}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Force Push
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildCommitContextMenuItems(
  commitId: string,
  currentBranch: string | null,
  cherryPick: (id: string) => void,
  resetTo: (id: string, mode: "soft" | "hard") => void,
  rebaseOnto: (target: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  items.push({
    label: `Cherry-pick onto ${currentBranch ?? "HEAD"}`,
    onClick: () => cherryPick(commitId),
  });

  if (currentBranch) {
    items.push({
      label: `Rebase ${currentBranch} onto here`,
      onClick: () => rebaseOnto(commitId),
    });
  }

  items.push({
    label: "Reset soft to here (keep changes)",
    onClick: () => resetTo(commitId, "soft"),
  });

  items.push({
    label: "Reset hard to here",
    onClick: () => resetTo(commitId, "hard"),
    destructive: true,
  });

  items.push({
    label: `Copy SHA: ${commitId.slice(0, 7)}`,
    onClick: () => navigator.clipboard.writeText(commitId),
  });

  return items;
}

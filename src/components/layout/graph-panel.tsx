import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  FolderGit2,
  X,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { CommitGraphCanvas } from "@/components/graph/commit-graph-canvas";
import { DiffViewer } from "@/components/staging/diff-viewer";
import { ConflictEditor } from "@/components/staging/conflict-editor";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import type { BranchInfo, ForgeStatus } from "@/types/git";
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
  const selectedFileStaged = useRepoStore((s) => s.selectedFileStaged);
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
  const dirtyCheckoutPending = useRepoStore((s) => s.dirtyCheckoutPending);
  const stashAndCheckout = useRepoStore((s) => s.stashAndCheckout);
  const discardAndCheckout = useRepoStore((s) => s.discardAndCheckout);
  const cancelDirtyCheckout = useRepoStore((s) => s.cancelDirtyCheckout);
  const remoteCheckoutPending = useRepoStore((s) => s.remoteCheckoutPending);
  const resetLocalToRemote = useRepoStore((s) => s.resetLocalToRemote);
  const cancelRemoteCheckout = useRepoStore((s) => s.cancelRemoteCheckout);
  const forcePushPending = useRepoStore((s) => s.forcePushPending);
  const forcePush = useRepoStore((s) => s.forcePush);
  const cancelForcePush = useRepoStore((s) => s.cancelForcePush);
  const conflictState = useRepoStore((s) => s.conflictState);
  const cherryPick = useRepoStore((s) => s.cherryPick);
  const rebaseOnto = useRepoStore((s) => s.rebaseOnto);
  const mergeInto = useRepoStore((s) => s.mergeInto);
  const resetTo = useRepoStore((s) => s.resetTo);
  const revertCommit = useRepoStore((s) => s.revertCommit);
  const checkoutDetached = useRepoStore((s) => s.checkoutDetached);
  const createBranchAtAction = useRepoStore((s) => s.createBranchAt);
  const createNewTag = useRepoStore((s) => s.createNewTag);
  const deleteBranch = useRepoStore((s) => s.deleteBranch);
  const deleteRemoteBranch = useRepoStore((s) => s.deleteRemoteBranch);
  const renameBranch = useRepoStore((s) => s.renameBranch);
  const pull = useRepoStore((s) => s.pull);
  const push = useRepoStore((s) => s.push);
  const setUpstream = useRepoStore((s) => s.setUpstream);
  const selectFile = useRepoStore((s) => s.selectFile);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const setAmendMode = useRepoStore((s) => s.setAmendMode);
  const selectStash = useRepoStore((s) => s.selectStash);
  const applyStash = useRepoStore((s) => s.applyStash);
  const popStash = useRepoStore((s) => s.popStash);
  const dropStash = useRepoStore((s) => s.dropStash);

  const [commitContextMenu, setCommitContextMenu] = useState<{
    commitId: string;
    x: number;
    y: number;
  } | null>(null);
  const [stashContextMenu, setStashContextMenu] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [confirmResetHard, setConfirmResetHard] = useState<string | null>(null);
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<{
    branchName: string;
    deleteLocal: boolean;
    deleteRemote: boolean;
    remoteName: string;
  } | null>(null);
  const [confirmDropStash, setConfirmDropStash] = useState<number | null>(null);
  const [createBranchDialog, setCreateBranchDialog] = useState<{ commitId: string } | null>(null);
  const [createTagDialog, setCreateTagDialog] = useState<{ commitId: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ branch: string } | null>(null);
  const [upstreamDialog, setUpstreamDialog] = useState<{ branch: string } | null>(null);
  const [dialogInput, setDialogInput] = useState("");

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
  const isConflictedFile = selectedFilePath
    ? fileStatuses.some((f) => f.path === selectedFilePath && f.is_conflicted)
    : false;
  const showConflictEditor = isConflictedFile && !selectedCommitId && selectedStashIndex == null;

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
          </div>
          <div className="mx-3 border-t border-border" />
        </div>
      )}

      {/* Conflict banner — status info only; Continue/Abort live in CommitBox */}
      {conflictState?.in_progress && (() => {
        const conflictedFiles = fileStatuses.filter((f) => f.is_conflicted);
        const unresolvedCount = conflictedFiles.length;
        return (
          <div className="flex items-center gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
            <span className="flex-1 text-xs text-yellow-200">
              {conflictState.operation.charAt(0).toUpperCase() + conflictState.operation.slice(1)} in progress
            </span>
            {unresolvedCount > 0 && (
              <button
                onClick={() => {
                  const first = conflictedFiles[0];
                  if (first) selectFile(first.path, false);
                }}
                title="Go to first conflict"
                className="rounded-md bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-100 transition-colors hover:bg-yellow-500/30"
              >
                {unresolvedCount} conflict{unresolvedCount !== 1 ? "s" : ""} to resolve
              </button>
            )}
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
        ) : showConflictEditor && selectedFilePath ? (
          <ConflictEditor filePath={selectedFilePath} />
        ) : showDiff ? (
          <div className="h-full overflow-hidden">
            <DiffViewer
              diff={activeDiff}
              filePath={selectedFilePath ?? activeDiff.path}
              mode={
                selectedCommitId || selectedStashIndex != null || selectedFileStaged
                  ? "readonly"
                  : "interactive"
              }
            />
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
            onSelectStash={(index) => selectStash(index)}
            onCommitContextMenu={(commitId, x, y) => {
              if (isLoading) return;
              setCommitContextMenu({ commitId, x, y });
            }}
            onStashContextMenu={(index, x, y) => {
              if (isLoading) return;
              setStashContextMenu({ index, x, y });
            }}
          />
        )}

        {/* Loading overlay — blocks interaction during git ops or diff loading */}
        {(isLoading || diffLoading) && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 animate-fade-in">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Commit context menu (includes branch ops when branches are on the commit) */}
      {commitContextMenu && (
        <ContextMenu
          x={commitContextMenu.x}
          y={commitContextMenu.y}
          items={buildCommitContextMenuItems(
            commitContextMenu.commitId,
            currentBranch,
            branches,
            cherryPick,
            (id, mode) => {
              if (mode === "hard") {
                setConfirmResetHard(id);
              } else {
                resetTo(id, mode);
              }
            },
            rebaseOnto,
            mergeInto,
            revertCommit,
            checkoutDetached,
            (commitId) => { setDialogInput(""); setCreateBranchDialog({ commitId }); },
            (commitId) => { setDialogInput(""); setCreateTagDialog({ commitId }); },
            checkout,
            pull,
            push,
            (name, deleteLocal, deleteRemote, remoteName) => {
              setConfirmDeleteBranch({ branchName: name, deleteLocal, deleteRemote, remoteName });
            },
            (name) => { setDialogInput(name); setRenameDialog({ branch: name }); },
            (name) => { setDialogInput(""); setUpstreamDialog({ branch: name }); },
            headCommitId,
            setAmendMode,
            forgeStatus,
          )}
          onClose={() => setCommitContextMenu(null)}
        />
      )}

      {/* Stash context menu */}
      {stashContextMenu && (
        <ContextMenu
          x={stashContextMenu.x}
          y={stashContextMenu.y}
          items={[
            {
              label: "Apply (keep in stash list)",
              onClick: () => applyStash(stashContextMenu.index),
            },
            {
              label: "Pop (apply & remove)",
              onClick: () => popStash(stashContextMenu.index),
            },
            {
              label: "Drop (discard)",
              onClick: () => setConfirmDropStash(stashContextMenu.index),
              destructive: true,
            },
          ]}
          onClose={() => setStashContextMenu(null)}
        />
      )}

      {/* Dirty working tree checkout dialog */}
      {dirtyCheckoutPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-sm">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <p className="text-sm text-foreground">Uncommitted changes</p>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              You have {dirtyCheckoutPending.changesCount} unsaved {dirtyCheckoutPending.changesCount === 1 ? "change" : "changes"}.
              How would you like to proceed?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelDirtyCheckout}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={stashAndCheckout}
                className="rounded bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-accent transition-colors"
              >
                Stash &amp; Switch
              </button>
              <button
                onClick={discardAndCheckout}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Discard &amp; Switch
              </button>
            </div>
          </div>
        </div>
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

      {/* Delete branch confirmation */}
      {confirmDeleteBranch && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Delete branch?</p>
            <p className="text-xs text-muted-foreground mb-4">
              {confirmDeleteBranch.deleteLocal && confirmDeleteBranch.deleteRemote
                ? `This will delete "${confirmDeleteBranch.branchName}" locally and from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                : confirmDeleteBranch.deleteRemote
                  ? `This will delete "${confirmDeleteBranch.branchName}" from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                  : `This will delete "${confirmDeleteBranch.branchName}" locally. This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteBranch(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { branchName, deleteLocal, deleteRemote, remoteName } = confirmDeleteBranch;
                  if (deleteLocal) deleteBranch(branchName);
                  if (deleteRemote) deleteRemoteBranch(remoteName, branchName);
                  setConfirmDeleteBranch(null);
                }}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop stash confirmation */}
      {confirmDropStash != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Drop stash?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will permanently discard stash@&#123;{confirmDropStash}&#125;. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDropStash(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  dropStash(confirmDropStash);
                  setConfirmDropStash(null);
                }}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Drop
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

      {/* Create branch at commit dialog */}
      {createBranchDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Create branch</p>
            <p className="text-xs text-muted-foreground mb-3">
              New branch at {createBranchDialog.commitId.slice(0, 7)}
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim()) {
                  createBranchAtAction(dialogInput.trim(), createBranchDialog.commitId);
                  setCreateBranchDialog(null);
                } else if (e.key === "Escape") {
                  setCreateBranchDialog(null);
                }
              }}
              placeholder="Branch name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateBranchDialog(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim()) {
                    createBranchAtAction(dialogInput.trim(), createBranchDialog.commitId);
                    setCreateBranchDialog(null);
                  }
                }}
                disabled={!dialogInput.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename branch dialog (from graph badge) */}
      {renameDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Rename branch</p>
            <p className="text-xs text-muted-foreground mb-3">
              Renaming &apos;{renameDialog.branch}&apos;
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim() && dialogInput.trim() !== renameDialog.branch) {
                  renameBranch(renameDialog.branch, dialogInput.trim());
                  setRenameDialog(null);
                } else if (e.key === "Escape") {
                  setRenameDialog(null);
                }
              }}
              placeholder="New name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameDialog(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim() && dialogInput.trim() !== renameDialog.branch) {
                    renameBranch(renameDialog.branch, dialogInput.trim());
                    setRenameDialog(null);
                  }
                }}
                disabled={!dialogInput.trim() || dialogInput.trim() === renameDialog.branch}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set upstream dialog (from graph badge) */}
      {upstreamDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Set upstream</p>
            <p className="text-xs text-muted-foreground mb-3">
              Set tracking branch for &apos;{upstreamDialog.branch}&apos;
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim()) {
                  setUpstream(dialogInput.trim());
                  setUpstreamDialog(null);
                } else if (e.key === "Escape") {
                  setUpstreamDialog(null);
                }
              }}
              placeholder="e.g. origin/main"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setUpstreamDialog(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim()) {
                    setUpstream(dialogInput.trim());
                    setUpstreamDialog(null);
                  }
                }}
                disabled={!dialogInput.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create tag at commit dialog */}
      {createTagDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Create tag</p>
            <p className="text-xs text-muted-foreground mb-3">
              New tag at {createTagDialog.commitId.slice(0, 7)}
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim()) {
                  createNewTag(dialogInput.trim(), createTagDialog.commitId);
                  setCreateTagDialog(null);
                } else if (e.key === "Escape") {
                  setCreateTagDialog(null);
                }
              }}
              placeholder="Tag name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateTagDialog(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim()) {
                    createNewTag(dialogInput.trim(), createTagDialog.commitId);
                    setCreateTagDialog(null);
                  }
                }}
                disabled={!dialogInput.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Create
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
  branches: BranchInfo[],
  cherryPick: (id: string) => void,
  resetTo: (id: string, mode: "soft" | "hard") => void,
  rebaseOnto: (target: string) => void,
  mergeInto: (target: string) => void,
  revertCommit: (id: string) => void,
  checkoutDetached: (id: string) => void,
  createBranchHere: (commitId: string) => void,
  createTagHere: (commitId: string) => void,
  checkoutBranch: (name: string) => void,
  pull: () => void,
  push: () => void,
  confirmDeleteBranch: (name: string, deleteLocal: boolean, deleteRemote: boolean, remoteName: string) => void,
  renameBranch: (name: string) => void,
  setUpstream: (name: string) => void,
  headCommitId: string | null,
  setAmendMode: (on: boolean) => void,
  forgeStatus: ForgeStatus | null,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  // ── Branch ops (when branches point to this commit) ──
  const branchesOnCommit = branches.filter((b) => b.commit_id === commitId);

  for (const branch of branchesOnCommit) {
    const isCurrent = branch.name === currentBranch;
    const isRemote = branch.is_remote;

    if (isRemote) {
      items.push({
        label: `Checkout ${branch.name}`,
        onClick: () => checkoutBranch(branch.name),
      });
      items.push({
        label: `Copy branch name: ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branch.name),
      });
      const slashIdx = branch.name.indexOf("/");
      if (slashIdx > 0) {
        const remote = branch.name.slice(0, slashIdx);
        const remoteBranch = branch.name.slice(slashIdx + 1);
        items.push({
          label: `Delete ${branch.name} from ${remote}…`,
          onClick: () => confirmDeleteBranch(remoteBranch, false, true, remote),
          destructive: true,
        });
      }
      items.push({ separator: true });
    } else {
      // Local branch
      if (!isCurrent) {
        items.push({
          label: `Checkout ${branch.name}`,
          onClick: () => checkoutBranch(branch.name),
        });
      }

      if (!isCurrent && currentBranch) {
        items.push({
          label: `Merge ${branch.name} into ${currentBranch}`,
          onClick: () => mergeInto(branch.name),
        });
        items.push({
          label: `Rebase ${currentBranch} onto ${branch.name}`,
          onClick: () => rebaseOnto(branch.name),
        });
      }

      items.push({ label: "Pull", onClick: () => pull() });
      items.push({ label: "Push", onClick: () => push() });
      items.push({ label: "Set upstream…", onClick: () => setUpstream(branch.name) });
      items.push({ label: "Rename branch…", onClick: () => renameBranch(branch.name) });
      items.push({
        label: `Copy branch name: ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branch.name),
      });

      if (!isCurrent) {
        const hasRemote = branch.ahead != null || branch.behind != null;
        items.push({
          label: hasRemote ? `Delete ${branch.name} (local + remote)…` : `Delete ${branch.name}…`,
          onClick: () => confirmDeleteBranch(branch.name, true, hasRemote, "origin"),
          destructive: true,
        });
      }

      items.push({ separator: true });
    }
  }

  // ── Commit ops ──
  const shortSha = commitId.slice(0, 7);
  const hasLocalBranches = branchesOnCommit.some((b) => !b.is_remote);

  items.push({
    label: `Cherry-pick onto ${currentBranch ?? "HEAD"}`,
    onClick: () => cherryPick(commitId),
  });

  // Only show commit-level merge/rebase when no local branch already
  // covers them — otherwise they duplicate the branch ops above.
  if (currentBranch && !hasLocalBranches) {
    items.push({
      label: `Merge ${shortSha} into ${currentBranch}`,
      onClick: () => mergeInto(commitId),
    });
    items.push({
      label: `Rebase ${currentBranch} onto ${shortSha}`,
      onClick: () => rebaseOnto(commitId),
    });
  }

  items.push({ separator: true });

  // Navigation
  items.push({
    label: `Checkout ${shortSha} (detached HEAD)`,
    onClick: () => checkoutDetached(commitId),
  });
  items.push({
    label: `Create branch at ${shortSha}…`,
    onClick: () => createBranchHere(commitId),
  });
  items.push({
    label: `Create tag at ${shortSha}…`,
    onClick: () => createTagHere(commitId),
  });

  items.push({ separator: true });

  // Modify
  if (commitId === headCommitId) {
    items.push({
      label: "Edit commit message",
      onClick: () => setAmendMode(true),
    });
  }
  items.push({
    label: `Revert ${shortSha}`,
    onClick: () => revertCommit(commitId),
  });
  items.push({
    label: `Reset soft to ${shortSha} (keep changes)`,
    onClick: () => resetTo(commitId, "soft"),
  });
  items.push({
    label: `Reset hard to ${shortSha}`,
    onClick: () => resetTo(commitId, "hard"),
    destructive: true,
  });

  items.push({ separator: true });

  // Clipboard
  items.push({
    label: `Copy SHA: ${commitId.slice(0, 7)}`,
    onClick: () => navigator.clipboard.writeText(commitId),
  });

  // Copy link to commit (when forge is detected)
  if (forgeStatus?.kind && forgeStatus.host && forgeStatus.owner && forgeStatus.repo) {
    const { kind, host, owner, repo } = forgeStatus;
    const commitPath = kind === "gitlab" ? `-/commit/${commitId}` : `commit/${commitId}`;
    const commitUrl = `https://${host}/${owner}/${repo}/${commitPath}`;
    items.push({
      label: "Copy link to commit",
      onClick: () => navigator.clipboard.writeText(commitUrl),
    });

    // Copy link to branch (for branches on this commit)
    for (const branch of branchesOnCommit) {
      if (branch.is_remote) continue;
      const branchPath = kind === "gitlab"
        ? `-/tree/${encodeURIComponent(branch.name)}`
        : `tree/${encodeURIComponent(branch.name)}`;
      const branchUrl = `https://${host}/${owner}/${repo}/${branchPath}`;
      items.push({
        label: `Copy link to ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branchUrl),
      });
    }
  }

  return items;
}

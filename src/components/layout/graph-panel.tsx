import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ArrowLeft,
  Undo2,
  Archive,
  ArchiveRestore,
  FileEdit,
  GitBranchPlus,
  FolderGit2,
  X,
  ChevronDown,
  FolderOpen,
} from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { CommitGraphCanvas } from "@/components/graph/commit-graph-canvas";
import { DiffViewer } from "@/components/staging/diff-viewer";

export function GraphPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const repoName = useRepoStore((s) => s.repoName);
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
  const fetchAction = useRepoStore((s) => s.fetch);
  const pullAction = useRepoStore((s) => s.pull);
  const pushAction = useRepoStore((s) => s.push);
  const pushStash = useRepoStore((s) => s.pushStash);
  const popStash = useRepoStore((s) => s.popStash);
  const createBranch = useRepoStore((s) => s.createBranch);
  const checkout = useRepoStore((s) => s.checkout);
  const undoInfo = useRepoStore((s) => s.undoInfo);
  const undoAction = useRepoStore((s) => s.undo);
  const remoteCheckoutPending = useRepoStore((s) => s.remoteCheckoutPending);
  const resetLocalToRemote = useRepoStore((s) => s.resetLocalToRemote);
  const cancelRemoteCheckout = useRepoStore((s) => s.cancelRemoteCheckout);

  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  // Ctrl+Z undo shortcut
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

  // No repo open
  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-background">
        <button
          onClick={handleOpenRepo}
          disabled={isLoading}
          className="rounded-md bg-secondary px-6 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {isLoading ? "Opening..." : "Open Repository"}
        </button>
        <p className="text-xs text-muted-foreground">
          Select a folder containing a Git repository
        </p>

        {recentRepos.length > 0 && (
          <div className="mt-4 w-full max-w-sm">
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider text-center">
              Recent Repositories
            </p>
            <div className="flex flex-col gap-0.5">
              {recentRepos.map((repo) => (
                <div
                  key={repo.path}
                  className="group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors hover:bg-secondary"
                  onClick={() => openRepository(repo.path)}
                >
                  <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm text-foreground truncate">
                      {repo.name}
                    </span>
                    <span className="text-xs text-muted-foreground/50 truncate">
                      {repo.path}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromRecentRepos(repo.path);
                    }}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                    title="Remove from recent"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
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
      {/* Header bar with toolbar */}
      <div className="shrink-0">
      <div className="flex h-10 items-center px-4">
        {showDiff || showLargeDiffGuard || (diffLoading && selectedFilePath) ? (
          <>
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
          </>
        ) : (
          <RepoSwitcher
            repoName={repoName ?? ""}
            commitCount={commits.length}
            recentRepos={recentRepos}
            currentPath={repoPath ?? ""}
            onOpenRepo={handleOpenRepo}
            onSwitchRepo={openRepository}
            onRemoveRepo={removeFromRecentRepos}
          />
        )}

        {/* Toolbar buttons — right side */}
        <div className="ml-auto flex items-center gap-1">
          {fileStatuses.length > 0 && (
            <>
              <button
                onClick={() => { clearSelection(); loadStatus(); }}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                  selectedCommitId === null && selectedStashIndex === null
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <FileEdit className="h-3.5 w-3.5" />
                <span>Changes</span>
                <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-xs leading-none">
                  {fileStatuses.length}
                </span>
              </button>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}

          {undoInfo?.can_undo && (
            <>
              <ToolbarButton
                icon={<Undo2 className="h-3.5 w-3.5" />}
                label="Undo"
                disabled={isLoading}
                onClick={undoAction}
                title={undoInfo.description}
              />
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}

          <ToolbarButton
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Fetch"
            disabled={isLoading}
            onClick={fetchAction}
          />
          <ToolbarButton
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            label="Pull"
            disabled={isLoading}
            onClick={pullAction}
          />
          <ToolbarButton
            icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
            label="Push"
            disabled={isLoading}
            onClick={pushAction}
          />

          {/* Separator */}
          <div className="mx-1 h-4 w-px bg-border" />

          <ToolbarButton
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Stash"
            disabled={isLoading || fileStatuses.length === 0}
            onClick={() => pushStash()}
          />
          <ToolbarButton
            icon={<ArchiveRestore className="h-3.5 w-3.5" />}
            label="Pop"
            disabled={isLoading || stashes.length === 0}
            onClick={() => popStash(0)}
          />

          {/* Separator */}
          <div className="mx-1 h-4 w-px bg-border" />

          {showBranchInput ? (
            <input
              type="text"
              placeholder="branch name..."
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBranchName.trim()) {
                  createBranch(newBranchName.trim());
                  setNewBranchName("");
                  setShowBranchInput(false);
                } else if (e.key === "Escape") {
                  setShowBranchInput(false);
                  setNewBranchName("");
                }
              }}
              onBlur={() => {
                setShowBranchInput(false);
                setNewBranchName("");
              }}
              autoFocus
              className="w-32 rounded bg-background border border-border px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <ToolbarButton
              icon={<GitBranchPlus className="h-3.5 w-3.5" />}
              label="Branch"
              disabled={isLoading}
              onClick={() => setShowBranchInput(true)}
            />
          )}
        </div>
      </div>
      <div className="mx-3 my-1 border-t border-border" />
      </div>

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
            onClickWip={clearSelection}
          />
        )}
      </div>

      {/* Remote checkout dialog */}
      {remoteCheckoutPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-popover p-4 shadow-lg max-w-sm">
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
    </div>
  );
}

function RepoSwitcher({
  repoName,
  commitCount,
  recentRepos,
  currentPath,
  onOpenRepo,
  onSwitchRepo,
  onRemoveRepo,
}: {
  repoName: string;
  commitCount: number;
  recentRepos: { path: string; name: string }[];
  currentPath: string;
  onOpenRepo: () => void;
  onSwitchRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const otherRepos = recentRepos.filter((r) => r.path !== currentPath);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded px-2 py-1 -ml-2 hover:bg-secondary transition-colors"
      >
        <span className="text-xs font-medium text-muted-foreground">
          {repoName}
        </span>
        <span className="text-xs text-muted-foreground/50">
          {commitCount.toLocaleString()} commits
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-md border border-border bg-popover shadow-lg">
          {/* Open new repo */}
          <button
            onClick={() => {
              setIsOpen(false);
              onOpenRepo();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Repository...
          </button>

          {/* Recent repos */}
          {otherRepos.length > 0 && (
            <>
              <div className="border-t border-border" />
              <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground/50 uppercase tracking-wider">
                Recent
              </p>
              {otherRepos.map((repo) => (
                <div
                  key={repo.path}
                  className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary transition-colors"
                  onClick={() => {
                    setIsOpen(false);
                    onSwitchRepo(repo.path);
                  }}
                >
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs text-foreground truncate">{repo.name}</span>
                    <span className="text-xs text-muted-foreground/40 truncate">{repo.path}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRepo(repo.path);
                    }}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                    title="Remove from recent"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}


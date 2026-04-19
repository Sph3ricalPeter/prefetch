import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  FileEdit,
  GitBranchPlus,
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

  const openRepository = useRepoStore((s) => s.openRepository);
  const selectCommit = useRepoStore((s) => s.selectCommit);
  const clearDiff = useRepoStore((s) => s.clearDiff);
  const clearSelection = useRepoStore((s) => s.clearSelection);
  const loadStatus = useRepoStore((s) => s.loadStatus);
  const fetchAction = useRepoStore((s) => s.fetch);
  const pullAction = useRepoStore((s) => s.pull);
  const pushAction = useRepoStore((s) => s.push);
  const pushStash = useRepoStore((s) => s.pushStash);
  const popStash = useRepoStore((s) => s.popStash);
  const createBranch = useRepoStore((s) => s.createBranch);
  const checkout = useRepoStore((s) => s.checkout);

  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const handleOpenRepo = useCallback(async () => {
    const selected = await open({
      directory: true,
      title: "Open Git Repository",
    });
    if (selected) {
      await openRepository(selected);
    }
  }, [openRepository]);

  // No repo open
  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
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

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar with toolbar */}
      <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
        {showDiff ? (
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
          </>
        ) : (
          <>
            <span className="text-xs font-medium text-muted-foreground">
              {repoName}
            </span>
            <span className="ml-2 text-xs text-muted-foreground/50">
              {commits.length.toLocaleString()} commits
            </span>
          </>
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
              className="w-32 rounded bg-secondary px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
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

      {/* Center content: graph or diff */}
      <div className="flex-1 min-h-0">
        {showDiff ? (
          <div className="h-full overflow-auto">
            <DiffViewer diff={activeDiff} />
          </div>
        ) : (
          <CommitGraphCanvas
            commits={commits}
            edges={edges}
            totalLanes={totalLanes}
            selectedCommitId={selectedCommitId}
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
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

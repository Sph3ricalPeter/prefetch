import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "@/stores/repo-store";
import { CommitGraphCanvas } from "@/components/graph/commit-graph-canvas";

export function GraphPanel() {
  const {
    repoPath,
    repoName,
    commits,
    edges,
    totalLanes,
    selectedCommitId,
    isLoading,
    error,
    openRepository,
    selectCommit,
  } = useRepoStore();

  const handleOpenRepo = async () => {
    const selected = await open({
      directory: true,
      title: "Open Git Repository",
    });
    if (selected) {
      await openRepository(selected);
    }
  };

  // No repo open — show open button
  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        {error && (
          <p className="text-sm text-destructive max-w-sm text-center">
            {error}
          </p>
        )}
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

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading commits...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-destructive max-w-sm text-center">
          {error}
        </p>
        <button
          onClick={handleOpenRepo}
          className="rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent"
        >
          Open Different Repository
        </button>
      </div>
    );
  }

  // Empty repo
  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar */}
      <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
        <span className="text-xs font-medium text-muted-foreground">
          {repoName}
        </span>
        <span className="ml-2 text-xs text-muted-foreground/50">
          {commits.length.toLocaleString()} commits
        </span>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 min-h-0">
        <CommitGraphCanvas
          commits={commits}
          edges={edges}
          totalLanes={totalLanes}
          selectedCommitId={selectedCommitId}
          onSelectCommit={selectCommit}
        />
      </div>
    </div>
  );
}

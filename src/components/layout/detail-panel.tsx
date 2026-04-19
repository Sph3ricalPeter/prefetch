import { ArrowLeft } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { FileList } from "@/components/staging/file-list";
import { CommitBox } from "@/components/staging/commit-box";
import { DiffViewer } from "@/components/staging/diff-viewer";

export function DetailPanel() {
  const {
    commits,
    selectedCommitId,
    selectedFilePath,
    selectedFileDiff,
    fileStatuses,
    clearFileSelection,
  } = useRepoStore();

  // Mode 1: Viewing a file diff
  if (selectedFilePath && selectedFileDiff) {
    return (
      <div className="flex h-full flex-col bg-card">
        {/* Diff header */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <button
            onClick={clearFileSelection}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <span className="truncate text-xs font-medium text-foreground">
            {selectedFilePath}
          </span>
        </div>

        {/* Diff content */}
        <div className="flex-1 min-h-0 overflow-auto">
          <DiffViewer diff={selectedFileDiff} />
        </div>
      </div>
    );
  }

  // Mode 2: Viewing a selected commit from the graph
  if (selectedCommitId) {
    const commit = commits.find((c) => c.id === selectedCommitId);
    if (commit) {
      const date = new Date(commit.timestamp * 1000);
      const dateStr = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      return (
        <div className="flex h-full flex-col bg-card overflow-y-auto p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Commit Details
          </h2>
          <div className="mb-3">
            <label className="text-xs text-muted-foreground">SHA</label>
            <p className="font-mono text-xs text-foreground break-all">
              {commit.id}
            </p>
          </div>
          <div className="mb-3">
            <label className="text-xs text-muted-foreground">Author</label>
            <p className="text-sm text-foreground">{commit.author_name}</p>
            <p className="text-xs text-muted-foreground">
              {commit.author_email}
            </p>
          </div>
          <div className="mb-3">
            <label className="text-xs text-muted-foreground">Date</label>
            <p className="text-sm text-foreground">{dateStr}</p>
          </div>
          <div className="mb-3">
            <label className="text-xs text-muted-foreground">Message</label>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {commit.message}
            </p>
          </div>
          {commit.parent_ids.length > 0 && (
            <div className="mb-3">
              <label className="text-xs text-muted-foreground">
                {commit.parent_ids.length === 1 ? "Parent" : "Parents"}
              </label>
              {commit.parent_ids.map((pid) => (
                <p
                  key={pid}
                  className="font-mono text-xs text-muted-foreground"
                >
                  {pid.slice(0, 7)}
                </p>
              ))}
            </div>
          )}
        </div>
      );
    }
  }

  // Mode 3: Default — show staging panel (file list + commit box)
  if (fileStatuses.length > 0) {
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Changes
          </h2>
          <span className="ml-2 text-xs text-muted-foreground/50">
            {fileStatuses.length}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FileList />
        </div>
        <CommitBox />
      </div>
    );
  }

  // No changes, no selection
  return (
    <div className="flex h-full flex-col items-center justify-center bg-card p-4">
      <p className="text-sm text-muted-foreground">
        Select a commit to view details
      </p>
    </div>
  );
}

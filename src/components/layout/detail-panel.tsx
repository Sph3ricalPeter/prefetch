import { FileText } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { FileList } from "@/components/staging/file-list";
import { CommitBox } from "@/components/staging/commit-box";
import type { FileStatus } from "@/types/git";

export function DetailPanel() {
  const {
    commits,
    selectedCommitId,
    selectedFilePath,
    fileStatuses,
    commitFiles,
    selectCommitFile,
  } = useRepoStore();

  // Mode 1: A commit is selected from the graph — show details + changed files
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
        <div className="flex h-full flex-col bg-card overflow-y-auto">
          {/* Commit info */}
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Commit
            </h2>
            <p className="font-mono text-xs text-muted-foreground mb-2">
              {commit.short_id}
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap mb-2">
              {commit.message}
            </p>
            <p className="text-xs text-muted-foreground">
              {commit.author_name} &middot; {dateStr}
            </p>
          </div>

          {/* Changed files in this commit */}
          {commitFiles.length > 0 && (
            <div className="flex-1 min-h-0">
              <div className="flex items-center px-4 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Changed Files
                </span>
                <span className="ml-2 text-xs text-muted-foreground/50">
                  {commitFiles.length}
                </span>
              </div>
              <div className="overflow-y-auto">
                {commitFiles.map((file) => (
                  <CommitFileRow
                    key={file.path}
                    file={file}
                    isSelected={selectedFilePath === file.path}
                    onClick={() =>
                      selectCommitFile(selectedCommitId, file.path)
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
  }

  // Mode 2: No commit selected — show staging panel (file list + commit box)
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

function CommitFileRow({
  file,
  isSelected,
  onClick,
}: {
  file: FileStatus;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor =
    file.status_type === "added"
      ? "text-green-400"
      : file.status_type === "deleted"
        ? "text-red-400"
        : file.status_type === "renamed"
          ? "text-blue-400"
          : "text-yellow-400";

  const statusLabel =
    file.status_type === "added"
      ? "A"
      : file.status_type === "deleted"
        ? "D"
        : file.status_type === "renamed"
          ? "R"
          : "M";

  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 px-4 py-1 text-left transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
    >
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}>
        {statusLabel}
      </span>
      <span className="truncate text-xs text-foreground">{fileName}</span>
      {dirPath && (
        <span className="truncate text-xs text-muted-foreground/50">
          {dirPath}
        </span>
      )}
    </button>
  );
}

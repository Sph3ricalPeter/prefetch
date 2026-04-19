import { useRepoStore } from "@/stores/repo-store";

export function DetailPanel() {
  const { commits, selectedCommitId } = useRepoStore();

  const commit = selectedCommitId
    ? commits.find((c) => c.id === selectedCommitId)
    : null;

  if (!commit) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Select a commit to view details
        </p>
      </div>
    );
  }

  const date = new Date(commit.timestamp * 1000);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex h-full flex-col bg-card p-4 overflow-y-auto">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Commit Details
      </h2>

      {/* SHA */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground">SHA</label>
        <p className="font-mono text-xs text-foreground break-all">
          {commit.id}
        </p>
      </div>

      {/* Author */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground">Author</label>
        <p className="text-sm text-foreground">{commit.author_name}</p>
        <p className="text-xs text-muted-foreground">{commit.author_email}</p>
      </div>

      {/* Date */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground">Date</label>
        <p className="text-sm text-foreground">{dateStr}</p>
      </div>

      {/* Message */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground">Message</label>
        <p className="text-sm text-foreground whitespace-pre-wrap">
          {commit.message}
        </p>
      </div>

      {/* Parents */}
      {commit.parent_ids.length > 0 && (
        <div className="mb-3">
          <label className="text-xs text-muted-foreground">
            {commit.parent_ids.length === 1 ? "Parent" : "Parents"}
          </label>
          {commit.parent_ids.map((pid) => (
            <p key={pid} className="font-mono text-xs text-muted-foreground">
              {pid.slice(0, 7)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

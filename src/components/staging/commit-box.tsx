import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";

export function CommitBox() {
  const commitMessage = useRepoStore((s) => s.commitMessage);
  const setCommitMessage = useRepoStore((s) => s.setCommitMessage);
  const commitDescription = useRepoStore((s) => s.commitDescription);
  const setCommitDescription = useRepoStore((s) => s.setCommitDescription);
  const commit = useRepoStore((s) => s.commit);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const isLoading = useRepoStore((s) => s.isLoading);

  const [showDescription, setShowDescription] = useState(false);

  const stagedCount = fileStatuses.filter((f) => f.is_staged).length;
  const canCommit = stagedCount > 0 && commitMessage.trim().length > 0 && !isLoading;

  const handleCommit = () => {
    if (canCommit) {
      commit(commitMessage);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCommit) {
      e.preventDefault();
      handleCommit();
    }
  };

  return (
    <div className="flex flex-col gap-2 pt-0 px-3 pb-3">
      <div className="mx-0 mb-1 border-t border-border" />
      <textarea
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        rows={1}
        className="w-full resize-none rounded bg-background border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Description toggle + field */}
      <button
        onClick={() => setShowDescription(!showDescription)}
        className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors self-start"
      >
        {showDescription ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Description
      </button>

      {showDescription && (
        <textarea
          value={commitDescription}
          onChange={(e) => setCommitDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Optional extended description..."
          rows={3}
          className="w-full resize-y rounded bg-background border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      <button
        onClick={handleCommit}
        disabled={!canCommit}
        className="w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isLoading
          ? "Committing..."
          : stagedCount > 0
            ? `Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`
            : "Nothing staged"}
      </button>
      <p className="text-center text-xs text-muted-foreground/50">
        Ctrl+Enter to commit
      </p>
    </div>
  );
}

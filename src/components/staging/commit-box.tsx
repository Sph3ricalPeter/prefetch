import { useRepoStore } from "@/stores/repo-store";

export function CommitBox() {
  const {
    commitMessage,
    setCommitMessage,
    commit,
    fileStatuses,
    isLoading,
  } = useRepoStore();

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
    <div className="flex flex-col gap-2 border-t border-border p-3">
      <textarea
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        rows={3}
        className="w-full resize-none rounded bg-secondary px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
      />
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

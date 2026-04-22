import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { gravatarUrl } from "@/lib/gravatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const SOURCE_LABELS: Record<string, string> = {
  local: "Local repo config",
  global: "Global git config",
  system: "System git config",
  profile: "Profile",
  unknown: "Unknown source",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

/** Tries to load a gravatar; returns the URL on success, null on 404/error. */
function useGravatar(email: string | undefined): string | null {
  const [loaded, setLoaded] = useState<{ email: string; url: string } | null>(null);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    const src = gravatarUrl(email, 40); // 2x for retina on a 20px element
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setLoaded({ email, url: src });
    };
    img.onerror = () => {};
    img.src = src;
    return () => { cancelled = true; };
  }, [email]);

  // Derive null from props instead of calling setState synchronously in the effect
  return email && loaded?.email === email ? loaded.url : null;
}

export function CommitBox() {
  const commitMessage = useRepoStore((s) => s.commitMessage);
  const setCommitMessage = useRepoStore((s) => s.setCommitMessage);
  const commitDescription = useRepoStore((s) => s.commitDescription);
  const setCommitDescription = useRepoStore((s) => s.setCommitDescription);
  const commit = useRepoStore((s) => s.commit);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const isLoading = useRepoStore((s) => s.isLoading);
  const gitIdentity = useRepoStore((s) => s.gitIdentity);
  const avatarUrl = useGravatar(gitIdentity?.email);

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

      {/* Author identity */}
      {gitIdentity && gitIdentity.name && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-default">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={gitIdentity.name}
                  className="h-5 w-5 shrink-0 rounded-full"
                />
              ) : (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary">
                  {getInitials(gitIdentity.name)}
                </div>
              )}
              <span className="text-xs text-muted-foreground truncate">
                {gitIdentity.name}
              </span>
              <span className="ml-auto rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground/60 shrink-0">
                {gitIdentity.source}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            <div className="space-y-0.5 text-xs">
              <p className="font-medium">{gitIdentity.name}</p>
              <p className="text-muted-foreground">{gitIdentity.email}</p>
              <p className="text-muted-foreground/70 text-[11px]">
                Source: {SOURCE_LABELS[gitIdentity.source] ?? gitIdentity.source}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      <div className="relative">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          rows={1}
          className={`w-full resize-none rounded bg-background border px-3 py-2 pr-10 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring ${
            commitMessage.length > 72
              ? "border-destructive/60"
              : commitMessage.length > 50
                ? "border-yellow-500/40"
                : "border-border"
          }`}
        />
        {commitMessage.length > 0 && (
          <span
            className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums ${
              commitMessage.length > 72
                ? "text-destructive"
                : commitMessage.length > 50
                  ? "text-yellow-500"
                  : "text-muted-foreground/40"
            }`}
          >
            {commitMessage.length}
          </span>
        )}
      </div>

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

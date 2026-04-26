import { useState, useEffect, useRef } from "react";
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
  const conflictState = useRepoStore((s) => s.conflictState);
  const rebaseProgress = useRepoStore((s) => s.rebaseProgress);
  const continueOperation = useRepoStore((s) => s.continueOperation);
  const abortOperation = useRepoStore((s) => s.abortOperation);

  const [showDescription, setShowDescription] = useState(false);

  // Track the last rebase step key so we only auto-fill on step transitions
  const prevStepRef = useRef<string | null>(null);

  // Auto-fill commit message when rebase progress advances to a new step
  useEffect(() => {
    const stepKey = rebaseProgress
      ? `${rebaseProgress.step}/${rebaseProgress.total}`
      : null;
    const isNewStep = stepKey !== prevStepRef.current;
    prevStepRef.current = stepKey;

    if (conflictState?.in_progress && rebaseProgress && isNewStep) {
      setCommitMessage(rebaseProgress.message);
    }
  }, [rebaseProgress, conflictState, setCommitMessage]);

  const isOperationInProgress = conflictState?.in_progress ?? false;
  const operationLabel = conflictState?.operation
    ? conflictState.operation.charAt(0).toUpperCase() + conflictState.operation.slice(1)
    : "";
  const unresolvedCount = fileStatuses.filter((f) => f.is_conflicted).length;

  const stagedCount = fileStatuses.filter((f) => f.is_staged).length;
  const canCommit = stagedCount > 0 && commitMessage.trim().length > 0 && !isLoading;
  const canContinue = unresolvedCount === 0 && !isLoading;

  const handleCommit = () => {
    if (canCommit) {
      commit(commitMessage);
    }
  };

  const handleContinue = () => {
    if (canContinue) {
      continueOperation(commitMessage.trim() || undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (isOperationInProgress) {
        handleContinue();
      } else if (canCommit) {
        handleCommit();
      }
    }
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommitMessage(e.target.value);
  };

  // Build the progress label for rebase: "Rebasing step 1/3 · abc1234"
  const progressLabel =
    rebaseProgress && conflictState?.operation === "rebase"
      ? `Rebasing step ${rebaseProgress.step}/${rebaseProgress.total}${rebaseProgress.commit_id ? ` · ${rebaseProgress.commit_id}` : ""}`
      : null;

  return (
    <div className="flex flex-col gap-2 pt-0 px-3 pb-3">
      <div className="mx-0 mb-1 border-t border-border" />

      {/* Operation progress header */}
      {isOperationInProgress && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
          <span className="text-xs font-medium text-yellow-200">
            {progressLabel ?? `${operationLabel} in progress`}
          </span>
        </div>
      )}

      {/* Author identity */}
      {!isOperationInProgress && gitIdentity && gitIdentity.name && (
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
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-caption font-bold text-primary">
                  {getInitials(gitIdentity.name)}
                </div>
              )}
              <span className="text-xs text-muted-foreground truncate">
                {gitIdentity.name}
              </span>
              <span className="ml-auto rounded bg-accent px-1 py-0.5 text-caption text-dim shrink-0">
                {gitIdentity.source}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            <div className="space-y-0.5 text-xs">
              <p className="font-medium">{gitIdentity.name}</p>
              <p className="text-muted-foreground">{gitIdentity.email}</p>
              <p className="text-dim text-label">
                Source: {SOURCE_LABELS[gitIdentity.source] ?? gitIdentity.source}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      <div className="relative">
        <textarea
          value={commitMessage}
          onChange={handleMessageChange}
          onKeyDown={handleKeyDown}
          placeholder={isOperationInProgress ? "Commit message for this step..." : "Commit message..."}
          rows={1}
          className={`w-full resize-none rounded-md bg-background border px-3 py-2 pr-10 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors ${
            commitMessage.length > 72
              ? "border-destructive/60"
              : commitMessage.length > 50
                ? "border-yellow-500/40"
                : isOperationInProgress
                  ? "border-yellow-500/30"
                  : "border-border"
          }`}
        />
        {commitMessage.length > 0 && (
          <span
            className={`absolute right-2 top-1/2 -translate-y-1/2 text-caption tabular-nums ${
              commitMessage.length > 72
                ? "text-destructive"
                : commitMessage.length > 50
                  ? "text-yellow-500"
                  : "text-faint"
            }`}
          >
            {commitMessage.length}
          </span>
        )}
      </div>

      {/* Description toggle + field — only in normal commit mode */}
      {!isOperationInProgress && (
        <>
          <button
            onClick={() => setShowDescription(!showDescription)}
            className="flex items-center gap-1 text-xs text-dim hover:text-muted-foreground transition-colors self-start"
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
              className="w-full resize-y rounded-md bg-background border border-border px-3 py-2 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          )}
        </>
      )}

      {/* Action buttons */}
      {isOperationInProgress ? (
        <div className="flex gap-2">
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {isLoading
              ? "Continuing..."
              : unresolvedCount > 0
                ? `${unresolvedCount} conflict${unresolvedCount !== 1 ? "s" : ""} remaining`
                : `Continue ${operationLabel}`}
          </button>
          <button
            onClick={abortOperation}
            disabled={isLoading}
            className="rounded-md bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-400 transition-all hover:bg-red-500/30 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            Abort
          </button>
        </div>
      ) : (
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {isLoading
            ? "Committing..."
            : stagedCount > 0
              ? `Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`
              : "Nothing staged"}
        </button>
      )}
      <p className="text-center text-xs text-faint">
        {isOperationInProgress ? "Ctrl+Enter to continue" : "Ctrl+Enter to commit"}
      </p>
    </div>
  );
}

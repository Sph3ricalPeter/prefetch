import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { getTokenInfo } from "@/lib/commands";
import type { TokenInfo } from "@/lib/commands";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { ProfileAvatar } from "@/components/ui/avatar";
import { ResizableTextarea } from "@/components/ui/resizable-textarea";

const SOURCE_LABELS: Record<string, string> = {
  local: "Local repo config",
  global: "Global git config",
  system: "System git config",
  profile: "Profile",
  unknown: "Unknown source",
};

/** localStorage key for the commit message draft, scoped to the repo path. */
function draftKey(repoPath: string) {
  return `prefetch:commit_draft:${repoPath}`;
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
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const conflictState = useRepoStore((s) => s.conflictState);
  const rebaseProgress = useRepoStore((s) => s.rebaseProgress);
  const continueOperation = useRepoStore((s) => s.continueOperation);
  const abortOperation = useRepoStore((s) => s.abortOperation);
  const amendMode = useRepoStore((s) => s.amendMode);
  const setAmendMode = useRepoStore((s) => s.setAmendMode);
  const headCommitId = useRepoStore((s) => s.headCommitId);
  const repoPath = useRepoStore((s) => s.repoPath);

  const [showDescription, setShowDescription] = useState(false);
  const [authInfoResult, setAuthInfoResult] = useState<{
    profileId: string;
    host: string;
    info: TokenInfo | null;
  } | null>(null);

  // Load auth info when profile + forge are available
  useEffect(() => {
    const pid = activeProfile?.id;
    const host = forgeStatus?.host;
    if (!pid || !host) return;
    let cancelled = false;
    getTokenInfo(pid, host)
      .then((info) => { if (!cancelled) setAuthInfoResult({ profileId: pid, host, info }); })
      .catch(() => { if (!cancelled) setAuthInfoResult({ profileId: pid, host, info: null }); });
    return () => { cancelled = true; };
  }, [activeProfile?.id, forgeStatus?.host]);

  // Derive authInfo — null when profile/host don't match the last fetch
  const authInfo =
    authInfoResult &&
    authInfoResult.profileId === activeProfile?.id &&
    authInfoResult.host === forgeStatus?.host
      ? authInfoResult.info
      : null;

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

  // ── Draft persistence ─────────────────────────────────────────────────────
  // Drafts are saved per repo (keyed by path) and only ever written in direct
  // response to the user typing — NOT from an effect that watches the store.
  // The store clears commitMessage/commitDescription during a repo switch and
  // after a commit; an effect-based writer would race those transient empties
  // and delete the wrong repo's draft (the bug this replaces).
  const persistDraft = useCallback(
    (message: string, description: string) => {
      if (!repoPath) return;
      if (conflictState?.in_progress) return; // rebase/merge owns the message
      try {
        if (message || description) {
          localStorage.setItem(
            draftKey(repoPath),
            JSON.stringify({ message, description }),
          );
        } else {
          localStorage.removeItem(draftKey(repoPath));
        }
      } catch {
        // localStorage full or unavailable — not critical
      }
    },
    [repoPath, conflictState],
  );

  // Restore the saved draft exactly once per repo, right after a switch when
  // the store has been cleared. The ref is set only after a real restore
  // attempt completes — NOT while a rebase/merge is in progress — so a repo
  // first seen mid-conflict still gets its draft restored once the conflict
  // clears (the effect re-runs on conflictState change). Persistence lives in
  // the typing handlers, so the transient empty renders during a switch can't
  // race this; the restoredForRef guard alone blocks a second restore.
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repoPath) return;
    if (restoredForRef.current === repoPath) return; // already restored for this repo
    if (conflictState?.in_progress) return; // rebase/merge fills its own message
    if (commitMessage || commitDescription) return; // don't clobber existing content

    try {
      const raw = localStorage.getItem(draftKey(repoPath));
      if (raw) {
        const draft = JSON.parse(raw) as { message?: string; description?: string };
        if (draft.message) setCommitMessage(draft.message);
        if (draft.description) setCommitDescription(draft.description);
      }
    } catch {
      // Corrupt entry — ignore
    }
    restoredForRef.current = repoPath;
  }, [repoPath, conflictState, commitMessage, commitDescription, setCommitMessage, setCommitDescription]);
  // ─────────────────────────────────────────────────────────────────────────

  const isOperationInProgress = conflictState?.in_progress ?? false;
  const operationLabel = conflictState?.operation
    ? conflictState.operation.charAt(0).toUpperCase() + conflictState.operation.slice(1)
    : "";
  const unresolvedCount = fileStatuses.filter((f) => f.is_conflicted).length;

  const stagedCount = fileStatuses.filter((f) => f.is_staged).length;
  const canCommit =
    stagedCount > 0 && commitMessage.trim().length > 0 && !isLoading;
  const canContinue = unresolvedCount === 0 && !isLoading;

  const handleCommit = () => {
    if (canCommit) {
      commit(commitMessage, amendMode);
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
    persistDraft(e.target.value, commitDescription);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommitDescription(e.target.value);
    persistDraft(commitMessage, e.target.value);
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
              <ProfileAvatar
                name={gitIdentity.name}
                email={gitIdentity.email}
                size={20}
                color={activeProfile?.color}
                icon={activeProfile?.icon}
                avatarUrl={activeProfile?.avatar_url}
              />
              <span className="text-xs text-muted-foreground truncate">
                {gitIdentity.name}
              </span>
              <span className="ml-auto rounded bg-accent px-1.5 py-0.5 text-label text-dim shrink-0">
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
              {authInfo && (
                <p className="text-dim text-label">
                  Auth: {forgeStatus?.kind === "github" ? "GitHub" : forgeStatus?.kind === "gitlab" ? "GitLab" : ""} {authInfo.token_type === "oauth" ? "OAuth" : "PAT"}
                  {authInfo.username ? ` (@${authInfo.username})` : ""}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      <ResizableTextarea
        value={commitMessage}
        onChange={handleMessageChange}
        onKeyDown={handleKeyDown}
        placeholder={isOperationInProgress ? "Commit message for this step..." : "Commit message..."}
        autoGrow
        minHeight={34}
        maxHeight={220}
        gripPosition="top-right"
        className={`pr-10 ${
          commitMessage.length > 72
            ? "border-destructive/60"
            : commitMessage.length > 50
              ? "border-yellow-500/40"
              : isOperationInProgress
                ? "border-yellow-500/30"
                : "border-border"
        }`}
        overlay={
          commitMessage.length > 0 ? (
            <span
              className={`pointer-events-none absolute right-2 bottom-2 text-caption tabular-nums ${
                commitMessage.length > 72
                  ? "text-destructive"
                  : commitMessage.length > 50
                    ? "text-yellow-500"
                    : "text-faint"
              }`}
            >
              {commitMessage.length}
            </span>
          ) : null
        }
      />

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
            <ResizableTextarea
              value={commitDescription}
              onChange={handleDescriptionChange}
              onKeyDown={handleKeyDown}
              placeholder="Optional extended description..."
              minHeight={76}
              maxHeight={320}
              gripPosition="top-right"
              className="border-border"
            />
          )}

          {/* Amend last commit toggle */}
          {headCommitId && (
            <label className="flex items-center gap-2 cursor-pointer group">
              <Checkbox
                checked={amendMode}
                onCheckedChange={(v) => setAmendMode(v === true)}
              />
              <span className="text-xs text-dim group-hover:text-muted-foreground transition-colors select-none">
                Amend last commit
              </span>
              {amendMode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">
                      Amending rewrites history — you'll need to force push if
                      already pushed
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </label>
          )}
        </>
      )}

      {/* Action buttons */}
      {isOperationInProgress ? (
        <div className="flex gap-2">
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:hover:translate-y-0 ${
              unresolvedCount > 0
                ? "border-red-500/30 text-red-400 opacity-80"
                : "border-[rgba(var(--conflict-output),0.3)] text-[var(--conflict-output-text)] hover:bg-[rgba(var(--conflict-output),0.1)] hover:border-[rgba(var(--conflict-output),0.4)] hover:-translate-y-px"
            }`}
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
          className={`w-full rounded-md px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${
            amendMode
              ? "bg-yellow-600 text-white hover:bg-yellow-600/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {isLoading
            ? amendMode ? "Amending..." : "Committing..."
            : amendMode
              ? stagedCount > 0
                ? `Amend Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`
                : "Nothing staged"
              : stagedCount > 0
                ? `Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`
                : "Nothing staged"}
        </button>
      )}
      <p className="flex items-center justify-center gap-1.5 text-xs text-faint">
        <Kbd>Ctrl+Enter</Kbd>
        {isOperationInProgress ? "to continue" : "to commit"}
      </p>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { getBriefSync, getTokenInfo, setBriefSync, suggestCommitMessage, syncBriefs } from "@/lib/commands";
import { showError } from "@/lib/toast";
import type { TokenInfo } from "@/lib/commands";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { ProfileAvatar } from "@/components/ui/avatar";
import { ResizableTextarea, type ResizableTextareaApi } from "@/components/ui/resizable-textarea";
import { RowDragHandle } from "@/components/ui/row-drag-handle";
import { AbortButton } from "@/components/ui/abort-button";
import { IconButton } from "@/components/ui/icon-button";

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

/** `briefMode`: the Brief tab is showing, so the message comes from
 *  Summarize (stage everything, write brief + message) and isn't typed. */
export function CommitBox({ briefMode = false }: { briefMode?: boolean }) {
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
  const amendMode = useRepoStore((s) => s.amendMode);
  const setAmendMode = useRepoStore((s) => s.setAmendMode);
  const headCommitId = useRepoStore((s) => s.headCommitId);
  const repoPath = useRepoStore((s) => s.repoPath);
  const claudeAvailable = useRepoStore((s) => s.claudeAvailable);
  const aiModel = useRepoStore((s) => s.aiModel);
  const stage = useRepoStore((s) => s.stage);
  const loadStatus = useRepoStore((s) => s.loadStatus);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const suggestBody = useRepoStore((s) => s.suggestBody);
  const setSuggestBody = useRepoStore((s) => s.setSuggestBody);

  // Drag handle above the card resizes the merged commit field — the
  // description part when it's shown, the subject otherwise.
  const messageResize = useRef<ResizableTextareaApi>(null);
  const descriptionResize = useRef<ResizableTextareaApi>(null);
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
    stagedCount > 0 && commitMessage.trim().length > 0 && !isLoading && !isSuggesting;
  const canContinue = unresolvedCount === 0 && !isLoading;
  const canSuggest = claudeAvailable && stagedCount > 0 && !isOperationInProgress && !amendMode;

  // Without Claude there's no Summarize, so the Brief tab keeps the typed message.
  const summarizing = briefMode && claudeAvailable && !isOperationInProgress;
  // Conflicts need resolving first: staging them would mark them resolved.
  const canSummarize =
    fileStatuses.length > 0 && unresolvedCount === 0 && !amendMode && !isLoading;

  const handleSuggest = async (writeBrief: boolean) => {
    setIsSuggesting(true);
    try {
      const unstaged = writeBrief
        ? [...new Set(fileStatuses.filter((f) => !f.is_staged).map((f) => f.path))]
        : [];
      if (unstaged.length > 0) await stage(unstaged);
      const s = useRepoStore.getState();
      // stage() toasts its own failure; don't summarize a subset as if it were everything.
      if (s.fileStatuses.some((f) => !f.is_staged && unstaged.includes(f.path))) return;
      if (!s.fileStatuses.some((f) => f.is_staged)) return;
      const before = {
        repoPath: s.repoPath,
        commitMessage: s.commitMessage,
        commitDescription: s.commitDescription,
        headCommitId: s.headCommitId,
      };
      const { subject, body } = await suggestCommitMessage(aiModel, writeBrief, suggestBody);
      if (writeBrief) await loadStatus();
      // Repo switched, user typed, or HEAD moved while claude ran — the result is stale.
      const now = useRepoStore.getState();
      if (
        now.repoPath !== before.repoPath ||
        now.commitMessage !== before.commitMessage ||
        now.commitDescription !== before.commitDescription ||
        now.headCommitId !== before.headCommitId
      ) return;
      // A summary replaces the whole message; a suggestion keeps a typed body.
      const suggested = suggestBody ? body : "";
      const description = writeBrief ? suggested : suggested || before.commitDescription;
      setCommitMessage(subject);
      setCommitDescription(description);
      persistDraft(subject, description);
    } catch (e) {
      showError(writeBrief ? "Summarize changes" : "Suggest commit message", e);
    } finally {
      setIsSuggesting(false);
    }
  };

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
    <>
      {summarizing ? (
        <div className="h-2 shrink-0" />
      ) : (
        <RowDragHandle
          onMouseDown={(e) =>
            (descriptionResize.current ?? messageResize.current)?.startResize(e)
          }
          label="Resize commit message"
        />
      )}
      <div className="flex shrink-0 flex-col gap-2 rounded-md border border-border bg-card px-3 py-3 animate-fade-in">
      {/* Operation progress header */}
      {isOperationInProgress && (
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-400 animate-pulse" />
          <span className="text-xs font-medium text-orange-200">
            {progressLabel ?? `${operationLabel} in progress`}
          </span>
        </div>
      )}

      {/* Author identity */}
      {!isOperationInProgress && gitIdentity && gitIdentity.name && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-default px-1">
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
              <span className="ml-auto rounded-md bg-accent px-1.5 py-0.5 text-label text-dim shrink-0">
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

      {/* Brief tab: the summary, read-only. Otherwise the merged commit
          field — subject on top (bright), extended description below the
          rule (dim). Two textareas styled as one box: a single textarea
          can't paint two colours or hold a divider, and an overlay mirror
          would have to keep caret metrics in sync. */}
      {summarizing ? (
        <>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-field px-3 py-2 text-xs">
            {commitMessage ? (
              <>
                <p className="font-medium text-foreground">{commitMessage}</p>
                {commitDescription && (
                  <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-dim">{commitDescription}</p>
                )}
              </>
            ) : (
              <p className="text-faint">Summarize stages every change, then writes the brief and the commit message.</p>
            )}
          </div>
          <button
            onClick={() => handleSuggest(true)}
            disabled={!canSummarize || isSuggesting}
            className="flex min-h-8 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSuggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isSuggesting ? "Summarizing…" : commitMessage ? "Summarize again" : "Summarize changes"}
          </button>
        </>
      ) : (
        <div
          className={`flex flex-col rounded-md border bg-field transition-colors focus-within:ring-1 focus-within:ring-ring ${
            commitMessage.length > 72
              ? "border-destructive/60"
              : commitMessage.length > 50
                ? "border-yellow-500/40"
                : isOperationInProgress
                  ? "border-orange-500/30"
                  : "border-border"
          }`}
        >
          <ResizableTextarea
            value={commitMessage}
            onChange={handleMessageChange}
            onKeyDown={handleKeyDown}
            placeholder={isOperationInProgress ? "Commit message for this step..." : "Commit message..."}
            autoGrow
            minHeight={50}
            maxHeight={480}
            gripPosition="none"
            apiRef={messageResize}
            className={`rounded-none border-0 bg-transparent focus:ring-0 ${canSuggest ? "pr-14" : "pr-10"}`}
            overlay={
              <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1">
                {commitMessage.length > 0 && (
                  <span
                    className={`text-caption tabular-nums ${
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
                {canSuggest && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconButton
                        size="sm"
                        onClick={() => handleSuggest(false)}
                        disabled={isSuggesting}
                        aria-label="Suggest message with Claude"
                        className="pointer-events-auto"
                      >
                        {isSuggesting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                      </IconButton>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">Suggest message with Claude</p>
                      <p className="text-label text-dim">
                        From the staged changes, with any Change Brief covering them as context. Sends your staged diff to Anthropic via your Claude Code login
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            }
          />

          {/* Description — hidden mid-operation (rebase/merge steps take a
              subject only). */}
          {!isOperationInProgress && (
            <>
              <div className="mx-3 border-t border-border" />
              <ResizableTextarea
                value={commitDescription}
                onChange={handleDescriptionChange}
                onKeyDown={handleKeyDown}
                placeholder="Extended description..."
                minHeight={64}
                maxHeight={480}
                gripPosition="none"
                apiRef={descriptionResize}
                className="rounded-none border-0 bg-transparent text-dim focus:ring-0"
              />
            </>
          )}
        </div>
      )}

      {!isOperationInProgress && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Amend last commit toggle */}
            {headCommitId && (
              <CheckboxLabel checked={amendMode} onCheckedChange={setAmendMode} label="Amend last commit">
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
              </CheckboxLabel>
            )}
            {claudeAvailable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <CheckboxLabel checked={suggestBody} onCheckedChange={setSuggestBody} label="Suggest description" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Off: Claude suggests the subject line only</p>
                </TooltipContent>
              </Tooltip>
            )}
            {briefMode && <SyncToggle />}
          </div>
        </>
      )}

      {/* Action buttons */}
      {isOperationInProgress ? (
        <div className="flex gap-2">
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className={`flex min-h-8 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:hover:translate-y-0 ${
              unresolvedCount > 0
                ? "border-red-500/30 text-red-400 opacity-80"
                : "border-[rgba(var(--conflict-output),0.3)] text-[var(--conflict-output-text)] hover:bg-[rgba(var(--conflict-output),0.1)] hover:border-[rgba(var(--conflict-output),0.4)] hover:-translate-y-px"
            }`}
          >
            <span>
              {isLoading
                ? "Continuing..."
                : unresolvedCount > 0
                  ? `${unresolvedCount} conflict${unresolvedCount !== 1 ? "s" : ""} remaining`
                  : `Continue ${operationLabel}`}
            </span>
            {canContinue && !isLoading && <Kbd>Ctrl+Enter</Kbd>}
          </button>
          <AbortButton disabled={isLoading} className="min-h-8 px-3" />
        </div>
      ) : (
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className={`flex min-h-8 w-full items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold transition-all hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${
            amendMode
              ? "bg-yellow-600 text-white hover:bg-yellow-600/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          <span>
            {isLoading
              ? amendMode ? "Amending..." : "Committing..."
              : amendMode
                ? stagedCount > 0
                  ? `Amend Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`
                  : "Nothing staged"
                : stagedCount > 0
                  ? `Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`
                  : "Nothing staged"}
          </span>
          {canCommit && !isLoading && (
            <Kbd className="bg-black/25 text-white">Ctrl+Enter</Kbd>
          )}
        </button>
      )}
      </div>
    </>
  );
}

/** A checkbox and its label in the commit box's toggle row. Other props
 *  (a TooltipTrigger's handlers and ref) land on the label; children follow
 *  the text. */
function CheckboxLabel({
  checked,
  onCheckedChange,
  label,
  children,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  label: string;
} & React.ComponentPropsWithRef<"label">) {
  return (
    <label {...rest} className="flex items-center gap-2 cursor-pointer group">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      <span className="text-xs text-dim group-hover:text-muted-foreground transition-colors select-none">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Per-repo opt-in for sharing brief notes with origin. Off by default:
 *  briefs can hold reasoning that shouldn't leave this machine. */
function SyncToggle() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    getBriefSync().then(setEnabled).catch(() => {});
  }, [repoPath]);

  const toggle = async (on: boolean) => {
    setEnabled(on);
    try {
      await setBriefSync(on);
    } catch (e) {
      setEnabled(!on);
      showError("Sync Change Briefs", e);
      return;
    }
    if (on) await syncBriefs(true).catch((e) => showError("Sync Change Briefs", e));
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CheckboxLabel checked={enabled} onCheckedChange={toggle} label="Sync briefs" />
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">Share Change Briefs with origin on push, fetch and pull</p>
        <p className="text-label text-dim">Off: briefs stay on this machine</p>
      </TooltipContent>
    </Tooltip>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  FolderGit2,
  X,
  AlertTriangle,
  Loader2,
  Check,
  Copy,
  Trash2,
  GitMerge,
  FastForward,
  Link,
  Pencil,
  Cherry,
  GitBranchPlus,
  Tag,
  Undo2,
  RotateCcw,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArchiveRestore,
} from "lucide-react";
import { getUiState, setUiState } from "@/lib/database";
import { Checkbox } from "@/components/ui/checkbox";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import {
  CommitGraphCanvas,
  LANE_WIDTH,
  type GraphColumnWidths,
} from "@/components/graph/commit-graph-canvas";
import { GraphHeader } from "@/components/graph/graph-header";
import { DiffViewer } from "@/components/staging/diff-viewer";
import { ConflictEditor } from "@/components/staging/conflict-editor";
import { CiLogViewer } from "@/components/ci/ci-log-viewer";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import type { BranchInfo, ForgeKind, ForgeStatus, TagInfo } from "@/types/git";
import { ForgeIcon } from "@/components/ui/forge-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// ── Graph column layout (badge / graph / sha / message / author / date) ──────
// Static columns (user-resizable pixels, or fixed constants):
//   - badge (branch/tag): pixels, user-resizable
//   - graph:              pixels, user-resizable (floored by lane count)
//   - sha:                fixed constant (not resizable, not persisted)
//   - date:               fixed constant (not resizable, not persisted)
// Flexible columns: message + author share the remaining ("flex") width in a
// persisted ratio so each scales with the middle pane while preserving the
// visible-text ratio between them.
const COL_BADGE_MIN = 120;
const COL_BADGE_MAX = 420;
const COL_GRAPH_MIN = 80;
const COL_GRAPH_MAX = 800;
const COL_AUTHOR_MIN = 80;
const COL_AUTHOR_MAX = 400;

const COL_BADGE_DEFAULT = 190;
const COL_GRAPH_PAD_RIGHT = 24;
/** Fixed pixel width of the SHA column — sized to fit a 7-char short SHA at
 *  body font size (incl. up to ~110% font scale). Not persisted, not resizable. */
const COL_SHA = 70;
/** Fixed pixel width of the date column. Not persisted, not resizable. */
const COL_DATE = 100;
/** Default share of the flexible (message + author) area allocated to author.
 *  Message gets the remaining (1 − ratio). */
const AUTHOR_RATIO_DEFAULT = 0.25;

interface GraphLayout {
  /** Badge (branch/tag) column width in pixels. */
  badge: number;
  /** Graph column width in pixels (floored by lane count at render time). */
  graph: number;
  /** Author's share (0..1) of the flexible message+author area. */
  authorRatio: number;
}

const LAYOUT_DEFAULT: GraphLayout = {
  badge: COL_BADGE_DEFAULT,
  graph: COL_GRAPH_MIN,
  authorRatio: AUTHOR_RATIO_DEFAULT,
};

/** Default graph column width derived from the topology's lane count. */
function defaultGraphWidth(totalLanes: number): number {
  return Math.max(
    COL_GRAPH_MIN,
    Math.min(COL_GRAPH_MAX, totalLanes * LANE_WIDTH + COL_GRAPH_PAD_RIGHT),
  );
}

/** Minimum allowed graph column width — must fit every lane in the current topology. */
function minGraphWidth(totalLanes: number): number {
  return Math.max(COL_GRAPH_MIN, totalLanes * LANE_WIDTH + 8);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Compute the pixel width available to the message+author pair. */
function flexAreaPx(
  layout: GraphLayout,
  containerWidth: number,
  totalLanes: number,
  visibility: { sha: boolean; date: boolean },
): number {
  const badge = clamp(layout.badge, COL_BADGE_MIN, COL_BADGE_MAX);
  const graph = clamp(layout.graph, minGraphWidth(totalLanes), COL_GRAPH_MAX);
  const sha = visibility.sha ? COL_SHA : 0;
  const date = visibility.date ? COL_DATE : 0;
  return Math.max(0, containerWidth - badge - graph - sha - date);
}

/** Project the persisted layout onto the current container, clamped to pixel
 *  min/max. The author column is derived from `authorRatio × flexArea`. */
function deriveWidths(
  layout: GraphLayout,
  containerWidth: number,
  totalLanes: number,
  visibility: { sha: boolean; author: boolean; date: boolean },
): GraphColumnWidths {
  const badge = clamp(layout.badge, COL_BADGE_MIN, COL_BADGE_MAX);
  const graph = clamp(layout.graph, minGraphWidth(totalLanes), COL_GRAPH_MAX);
  const flex = flexAreaPx(layout, containerWidth, totalLanes, visibility);
  const author = clamp(layout.authorRatio * flex, COL_AUTHOR_MIN, COL_AUTHOR_MAX);
  return { badge, graph, sha: COL_SHA, author, date: COL_DATE };
}

/** Convert the pixel widths reported by the header (after a drag) back into
 *  the persistable layout. Badge/graph stay in pixels; author becomes its
 *  ratio of the resulting flex area. SHA and date are fixed constants and
 *  not part of the persisted layout. */
function pxWidthsToLayout(
  w: GraphColumnWidths,
  containerWidth: number,
  totalLanes: number,
  visibility: { sha: boolean; date: boolean },
  prev: GraphLayout,
): GraphLayout {
  const next: GraphLayout = {
    badge: w.badge,
    graph: w.graph,
    authorRatio: prev.authorRatio,
  };
  if (containerWidth > 0) {
    const flex = flexAreaPx(next, containerWidth, totalLanes, visibility);
    if (flex > 0) {
      next.authorRatio = clamp(w.author / flex, 0.05, 0.9);
    }
  }
  return next;
}

/** Parse the persisted layout blob `{ badge, graph, authorRatio }`. Invalid
 *  or missing entries reject so callers fall back to defaults — there is no
 *  migration from older formats. */
function parseStoredLayout(raw: string | null, totalLanes: number): GraphLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const num = (k: string): number =>
      typeof parsed[k] === "number" && Number.isFinite(parsed[k]) ? (parsed[k] as number) : NaN;

    const badge = num("badge");
    const graph = num("graph");
    const authorRatio = num("authorRatio");
    if (
      !Number.isFinite(badge) ||
      !Number.isFinite(graph) ||
      !Number.isFinite(authorRatio)
    ) {
      return null;
    }
    return {
      badge: clamp(badge, COL_BADGE_MIN, COL_BADGE_MAX),
      graph: clamp(graph, minGraphWidth(totalLanes), COL_GRAPH_MAX),
      authorRatio: clamp(authorRatio, 0.05, 0.9),
    };
  } catch {
    return null;
  }
}

export function GraphPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const commits = useRepoStore((s) => s.commits);
  const edges = useRepoStore((s) => s.edges);
  const totalLanes = useRepoStore((s) => s.totalLanes);
  const selectedCommitId = useRepoStore((s) => s.selectedCommitId);
  const selectedFilePath = useRepoStore((s) => s.selectedFilePath);
  const activeDiff = useRepoStore((s) => s.activeDiff);
  const isLoading = useRepoStore((s) => s.isLoading);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const stashes = useRepoStore((s) => s.stashes);
  const branches = useRepoStore((s) => s.branches);
  const refMru = useRepoStore((s) => s.refMru);
  const tags = useRepoStore((s) => s.tags);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const headCommitId = useRepoStore((s) => s.headCommitId);
  const selectedFileStaged = useRepoStore((s) => s.selectedFileStaged);
  const largeDiffPending = useRepoStore((s) => s.largeDiffPending);
  const diffLoading = useRepoStore((s) => s.diffLoading);
  const ciSelectedJobId = useRepoStore((s) => s.ciSelectedJobId);

  const openRepository = useRepoStore((s) => s.openRepository);
  const selectCommit = useRepoStore((s) => s.selectCommit);
  const clearDiff = useRepoStore((s) => s.clearDiff);
  const loadPendingDiff = useRepoStore((s) => s.loadPendingDiff);
  const clearSelection = useRepoStore((s) => s.clearSelection);
  const loadStatus = useRepoStore((s) => s.loadStatus);
  const checkout = useRepoStore((s) => s.checkout);
  const undoInfo = useRepoStore((s) => s.undoInfo);
  const undoAction = useRepoStore((s) => s.undo);
  const dirtyActionPending = useRepoStore((s) => s.dirtyActionPending);
  const stashAndProceed = useRepoStore((s) => s.stashAndProceed);
  const discardAndProceed = useRepoStore((s) => s.discardAndProceed);
  const cancelDirtyAction = useRepoStore((s) => s.cancelDirtyAction);
  const remoteCheckoutPending = useRepoStore((s) => s.remoteCheckoutPending);
  const resetLocalToRemote = useRepoStore((s) => s.resetLocalToRemote);
  const cancelRemoteCheckout = useRepoStore((s) => s.cancelRemoteCheckout);
  const forcePushPending = useRepoStore((s) => s.forcePushPending);
  const forcePush = useRepoStore((s) => s.forcePush);
  const cancelForcePush = useRepoStore((s) => s.cancelForcePush);
  const conflictState = useRepoStore((s) => s.conflictState);
  const cherryPick = useRepoStore((s) => s.cherryPick);
  const rebaseOnto = useRepoStore((s) => s.rebaseOnto);
  const mergeInto = useRepoStore((s) => s.mergeInto);
  const resetTo = useRepoStore((s) => s.resetTo);
  const revertCommit = useRepoStore((s) => s.revertCommit);
  const checkoutDetached = useRepoStore((s) => s.checkoutDetached);
  const createBranchAtAction = useRepoStore((s) => s.createBranchAt);
  const createNewTag = useRepoStore((s) => s.createNewTag);
  const deleteExistingTag = useRepoStore((s) => s.deleteExistingTag);
  const deleteBranch = useRepoStore((s) => s.deleteBranch);
  const deleteRemoteBranch = useRepoStore((s) => s.deleteRemoteBranch);
  const renameBranch = useRepoStore((s) => s.renameBranch);
  const pull = useRepoStore((s) => s.pull);
  const push = useRepoStore((s) => s.push);
  const setUpstream = useRepoStore((s) => s.setUpstream);
  const selectFile = useRepoStore((s) => s.selectFile);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const rewordHeadCommit = useRepoStore((s) => s.rewordHeadCommit);
  const selectStash = useRepoStore((s) => s.selectStash);
  const applyStash = useRepoStore((s) => s.applyStash);
  const popStash = useRepoStore((s) => s.popStash);
  const dropStash = useRepoStore((s) => s.dropStash);

  const [commitContextMenu, setCommitContextMenu] = useState<{
    commitId: string;
    x: number;
    y: number;
    /** When set, the context menu lists actions for only this ref (set by the
     *  hover dropdown's right-click so the user gets the right ref's actions). */
    focusRefName?: string;
  } | null>(null);
  const [stashContextMenu, setStashContextMenu] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<string | null>(null);
  const [confirmResetHard, setConfirmResetHard] = useState<string | null>(null);
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<{
    branchName: string;
    deleteLocal: boolean;
    deleteRemote: boolean;
    remoteName: string;
  } | null>(null);
  const [confirmDropStash, setConfirmDropStash] = useState<number | null>(null);
  const [createBranchDialog, setCreateBranchDialog] = useState<{ commitId: string } | null>(null);
  const [createTagDialog, setCreateTagDialog] = useState<{ commitId: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ branch: string } | null>(null);
  const [upstreamDialog, setUpstreamDialog] = useState<{ branch: string } | null>(null);
  const [dialogInput, setDialogInput] = useState("");
  const [editMessageDialog, setEditMessageDialog] = useState<{ commitId: string } | null>(null);
  const [editMsgSubject, setEditMsgSubject] = useState("");
  const [editMsgBody, setEditMsgBody] = useState("");

  // Ctrl+Z undo shortcut (global)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        // Don't intercept if focused on an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (undoInfo?.can_undo) {
          e.preventDefault();
          undoAction();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoInfo, undoAction]);


  const handleOpenRepo = useCallback(async () => {
    const selected = await open({
      directory: true,
      title: "Open Git Repository",
    });
    if (selected) {
      await openRepository(selected);
    }
  }, [openRepository]);

  const recentRepos = useRepoStore((s) => s.recentRepos);
  const removeFromRecentRepos = useRepoStore((s) => s.removeFromRecentRepos);

  // ── Graph column widths ───────────────────────────────────────────────
  // Stored per-repo as JSON under ui_state key `graph_layout:{path}`. Badge,
  // graph and author scale proportionally with the middle pane; sha is a
  // fixed constant; date is a static pixel width.
  const [layout, setLayout] = useState<GraphLayout>({
    ...LAYOUT_DEFAULT,
    graph: defaultGraphWidth(totalLanes),
  });
  const columnVisibility = useRepoStore((s) => s.graphColumnVisibility);
  const setColumnVisibility = useRepoStore((s) => s.setGraphColumnVisibility);
  const dateFormat = useRepoStore((s) => s.graphDateFormat);
  const [graphContainerWidth, setGraphContainerWidth] = useState<number>(0);
  // Keep refs alongside the state so async load + drag-end callbacks can read
  // the latest container width and visibility without needing them in deps.
  const containerWidthRef = useRef(0);
  useEffect(() => {
    containerWidthRef.current = graphContainerWidth;
  }, [graphContainerWidth]);
  const visibilityRef = useRef(columnVisibility);
  useEffect(() => {
    visibilityRef.current = columnVisibility;
  }, [columnVisibility]);
  const graphObserverRef = useRef<ResizeObserver | null>(null);
  const graphContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (graphObserverRef.current) {
      graphObserverRef.current.disconnect();
      graphObserverRef.current = null;
    }
    if (el) {
      setGraphContainerWidth(el.clientWidth);
      const observer = new ResizeObserver(() => {
        setGraphContainerWidth(el.clientWidth);
      });
      observer.observe(el);
      graphObserverRef.current = observer;
    }
  }, []);

  // Restore the persisted layout when the repo changes. Invalid or missing
  // entries fall back to defaults — there is no migration from older formats.
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    const defaults: GraphLayout = {
      ...LAYOUT_DEFAULT,
      graph: defaultGraphWidth(totalLanes),
    };
    getUiState(`graph_layout:${repoPath}`)
      .then((raw) => {
        if (cancelled) return;
        setLayout(parseStoredLayout(raw, totalLanes) ?? defaults);
      })
      .catch(() => {
        if (!cancelled) setLayout(defaults);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);


  // Effective pixel widths fed to header + canvas — derived each render from
  // the persisted layout, the current container width, the topology's lane
  // count (which floors the graph column), and which optional columns are on.
  const effectiveWidths: GraphColumnWidths = deriveWidths(
    layout,
    graphContainerWidth,
    totalLanes,
    columnVisibility,
  );


  // Auto-reopen checkbox state (welcome screen only)
  const [autoReopen, setAutoReopen] = useState(false);
  useEffect(() => {
    getUiState("auto_reopen_last_repo").then((v) => {
      if (v === "true") setAutoReopen(true);
    }).catch(() => {});
  }, []);

  // No repo open — welcome screen
  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-background">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Open a repository to get started
          </p>
          <button
            onClick={handleOpenRepo}
            disabled={isLoading}
            className="rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {isLoading ? "Opening..." : "Open Repository"}
          </button>
        </div>

        {recentRepos.length > 0 && (
          <div className="mt-2 w-full max-w-sm">
            <p className="mb-2 text-label font-medium text-faint uppercase tracking-[0.08em] text-center">
              Recent Repositories
            </p>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border overflow-hidden">
              {recentRepos.map((repo) => {
                const profileName = repo.profile_id
                  ? useProfileStore.getState().profiles.find((p) => p.id === repo.profile_id)?.name
                  : null;
                return (
                  <div
                    key={repo.path}
                    className="group flex items-center gap-2 bg-card px-3 py-2 cursor-pointer transition-colors hover:bg-secondary"
                    onClick={() => openRepository(repo.path)}
                  >
                    {repo.forge_kind ? (
                      <ForgeIcon kind={repo.forge_kind as ForgeKind} className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-foreground truncate">
                        {repo.name}
                      </span>
                      <span className="text-label text-faint truncate">
                        {repo.path}
                      </span>
                    </div>
                    {profileName && (
                      <span className="shrink-0 rounded-sm bg-brand/10 px-1.5 py-0.5 text-caption font-medium text-brand-dim">
                        {profileName}
                      </span>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromRecentRepos(repo.path);
                          }}
                          className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Remove from recent</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Auto-reopen toggle */}
        <label className="mt-1 flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={autoReopen}
            onCheckedChange={(v) => {
              const checked = v === true;
              setAutoReopen(checked);
              setUiState("auto_reopen_last_repo", checked ? "true" : "false").catch(() => {});
            }}
          />
          <span className="text-xs text-muted-foreground select-none">
            Reopen last repository on startup
          </span>
        </label>
      </div>
    );
  }

  // Empty repo
  if (!isLoading && commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">No commits yet</p>
      </div>
    );
  }

  const showDiff = activeDiff !== null;
  const showLargeDiffGuard = largeDiffPending !== null;
  const showCiLog = ciSelectedJobId != null && !showDiff && !showLargeDiffGuard;
  const isConflictedFile = selectedFilePath
    ? fileStatuses.some((f) => f.path === selectedFilePath && f.is_conflicted)
    : false;
  const showConflictEditor = isConflictedFile && !selectedCommitId && selectedStashIndex == null;

  return (
    <div className="relative flex h-full flex-col bg-background">
      {/* File path bar — only for large diff guard or diff loading (DiffViewer has its own) */}
      {!showDiff && (showLargeDiffGuard || (diffLoading && selectedFilePath)) && (
        <div className="shrink-0">
          <div className="flex min-h-9 items-center px-3 py-1">
            <button
              onClick={clearDiff}
              className="mr-2 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <span className="truncate text-xs font-medium text-foreground">
              {selectedFilePath}
            </span>
          </div>
          <div className="mx-3 border-t border-border" />
        </div>
      )}

      {/* Conflict banner — hidden when conflict editor is active (it has its own toolbar) */}
      {conflictState?.in_progress && !showConflictEditor && (() => {
        const conflictedFiles = fileStatuses.filter((f) => f.is_conflicted);
        const unresolvedCount = conflictedFiles.length;
        return (
          <div className="flex items-center gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
            <span className="flex-1 text-xs text-yellow-200">
              {conflictState.operation.charAt(0).toUpperCase() + conflictState.operation.slice(1)} in progress
            </span>
            {unresolvedCount > 0 && (
              <button
                onClick={() => {
                  const first = conflictedFiles[0];
                  if (first) selectFile(first.path, false);
                }}
                title="Go to first conflict"
                className="rounded-md border border-yellow-500/30 px-3 py-1 text-xs font-medium text-yellow-100 transition-colors hover:bg-yellow-500/10 hover:border-yellow-500/40"
              >
                {unresolvedCount} conflict{unresolvedCount !== 1 ? "s" : ""} to resolve
              </button>
            )}
          </div>
        );
      })()}

      {/* Center content: graph, diff, or large diff guard */}
      <div className="flex-1 min-h-0">
        {showLargeDiffGuard ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Large diff — {largeDiffPending.totalChanges.toLocaleString()} changed lines
            </p>
            <button
              onClick={loadPendingDiff}
              disabled={largeDiffPending.loading}
              className="rounded-md bg-secondary px-4 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-40"
            >
              Load anyway
            </button>
          </div>
        ) : showConflictEditor && selectedFilePath ? (
          <ConflictEditor filePath={selectedFilePath} />
        ) : showDiff ? (
          <div className="h-full overflow-hidden">
            <DiffViewer
              diff={activeDiff}
              filePath={selectedFilePath ?? activeDiff.path}
              mode={
                selectedCommitId || selectedStashIndex != null
                  ? "readonly"
                  : "interactive"
              }
              source={{
                commitId: selectedCommitId,
                stashIndex: selectedStashIndex,
                staged: selectedFileStaged,
              }}
              staged={selectedFileStaged}
              onBack={clearDiff}
            />
          </div>
        ) : showCiLog ? (
          <CiLogViewer />
        ) : (
          <div ref={graphContainerRef} className="flex h-full flex-col">
            <GraphHeader
              widths={effectiveWidths}
              containerWidth={graphContainerWidth}
              badgeMin={COL_BADGE_MIN}
              badgeMax={COL_BADGE_MAX}
              graphMin={minGraphWidth(totalLanes)}
              graphMax={COL_GRAPH_MAX}
              visibility={columnVisibility}
              onResize={(w) => {
                const next = pxWidthsToLayout(w, containerWidthRef.current, totalLanes, visibilityRef.current, layout);
                setLayout(next);
              }}
              onResizeEnd={(w) => {
                const next = pxWidthsToLayout(w, containerWidthRef.current, totalLanes, visibilityRef.current, layout);
                setLayout(next);
                if (repoPath) {
                  setUiState(`graph_layout:${repoPath}`, JSON.stringify(next)).catch(() => {});
                }
              }}
              onVisibilityChange={setColumnVisibility}
            />
            <div className="flex-1 min-h-0">
              <CommitGraphCanvas
                commits={commits}
                edges={edges}
                totalLanes={totalLanes}
                selectedCommitId={selectedCommitId}
                headCommitId={headCommitId}
                onSelectCommit={selectCommit}
                onCheckoutBranch={checkout}
                branches={branches}
                tags={tags}
                stashes={stashes}
                hasUncommittedChanges={fileStatuses.length > 0}
                fileStatusCount={fileStatuses.length}
                isWipSelected={selectedCommitId === null && selectedStashIndex === null}
                onClickWip={() => { clearSelection(); loadStatus(); }}
                onSelectStash={(index) => selectStash(index)}
                onCommitContextMenu={(commitId, x, y, focusRefName) => {
                  if (isLoading) return;
                  setCommitContextMenu({ commitId, x, y, focusRefName });
                }}
                onStashContextMenu={(index, x, y) => {
                  if (isLoading) return;
                  setStashContextMenu({ index, x, y });
                }}
                columnWidths={effectiveWidths}
                columnVisibility={columnVisibility}
                dateFormat={dateFormat}
                refMru={refMru}
              />
            </div>
          </div>
        )}

        {/* Loading overlay — blocks interaction during git ops or diff loading */}
        {(isLoading || diffLoading) && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 animate-fade-in">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Commit context menu (includes branch ops when branches are on the commit) */}
      {commitContextMenu && (
        <ContextMenu
          x={commitContextMenu.x}
          y={commitContextMenu.y}
          items={buildCommitContextMenuItems(
            commitContextMenu.commitId,
            currentBranch,
            branches,
            tags,
            cherryPick,
            (id, mode) => {
              if (mode === "hard") {
                setConfirmResetHard(id);
              } else {
                resetTo(id, mode);
              }
            },
            rebaseOnto,
            mergeInto,
            revertCommit,
            checkoutDetached,
            (commitId) => { setDialogInput(""); setCreateBranchDialog({ commitId }); },
            (commitId) => { setDialogInput(""); setCreateTagDialog({ commitId }); },
            checkout,
            pull,
            push,
            (name, deleteLocal, deleteRemote, remoteName) => {
              setConfirmDeleteBranch({ branchName: name, deleteLocal, deleteRemote, remoteName });
            },
            (name) => { setDialogInput(name); setRenameDialog({ branch: name }); },
            (name) => { setDialogInput(""); setUpstreamDialog({ branch: name }); },
            headCommitId,
            (commitId) => {
              const c = commits.find((x) => x.id === commitId);
              if (!c) return;
              setEditMsgSubject(c.message);
              setEditMsgBody(c.body);
              setEditMessageDialog({ commitId });
            },
            (tagName) => setConfirmDeleteTag(tagName),
            forgeStatus,
            commitContextMenu.focusRefName,
          )}
          onClose={() => setCommitContextMenu(null)}
        />
      )}

      {/* Stash context menu */}
      {stashContextMenu && (
        <ContextMenu
          x={stashContextMenu.x}
          y={stashContextMenu.y}
          items={[
            {
              label: "Apply (keep in stash list)",
              onClick: () => applyStash(stashContextMenu.index),
              icon: ArrowDownToLine,
            },
            {
              label: "Pop (apply & remove)",
              onClick: () => popStash(stashContextMenu.index),
              icon: ArchiveRestore,
            },
            {
              label: "Drop (discard)",
              onClick: () => setConfirmDropStash(stashContextMenu.index),
              destructive: true,
              icon: Trash2,
            },
          ]}
          onClose={() => setStashContextMenu(null)}
        />
      )}

      {/* Dirty working tree dialog */}
      {dirtyActionPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-md">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <p className="text-sm text-foreground">Uncommitted changes</p>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              You have {dirtyActionPending.changesCount} unsaved {dirtyActionPending.changesCount === 1 ? "change" : "changes"}.
              How would you like to proceed?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelDirtyAction}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={stashAndProceed}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Stash &amp; {dirtyActionPending.operation === "pull" ? "Pull" : dirtyActionPending.operation === "merge" ? "Merge" : dirtyActionPending.operation === "cherry-pick" ? "Cherry-pick" : dirtyActionPending.operation === "revert" ? "Revert" : "Switch"}
              </button>
              <button
                onClick={discardAndProceed}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Discard &amp; {dirtyActionPending.operation === "pull" ? "Pull" : dirtyActionPending.operation === "merge" ? "Merge" : dirtyActionPending.operation === "cherry-pick" ? "Cherry-pick" : dirtyActionPending.operation === "revert" ? "Revert" : "Switch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remote checkout dialog */}
      {remoteCheckoutPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-md">
            {remoteCheckoutPending.alreadyOnLocal ? (
              <>
                <p className="text-sm text-foreground mb-1">
                  Reset &apos;{remoteCheckoutPending.localName}&apos; to match &apos;{remoteCheckoutPending.remoteName}&apos;?
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  This will hard-reset your local branch to the remote version. Any uncommitted changes will be lost.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground mb-1">
                  A local &apos;{remoteCheckoutPending.localName}&apos; already exists.
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Choose how to handle the remote branch checkout.
                </p>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelRemoteCheckout}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              {!remoteCheckoutPending.alreadyOnLocal && (
                <button
                  onClick={() => {
                    cancelRemoteCheckout();
                    checkout(remoteCheckoutPending.localName);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
                >
                  Switch to Local
                </button>
              )}
              <button
                onClick={resetLocalToRemote}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Reset Local to Remote
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset hard confirmation */}
      {confirmResetHard && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Reset hard?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will discard all changes and move the branch to {confirmResetHard.slice(0, 7)}. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmResetHard(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  resetTo(confirmResetHard, "hard");
                  setConfirmResetHard(null);
                }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Reset Hard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete branch confirmation */}
      {confirmDeleteBranch && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Delete branch?</p>
            <p className="text-xs text-muted-foreground mb-4">
              {confirmDeleteBranch.deleteLocal && confirmDeleteBranch.deleteRemote
                ? `This will delete "${confirmDeleteBranch.branchName}" locally and from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                : confirmDeleteBranch.deleteRemote
                  ? `This will delete "${confirmDeleteBranch.branchName}" from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                  : `This will delete "${confirmDeleteBranch.branchName}" locally. This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteBranch(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { branchName, deleteLocal, deleteRemote, remoteName } = confirmDeleteBranch;
                  setConfirmDeleteBranch(null);
                  if (deleteLocal) await deleteBranch(branchName);
                  if (deleteRemote) await deleteRemoteBranch(remoteName, branchName);
                }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop stash confirmation */}
      {confirmDropStash != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Drop stash?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will permanently discard stash@&#123;{confirmDropStash}&#125;. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDropStash(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  dropStash(confirmDropStash);
                  setConfirmDropStash(null);
                }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Drop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete tag confirmation */}
      {confirmDeleteTag != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Delete tag?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will delete the local tag "{confirmDeleteTag}". If it has been pushed, the remote tag is not affected.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteTag(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteExistingTag(confirmDeleteTag);
                  setConfirmDeleteTag(null);
                }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force push confirmation */}
      {forcePushPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Force push?</p>
            <p className="text-xs text-muted-foreground mb-4">
              The remote branch has diverged from your local branch. Force pushing will overwrite the remote history. This uses --force-with-lease for safety.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelForcePush}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={forcePush}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Force Push
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create branch at commit dialog */}
      {createBranchDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Create branch</p>
            <p className="text-xs text-muted-foreground mb-3">
              New branch at {createBranchDialog.commitId.slice(0, 7)}
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim()) {
                  createBranchAtAction(dialogInput.trim(), createBranchDialog.commitId);
                  setCreateBranchDialog(null);
                } else if (e.key === "Escape") {
                  setCreateBranchDialog(null);
                }
              }}
              placeholder="Branch name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateBranchDialog(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim()) {
                    createBranchAtAction(dialogInput.trim(), createBranchDialog.commitId);
                    setCreateBranchDialog(null);
                  }
                }}
                disabled={!dialogInput.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit (reword) HEAD commit message dialog */}
      {editMessageDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg w-full max-w-md">
            <p className="text-sm text-foreground mb-1">Edit commit message</p>
            <p className="text-xs text-muted-foreground mb-3">
              Rewrites HEAD ({editMessageDialog.commitId.slice(0, 7)}). If already pushed, you'll need to force push.
            </p>
            <input
              autoFocus
              value={editMsgSubject}
              onChange={(e) => setEditMsgSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditMessageDialog(null);
              }}
              placeholder="Subject"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-2"
            />
            <textarea
              value={editMsgBody}
              onChange={(e) => setEditMsgBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditMessageDialog(null);
              }}
              placeholder="Optional extended description…"
              rows={5}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3 font-mono"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditMessageDialog(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const subject = editMsgSubject.trim();
                  if (!subject) return;
                  const body = editMsgBody.trim();
                  const full = body ? `${subject}\n\n${body}` : subject;
                  rewordHeadCommit(full);
                  setEditMessageDialog(null);
                }}
                disabled={!editMsgSubject.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename branch dialog (from graph badge) */}
      {renameDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Rename branch</p>
            <p className="text-xs text-muted-foreground mb-3">
              Renaming &apos;{renameDialog.branch}&apos;
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim() && dialogInput.trim() !== renameDialog.branch) {
                  renameBranch(renameDialog.branch, dialogInput.trim());
                  setRenameDialog(null);
                } else if (e.key === "Escape") {
                  setRenameDialog(null);
                }
              }}
              placeholder="New name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameDialog(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim() && dialogInput.trim() !== renameDialog.branch) {
                    renameBranch(renameDialog.branch, dialogInput.trim());
                    setRenameDialog(null);
                  }
                }}
                disabled={!dialogInput.trim() || dialogInput.trim() === renameDialog.branch}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set upstream dialog (from graph badge) */}
      {upstreamDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Set upstream</p>
            <p className="text-xs text-muted-foreground mb-3">
              Set tracking branch for &apos;{upstreamDialog.branch}&apos;
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim()) {
                  setUpstream(dialogInput.trim());
                  setUpstreamDialog(null);
                } else if (e.key === "Escape") {
                  setUpstreamDialog(null);
                }
              }}
              placeholder="e.g. origin/main"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setUpstreamDialog(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim()) {
                    setUpstream(dialogInput.trim());
                    setUpstreamDialog(null);
                  }
                }}
                disabled={!dialogInput.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create tag at commit dialog */}
      {createTagDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Create tag</p>
            <p className="text-xs text-muted-foreground mb-3">
              New tag at {createTagDialog.commitId.slice(0, 7)}
            </p>
            <input
              autoFocus
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dialogInput.trim()) {
                  createNewTag(dialogInput.trim(), createTagDialog.commitId);
                  setCreateTagDialog(null);
                } else if (e.key === "Escape") {
                  setCreateTagDialog(null);
                }
              }}
              placeholder="Tag name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateTagDialog(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (dialogInput.trim()) {
                    createNewTag(dialogInput.trim(), createTagDialog.commitId);
                    setCreateTagDialog(null);
                  }
                }}
                disabled={!dialogInput.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildCommitContextMenuItems(
  commitId: string,
  currentBranch: string | null,
  branches: BranchInfo[],
  tags: TagInfo[],
  cherryPick: (id: string) => void,
  resetTo: (id: string, mode: "soft" | "hard") => void,
  rebaseOnto: (target: string) => void,
  mergeInto: (target: string) => void,
  revertCommit: (id: string) => void,
  checkoutDetached: (id: string) => void,
  createBranchHere: (commitId: string) => void,
  createTagHere: (commitId: string) => void,
  checkoutBranch: (name: string) => void,
  pull: () => void,
  push: () => void,
  confirmDeleteBranch: (name: string, deleteLocal: boolean, deleteRemote: boolean, remoteName: string) => void,
  renameBranch: (name: string) => void,
  setUpstream: (name: string) => void,
  headCommitId: string | null,
  openRewordDialog: (commitId: string) => void,
  confirmDeleteTag: (name: string) => void,
  forgeStatus: ForgeStatus | null,
  /** When set, the branch and tag sections are filtered to this single ref so
   *  the menu reflects the specific item the user clicked (e.g. via the hover
   *  dropdown). Falsy/undefined keeps the full multi-ref behaviour. */
  focusRefName?: string,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  // ── Branch ops (when branches point to this commit) ──
  const branchesOnCommit = (
    focusRefName
      ? branches.filter((b) => b.commit_id === commitId && b.name === focusRefName)
      : branches.filter((b) => b.commit_id === commitId)
  );

  for (const branch of branchesOnCommit) {
    const isCurrent = branch.name === currentBranch;
    const isRemote = branch.is_remote;

    if (isRemote) {
      items.push({
        label: `Checkout ${branch.name}`,
        onClick: () => checkoutBranch(branch.name),
        icon: Check,
      });
      items.push({
        label: `Copy branch name: ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branch.name),
        icon: Copy,
      });
      const slashIdx = branch.name.indexOf("/");
      if (slashIdx > 0) {
        const remote = branch.name.slice(0, slashIdx);
        const remoteBranch = branch.name.slice(slashIdx + 1);
        items.push({
          label: `Delete ${branch.name} from ${remote}…`,
          onClick: () => confirmDeleteBranch(remoteBranch, false, true, remote),
          destructive: true,
          icon: Trash2,
        });
      }
      items.push({ separator: true });
    } else {
      // Local branch
      if (!isCurrent) {
        items.push({
          label: `Checkout ${branch.name}`,
          onClick: () => checkoutBranch(branch.name),
          icon: Check,
        });
      }

      if (!isCurrent && currentBranch) {
        items.push({
          label: `Merge ${branch.name} into ${currentBranch}`,
          onClick: () => mergeInto(branch.name),
          icon: GitMerge,
        });
        items.push({
          label: branch.can_fast_forward
            ? `Fast-forward ${currentBranch} to ${branch.name}`
            : `Rebase ${currentBranch} onto ${branch.name}`,
          onClick: () => rebaseOnto(branch.name),
          icon: FastForward,
        });
      }

      items.push({ label: "Pull", onClick: () => pull(), icon: ArrowDownToLine });
      items.push({ label: "Push", onClick: () => push(), icon: ArrowUpFromLine });
      items.push({ label: "Set upstream…", onClick: () => setUpstream(branch.name), icon: Link });
      items.push({ label: "Rename branch…", onClick: () => renameBranch(branch.name), icon: Pencil });
      items.push({
        label: `Copy branch name: ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branch.name),
        icon: Copy,
      });

      if (!isCurrent) {
        const hasRemote = branch.ahead != null || branch.behind != null;
        items.push({
          label: `Delete ${branch.name}…`,
          onClick: () => confirmDeleteBranch(branch.name, true, false, "origin"),
          destructive: true,
          icon: Trash2,
        });
        if (hasRemote) {
          items.push({
            label: `Delete ${branch.name} (local + remote)…`,
            onClick: () => confirmDeleteBranch(branch.name, true, true, "origin"),
            destructive: true,
            icon: Trash2,
          });
        }
      }

      items.push({ separator: true });
    }
  }

  // ── Commit ops ──
  const shortSha = commitId.slice(0, 7);
  const hasLocalBranches = branchesOnCommit.some((b) => !b.is_remote);

  items.push({
    label: `Cherry-pick onto ${currentBranch ?? "HEAD"}`,
    onClick: () => cherryPick(commitId),
    icon: Cherry,
  });

  // Only show commit-level merge/rebase when no local branch already
  // covers them — otherwise they duplicate the branch ops above.
  if (currentBranch && !hasLocalBranches) {
    items.push({
      label: `Merge ${shortSha} into ${currentBranch}`,
      onClick: () => mergeInto(commitId),
      icon: GitMerge,
    });
    items.push({
      label: `Rebase ${currentBranch} onto ${shortSha}`,
      onClick: () => rebaseOnto(commitId),
      icon: FastForward,
    });
  }

  items.push({ separator: true });

  // Navigation
  items.push({
    label: `Checkout ${shortSha} (detached HEAD)`,
    onClick: () => checkoutDetached(commitId),
    icon: Check,
  });
  items.push({
    label: `Create branch at ${shortSha}…`,
    onClick: () => createBranchHere(commitId),
    icon: GitBranchPlus,
  });
  items.push({
    label: `Create tag at ${shortSha}…`,
    onClick: () => createTagHere(commitId),
    icon: Tag,
  });

  // Per-tag actions for tags already pointing at this commit
  const tagsOnCommit = (
    focusRefName
      ? tags.filter((t) => t.commit_id && commitId.startsWith(t.commit_id) && t.name === focusRefName)
      : tags.filter((t) => t.commit_id && commitId.startsWith(t.commit_id))
  );
  for (const tag of tagsOnCommit) {
    items.push({
      label: `Copy tag name: ${tag.name}`,
      onClick: () => navigator.clipboard.writeText(tag.name),
      icon: Copy,
    });
    items.push({
      label: `Delete tag ${tag.name}…`,
      onClick: () => confirmDeleteTag(tag.name),
      destructive: true,
      icon: Trash2,
    });
  }

  items.push({ separator: true });

  // Modify
  if (commitId === headCommitId) {
    items.push({
      label: "Edit commit message…",
      onClick: () => openRewordDialog(commitId),
      icon: Pencil,
    });
  }
  items.push({
    label: `Revert ${shortSha}`,
    onClick: () => revertCommit(commitId),
    icon: Undo2,
  });
  items.push({
    label: `Reset soft to ${shortSha} (keep changes)`,
    onClick: () => resetTo(commitId, "soft"),
    icon: RotateCcw,
  });
  items.push({
    label: `Reset hard to ${shortSha}`,
    onClick: () => resetTo(commitId, "hard"),
    destructive: true,
    icon: RotateCcw,
  });

  items.push({ separator: true });

  // Clipboard
  items.push({
    label: `Copy SHA: ${commitId.slice(0, 7)}`,
    onClick: () => navigator.clipboard.writeText(commitId),
    icon: Copy,
  });

  // Copy link to commit (when forge is detected)
  if (forgeStatus?.kind && forgeStatus.host && forgeStatus.owner && forgeStatus.repo) {
    const { kind, host, owner, repo } = forgeStatus;
    const commitPath = kind === "gitlab" ? `-/commit/${commitId}` : `commit/${commitId}`;
    const commitUrl = `https://${host}/${owner}/${repo}/${commitPath}`;
    items.push({
      label: "Copy link to commit",
      onClick: () => navigator.clipboard.writeText(commitUrl),
      icon: Link,
    });

    // Copy link to branch (for branches on this commit)
    for (const branch of branchesOnCommit) {
      if (branch.is_remote) continue;
      const branchPath = kind === "gitlab"
        ? `-/tree/${encodeURIComponent(branch.name)}`
        : `tree/${encodeURIComponent(branch.name)}`;
      const branchUrl = `https://${host}/${owner}/${repo}/${branchPath}`;
      items.push({
        label: `Copy link to ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branchUrl),
        icon: Link,
      });
    }
  }

  return items;
}

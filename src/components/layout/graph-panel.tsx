import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderGit2,
  X,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { AbortButton } from "@/components/ui/abort-button";
import { getUiState, setUiState } from "@/lib/database";
import { rewordImpact } from "@/lib/commands";
import { Checkbox } from "@/components/ui/checkbox";
import { useRepoStore } from "@/stores/repo-store";
import { useDelayedFlag } from "@/hooks/use-delayed-flag";
import { useProfileStore } from "@/stores/profile-store";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { CreateWorktreeDialog, RemoveWorktreeDialog } from "@/components/ui/worktree-dialogs";
import {
  CommitGraphCanvas,
  MESSAGE_INSET_LEFT,
  SCROLLBAR_PAD_RIGHT,
  type GraphColumnWidths,
  type GraphColumnVisibility,
} from "@/components/graph/commit-graph-canvas";
import { laneWidthFor, LANE_WIDTH } from "@/lib/graph-density";
import { GraphHeader } from "@/components/graph/graph-header";
import { DiffViewer } from "@/components/staging/diff-viewer";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { ConflictEditor } from "@/components/staging/conflict-editor";
import { CiLogViewer } from "@/components/ci/ci-log-viewer";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import type { BranchInfo, ForgeKind, ForgeStatus, RewordImpact, TagInfo } from "@/types/git";
import { ForgeIcon } from "@/components/ui/forge-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ACTION_ICONS } from "@/lib/action-icons";

// ── Graph column layout (badge / graph / message / author / date / sha) ──────
// Static columns (user-resizable pixels, or fixed constants):
//   - badge (branch/tag): pixels, user-resizable
//   - graph:              pixels, user-resizable (floored by lane count)
//   - date:               fixed constant (not resizable, not persisted)
//   - sha:                fixed constant (not resizable, not persisted), rightmost
// Flexible columns: message + author share the remaining ("flex") width in a
// persisted ratio so each scales with the middle pane while preserving the
// visible-text ratio between them.
const COL_BADGE_MIN = 120;
const COL_BADGE_MAX = 420;
const COL_GRAPH_MIN = 55;
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
/** Minimum readable width for the message column. When showing all enabled
 *  optional columns would shrink the message below this, columns are
 *  auto-collapsed (sha → date → author) until it fits again. */
const COL_MSG_MIN = 160;
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

/** Default graph column width derived from the topology's lane count and the
 *  active lane pitch (narrower when dot nodes are on). */
function defaultGraphWidth(totalLanes: number, laneWidth: number): number {
  return Math.max(
    COL_GRAPH_MIN,
    Math.min(COL_GRAPH_MAX, totalLanes * laneWidth + COL_GRAPH_PAD_RIGHT),
  );
}

/** Minimum allowed graph column width — must fit every lane in the current topology. */
function minGraphWidth(totalLanes: number, laneWidth: number): number {
  return Math.max(COL_GRAPH_MIN, totalLanes * laneWidth + 8);
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
  laneWidth: number,
): number {
  const badge = clamp(layout.badge, COL_BADGE_MIN, COL_BADGE_MAX);
  const graph = clamp(layout.graph, minGraphWidth(totalLanes, laneWidth), COL_GRAPH_MAX);
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
  laneWidth: number,
): GraphColumnWidths {
  const badge = clamp(layout.badge, COL_BADGE_MIN, COL_BADGE_MAX);
  const graph = clamp(layout.graph, minGraphWidth(totalLanes, laneWidth), COL_GRAPH_MAX);
  const flex = flexAreaPx(layout, containerWidth, totalLanes, visibility, laneWidth);
  let author = clamp(layout.authorRatio * flex, COL_AUTHOR_MIN, COL_AUTHOR_MAX);
  // Never let a wide author ratio starve the message below its minimum — cap
  // author at whatever leaves COL_MSG_MIN for the message (floored at its min).
  if (flex - author < COL_MSG_MIN) {
    author = Math.max(COL_AUTHOR_MIN, flex - COL_MSG_MIN);
  }
  return { badge, graph, sha: COL_SHA, author, date: COL_DATE };
}

/** Responsive column collapse. Starting from the user's chosen visibility, drop
 *  optional columns in priority order (sha → date → author) until the message
 *  column would have at least COL_MSG_MIN px. Columns dropped here are still
 *  "on" from the user's perspective — the canvas surfaces their values in a
 *  hover tooltip. Mirrors the message-width arithmetic in the canvas draw(). */
function deriveEffectiveVisibility(
  badge: number,
  graph: number,
  containerWidth: number,
  userVisibility: GraphColumnVisibility,
): GraphColumnVisibility {
  const vis = { ...userVisibility };
  // Not measured yet — honor the user's choice; a later resize re-derives.
  if (containerWidth <= 0) return vis;

  const msgFits = (v: GraphColumnVisibility): boolean => {
    const rightCols =
      (v.sha ? COL_SHA : 0) +
      (v.date ? COL_DATE : 0) +
      (v.author ? COL_AUTHOR_MIN : 0);
    // Matches draw(): msgRight = width - SCROLLBAR_PAD_RIGHT - rightCols - 8
    // when any right column is shown, else width - 16.
    const msgRight =
      rightCols > 0
        ? containerWidth - SCROLLBAR_PAD_RIGHT - rightCols - 8
        : containerWidth - 16;
    const msgLeft = badge + graph + MESSAGE_INSET_LEFT;
    return msgRight - msgLeft >= COL_MSG_MIN;
  };

  if (!msgFits(vis) && vis.sha) vis.sha = false;
  if (!msgFits(vis) && vis.date) vis.date = false;
  if (!msgFits(vis) && vis.author) vis.author = false;
  return vis;
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
  laneWidth: number,
): GraphLayout {
  const next: GraphLayout = {
    badge: w.badge,
    graph: w.graph,
    authorRatio: prev.authorRatio,
  };
  if (containerWidth > 0) {
    const flex = flexAreaPx(next, containerWidth, totalLanes, visibility, laneWidth);
    if (flex > 0) {
      next.authorRatio = clamp(w.author / flex, 0.05, 0.9);
    }
  }
  return next;
}

/** Parse the persisted layout blob `{ badge, graph, authorRatio }`. Invalid
 *  or missing entries reject so callers fall back to defaults — there is no
 *  migration from older formats. */
function parseStoredLayout(raw: string | null, totalLanes: number, laneWidth: number): GraphLayout | null {
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
      graph: clamp(graph, minGraphWidth(totalLanes, laneWidth), COL_GRAPH_MAX),
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
  // Local diffs return in a few ms — showing the dim overlay immediately just
  // flashes. Only diffs slower than half a second get one; the git-op overlay
  // (isLoading) stays instant since it also blocks interaction.
  const showDiffSpinner = useDelayedFlag(diffLoading, 500);
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
  const revealWorktree = useRepoStore((s) => s.revealWorktree);
  const selectFile = useRepoStore((s) => s.selectFile);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const rewordCommit = useRepoStore((s) => s.rewordCommit);
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
  const [worktreeDialogBranch, setWorktreeDialogBranch] = useState<string | null>(null);
  const [removeWorktreeTarget, setRemoveWorktreeTarget] = useState<{ path: string; label: string } | null>(null);
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
  const [editMessageDialog, setEditMessageDialog] = useState<{
    commitId: string;
    /** Preflight result; null until the check returns. */
    impact: RewordImpact | null;
    /** Why the preflight failed — never silently treated as "all clear". */
    impactError: string | null;
  } | null>(null);
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
    graph: defaultGraphWidth(totalLanes, LANE_WIDTH),
  });
  const columnVisibility = useRepoStore((s) => s.graphColumnVisibility);
  const setColumnVisibility = useRepoStore((s) => s.setGraphColumnVisibility);
  const dateFormat = useRepoStore((s) => s.graphDateFormat);
  const graphDensity = useRepoStore((s) => s.graphDensity);
  const setGraphDensity = useRepoStore((s) => s.setGraphDensity);
  const graphDotNodes = useRepoStore((s) => s.graphDotNodes);
  const setGraphDotNodes = useRepoStore((s) => s.setGraphDotNodes);
  // Lanes pack tighter when commit nodes are dots — feeds the column-width math.
  const laneWidth = laneWidthFor(graphDotNodes);
  const [graphContainerWidth, setGraphContainerWidth] = useState<number>(0);
  // Keep refs alongside the state so async load + drag-end callbacks can read
  // the latest container width and visibility without needing them in deps.
  const containerWidthRef = useRef(0);
  useEffect(() => {
    containerWidthRef.current = graphContainerWidth;
  }, [graphContainerWidth]);
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
    const lw = laneWidthFor(graphDotNodes);
    const defaults: GraphLayout = {
      ...LAYOUT_DEFAULT,
      graph: defaultGraphWidth(totalLanes, lw),
    };
    getUiState(`graph_layout:${repoPath}`)
      .then((raw) => {
        if (cancelled) return;
        setLayout(parseStoredLayout(raw, totalLanes, lw) ?? defaults);
      })
      .catch(() => {
        if (!cancelled) setLayout(defaults);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);


  // Responsive visibility — drops optional columns (sha → date → author) when
  // the panel is too narrow to keep a readable message column. The user's
  // chosen `columnVisibility` stays the source of truth (settings checkmarks +
  // tooltip surfacing); this derived value drives what's actually laid out.
  const effectiveVisibility: GraphColumnVisibility = deriveEffectiveVisibility(
    clamp(layout.badge, COL_BADGE_MIN, COL_BADGE_MAX),
    clamp(layout.graph, minGraphWidth(totalLanes, laneWidth), COL_GRAPH_MAX),
    graphContainerWidth,
    columnVisibility,
  );

  // Effective pixel widths fed to header + canvas — derived each render from
  // the persisted layout, the current container width, the topology's lane
  // count (which floors the graph column), and which optional columns are on.
  const effectiveWidths: GraphColumnWidths = deriveWidths(
    layout,
    graphContainerWidth,
    totalLanes,
    effectiveVisibility,
    laneWidth,
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
                      <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-caption font-medium text-brand-dim">
                        {profileName}
                      </span>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <IconButton
                          size="sm"
                          variant="subtle"
                          reveal="fade"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromRecentRepos(repo.path);
                          }}
                          className="shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </IconButton>
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
      {/* Header for the large-diff guard — the same DiffToolbar the diff itself
          renders, so nothing shifts when "Load anyway" swaps one for the other. */}
      {!showDiff && showLargeDiffGuard && (
        <DiffToolbar filePath={selectedFilePath ?? undefined} onBack={clearDiff} />
      )}

      {/* Conflict banner — hidden when conflict editor is active (it has its own toolbar) */}
      {conflictState?.in_progress && !showConflictEditor && (() => {
        const conflictedFiles = fileStatuses.filter((f) => f.is_conflicted);
        const unresolvedCount = conflictedFiles.length;
        return (
          <div className="flex items-center gap-1 border-b border-orange-500/30 bg-orange-500/15 px-3 py-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-400 animate-pulse" />
            <span className="flex-1 text-xs text-orange-200">
              {conflictState.operation.charAt(0).toUpperCase() + conflictState.operation.slice(1)} in progress
            </span>
            {unresolvedCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      const first = conflictedFiles[0];
                      if (first) selectFile(first.path, false);
                    }}
                    className="rounded-md border border-orange-500/30 px-3 py-1 text-xs font-medium text-orange-100 transition-colors hover:bg-orange-500/20 hover:border-orange-500/40"
                  >
                    {unresolvedCount} conflict{unresolvedCount !== 1 ? "s" : ""} to resolve
                  </button>
                </TooltipTrigger>
                <TooltipContent>Go to first conflict</TooltipContent>
              </Tooltip>
            )}
            <AbortButton className="px-3" />
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
              graphMin={minGraphWidth(totalLanes, laneWidth)}
              graphMax={COL_GRAPH_MAX}
              visibility={effectiveVisibility}
              userVisibility={columnVisibility}
              density={graphDensity}
              dotNodes={graphDotNodes}
              onDensityChange={setGraphDensity}
              onDotNodesChange={setGraphDotNodes}
              onResize={(w) => {
                const next = pxWidthsToLayout(w, containerWidthRef.current, totalLanes, effectiveVisibility, layout, laneWidth);
                setLayout(next);
              }}
              onResizeEnd={(w) => {
                const next = pxWidthsToLayout(w, containerWidthRef.current, totalLanes, effectiveVisibility, layout, laneWidth);
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
                menuOpen={!!commitContextMenu || !!stashContextMenu}
                columnWidths={effectiveWidths}
                columnVisibility={effectiveVisibility}
                dateFormat={dateFormat}
                density={graphDensity}
                dotNodes={graphDotNodes}
                refMru={refMru}
              />
            </div>
          </div>
        )}

        {/* Loading overlay — blocks interaction during git ops or diff loading */}
        {(isLoading || showDiffSpinner) && (
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
            (commitId) => {
              const c = commits.find((x) => x.id === commitId);
              if (!c) return;
              setEditMsgSubject(c.message);
              setEditMsgBody(c.body);
              setEditMessageDialog({ commitId, impact: null, impactError: null });
              // How much this rewrites, and whether it's even possible, comes
              // from git — fetched async so opening the dialog stays instant.
              rewordImpact(commitId)
                .then((impact) =>
                  setEditMessageDialog((d) =>
                    d?.commitId === commitId ? { ...d, impact } : d,
                  ),
                )
                .catch((e: unknown) =>
                  setEditMessageDialog((d) =>
                    d?.commitId === commitId
                      ? { ...d, impactError: e instanceof Error ? e.message : String(e) }
                      : d,
                  ),
                );
            },
            (tagName) => setConfirmDeleteTag(tagName),
            setWorktreeDialogBranch,
            revealWorktree,
            setRemoveWorktreeTarget,
            forgeStatus,
            commitContextMenu.focusRefName,
          )}
          onClose={() => setCommitContextMenu(null)}
        />
      )}

      {/* Create worktree dialog */}
      {worktreeDialogBranch && (
        <CreateWorktreeDialog
          branch={worktreeDialogBranch}
          onClose={() => setWorktreeDialogBranch(null)}
        />
      )}

      {/* Remove worktree confirmation */}
      {removeWorktreeTarget && (
        <RemoveWorktreeDialog
          path={removeWorktreeTarget.path}
          label={removeWorktreeTarget.label}
          onClose={() => setRemoveWorktreeTarget(null)}
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
              writesRepo: true,
              icon: ACTION_ICONS["Apply Stash"],
            },
            {
              label: "Pop (apply & remove)",
              onClick: () => popStash(stashContextMenu.index),
              writesRepo: true,
              icon: ACTION_ICONS["Pop Stash"],
            },
            {
              label: "Drop (discard)",
              onClick: () => setConfirmDropStash(stashContextMenu.index),
              destructive: true,
              icon: ACTION_ICONS["Drop Stash"],
            },
          ]}
          onClose={() => setStashContextMenu(null)}
        />
      )}

      {/* Dirty working tree dialog */}
      {dirtyActionPending && (
        <Modal open onClose={cancelDirtyAction} className="max-w-md p-4">
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
        </Modal>
      )}

      {/* Remote checkout dialog */}
      {remoteCheckoutPending && (
        <Modal open onClose={cancelRemoteCheckout} className="max-w-md p-4">
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
        </Modal>
      )}

      {/* Reset hard confirmation */}
      {confirmResetHard && (
        <ConfirmDialog
          open
          onClose={() => setConfirmResetHard(null)}
          title="Reset hard?"
          description={`This will discard all changes and move the branch to ${confirmResetHard.slice(0, 7)}. This cannot be undone.`}
          confirmLabel="Reset Hard"
          destructive
          onConfirm={() => {
            resetTo(confirmResetHard, "hard");
            setConfirmResetHard(null);
          }}
        />
      )}

      {/* Delete branch confirmation */}
      {confirmDeleteBranch && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDeleteBranch(null)}
          title="Delete branch?"
          description={
            confirmDeleteBranch.deleteLocal && confirmDeleteBranch.deleteRemote
              ? `This will delete "${confirmDeleteBranch.branchName}" locally and from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
              : confirmDeleteBranch.deleteRemote
                ? `This will delete "${confirmDeleteBranch.branchName}" from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                : `This will delete "${confirmDeleteBranch.branchName}" locally. This cannot be undone.`
          }
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const { branchName, deleteLocal, deleteRemote, remoteName } = confirmDeleteBranch;
            setConfirmDeleteBranch(null);
            if (deleteLocal) await deleteBranch(branchName);
            if (deleteRemote) await deleteRemoteBranch(remoteName, branchName);
          }}
        />
      )}

      {/* Drop stash confirmation */}
      {confirmDropStash != null && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDropStash(null)}
          title="Drop stash?"
          description={`This will permanently discard stash@{${confirmDropStash}}. This cannot be undone.`}
          confirmLabel="Drop"
          destructive
          onConfirm={() => {
            dropStash(confirmDropStash);
            setConfirmDropStash(null);
          }}
        />
      )}

      {/* Delete tag confirmation */}
      {confirmDeleteTag != null && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDeleteTag(null)}
          title="Delete tag?"
          description={`This will delete the local tag "${confirmDeleteTag}". If it has been pushed, the remote tag is not affected.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            deleteExistingTag(confirmDeleteTag);
            setConfirmDeleteTag(null);
          }}
        />
      )}

      {/* Force push confirmation */}
      {forcePushPending && (
        <ConfirmDialog
          open
          onClose={cancelForcePush}
          title="Force push?"
          description="The remote branch has diverged from your local branch. Force pushing will overwrite the remote history. This uses --force-with-lease for safety."
          confirmLabel="Force Push"
          destructive
          onConfirm={forcePush}
        />
      )}

      {/* Create branch at commit dialog */}
      {createBranchDialog && (
        <ConfirmDialog
          open
          onClose={() => setCreateBranchDialog(null)}
          title="Create branch"
          description={`New branch at ${createBranchDialog.commitId.slice(0, 7)}`}
          confirmLabel="Create"
          confirmDisabled={!dialogInput.trim()}
          onConfirm={() => {
            if (dialogInput.trim()) {
              createBranchAtAction(dialogInput.trim(), createBranchDialog.commitId);
              setCreateBranchDialog(null);
            }
          }}
        >
          <input
            autoFocus
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dialogInput.trim()) {
                createBranchAtAction(dialogInput.trim(), createBranchDialog.commitId);
                setCreateBranchDialog(null);
              }
            }}
            placeholder="Branch name"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />
        </ConfirmDialog>
      )}

      {/* Edit (reword) commit message dialog */}
      {editMessageDialog && (
        <ConfirmDialog
          open
          onClose={() => setEditMessageDialog(null)}
          className="w-full max-w-md"
          title="Edit commit message"
          description={rewordDescription(editMessageDialog.commitId, editMessageDialog.impact, currentBranch)}
          confirmLabel="Save"
          confirmDisabled={!editMsgSubject.trim() || !!editMessageDialog.impact?.blocker}
          onConfirm={() => {
            const subject = editMsgSubject.trim();
            if (!subject) return;
            const body = editMsgBody.trim();
            const full = body ? `${subject}\n\n${body}` : subject;
            rewordCommit(editMessageDialog.commitId, full);
            setEditMessageDialog(null);
          }}
        >
          {editMessageDialog.impact?.blocker && (
            <p className="mb-3 text-xs text-destructive">{editMessageDialog.impact.blocker}</p>
          )}
          {editMessageDialog.impactError && (
            <p className="mb-3 text-xs text-yellow-500">
              Couldn't check what this would rewrite ({editMessageDialog.impactError}) — saving may
              still fail.
            </p>
          )}
          {!!editMessageDialog.impact?.pushed_to.length && (
            <p className="mb-3 text-xs text-yellow-500">
              Already pushed to {editMessageDialog.impact.pushed_to.join(", ")} — you'll need to
              force push.
            </p>
          )}
          {!!editMessageDialog.impact?.stranded_refs.length && (
            <p className="mb-3 text-xs text-yellow-500">
              {editMessageDialog.impact.stranded_refs.join(", ")} also contain this commit and will
              keep the old version — move them too, or history forks.
            </p>
          )}
          <input
            autoFocus
            value={editMsgSubject}
            onChange={(e) => setEditMsgSubject(e.target.value)}
            placeholder="Subject"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-2"
          />
          <textarea
            value={editMsgBody}
            onChange={(e) => setEditMsgBody(e.target.value)}
            placeholder="Optional extended description…"
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3 font-mono"
          />
        </ConfirmDialog>
      )}

      {/* Rename branch dialog (from graph badge) */}
      {renameDialog && (
        <ConfirmDialog
          open
          onClose={() => setRenameDialog(null)}
          title="Rename branch"
          description={`Renaming '${renameDialog.branch}'`}
          confirmLabel="Rename"
          confirmDisabled={!dialogInput.trim() || dialogInput.trim() === renameDialog.branch}
          onConfirm={() => {
            if (dialogInput.trim() && dialogInput.trim() !== renameDialog.branch) {
              renameBranch(renameDialog.branch, dialogInput.trim());
              setRenameDialog(null);
            }
          }}
        >
          <input
            autoFocus
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dialogInput.trim() && dialogInput.trim() !== renameDialog.branch) {
                renameBranch(renameDialog.branch, dialogInput.trim());
                setRenameDialog(null);
              }
            }}
            placeholder="New name"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />
        </ConfirmDialog>
      )}

      {/* Set upstream dialog (from graph badge) */}
      {upstreamDialog && (
        <ConfirmDialog
          open
          onClose={() => setUpstreamDialog(null)}
          title="Set upstream"
          description={`Set tracking branch for '${upstreamDialog.branch}'`}
          confirmLabel="Set"
          confirmDisabled={!dialogInput.trim()}
          onConfirm={() => {
            if (dialogInput.trim()) {
              setUpstream(dialogInput.trim());
              setUpstreamDialog(null);
            }
          }}
        >
          <input
            autoFocus
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dialogInput.trim()) {
                setUpstream(dialogInput.trim());
                setUpstreamDialog(null);
              }
            }}
            placeholder="e.g. origin/main"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />
        </ConfirmDialog>
      )}

      {/* Create tag at commit dialog */}
      {createTagDialog && (
        <ConfirmDialog
          open
          onClose={() => setCreateTagDialog(null)}
          title="Create tag"
          description={`New tag at ${createTagDialog.commitId.slice(0, 7)}`}
          confirmLabel="Create"
          confirmDisabled={!dialogInput.trim()}
          onConfirm={() => {
            if (dialogInput.trim()) {
              createNewTag(dialogInput.trim(), createTagDialog.commitId);
              setCreateTagDialog(null);
            }
          }}
        >
          <input
            autoFocus
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dialogInput.trim()) {
                createNewTag(dialogInput.trim(), createTagDialog.commitId);
                setCreateTagDialog(null);
              }
            }}
            placeholder="Tag name"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Reword dialog subtitle — spells out the blast radius once the preflight lands. */
function rewordDescription(
  commitId: string,
  impact: RewordImpact | null,
  currentBranch: string | null,
): string {
  const sha = commitId.slice(0, 7);
  const replayed = impact && !impact.blocker ? impact.commit_count - 1 : 0;
  if (replayed <= 0) return `Rewrites ${sha}.`;
  return `Rewrites ${sha} and the ${replayed} commit${replayed === 1 ? "" : "s"} after it on ${currentBranch ?? "HEAD"}.`;
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
  openRewordDialog: (commitId: string) => void,
  confirmDeleteTag: (name: string) => void,
  createWorktree: (name: string) => void,
  revealWorktree: (path: string) => void,
  removeWorktree: (target: { path: string; label: string }) => void,
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
        writesRepo: true,
        icon: ACTION_ICONS.Checkout,
      });
      items.push({
        label: `Copy branch name: ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branch.name),
        icon: ACTION_ICONS.Copy,
      });
      const slashIdx = branch.name.indexOf("/");
      if (slashIdx > 0) {
        const remote = branch.name.slice(0, slashIdx);
        const remoteBranch = branch.name.slice(slashIdx + 1);
        items.push({
          label: `Delete ${branch.name} from ${remote}…`,
          onClick: () => confirmDeleteBranch(remoteBranch, false, true, remote),
          writesRepo: true,
          destructive: true,
          icon: ACTION_ICONS["Delete Remote Branch"],
        });
      }
      items.push({ separator: true });
    } else {
      // Local branch
      const heldByWorktree = branch.worktree_path;
      if (!isCurrent && heldByWorktree) {
        // Git refuses to check this out here — offer the worktree instead.
        items.push({
          label: "Reveal worktree in file manager",
          onClick: () => revealWorktree(heldByWorktree),
          icon: ACTION_ICONS["Reveal Worktree"],
        });
        items.push({
          label: "Copy worktree path",
          onClick: () => navigator.clipboard.writeText(heldByWorktree),
          icon: ACTION_ICONS.Copy,
        });
        items.push({
          label: "Remove worktree…",
          onClick: () => removeWorktree({ path: heldByWorktree, label: branch.name }),
          writesRepo: true,
          destructive: true,
          icon: ACTION_ICONS["Remove Worktree"],
        });
      } else if (!isCurrent) {
        items.push({
          label: `Checkout ${branch.name}`,
          onClick: () => checkoutBranch(branch.name),
          writesRepo: true,
          icon: ACTION_ICONS.Checkout,
        });
      }

      if (!isCurrent && currentBranch) {
        items.push({
          label: `Merge ${branch.name} into ${currentBranch}`,
          onClick: () => mergeInto(branch.name),
          writesRepo: true,
          icon: ACTION_ICONS.Merge,
        });
        items.push({
          label: branch.can_fast_forward
            ? `Fast-forward ${currentBranch} to ${branch.name}`
            : `Rebase ${currentBranch} onto ${branch.name}`,
          onClick: () => rebaseOnto(branch.name),
          writesRepo: true,
          icon: ACTION_ICONS.Rebase,
        });
      }

      items.push({ label: "Pull", onClick: () => pull(), icon: ACTION_ICONS.Pull, writesRepo: true });
      items.push({ label: "Push", onClick: () => push(), icon: ACTION_ICONS.Push, writesRepo: true });
      items.push({ label: "Set upstream…", onClick: () => setUpstream(branch.name), icon: ACTION_ICONS["Set Upstream"] });
      items.push({ label: "Rename branch…", onClick: () => renameBranch(branch.name), icon: ACTION_ICONS["Rename Branch"], writesRepo: true });
      items.push({
        label: `Copy branch name: ${branch.name}`,
        onClick: () => navigator.clipboard.writeText(branch.name),
        icon: ACTION_ICONS.Copy,
      });
      // Not for the current branch: git refuses to put a branch in two
      // worktrees, and HEAD's own worktree is deliberately absent from
      // `worktree_path`.
      if (!heldByWorktree && !isCurrent) {
        items.push({
          label: "Create worktree…",
          onClick: () => createWorktree(branch.name),
          writesRepo: true,
          icon: ACTION_ICONS["Create Worktree"],
        });
      }

      // Delete — git refuses while a worktree holds the branch, with no
      // force flag that overrides it, so don't offer a dead action.
      if (!isCurrent && !heldByWorktree) {
        const hasRemote = branch.ahead != null || branch.behind != null;
        items.push({
          label: `Delete ${branch.name}…`,
          onClick: () => confirmDeleteBranch(branch.name, true, false, "origin"),
          writesRepo: true,
          destructive: true,
          icon: ACTION_ICONS["Delete Branch"],
        });
        if (hasRemote) {
          items.push({
            label: `Delete ${branch.name} (local + remote)…`,
            onClick: () => confirmDeleteBranch(branch.name, true, true, "origin"),
            writesRepo: true,
            destructive: true,
            icon: ACTION_ICONS["Delete Remote Branch"],
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
    writesRepo: true,
    icon: ACTION_ICONS["Cherry-pick"],
  });

  // Only show commit-level merge/rebase when no local branch already
  // covers them — otherwise they duplicate the branch ops above.
  if (currentBranch && !hasLocalBranches) {
    items.push({
      label: `Merge ${shortSha} into ${currentBranch}`,
      onClick: () => mergeInto(commitId),
      writesRepo: true,
      icon: ACTION_ICONS.Merge,
    });
    items.push({
      label: `Rebase ${currentBranch} onto ${shortSha}`,
      onClick: () => rebaseOnto(commitId),
      writesRepo: true,
      icon: ACTION_ICONS.Rebase,
    });
  }

  items.push({ separator: true });

  // Navigation
  items.push({
    label: `Checkout ${shortSha} (detached HEAD)`,
    onClick: () => checkoutDetached(commitId),
    writesRepo: true,
    icon: ACTION_ICONS.Checkout,
  });
  items.push({
    label: `Create branch at ${shortSha}…`,
    onClick: () => createBranchHere(commitId),
    icon: ACTION_ICONS["Create Branch"],
  });
  items.push({
    label: `Create tag at ${shortSha}…`,
    onClick: () => createTagHere(commitId),
    icon: ACTION_ICONS["Create Tag"],
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
      icon: ACTION_ICONS.Copy,
    });
    items.push({
      label: `Delete tag ${tag.name}…`,
      onClick: () => confirmDeleteTag(tag.name),
      destructive: true,
      icon: ACTION_ICONS["Delete Tag"],
    });
  }

  items.push({ separator: true });

  // Modify
  items.push({
    label: "Edit commit message…",
    onClick: () => openRewordDialog(commitId),
    writesRepo: true,
    icon: ACTION_ICONS["Reword Commit"],
  });
  items.push({
    label: `Revert ${shortSha}`,
    onClick: () => revertCommit(commitId),
    writesRepo: true,
    icon: ACTION_ICONS.Revert,
  });
  items.push({
    label: `Reset soft to ${shortSha} (keep changes)`,
    onClick: () => resetTo(commitId, "soft"),
    writesRepo: true,
    icon: ACTION_ICONS.Reset,
  });
  items.push({
    label: `Reset hard to ${shortSha}`,
    onClick: () => resetTo(commitId, "hard"),
    writesRepo: true,
    destructive: true,
    icon: ACTION_ICONS.Reset,
  });

  items.push({ separator: true });

  // Clipboard
  items.push({
    label: `Copy SHA: ${commitId.slice(0, 7)}`,
    onClick: () => navigator.clipboard.writeText(commitId),
    icon: ACTION_ICONS.Copy,
  });

  // Copy link to commit (when forge is detected)
  if (forgeStatus?.kind && forgeStatus.host && forgeStatus.owner && forgeStatus.repo) {
    const { kind, host, owner, repo } = forgeStatus;
    const commitPath = kind === "gitlab" ? `-/commit/${commitId}` : `commit/${commitId}`;
    const commitUrl = `https://${host}/${owner}/${repo}/${commitPath}`;
    items.push({
      label: "Copy link to commit",
      onClick: () => navigator.clipboard.writeText(commitUrl),
      icon: ACTION_ICONS["Copy Link"],
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
        icon: ACTION_ICONS["Copy Link"],
      });
    }
  }

  return items;
}

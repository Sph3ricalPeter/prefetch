import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type {
  BranchInfo,
  CiJob,
  CommitInfo,
  ConflictContents,
  ConflictState,
  FileDiff,
  FileStatus,
  ForgeStatus,
  GitIdentity,
  GraphEdge,
  HunkLineSelection,
  LfsInfo,
  Pipeline,
  PipelineStatus,
  PrInfo,
  RebaseProgress,
  StashInfo,
  TagInfo,
  UndoAction,
} from "@/types/git";
import type { GraphColumnVisibility } from "@/components/graph/commit-graph-canvas";
import type { DateFormatId } from "@/lib/date-format";

export interface SidebarSections {
  branches: boolean;
  ci: boolean;
  stashes: boolean;
  tags: boolean;
}

const DEFAULT_SIDEBAR_SECTIONS: SidebarSections = {
  branches: true,
  ci: false,
  stashes: true,
  tags: true,
};

import {
  openRepo,
  getCommits,
  getBranches,
  getRefMru,
  checkoutBranch,
  forceCheckoutBranch,
  createBranchCmd,
  fetchRepo,
  pullRepo,
  pushRepo,
  forcePushRepo,
  getFileStatus,
  getFileDiff,
  discardFiles as discardFilesCmd,
  discardAllChanges as discardAllCmd,
  stageFiles as stageFilesCmd,
  unstageFiles as unstageFilesCmd,
  createCommit,
  rewordHeadCommit as rewordHeadCommitCmd,
  getCommitFiles,
  getCommitFileDiff,
  getStashes,
  stashPush as stashPushCmd,
  stashPop as stashPopCmd,
  stashDrop as stashDropCmd,
  stashApply as stashApplyCmd,
  getStashFiles,
  getStashFileDiff,
  getTags,
  createTagCmd,
  deleteTagCmd,
  pushTagCmd,
  getUndoAction,
  undoLast,
  resolveConflictOurs as resolveOursCmd,
  resolveConflictTheirs as resolveTheirsCmd,
  resetToCommit as resetToCommitCmd,
  cherryPickCommit,
  rebaseOnto as rebaseOntoCmd,
  mergeBranch as mergeBranchCmd,
  getMergeMessage as getMergeMessageCmd,
  deleteBranch as deleteBranchCmd,
  getConflictState,
  abortOperation as abortOperationCmd,
  continueOperation as continueOperationCmd,
  getRebaseProgress as getRebaseProgressCmd,
  lfsCheckInitialized,
  lfsGetInfo,
  lfsInitialize,
  lfsTrackPattern as lfsTrackCmd,
  lfsUntrackPattern as lfsUntrackCmd,
  lfsPruneObjects as lfsPruneCmd,
  getGitIdentity as getGitIdentityCmd,
  getForgeStatus,
  saveForgeToken as saveForgeTokenCmd,
  deleteForgeToken as deleteForgeTokenCmd,
  getPrForBranch as getPrForBranchCmd,
  clearPrCache as clearPrCacheCmd,
  openUrl as openUrlCmd,
  getPipelinesForBranch,
  getPipelineJobs,
  getCiJobLog,
  stagePatch as stagePatchCmd,
  unstagePatch as unstagePatchCmd,
  getConflictContents as getConflictContentsCmd,
  resolveConflictManual as resolveConflictManualCmd,
  revertCommit as revertCommitCmd,
  checkoutDetached as checkoutDetachedCmd,
  createBranchAt as createBranchAtCmd,
  renameBranchCmd,
  renameBranchOnRemote,
  deleteRemoteBranch as deleteRemoteBranchCmd,
  setUpstream as setUpstreamCmd,
  stashPushFiles as stashPushFilesCmd,
  showInFolder as showInFolderCmd,
  openInDefaultEditor as openInEditorCmd,
  deleteFileCmd,
} from "@/lib/commands";
import { generatePatch, generateHunkPatch } from "@/lib/patch";
import { computeDiffRegions, buildOutputWithSources } from "@/lib/conflict-regions";
import { MultiStepAction } from "@/lib/multi-step";
import {
  addRecentRepo,
  getRecentRepos,
  removeRecentRepo,
  updateRepoForgeInfo,
  getUiState,
  setUiState,
  type RecentRepo,
} from "@/lib/database";

/** Files with more than this many changed lines show a "Load anyway" guard */
const LARGE_DIFF_THRESHOLD = 10_000;

/** Safely extract an error message string from an unknown catch value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Parse a Tauri error to detect hook failures.
 *  Hook errors are serialized as `[hook:<name>] <output>` by the Rust backend. */
function parseError(e: unknown): { hookName: string | null; message: string } {
  const msg = errorMessage(e);
  const match = msg.match(/^\[hook:([\w-]+)\]\s*(.*)/s);
  return match
    ? { hookName: match[1], message: match[2] || "Hook failed" }
    : { hookName: null, message: msg };
}

/** Check if a file exceeds the large diff threshold. */
function isLargeDiff(files: FileStatus[], path: string): number | false {
  const file = files.find((f) => f.path === path);
  const total = (file?.additions ?? 0) + (file?.deletions ?? 0);
  return total > LARGE_DIFF_THRESHOLD ? total : false;
}

/**
 * Builds a content signature for a diff so we can skip re-renders when polling
 * returns identical content. Includes line origin + content so we catch
 * in-place edits that don't change line counts (e.g. a one-character typo fix).
 *
 * The signature is cached by reference to the diff object — a 10k-line diff
 * serializes to a multi-MB string, and the polled-but-unchanged case (the
 * common one) would otherwise pay that cost twice every 5 seconds.
 */
const diffSignatureCache = new WeakMap<FileDiff, string>();
function diffSignature(diff: FileDiff): string {
  const cached = diffSignatureCache.get(diff);
  if (cached !== undefined) return cached;
  const sig = diff.hunks
    .map((h) => `${h.header}\n${h.lines.map((l) => l.origin + l.content).join("\n")}`)
    .join("\n");
  diffSignatureCache.set(diff, sig);
  return sig;
}

// Module-level in-flight guard for refreshActiveDiff. Without it, a slow
// `getFileDiff` IPC under a 5-second poll cadence could let multiple fetches
// stack up; we skip new attempts while one is already running.
let refreshDiffInFlight = false;

/** Auto-select the first conflicted file so the user lands in the conflict editor immediately. */
function autoSelectFirstConflict(
  statuses: FileStatus[],
  get: () => RepoState,
): void {
  const first = statuses.find((f) => f.is_conflicted);
  if (first && !get().selectedFilePath) {
    get().selectFile(first.path, false);
  }
}

/** Batch-analyze conflicted files to find which ones are fully auto-resolved. */
async function analyzeConflictFiles(
  files: FileStatus[],
  set: (state: Partial<RepoState>) => void,
): Promise<void> {
  const conflicted = files.filter((f) => f.is_conflicted);
  if (conflicted.length === 0) {
    set({ conflictAutoResolvedFiles: new Map() });
    return;
  }
  const results = await Promise.all(
    conflicted.map(async (f): Promise<[string, string] | null> => {
      try {
        const contents = await getConflictContentsCmd(f.path);
        const regions = computeDiffRegions(contents.ours, contents.theirs, contents.base ?? undefined);
        const hasRealConflict = regions.some((r) => r.type === "changed");
        const hasAutoResolved = regions.some((r) => r.type === "auto-resolved");
        if (!hasRealConflict && hasAutoResolved) {
          const { text } = buildOutputWithSources(regions, new Map());
          return [f.path, text];
        }
        return null;
      } catch {
        return null;
      }
    }),
  );
  const map = new Map<string, string>();
  for (const entry of results) {
    if (entry) map.set(entry[0], entry[1]);
  }
  set({ conflictAutoResolvedFiles: map });
}

/**
 * Handle a git operation that may result in conflicts (cherry-pick, rebase, merge, revert).
 * On error, checks for conflict state and refreshes the UI accordingly.
 */
async function handleConflictError(
  e: unknown,
  operationLabel: string,
  set: (state: Partial<RepoState>) => void,
  get: () => RepoState,
  extra?: () => Promise<void>,
): Promise<void> {
  set({ isLoading: false });
  const conflict = await getConflictState().catch(() => null);
  if (conflict?.in_progress) {
    const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus().catch(() => [])]);
    set({ ...repoData, fileStatuses: statuses, conflictState: conflict });
    analyzeConflictFiles(statuses, set).catch(() => {});
    autoSelectFirstConflict(statuses, get);
    if (extra) await extra();
    toast.error(`${operationLabel} has conflicts — resolve them, then continue or abort`);
  } else {
    const { hookName, message } = parseError(e);
    if (hookName) {
      toast.error(`Hook '${hookName}' failed`, { description: message.slice(0, 300), duration: 10000 });
    } else {
      toast.error(message);
    }
  }
}

interface RepoState {
  repoPath: string | null;
  repoName: string | null;
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  headCommitId: string | null;
  branches: BranchInfo[];
  /** Ref name → unix timestamp of its tip commit. Drives MRU ordering for
   *  overlapping badges and the commit-graph edge draw order. */
  refMru: Map<string, number>;
  currentBranch: string | null;
  selectedCommitId: string | null;
  isLoading: boolean;
  error: string | null;

  /** Global filter query (debounced). Drives the sidebar lists, the commit
   *  graph dimming, and the right-column changed-files lists. */
  filterQuery: string;

  // Staging (working tree)
  fileStatuses: FileStatus[];
  selectedFilePath: string | null;
  selectedFileStaged: boolean;

  // Active diff — displayed in center panel
  activeDiff: FileDiff | null;
  /** True when a diff is being fetched */
  diffLoading: boolean;
  /** Set when a large diff is deferred — fetch only when user clicks "Load anyway" */
  largeDiffPending: {
    path: string;
    staged?: boolean;
    commitId?: string;
    stashIndex?: number;
    totalChanges: number;
    loading?: boolean;
  } | null;

  // Historical commit files
  commitFiles: FileStatus[];
  commitFilesLoading: boolean;

  commitMessage: string;
  commitDescription: string;

  /** When true, the next commit amends HEAD instead of creating a new one */
  amendMode: boolean;

  // Stash
  stashes: StashInfo[];
  selectedStashIndex: number | null;

  // Tags
  tags: TagInfo[];

  // Force push
  forcePushPending: boolean;

  // Conflict state
  conflictState: ConflictState | null;
  conflictContents: ConflictContents | null;
  conflictOutputText: string | null;
  /** Auto-resolved conflict files: path → pre-computed output text for quick save */
  conflictAutoResolvedFiles: Map<string, string>;
  rebaseProgress: RebaseProgress | null;

  // Dirty working tree dialog — shown when an operation needs a clean tree
  dirtyActionPending: {
    operation: "checkout" | "pull" | "merge" | "cherry-pick" | "revert" | "checkout-detached";
    targetName: string;
    changesCount: number;
  } | null;

  // Remote checkout dialog
  remoteCheckoutPending: {
    localName: string;
    remoteName: string;
    alreadyOnLocal: boolean;
  } | null;

  // Undo
  undoInfo: UndoAction | null;
  /** Timestamp of last undo — suppresses undo refresh for a few seconds to prevent undo-of-undo loop */
  lastUndoTime: number;

  // Recent repos
  recentRepos: RecentRepo[];

  // LFS
  lfsInfo: LfsInfo | null;

  // Git identity
  gitIdentity: GitIdentity | null;

  // Forge
  forgeStatus: ForgeStatus | null;
  /** branch name → PrInfo (or null = "checked, no open PR") */
  prCache: Record<string, PrInfo | null>;

  // CI / Pipelines
  ciPipelines: Pipeline[];
  /** Jobs per pipeline — keyed by pipeline ID, eagerly loaded. */
  ciJobsMap: Record<number, CiJob[]>;
  /** Hidden pipeline source names (e.g. "schedule"). Persisted in ui_state. */
  ciHiddenSources: Set<string>;
  ciSelectedPipelineId: number | null;
  ciSelectedJobId: number | null;
  ciJobLog: string | null;
  ciLoading: boolean;
  ciPolling: boolean;

  /** Global file view mode — persisted across all views */
  fileViewMode: "flat" | "tree";

  /** Diff view layout — unified (interleaved) or side-by-side (split columns) */
  diffViewMode: "unified" | "side-by-side";
  /** Image diff view mode — unified (single image), side-by-side, or swipe overlay */
  imageDiffViewMode: "unified" | "side-by-side" | "swipe";
  /** Whether long lines wrap in the diff viewer */
  diffWrapLines: boolean;

  /** Which optional graph columns are visible (global) */
  graphColumnVisibility: GraphColumnVisibility;
  /** Date format used in the graph date column (global) */
  graphDateFormat: DateFormatId;

  /** Sidebar section expand/collapse state (persisted) */
  sidebarSections: SidebarSections;

  // Actions
  openRepository: (path: string) => Promise<void>;
  loadRecentRepos: () => Promise<void>;
  removeFromRecentRepos: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStatus: () => Promise<void>;
  refreshActiveDiff: () => Promise<void>;
  checkout: (name: string) => Promise<void>;
  stashAndProceed: () => Promise<void>;
  discardAndProceed: () => Promise<void>;
  cancelDirtyAction: () => void;
  resetLocalToRemote: () => Promise<void>;
  cancelRemoteCheckout: () => void;
  createBranch: (name: string) => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  selectCommit: (id: string | null) => Promise<void>;
  selectFile: (path: string, staged: boolean) => Promise<void>;
  selectCommitFile: (commitId: string, filePath: string) => Promise<void>;
  clearDiff: () => void;
  clearSelection: () => void;
  setDiffLoading: (loading: boolean) => void;
  /** Load a deferred large diff (user clicked "Load anyway") */
  loadPendingDiff: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  discardAll: () => Promise<void>;
  resolveOurs: (filePath: string) => Promise<void>;
  resolveTheirs: (filePath: string) => Promise<void>;
  stageHunk: (filePath: string, hunkIndex: number) => Promise<void>;
  unstageHunk: (filePath: string, hunkIndex: number) => Promise<void>;
  stageLines: (filePath: string, selections: HunkLineSelection[]) => Promise<void>;
  unstageLines: (filePath: string, selections: HunkLineSelection[]) => Promise<void>;
  loadConflictContents: (filePath: string) => Promise<void>;
  resolveConflictManual: (filePath: string, content: string) => Promise<void>;
  commit: (message: string, amend?: boolean) => Promise<void>;
  rewordHeadCommit: (message: string) => Promise<void>;
  setFilterQuery: (query: string) => void;
  setCommitMessage: (msg: string) => void;
  setCommitDescription: (desc: string) => void;
  setAmendMode: (on: boolean) => void;
  loadStashes: () => Promise<void>;
  selectStash: (index: number) => Promise<void>;
  selectStashFile: (index: number, filePath: string) => Promise<void>;
  pushStash: (message?: string) => Promise<void>;
  applyStash: (index: number) => Promise<void>;
  popStash: (index: number) => Promise<void>;
  dropStash: (index: number) => Promise<void>;
  loadTags: () => Promise<void>;
  createNewTag: (name: string, commit?: string, message?: string) => Promise<void>;
  deleteExistingTag: (name: string) => Promise<void>;
  pushExistingTag: (name: string) => Promise<void>;

  forcePush: () => Promise<void>;
  cancelForcePush: () => void;
  resetTo: (commitId: string, mode: "soft" | "hard") => Promise<void>;
  cherryPick: (commitId: string) => Promise<void>;
  rebaseOnto: (targetBranch: string) => Promise<void>;
  mergeInto: (target: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  revertCommit: (commitId: string) => Promise<void>;
  checkoutDetached: (commitId: string) => Promise<void>;
  createBranchAt: (name: string, commitId: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string, renameRemote?: boolean) => Promise<void>;
  deleteRemoteBranch: (remote: string, branch: string) => Promise<void>;
  setUpstream: (remoteBranch: string) => Promise<void>;
  stashFiles: (paths: string[], message?: string) => Promise<void>;
  showInFolder: (filePath: string) => Promise<void>;
  openInEditor: (filePath: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;
  abortOperation: () => Promise<void>;
  continueOperation: (message?: string) => Promise<void>;
  loadConflictState: () => Promise<void>;
  loadRebaseProgress: () => Promise<void>;
  loadUndoAction: () => Promise<void>;
  undo: () => Promise<void>;

  /** Reload commits + branches only — called on Refs watcher events (fetch updated refs) */
  reloadRefs: () => Promise<void>;
  /** Reload all repo data — called by file watcher Head events (checkout) */
  reloadAll: () => Promise<void>;

  // Git identity
  loadGitIdentity: () => Promise<void>;

  // Forge actions
  loadForgeStatus: () => Promise<void>;
  loadPrForBranch: (branch: string) => Promise<void>;
  saveForgeToken: (host: string, token: string) => Promise<void>;
  deleteForgeToken: (host: string) => Promise<void>;
  openPr: (url: string) => Promise<void>;

  // UI settings (persisted)
  setFileViewMode: (mode: "flat" | "tree") => void;
  loadFileViewMode: () => Promise<void>;
  setDiffViewMode: (mode: "unified" | "side-by-side") => void;
  setImageDiffViewMode: (mode: "unified" | "side-by-side" | "swipe") => void;
  setDiffWrapLines: (on: boolean) => void;
  loadDiffPreferences: () => Promise<void>;
  setGraphColumnVisibility: (v: GraphColumnVisibility) => void;
  setGraphDateFormat: (f: DateFormatId) => void;
  loadGraphPreferences: () => Promise<void>;
  setSidebarSection: (section: keyof SidebarSections, open: boolean) => void;
  loadSidebarPreferences: () => Promise<void>;

  // CI actions
  loadCiPipelines: () => Promise<void>;
  toggleCiPipeline: (pipelineId: number) => void;
  toggleCiSourceFilter: (source: string) => void;
  loadCiJobLog: (jobId: number) => Promise<void>;
  clearCiJobLog: () => void;
  startCiPolling: () => void;
  stopCiPolling: () => void;

  // LFS actions
  loadLfsInfo: (full?: boolean) => Promise<void>;
  initializeLfs: () => Promise<void>;
  trackLfsPattern: (pattern: string) => Promise<void>;
  untrackLfsPattern: (pattern: string) => Promise<void>;
  pruneLfsObjects: () => Promise<void>;
}

/** Fetch commits + branches + ref MRU without calling set(). Callers merge into their own set(). */
async function fetchRepoData(): Promise<Partial<RepoState>> {
  const [data, branchList, mruList] = await Promise.all([
    getCommits(),
    getBranches(),
    getRefMru().catch(() => [] as Array<[string, number]>),
  ]);
  const head = branchList.find((b) => b.is_head);
  return {
    commits: data.commits,
    edges: data.edges,
    totalLanes: data.total_lanes,
    headCommitId: data.head_commit_id,
    branches: branchList,
    refMru: new Map(mruList),
    currentBranch: head?.name ?? null,
  };
}

function operationLabel(op: string, target: string): string {
  switch (op) {
    case "checkout": return `Checkout ${target}`;
    case "checkout-detached": return `Checkout ${target.slice(0, 7)}`;
    case "pull": return "Pull";
    case "merge": return `Merge ${target}`;
    case "cherry-pick": return `Cherry-pick ${target.slice(0, 7)}`;
    case "revert": return `Revert ${target.slice(0, 7)}`;
    default: return op;
  }
}

type StoreGet = () => RepoState;

async function retryOperation(get: StoreGet, operation: string, targetName: string): Promise<void> {
  switch (operation) {
    case "checkout": await get().checkout(targetName); break;
    case "checkout-detached": await get().checkoutDetached(targetName); break;
    case "pull": await get().pull(); break;
    case "merge": await get().mergeInto(targetName); break;
    case "cherry-pick": await get().cherryPick(targetName); break;
    case "revert": await get().revertCommit(targetName); break;
  }
}

export const useRepoStore = create<RepoState>()((set, get) => ({
  repoPath: null,
  repoName: null,
  commits: [],
  edges: [],
  totalLanes: 0,
  headCommitId: null,
  branches: [],
  refMru: new Map(),
  currentBranch: null,
  selectedCommitId: null,
  isLoading: false,
  error: null,
  fileStatuses: [],
  selectedFilePath: null,
  selectedFileStaged: false,
  activeDiff: null,
  diffLoading: false,
  largeDiffPending: null,
  commitFiles: [],
  commitFilesLoading: false,
  filterQuery: "",
  commitMessage: "",
  commitDescription: "",
  amendMode: false,
  stashes: [],
  selectedStashIndex: null,
  tags: [],
  forcePushPending: false,
  conflictState: null,
  conflictContents: null,
  conflictOutputText: null,
  conflictAutoResolvedFiles: new Map(),
  rebaseProgress: null,
  dirtyActionPending: null,
  remoteCheckoutPending: null,
  undoInfo: null,
  lastUndoTime: 0,
  recentRepos: [],
  lfsInfo: null,
  gitIdentity: null,
  forgeStatus: null,
  prCache: {},
  ciPipelines: [],
  ciJobsMap: {},
  ciHiddenSources: new Set(),
  ciSelectedPipelineId: null,
  ciSelectedJobId: null,
  ciJobLog: null,
  ciLoading: false,
  ciPolling: false,
  fileViewMode: "flat",
  diffViewMode: "unified",
  imageDiffViewMode: "side-by-side",
  diffWrapLines: true,
  graphColumnVisibility: { sha: false, author: false, date: false },
  graphDateFormat: "short",
  sidebarSections: { ...DEFAULT_SIDEBAR_SECTIONS },

  openRepository: async (path: string) => {
    // Skip if this repo is already open
    if (get().repoPath === path && get().commits.length > 0) return;
    // Stop CI polling before switching repos
    get().stopCiPolling();
    // Clear avatar caches so forge lookups retry with fresh tokens
    import("@/lib/avatar-cache").then((m) => m.clearAvatarCache()).catch(() => {});
    // Clear all previous repo state before loading new one
    set({
      isLoading: true,
      error: null,
      commits: [],
      edges: [],
      totalLanes: 0,
      headCommitId: null,
      branches: [],
      currentBranch: null,
      fileStatuses: [],
      stashes: [],
      tags: [],
      selectedCommitId: null,
      selectedStashIndex: null,
      selectedFilePath: null,
      activeDiff: null,
      largeDiffPending: null,
      diffLoading: false,
      commitFiles: [],
      commitFilesLoading: false,
      commitMessage: "",
      commitDescription: "",
      amendMode: false,
      lfsInfo: null,
      forgeStatus: null,
      gitIdentity: null,
    });
    try {
      // openRepo MUST complete first — it sets up Rust-side state (watcher,
      // fetcher, repo_path) that all subsequent IPC commands depend on.
      const name = await openRepo(path);
      set({ repoPath: path, repoName: name });

      // Import profile store early so autoSwitch can run in the parallel batch
      const { useProfileStore } = await import("@/stores/profile-store");

      // Launch ALL independent data loads in a single parallel batch.
      // Previously these ran as two sequential rounds (commits/branches first,
      // then status/stashes/tags), adding 200-500ms of dead wait time.
      const [, data, branchList, statuses, stashList, tagList, undoAction, conflict] = await Promise.all([
        useProfileStore.getState().autoSwitchForRepo(path),
        getCommits(),
        getBranches(),
        getFileStatus(),
        getStashes(),
        getTags(),
        getUndoAction(),
        getConflictState(),
      ]);
      const head = branchList.find((b) => b.is_head);

      // Single set() call for all core data — avoids intermediate re-renders
      // that previously caused the canvas to redraw 2-3 times during load.
      set({
        isLoading: false,
        commits: data.commits,
        edges: data.edges,
        totalLanes: data.total_lanes,
        headCommitId: data.head_commit_id,
        branches: branchList,
        currentBranch: head?.name ?? null,
        fileStatuses: statuses,
        stashes: stashList,
        tags: tagList,
        undoInfo: undoAction,
        conflictState: conflict,
      });
      if (conflict?.in_progress) {
        analyzeConflictFiles(statuses, set).catch(() => {});
        autoSelectFirstConflict(statuses, get);
      }

      // Load LFS, forge, and identity info after core data (non-blocking, fire-and-forget)
      Promise.all([
        get().loadLfsInfo(),
        get().loadForgeStatus(),
        get().loadGitIdentity(),
      ]).catch((e) => console.warn("Background load failed:", e));
      // Track in recent repos + save as last opened (fire-and-forget)
      const activeProfile = useProfileStore.getState().activeProfile;
      Promise.all([
        addRecentRepo(path, name, activeProfile?.id ?? null).then(() => get().loadRecentRepos()),
        setUiState("last_repo_path", path),
      ]).catch((e) => console.warn("Recent repo tracking failed:", e));
    } catch (e) {
      const msg = errorMessage(e);
      set({ isLoading: false, error: msg });
      toast.error(msg);
    }
  },

  loadBranches: async () => {
    try {
      const branchList = await getBranches();
      const head = branchList.find((b) => b.is_head);
      set({ branches: branchList, currentBranch: head?.name ?? null });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  loadStatus: async () => {
    try {
      const statuses = await getFileStatus();
      // Refresh the active diff even when the file list hasn't changed — an
      // in-place edit (typo fix etc.) leaves additions/deletions unchanged but
      // still mutates content, and the diff viewer needs to reflect it.
      get().refreshActiveDiff();
      // Skip state update if nothing changed — avoids an unnecessary React
      // re-render on every 5-second poll when no files have been modified.
      const current = get().fileStatuses;
      if (
        statuses.length === current.length &&
        statuses.every(
          (s, i) =>
            s.path === current[i].path &&
            s.status_type === current[i].status_type &&
            s.is_staged === current[i].is_staged &&
            s.additions === current[i].additions &&
            s.deletions === current[i].deletions,
        )
      ) {
        return;
      }
      set({ fileStatuses: statuses });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  refreshActiveDiff: async () => {
    const {
      selectedFilePath,
      selectedFileStaged,
      selectedCommitId,
      selectedStashIndex,
      activeDiff,
      diffLoading,
      largeDiffPending,
    } = get();
    // No active file, fresh diff fetch already in flight, viewing immutable
    // history (commits/stashes don't change), or large-diff guard not loaded —
    // nothing to refresh.
    if (refreshDiffInFlight) return;
    if (!selectedFilePath || diffLoading || largeDiffPending) return;
    if (selectedCommitId || selectedStashIndex != null) return;
    refreshDiffInFlight = true;
    try {
      const newDiff = await getFileDiff(selectedFilePath, selectedFileStaged);
      // Guard against the user switching files mid-fetch — don't clobber a
      // newer selection with stale poll results.
      const after = get();
      if (
        after.selectedFilePath !== selectedFilePath ||
        after.selectedFileStaged !== selectedFileStaged ||
        after.selectedCommitId != null ||
        after.selectedStashIndex != null
      ) {
        return;
      }
      if (!activeDiff || diffSignature(newDiff) !== diffSignature(activeDiff)) {
        set({ activeDiff: newDiff });
      }
    } catch {
      // File may no longer exist or no longer be modified — leave the
      // current diff in place rather than flashing an error toast every 5s.
    } finally {
      refreshDiffInFlight = false;
    }
  },

  checkout: async (name: string) => {
    const { currentBranch, branches, fileStatuses } = get();
    if (name === currentBranch) return;

    // Smart remote branch handling: strip origin/ and check for local counterpart
    const remotePrefix = name.match(/^([^/]+)\//)?.[0];
    const isRemote = branches.some((b) => b.is_remote && b.name === name);

    // If target is the remote counterpart of the current branch, always show
    // the reset dialog — even with a dirty tree (reset --hard handles it)
    if (isRemote && remotePrefix) {
      const localName = name.slice(remotePrefix.length);

      if (localName === currentBranch) {
        set({ remoteCheckoutPending: { localName, remoteName: name, alreadyOnLocal: true } });
        return;
      }

      const localExists = branches.some((b) => !b.is_remote && b.name === localName);

      if (localExists) {
        if (fileStatuses.length > 0) {
          // Discard & switch should land on the LOCAL branch, not the remote
          // ref — force-checking-out a remote ref ("origin/x") detaches HEAD.
          set({ dirtyActionPending: { operation: "checkout", targetName: localName, changesCount: fileStatuses.length } });
          return;
        }
        set({ remoteCheckoutPending: { localName, remoteName: name, alreadyOnLocal: false } });
        return;
      }

      // No local branch — if dirty, prompt; otherwise auto-create tracking branch.
      // Pass the bare name so git's DWIM creates a tracking branch (force-checking
      // out the remote ref directly would detach HEAD instead).
      if (fileStatuses.length > 0) {
        set({ dirtyActionPending: { operation: "checkout", targetName: localName, changesCount: fileStatuses.length } });
        return;
      }
      set({ isLoading: true, error: null });
      try {
        await checkoutBranch(localName);
        const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
        set({ ...repoData, isLoading: false, fileStatuses: statuses });
        toast.success(`Checked out ${localName} (tracking ${name})`);
      } catch (e) {
        set({ isLoading: false });
        toast.error(errorMessage(e));
      }
      return;
    }

    // If working tree is dirty, prompt before switching
    if (fileStatuses.length > 0) {
      set({ dirtyActionPending: { operation: "checkout", targetName: name, changesCount: fileStatuses.length } });
      return;
    }

    // Local branch or tag — normal checkout
    set({ isLoading: true, error: null });
    try {
      await checkoutBranch(name);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses });
      toast.success(`Checked out ${name}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  stashAndProceed: async () => {
    const pending = get().dirtyActionPending;
    if (!pending) return;
    const { operation, targetName } = pending;
    set({ dirtyActionPending: null, isLoading: true, error: null });

    const opLabel = operationLabel(operation, targetName);
    const ms = new MultiStepAction(`Stash & ${opLabel}`, ["git stash push", opLabel]);
    try {
      ms.startStep(0);
      await stashPushCmd(`Auto-stash before ${operation}`);
      ms.completeStep(0);
      ms.startStep(1);
      ms.completeStep(1);
      ms.finish(1500);

      const freshStatuses = await getFileStatus();
      set({ isLoading: false, fileStatuses: freshStatuses });
      await retryOperation(get, operation, targetName);
    } catch (e) {
      const failIdx = ms.runningStepIndex();
      ms.failStep(failIdx >= 0 ? failIdx : 0, errorMessage(e));
      set({ isLoading: false });
      try {
        const [statuses, stashList] = await Promise.all([getFileStatus(), getStashes()]);
        set({ fileStatuses: statuses, stashes: stashList });
      } catch { /* stale UI is acceptable in error recovery */ }
    }
  },

  discardAndProceed: async () => {
    const pending = get().dirtyActionPending;
    if (!pending) return;
    const { operation, targetName } = pending;
    set({ dirtyActionPending: null, isLoading: true, error: null });

    const opLabel = operationLabel(operation, targetName);
    const ms = new MultiStepAction(`Discard & ${opLabel}`, ["Discard changes", opLabel]);
    try {
      ms.startStep(0);
      if (operation === "checkout") {
        await forceCheckoutBranch(targetName);
        ms.completeStep(0);
        ms.startStep(1);
        const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
        set({ ...repoData, isLoading: false, fileStatuses: statuses });
        ms.completeStep(1);
        ms.finish();
      } else {
        await discardAllCmd();
        ms.completeStep(0);
        ms.startStep(1);
        ms.completeStep(1);
        ms.finish(1500);

        const freshStatuses = await getFileStatus();
        set({ isLoading: false, fileStatuses: freshStatuses });
        await retryOperation(get, operation, targetName);
      }
    } catch (e) {
      const failIdx = ms.runningStepIndex();
      ms.failStep(failIdx >= 0 ? failIdx : 0, errorMessage(e));
      set({ isLoading: false });
    }
  },

  cancelDirtyAction: () => set({ dirtyActionPending: null }),

  resetLocalToRemote: async () => {
    const pending = get().remoteCheckoutPending;
    if (!pending) return;
    set({ remoteCheckoutPending: null, isLoading: true, error: null });

    // Two distinct git commands in sequence — surface them as a multi-step toast.
    const ms = new MultiStepAction(`Reset ${pending.localName} to ${pending.remoteName}`, [
      `git checkout ${pending.localName}`,
      `git reset --hard ${pending.remoteName}`,
    ]);
    try {
      ms.startStep(0);
      await checkoutBranch(pending.localName);
      ms.completeStep(0);

      ms.startStep(1);
      await resetToCommitCmd(pending.remoteName, "--hard");
      ms.completeStep(1);
      ms.finish();

      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses });
    } catch (e) {
      const failIdx = ms.runningStepIndex();
      ms.failStep(failIdx >= 0 ? failIdx : 0, errorMessage(e));
      set({ isLoading: false });
    }
  },

  cancelRemoteCheckout: () => set({ remoteCheckoutPending: null }),

  createBranch: async (name: string) => {
    try {
      await createBranchCmd(name);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, fileStatuses: statuses });
      toast.success(`Created and checked out ${name}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  fetch: async () => {
    set({ isLoading: true });
    const toastId = toast.loading("Fetching...");
    const unlisten = await listen<string>("git_progress", (event) => {
      toast.loading(event.payload, { id: toastId });
    });
    try {
      await fetchRepo();
      const [repoData, tagList] = await Promise.all([fetchRepoData(), getTags()]);
      set({ ...repoData, tags: tagList, isLoading: false, prCache: {} }); // invalidate PR cache after fetch
      clearPrCacheCmd().catch(() => {});
      toast.success("Fetch complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e), { id: toastId });
    } finally {
      unlisten();
    }
  },

  pull: async () => {
    const { fileStatuses } = get();
    if (fileStatuses.length > 0) {
      set({ dirtyActionPending: { operation: "pull", targetName: "", changesCount: fileStatuses.length } });
      return;
    }
    set({ isLoading: true });
    const toastId = toast.loading("Pulling...");
    const unlisten = await listen<string>("git_progress", (event) => {
      toast.loading(event.payload, { id: toastId });
    });
    try {
      await pullRepo();
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, prCache: {} }); // invalidate PR cache
      clearPrCacheCmd().catch(() => {});
      toast.success("Pull complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      const { hookName, message } = parseError(e);
      if (hookName) {
        toast.error(`Hook '${hookName}' failed`, { id: toastId, description: message.slice(0, 300), duration: 10000 });
      } else {
        toast.error(message, { id: toastId });
      }
    } finally {
      unlisten();
    }
  },

  push: async () => {
    set({ isLoading: true });
    const ms = new MultiStepAction("Push", ["git push", "Sync remote refs"]);
    try {
      ms.startStep(0);
      await pushRepo();
      ms.completeStep(0);

      ms.startStep(1);
      await fetchRepo().catch(() => {});
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false });
      ms.completeStep(1);
      ms.finish();

      // Kick off CI polling after successful push
      get().startCiPolling();
    } catch (e) {
      set({ isLoading: false });
      const { hookName, message } = parseError(e);
      const failIdx = ms.runningStepIndex();
      if (hookName) {
        ms.failStep(failIdx >= 0 ? failIdx : 0, `Hook '${hookName}' failed: ${message.slice(0, 200)}`);
      } else if (message.includes("rejected") || message.includes("non-fast-forward") || message.includes("fetch first")) {
        ms.failStep(failIdx >= 0 ? failIdx : 0, "Push rejected — remote has diverged");
        set({ forcePushPending: true });
      } else {
        ms.failStep(failIdx >= 0 ? failIdx : 0, message);
      }
    }
  },

  forcePush: async () => {
    set({ forcePushPending: false, isLoading: true });
    // Mirror push(): force push, then fetch to sync remote tracking refs.
    const ms = new MultiStepAction("Force push", ["git push --force", "Sync remote refs"]);
    try {
      ms.startStep(0);
      await forcePushRepo();
      ms.completeStep(0);

      ms.startStep(1);
      await fetchRepo().catch(() => {});
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false });
      ms.completeStep(1);
      ms.finish();
    } catch (e) {
      // Refetch even on failure — the graph may be stale from a prior
      // rebase or reset that never triggered a refresh.
      const repoData = await fetchRepoData().catch(() => ({}));
      set({ ...repoData, isLoading: false });
      const failIdx = ms.runningStepIndex();
      ms.failStep(failIdx >= 0 ? failIdx : 0, errorMessage(e));
    }
  },

  cancelForcePush: () => set({ forcePushPending: false }),

  selectCommit: async (id) => {
    set({
      selectedCommitId: id,
      selectedStashIndex: null,
      selectedFilePath: null,
      activeDiff: null,
      commitFiles: [],
      commitFilesLoading: !!id,
      ciSelectedJobId: null,
      ciJobLog: null,
    });
    if (id) {
      try {
        const files = await getCommitFiles(id);
        if (get().selectedCommitId === id) {
          set({ commitFiles: files, commitFilesLoading: false });
        }
      } catch (e) {
        if (get().selectedCommitId === id) {
          set({ commitFilesLoading: false });
        }
        toast.error(errorMessage(e));
      }
    }
  },

  selectFile: async (path, staged) => {
    set({ selectedFilePath: path, selectedFileStaged: staged, selectedCommitId: null, commitFiles: [], commitFilesLoading: false, largeDiffPending: null });

    const totalChanges = isLargeDiff(get().fileStatuses, path);
    if (totalChanges) {
      // Large-diff guard takes priority in the view chain — safe to clear CI now
      set({ activeDiff: null, largeDiffPending: { path, staged, totalChanges }, ciSelectedJobId: null, ciJobLog: null });
      return;
    }

    set({ diffLoading: true });
    try {
      const diff = await getFileDiff(path, staged);
      // Clear CI state only when the diff is ready to display — avoids graph flash.
      // Image byte-loading shows its own spinner inside ImageDiffViewer, so the
      // global overlay clears as soon as the diff metadata arrives.
      set({ activeDiff: diff, diffLoading: false, ciSelectedJobId: null, ciJobLog: null });
    } catch (e) {
      set({ diffLoading: false });
      toast.error(errorMessage(e));
    }
  },

  selectCommitFile: async (commitId, filePath) => {
    set({ selectedFilePath: filePath, largeDiffPending: null });

    const totalChanges = isLargeDiff(get().commitFiles, filePath);
    if (totalChanges) {
      set({ activeDiff: null, largeDiffPending: { path: filePath, commitId, totalChanges }, ciSelectedJobId: null, ciJobLog: null });
      return;
    }

    set({ diffLoading: true });
    try {
      const diff = await getCommitFileDiff(commitId, filePath);
      set({ activeDiff: diff, diffLoading: false, ciSelectedJobId: null, ciJobLog: null });
    } catch (e) {
      set({ diffLoading: false });
      toast.error(errorMessage(e));
    }
  },

  clearDiff: () => set({ activeDiff: null, largeDiffPending: null, diffLoading: false, selectedFilePath: null, ciSelectedJobId: null, ciJobLog: null }),
  setDiffLoading: (loading) => set({ diffLoading: loading }),

  clearSelection: () =>
    set({
      selectedCommitId: null,
      selectedStashIndex: null,
      selectedFilePath: null,
      activeDiff: null,
      largeDiffPending: null,
      commitFiles: [],
      commitFilesLoading: false,
    }),

  loadPendingDiff: async () => {
    const pending = get().largeDiffPending;
    if (!pending) return;
    // Mark as loading — keep the guard visible with a spinner
    set({ largeDiffPending: { ...pending, loading: true }, diffLoading: true });
    try {
      let diff: FileDiff;
      if (pending.stashIndex !== undefined) {
        diff = await getStashFileDiff(pending.stashIndex, pending.path);
      } else if (pending.commitId) {
        diff = await getCommitFileDiff(pending.commitId, pending.path);
      } else {
        diff = await getFileDiff(pending.path, pending.staged ?? false);
      }
      set({ activeDiff: diff, largeDiffPending: null, diffLoading: false });
    } catch (e) {
      set({ largeDiffPending: null, diffLoading: false });
      toast.error(errorMessage(e));
    }
  },

  stage: async (paths) => {
    set({ isLoading: true });
    try {
      await stageFilesCmd(paths);
      await get().loadStatus();
      // Refresh diff if the staged file is currently selected
      const { selectedFilePath } = get();
      if (selectedFilePath && paths.includes(selectedFilePath)) {
        const diff = await getFileDiff(selectedFilePath, true);
        set({ activeDiff: diff, selectedFileStaged: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  unstage: async (paths) => {
    set({ isLoading: true });
    try {
      await unstageFilesCmd(paths);
      await get().loadStatus();
      const { selectedFilePath } = get();
      if (selectedFilePath && paths.includes(selectedFilePath)) {
        const diff = await getFileDiff(selectedFilePath, false);
        set({ activeDiff: diff, selectedFileStaged: false, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  discard: async (paths) => {
    set({ isLoading: true });
    try {
      // Clear diff immediately so it disappears at the same time as the file list
      const { selectedFilePath } = get();
      if (selectedFilePath && paths.includes(selectedFilePath)) {
        set({ activeDiff: null, selectedFilePath: null, isLoading: true });
      }
      await discardFilesCmd(paths);
      await get().loadStatus();
      set({ isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  discardAll: async () => {
    set({ isLoading: true });
    try {
      await discardAllCmd();
      await get().loadStatus();
      set({ activeDiff: null, selectedFilePath: null, isLoading: false });
      toast.success("All changes discarded");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  resolveOurs: async (filePath) => {
    set({ isLoading: true });
    try {
      await resolveOursCmd(filePath);
      await get().loadStatus();
      set({ isLoading: false });
      toast.success(`Resolved ${filePath.split("/").pop()} — kept ours`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  resolveTheirs: async (filePath) => {
    set({ isLoading: true });
    try {
      await resolveTheirsCmd(filePath);
      await get().loadStatus();
      set({ isLoading: false });
      toast.success(`Resolved ${filePath.split("/").pop()} — kept theirs`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  stageHunk: async (filePath, hunkIndex) => {
    set({ isLoading: true });
    try {
      const diff = get().activeDiff;
      if (!diff) { set({ isLoading: false }); return; }
      const patch = generateHunkPatch(diff, hunkIndex);
      if (!patch.trim()) { set({ isLoading: false }); return; }
      await stagePatchCmd(patch);
      await get().loadStatus();
      const newDiff = await getFileDiff(filePath, false);
      set({ activeDiff: newDiff, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  unstageHunk: async (filePath, hunkIndex) => {
    set({ isLoading: true });
    try {
      const diff = get().activeDiff;
      if (!diff) { set({ isLoading: false }); return; }
      const patch = generateHunkPatch(diff, hunkIndex);
      if (!patch.trim()) { set({ isLoading: false }); return; }
      await unstagePatchCmd(patch);
      await get().loadStatus();
      const newDiff = await getFileDiff(filePath, true);
      set({ activeDiff: newDiff, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  stageLines: async (filePath, selections) => {
    set({ isLoading: true });
    try {
      const diff = get().activeDiff;
      if (!diff) { set({ isLoading: false }); return; }
      const lineKeys = new Set(selections.map((s) => `${s.hunkIndex}:${s.lineIndex}`));
      const patch = generatePatch(diff, lineKeys);
      if (!patch.trim()) { set({ isLoading: false }); return; }
      await stagePatchCmd(patch);
      await get().loadStatus();
      const newDiff = await getFileDiff(filePath, false);
      set({ activeDiff: newDiff, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  unstageLines: async (filePath, selections) => {
    set({ isLoading: true });
    try {
      const diff = get().activeDiff;
      if (!diff) { set({ isLoading: false }); return; }
      const lineKeys = new Set(selections.map((s) => `${s.hunkIndex}:${s.lineIndex}`));
      const patch = generatePatch(diff, lineKeys);
      if (!patch.trim()) { set({ isLoading: false }); return; }
      await unstagePatchCmd(patch);
      await get().loadStatus();
      const newDiff = await getFileDiff(filePath, true);
      set({ activeDiff: newDiff, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  loadConflictContents: async (filePath) => {
    try {
      const contents = await getConflictContentsCmd(filePath);
      set({ conflictContents: contents });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  resolveConflictManual: async (filePath, content) => {
    set({ isLoading: true });
    try {
      await resolveConflictManualCmd(filePath, content);
      await get().loadStatus();
      const autoMap = new Map(get().conflictAutoResolvedFiles);
      autoMap.delete(filePath);
      set({ conflictContents: null, conflictOutputText: null, conflictAutoResolvedFiles: autoMap, activeDiff: null, selectedFilePath: null, isLoading: false });
      toast.success(`Resolved ${filePath.split("/").pop()}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  commit: async (message, amend = false) => {
    if (!message.trim()) {
      toast.error("Commit message cannot be empty");
      return;
    }
    // Combine message + description (separated by blank line, git convention)
    const description = get().commitDescription.trim();
    const fullMessage = description ? `${message.trim()}\n\n${description}` : message.trim();
    set({ isLoading: true });
    try {
      await createCommit(fullMessage, amend);
      // Clear the draft from localStorage before the state update, because
      // setting fileStatuses to [] may unmount CommitBox before its persist
      // effect can fire.
      const rp = get().repoPath;
      if (rp) localStorage.removeItem(`prefetch:commit_draft:${rp}`);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({
        ...repoData,
        isLoading: false,
        fileStatuses: statuses,
        commitMessage: "",
        commitDescription: "",
        amendMode: false,
        selectedFilePath: null,
        activeDiff: null,
      });
      toast.success(amend ? "Commit amended" : "Committed successfully");
    } catch (e) {
      set({ isLoading: false });
      const { hookName, message } = parseError(e);
      if (hookName) {
        toast.error(`Hook '${hookName}' failed`, { description: message.slice(0, 300), duration: 10000 });
      } else {
        toast.error(message);
      }
    }
  },

  rewordHeadCommit: async (message) => {
    if (!message.trim()) {
      toast.error("Commit message cannot be empty");
      return;
    }
    set({ isLoading: true });
    try {
      await rewordHeadCommitCmd(message.trim());
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, fileStatuses: statuses, isLoading: false });
      toast.success("Commit message updated");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  setFilterQuery: (query) => set({ filterQuery: query }),
  setCommitMessage: (msg) => set({ commitMessage: msg }),
  setCommitDescription: (desc) => set({ commitDescription: desc }),

  setAmendMode: (on) => {
    if (on) {
      // Pre-fill commit message/description from the HEAD commit
      const { headCommitId, commits } = get();
      const headCommit = commits.find((c) => c.id === headCommitId);
      if (headCommit) {
        set({
          amendMode: true,
          commitMessage: headCommit.message,
          commitDescription: headCommit.body,
        });
      } else {
        set({ amendMode: true });
      }
    } else {
      set({ amendMode: false, commitMessage: "", commitDescription: "" });
    }
  },

  selectStash: async (index) => {
    set({
      selectedStashIndex: index,
      selectedCommitId: null,
      selectedFilePath: null,
      activeDiff: null,
      commitFiles: [],
      commitFilesLoading: true,
      ciSelectedJobId: null,
      ciJobLog: null,
    });
    try {
      const files = await getStashFiles(index);
      if (get().selectedStashIndex === index) {
        set({ commitFiles: files, commitFilesLoading: false });
      }
    } catch (e) {
      if (get().selectedStashIndex === index) {
        set({ commitFilesLoading: false });
      }
      toast.error(errorMessage(e));
    }
  },

  selectStashFile: async (index, filePath) => {
    set({ selectedFilePath: filePath, largeDiffPending: null });

    const totalChanges = isLargeDiff(get().commitFiles, filePath);
    if (totalChanges) {
      set({ activeDiff: null, largeDiffPending: { path: filePath, stashIndex: index, totalChanges } });
      return;
    }

    set({ diffLoading: true });
    try {
      const diff = await getStashFileDiff(index, filePath);
      set({ activeDiff: diff, diffLoading: false });
    } catch (e) {
      set({ diffLoading: false });
      toast.error(errorMessage(e));
    }
  },

  loadStashes: async () => {
    try {
      const stashList = await getStashes();
      set({ stashes: stashList });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  pushStash: async (message?) => {
    set({ isLoading: true });
    try {
      await stashPushCmd(message);
      const [statuses, stashList] = await Promise.all([
        getFileStatus(),
        getStashes(),
      ]);
      set({
        isLoading: false,
        fileStatuses: statuses,
        stashes: stashList,
        selectedFilePath: null,
        activeDiff: null,
      });
      toast.success("Changes stashed");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
      try {
        const [statuses, stashList] = await Promise.all([getFileStatus(), getStashes()]);
        set({ fileStatuses: statuses, stashes: stashList });
      } catch { /* stale UI is acceptable in error recovery */ }
    }
  },

  applyStash: async (index) => {
    set({ isLoading: true });
    try {
      await stashApplyCmd(index);
      const statuses = await getFileStatus();
      set({ isLoading: false, fileStatuses: statuses });
      toast.success("Stash applied (kept in stash list)");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  popStash: async (index) => {
    set({ isLoading: true });
    try {
      await stashPopCmd(index);
      const [statuses, stashList] = await Promise.all([
        getFileStatus(),
        getStashes(),
      ]);
      set({ isLoading: false, fileStatuses: statuses, stashes: stashList });
      toast.success("Stash applied & removed from list");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  dropStash: async (index) => {
    set({ isLoading: true });
    try {
      await stashDropCmd(index);
      const stashList = await getStashes();
      set({ isLoading: false, stashes: stashList });
      toast.success("Stash dropped");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  loadTags: async () => {
    try {
      const tagList = await getTags();
      set({ tags: tagList });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  createNewTag: async (name, commit?, message?) => {
    try {
      await createTagCmd(name, commit, message);
      const tagList = await getTags();
      set({ tags: tagList });
      toast.success(`Tag "${name}" created`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  deleteExistingTag: async (name) => {
    try {
      await deleteTagCmd(name);
      const tagList = await getTags();
      set({ tags: tagList });
      toast.success(`Tag "${name}" deleted`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  pushExistingTag: async (name) => {
    try {
      await pushTagCmd(name);
      toast.success(`Tag "${name}" pushed`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  resetTo: async (commitId, mode) => {
    set({ isLoading: true });
    try {
      await resetToCommitCmd(commitId, `--${mode}`);
      const [repoData, statuses, stashList, tagList, undoAction, conflict] = await Promise.all([
        fetchRepoData(),
        getFileStatus(),
        getStashes(),
        getTags(),
        getUndoAction(),
        getConflictState(),
      ]);
      set({
        ...repoData,
        isLoading: false,
        fileStatuses: statuses,
        stashes: stashList,
        tags: tagList,
        undoInfo: undoAction,
        conflictState: conflict,
        selectedCommitId: null,
        activeDiff: null,
      });
      toast.success(mode === "soft" ? "Reset (soft) — changes kept staged" : "Reset (hard) — working tree clean");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  cherryPick: async (commitId) => {
    const { fileStatuses } = get();
    if (fileStatuses.length > 0) {
      set({ dirtyActionPending: { operation: "cherry-pick", targetName: commitId, changesCount: fileStatuses.length } });
      return;
    }
    set({ isLoading: true });
    try {
      await cherryPickCommit(commitId);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        analyzeConflictFiles(statuses, set).catch(() => {});
        autoSelectFirstConflict(statuses, get);
        toast.error("Cherry-pick has conflicts — resolve them, then continue or abort");
      } else {
        toast.success("Cherry-pick successful");
      }
    } catch (e) {
      await handleConflictError(e, "Cherry-pick", set, get);
    }
  },

  rebaseOnto: async (targetBranch) => {
    set({ isLoading: true });
    try {
      await rebaseOntoCmd(targetBranch);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        analyzeConflictFiles(statuses, set).catch(() => {});
        autoSelectFirstConflict(statuses, get);
        if (conflict.operation === "rebase") {
          const progress = await getRebaseProgressCmd().catch(() => null);
          set({ rebaseProgress: progress });
        }
        toast.error("Rebase has conflicts — resolve them, then continue or abort");
      } else {
        toast.success(`Rebased onto ${targetBranch}`);
      }
    } catch (e) {
      await handleConflictError(e, "Rebase", set, get, async () => {
        const conflict = await getConflictState().catch(() => null);
        if (conflict?.operation === "rebase") {
          const progress = await getRebaseProgressCmd().catch(() => null);
          set({ rebaseProgress: progress });
        }
      });
    }
  },

  mergeInto: async (target) => {
    const { fileStatuses } = get();
    if (fileStatuses.length > 0) {
      set({ dirtyActionPending: { operation: "merge", targetName: target, changesCount: fileStatuses.length } });
      return;
    }
    set({ isLoading: true });
    try {
      await mergeBranchCmd(target);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        analyzeConflictFiles(statuses, set).catch(() => {});
        autoSelectFirstConflict(statuses, get);
        // Pre-fill commit message from MERGE_MSG
        const mergeMsg = await getMergeMessageCmd().catch(() => null);
        if (mergeMsg) set({ commitMessage: mergeMsg });
        toast.error("Merge has conflicts — resolve them, then continue or abort");
      } else {
        toast.success(`Merged ${target}`);
      }
    } catch (e) {
      await handleConflictError(e, "Merge", set, get, async () => {
        const mergeMsg = await getMergeMessageCmd().catch(() => null);
        if (mergeMsg) set({ commitMessage: mergeMsg });
      });
    }
  },

  deleteBranch: async (name, force = false) => {
    set({ isLoading: true });
    try {
      await deleteBranchCmd(name, force);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses });
      toast.success(`Deleted branch ${name}`);
    } catch (e) {
      set({ isLoading: false });
      const message = errorMessage(e);
      // If the branch has unmerged commits, git suggests -D
      if (!force && message.includes("not fully merged")) {
        toast.error(`Branch '${name}' has unmerged commits`, {
          description: "Use force delete to remove it anyway.",
          action: {
            label: "Force delete",
            onClick: () => get().deleteBranch(name, true),
          },
          duration: 10000,
        });
      } else {
        toast.error(message);
      }
    }
  },

  revertCommit: async (commitId) => {
    const { fileStatuses } = get();
    if (fileStatuses.length > 0) {
      set({ dirtyActionPending: { operation: "revert", targetName: commitId, changesCount: fileStatuses.length } });
      return;
    }
    set({ isLoading: true });
    try {
      await revertCommitCmd(commitId);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        analyzeConflictFiles(statuses, set).catch(() => {});
        autoSelectFirstConflict(statuses, get);
        toast.error("Revert has conflicts — resolve them, then continue or abort");
      } else {
        toast.success(`Reverted ${commitId.slice(0, 7)}`);
      }
    } catch (e) {
      await handleConflictError(e, "Revert", set, get);
    }
  },

  checkoutDetached: async (commitId) => {
    const { fileStatuses } = get();
    if (fileStatuses.length > 0) {
      set({ dirtyActionPending: { operation: "checkout-detached", targetName: commitId, changesCount: fileStatuses.length } });
      return;
    }
    set({ isLoading: true });
    try {
      await checkoutDetachedCmd(commitId);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses });
      toast.success(`Checked out ${commitId.slice(0, 7)} (detached HEAD)`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  createBranchAt: async (name, commitId) => {
    set({ isLoading: true });
    try {
      await createBranchAtCmd(name, commitId);
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false });
      toast.success(`Created branch '${name}' at ${commitId.slice(0, 7)}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  renameBranch: async (oldName, newName, renameRemote) => {
    set({ isLoading: true });
    try {
      if (renameRemote) {
        await renameBranchOnRemote(oldName, newName);
        toast.success(`Renamed '${oldName}' to '${newName}' (local + remote)`);
      } else {
        await renameBranchCmd(oldName, newName);
        toast.success(`Renamed '${oldName}' to '${newName}'`);
      }
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  deleteRemoteBranch: async (remote, branch) => {
    set({ isLoading: true });
    try {
      await deleteRemoteBranchCmd(remote, branch);
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false });
      toast.success(`Deleted ${remote}/${branch} from remote`);
    } catch (e) {
      const msg = errorMessage(e);
      if (msg.includes("remote ref does not exist")) {
        const repoData = await fetchRepoData();
        set({ ...repoData, isLoading: false });
        toast.success(`Remote branch ${remote}/${branch} already deleted`);
      } else {
        set({ isLoading: false });
        toast.error(msg);
      }
    }
  },

  setUpstream: async (remoteBranch) => {
    set({ isLoading: true });
    try {
      await setUpstreamCmd(remoteBranch);
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false });
      toast.success(`Upstream set to ${remoteBranch}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  stashFiles: async (paths, message) => {
    set({ isLoading: true });
    try {
      await stashPushFilesCmd(paths, message);
      const [statuses, stashList] = await Promise.all([getFileStatus(), getStashes()]);
      set({ isLoading: false, fileStatuses: statuses, stashes: stashList });
      toast.success(paths.length === 1 ? "Stashed 1 file" : `Stashed ${paths.length} files`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
      try {
        const [statuses, stashList] = await Promise.all([getFileStatus(), getStashes()]);
        set({ fileStatuses: statuses, stashes: stashList });
      } catch { /* stale UI is acceptable in error recovery */ }
    }
  },

  showInFolder: async (filePath) => {
    try {
      await showInFolderCmd(filePath);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  openInEditor: async (filePath) => {
    try {
      await openInEditorCmd(filePath);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  deleteFile: async (filePath) => {
    set({ isLoading: true });
    try {
      const { selectedFilePath } = get();
      if (selectedFilePath === filePath) {
        set({ activeDiff: null, selectedFilePath: null });
      }
      await deleteFileCmd(filePath);
      await get().loadStatus();
      toast.success(`Deleted ${filePath.split("/").pop()}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  abortOperation: async () => {
    set({ isLoading: true });
    try {
      await abortOperationCmd();
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict, rebaseProgress: null, conflictAutoResolvedFiles: new Map() });
      toast.success("Operation aborted");
    } catch (e) {
      set({ isLoading: false });
      toast.error(errorMessage(e));
    }
  },

  continueOperation: async (message?: string) => {
    set({ isLoading: true });
    try {
      await continueOperationCmd(message);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        analyzeConflictFiles(statuses, set).catch(() => {});
        autoSelectFirstConflict(statuses, get);
        // Rebase advanced to next commit — load new progress
        if (conflict.operation === "rebase") {
          const progress = await getRebaseProgressCmd().catch(() => null);
          set({ rebaseProgress: progress });
        }
        toast.error("Still has conflicts — resolve remaining files");
      } else {
        set({ rebaseProgress: null });
        toast.success("Operation completed");
      }
    } catch (e) {
      toast.error(errorMessage(e));
      // Always refresh state after failure — the operation may have partially
      // succeeded (e.g. commit created but editor failed) or the rebase may
      // have completed despite the error.
      try {
        const [repoData, statuses, conflict] = await Promise.all([
          fetchRepoData(),
          getFileStatus().catch(() => []),
          getConflictState(),
        ]);
        set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
        if (conflict.in_progress) {
          analyzeConflictFiles(statuses as FileStatus[], set).catch(() => {});
          autoSelectFirstConflict(statuses as FileStatus[], get);
          if (conflict.operation === "rebase") {
            const progress = await getRebaseProgressCmd().catch(() => null);
            set({ rebaseProgress: progress });
          }
        } else {
          set({ rebaseProgress: null });
        }
      } catch {
        set({ isLoading: false }); /* state refresh is best-effort */
      }
    }
  },

  loadConflictState: async () => {
    if (!get().repoPath) return;
    try {
      const conflict = await getConflictState();
      set({ conflictState: conflict });
      // Auto-load rebase progress when rebase is detected
      if (conflict.in_progress && conflict.operation === "rebase") {
        const progress = await getRebaseProgressCmd().catch(() => null);
        set({ rebaseProgress: progress });
      } else {
        set({ rebaseProgress: null });
      }
    } catch {
      set({ conflictState: null, rebaseProgress: null });
    }
  },

  loadRebaseProgress: async () => {
    if (!get().repoPath) return;
    try {
      const progress = await getRebaseProgressCmd();
      set({ rebaseProgress: progress });
    } catch {
      set({ rebaseProgress: null });
    }
  },

  loadUndoAction: async () => {
    if (!get().repoPath) return;
    try {
      const action = await getUndoAction();
      set({ undoInfo: action });
    } catch {
      set({ undoInfo: null });
    }
  },

  undo: async () => {
    const info = get().undoInfo;
    if (!info?.can_undo) return;
    // Disable undo immediately and record timestamp — the undo itself creates
    // a reflog entry, so we suppress undo refresh for a few seconds to prevent
    // an undo-of-undo loop. A new real action will re-enable it.
    set({ undoInfo: null, lastUndoTime: Date.now() });
    try {
      await undoLast();
      const [repoData, statuses, stashList] = await Promise.all([
        fetchRepoData(),
        getFileStatus(),
        getStashes(),
      ]);
      set({ ...repoData, fileStatuses: statuses, stashes: stashList });
      toast.success(info.description);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  loadRecentRepos: async () => {
    try {
      const repos = await getRecentRepos();
      set({ recentRepos: repos });
    } catch {
      // DB not initialized yet — ignore
    }
  },

  removeFromRecentRepos: async (path) => {
    try {
      await removeRecentRepo(path);
      const repos = await getRecentRepos();
      set({ recentRepos: repos });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  reloadRefs: async () => {
    if (!get().repoPath) return;
    try {
      const [repoData, tagList] = await Promise.all([fetchRepoData(), getTags()]);
      set({ ...repoData, tags: tagList });
    } catch {
      // Silently handle — background refresh
    }
  },

  reloadAll: async () => {
    if (!get().repoPath) return;
    try {
      // Skip undo refresh for 3s after an undo to prevent undo-of-undo loop
      const suppressUndo = Date.now() - get().lastUndoTime < 3000;
      // Single parallel batch + single set() to avoid double re-renders.
      // Previously reloadRepoData called set() first (canvas redraw), then
      // a second set() for status/stashes/tags (another canvas redraw).
      const [repoData, statuses, stashList, tagList, undoAction, conflict] = await Promise.all([
        fetchRepoData(),
        getFileStatus(),
        getStashes(),
        getTags(),
        suppressUndo ? Promise.resolve(null) : getUndoAction(),
        getConflictState(),
      ]);
      const update: Partial<RepoState> = { ...repoData, fileStatuses: statuses, stashes: stashList, tags: tagList, conflictState: conflict };
      if (undoAction !== null) {
        update.undoInfo = undoAction;
      }
      set(update);
      if (conflict.in_progress) analyzeConflictFiles(statuses, set).catch(() => {});
    } catch {
      // Silently handle — these are background refreshes from the file watcher
    }
  },

  // ── Git identity ──────────────────────────────────────────────────────────

  loadGitIdentity: async () => {
    try {
      const identity = await getGitIdentityCmd();
      // If a profile is active, display the profile's identity instead of git config
      const { useProfileStore } = await import("@/stores/profile-store");
      const activeProfile = useProfileStore.getState().activeProfile;
      if (activeProfile) {
        set({
          gitIdentity: {
            name: activeProfile.user_name,
            email: activeProfile.user_email,
            source: "profile",
          },
        });
      } else {
        set({ gitIdentity: identity });
      }
    } catch {
      // Non-critical
    }
  },

  // ── Forge actions ──────────────────────────────────────────────────────────

  loadForgeStatus: async () => {
    try {
      const status = await getForgeStatus();
      set({ forgeStatus: status });
      const path = get().repoPath;
      if (path && status.kind) {
        updateRepoForgeInfo(
          path,
          status.kind,
          status.host ?? null,
          status.owner ?? null,
          status.repo ?? null,
        ).catch(() => {});
      }
    } catch {
      // Forge detection is non-critical
    }
  },

  loadPrForBranch: async (branch: string) => {
    // Skip if already in cache (value may be null = "no PR", which is valid)
    if (branch in get().prCache) return;
    try {
      const pr = await getPrForBranchCmd(branch);
      set((state) => ({ prCache: { ...state.prCache, [branch]: pr } }));
    } catch {
      // PR lookup is best-effort
    }
  },

  saveForgeToken: async (host: string, token: string) => {
    try {
      await saveForgeTokenCmd(host, token);
      toast.success("Token saved");
      await get().loadForgeStatus();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  deleteForgeToken: async (host: string) => {
    try {
      await deleteForgeTokenCmd(host);
      set({ prCache: {} });
      toast.success("Token removed");
      await get().loadForgeStatus();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  openPr: async (url: string) => {
    try {
      await openUrlCmd(url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  // ── UI settings (persisted) ──────────────────────────────────────────────

  setFileViewMode: (mode) => {
    set({ fileViewMode: mode });
    setUiState("file_view_mode", mode).catch(() => {});
  },

  loadFileViewMode: async () => {
    try {
      const saved = await getUiState("file_view_mode");
      if (saved === "flat" || saved === "tree") {
        set({ fileViewMode: saved });
      }
    } catch {
      // DB might not be ready yet — use default
    }
  },

  setDiffViewMode: (mode) => {
    set({ diffViewMode: mode });
    setUiState("diff_view_mode", mode).catch(() => {});
  },

  setImageDiffViewMode: (mode) => {
    set({ imageDiffViewMode: mode });
    setUiState("image_diff_view_mode", mode).catch(() => {});
  },

  setDiffWrapLines: (on) => {
    set({ diffWrapLines: on });
    setUiState("diff_wrap_lines", on ? "true" : "false").catch(() => {});
  },

  loadDiffPreferences: async () => {
    try {
      const [viewMode, imageViewMode, wrapLines] = await Promise.all([
        getUiState("diff_view_mode"),
        getUiState("image_diff_view_mode"),
        getUiState("diff_wrap_lines"),
      ]);
      const update: Partial<RepoState> = {};
      if (viewMode === "unified" || viewMode === "side-by-side") {
        update.diffViewMode = viewMode;
      }
      if (imageViewMode === "unified" || imageViewMode === "side-by-side" || imageViewMode === "swipe") {
        update.imageDiffViewMode = imageViewMode;
      }
      if (wrapLines === "true" || wrapLines === "false") {
        update.diffWrapLines = wrapLines === "true";
      }
      if (Object.keys(update).length > 0) set(update);
    } catch {
      // DB might not be ready yet — use defaults
    }
  },

  setGraphColumnVisibility: (v) => {
    set({ graphColumnVisibility: v });
    setUiState("graph_column_visibility", JSON.stringify(v)).catch(() => {});
  },

  setGraphDateFormat: (f) => {
    set({ graphDateFormat: f });
    setUiState("graph_date_format", f).catch(() => {});
  },

  loadGraphPreferences: async () => {
    try {
      const [visRaw, fmtRaw] = await Promise.all([
        getUiState("graph_column_visibility"),
        getUiState("graph_date_format"),
      ]);
      const update: Partial<RepoState> = {};
      if (visRaw) {
        try {
          const parsed = JSON.parse(visRaw) as Record<string, unknown>;
          update.graphColumnVisibility = {
            sha: parsed.sha === true,
            author: parsed.author === true,
            date: parsed.date === true,
          };
        } catch { /* malformed — keep default */ }
      }
      if (fmtRaw === "relative" || fmtRaw === "short" || fmtRaw === "long" || fmtRaw === "iso") {
        update.graphDateFormat = fmtRaw;
      }
      if (Object.keys(update).length > 0) set(update);
    } catch {
      // DB might not be ready yet — use defaults
    }
  },

  setSidebarSection: (section, open) => {
    const next = { ...get().sidebarSections, [section]: open };
    set({ sidebarSections: next });
    setUiState("sidebar_sections", JSON.stringify(next)).catch(() => {});
  },

  loadSidebarPreferences: async () => {
    try {
      const [raw, hiddenRaw] = await Promise.all([
        getUiState("sidebar_sections"),
        getUiState("ci_hidden_sources"),
      ]);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          set({
            sidebarSections: {
              branches: parsed.branches !== false,
              ci: parsed.ci === true,
              stashes: parsed.stashes !== false,
              tags: parsed.tags !== false,
            },
          });
        } catch { /* malformed — keep defaults */ }
      }
      if (hiddenRaw) {
        try {
          const arr = JSON.parse(hiddenRaw) as string[];
          set({ ciHiddenSources: new Set(arr) });
        } catch { /* malformed — keep defaults */ }
      }
    } catch {
      // DB might not be ready yet — use defaults
    }
  },

  // ── CI actions ─────────────────────────────────────────────────────────────

  loadCiPipelines: async () => {
    const forgeStatus = get().forgeStatus;
    if (!forgeStatus?.has_token) return;

    set({ ciLoading: true });
    try {
      const pipelines = await getPipelinesForBranch(null, 10);
      set({ ciPipelines: pipelines, ciLoading: false });

      // Fetch jobs — only re-fetch for active/new pipelines, reuse cached for settled ones.
      // A pipeline can report settled while its jobs were last cached mid-flight (the poll that
      // observes the settle is the one that must capture the jobs' final states), so also
      // re-fetch when any cached job is still non-terminal.
      const isUnsettled = (s: PipelineStatus) => s === "queued" || s === "in_progress";
      const prevJobsMap = get().ciJobsMap;
      const toFetch = pipelines.filter(
        (p) =>
          isUnsettled(p.status) ||
          !(p.id in prevJobsMap) ||
          (prevJobsMap[p.id] ?? []).some((j) => isUnsettled(j.status)),
      );
      const entries = await Promise.all(
        toFetch.map(async (p) => {
          try {
            const jobs = await getPipelineJobs(p.id);
            return [p.id, jobs] as const;
          } catch {
            return [p.id, [] as CiJob[]] as const;
          }
        }),
      );
      const jobsMap: Record<number, CiJob[]> = {};
      for (const p of pipelines) {
        const fetched = entries.find(([id]) => id === p.id);
        jobsMap[p.id] = fetched ? fetched[1] : (prevJobsMap[p.id] ?? []);
      }
      set({ ciJobsMap: jobsMap });

      // Auto-expand the latest pipeline
      if (pipelines.length > 0 && get().ciSelectedPipelineId == null) {
        set({ ciSelectedPipelineId: pipelines[0].id });
      }

      // Auto-start polling if any pipeline is still active — consider job-level status too,
      // so we keep polling until the jobs settle, not just the pipeline.
      const hasActive = pipelines.some(
        (p) => isUnsettled(p.status) || (jobsMap[p.id] ?? []).some((j) => isUnsettled(j.status)),
      );
      if (hasActive) get().startCiPolling();
    } catch {
      set({ ciPipelines: [], ciLoading: false });
    }
  },

  toggleCiPipeline: (pipelineId: number) => {
    const current = get().ciSelectedPipelineId;
    set({ ciSelectedPipelineId: current === pipelineId ? null : pipelineId });
  },

  toggleCiSourceFilter: (source: string) => {
    const hidden = new Set(get().ciHiddenSources);
    if (hidden.has(source)) hidden.delete(source);
    else hidden.add(source);
    set({ ciHiddenSources: hidden });
    setUiState("ci_hidden_sources", JSON.stringify([...hidden])).catch(() => {});
  },

  loadCiJobLog: async (jobId: number) => {
    // Clear any active diff so the CI log viewer can show in the center pane
    set({ ciSelectedJobId: jobId, ciJobLog: null, activeDiff: null, largeDiffPending: null, selectedFilePath: null });
    try {
      const log = await getCiJobLog(jobId);
      set({ ciJobLog: log });
    } catch (e) {
      set({ ciJobLog: `Failed to load log: ${e}` });
    }
  },

  clearCiJobLog: () => {
    set({ ciSelectedJobId: null, ciJobLog: null });
  },

  startCiPolling: () => {
    if (get().ciPolling) return;
    set({ ciPolling: true });

    const poll = async () => {
      while (get().ciPolling) {
        await get().loadCiPipelines();

        // Stop polling once all pipelines AND their jobs are settled
        const isUnsettled = (s: PipelineStatus) => s === "queued" || s === "in_progress";
        const jobsMap = get().ciJobsMap;
        const active = get().ciPipelines.some(
          (p) => isUnsettled(p.status) || (jobsMap[p.id] ?? []).some((j) => isUnsettled(j.status)),
        );
        if (!active) {
          set({ ciPolling: false });
          return;
        }

        await new Promise((r) => setTimeout(r, 15_000));
      }
    };
    poll();
  },

  stopCiPolling: () => {
    set({ ciPolling: false });
  },

  // ── LFS actions ────────────────────────────────────────────────────────────

  loadLfsInfo: async (full = false) => {
    try {
      // Default: lightweight file-read check (<1ms) — just sets initialized flag
      // for the sidebar badge. Full details (tracked patterns, file counts) are
      // loaded on-demand when the user opens the LFS panel, because spawning
      // git lfs Go binaries takes 2-5s on Windows and freezes the app.
      const info = full ? await lfsGetInfo() : await lfsCheckInitialized();
      set({ lfsInfo: info });
    } catch {
      // LFS info is non-critical — silently ignore
    }
  },

  initializeLfs: async () => {
    set({ isLoading: true });
    try {
      await lfsInitialize();
      toast.success("LFS initialised in this repository");
      await get().loadLfsInfo(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      set({ isLoading: false });
    }
  },

  trackLfsPattern: async (pattern: string) => {
    set({ isLoading: true });
    try {
      await lfsTrackCmd(pattern);
      toast.success(`Tracking "${pattern}" with LFS`);
      await get().loadLfsInfo(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      set({ isLoading: false });
    }
  },

  untrackLfsPattern: async (pattern: string) => {
    set({ isLoading: true });
    try {
      await lfsUntrackCmd(pattern);
      toast.success(`Untracked "${pattern}" from LFS`);
      await get().loadLfsInfo(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      set({ isLoading: false });
    }
  },

  pruneLfsObjects: async () => {
    set({ isLoading: true });
    try {
      await lfsPruneCmd();
      toast.success("LFS objects pruned");
      await get().loadLfsInfo(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      set({ isLoading: false });
    }
  },
}));

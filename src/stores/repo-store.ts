import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type {
  BranchInfo,
  CommitInfo,
  ConflictState,
  FileDiff,
  FileStatus,
  ForgeStatus,
  GitIdentity,
  GraphEdge,
  LfsInfo,
  PrInfo,
  StashInfo,
  TagInfo,
  UndoAction,
} from "@/types/git";
import {
  openRepo,
  getCommits,
  getBranches,
  checkoutBranch,
  resetBranchToRemote,
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
  getCommitFiles,
  getCommitFileDiff,
  getStashes,
  stashPush as stashPushCmd,
  stashPop as stashPopCmd,
  stashDrop as stashDropCmd,
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
  getConflictState,
  abortOperation as abortOperationCmd,
  continueOperation as continueOperationCmd,
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
} from "@/lib/commands";
import {
  addRecentRepo,
  getRecentRepos,
  removeRecentRepo,
  setUiState,
  type RecentRepo,
} from "@/lib/database";

/** Files with more than this many changed lines show a "Load anyway" guard */
const LARGE_DIFF_THRESHOLD = 10_000;

interface RepoState {
  repoPath: string | null;
  repoName: string | null;
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  headCommitId: string | null;
  branches: BranchInfo[];
  currentBranch: string | null;
  selectedCommitId: string | null;
  isLoading: boolean;
  error: string | null;

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

  commitMessage: string;
  commitDescription: string;

  // Stash
  stashes: StashInfo[];
  selectedStashIndex: number | null;

  // Tags
  tags: TagInfo[];

  // Force push
  forcePushPending: boolean;

  // Conflict state
  conflictState: ConflictState | null;

  // Remote checkout dialog
  remoteCheckoutPending: {
    localName: string;
    remoteName: string;
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

  // Actions
  openRepository: (path: string) => Promise<void>;
  loadRecentRepos: () => Promise<void>;
  removeFromRecentRepos: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStatus: () => Promise<void>;
  checkout: (name: string) => Promise<void>;
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
  /** Load a deferred large diff (user clicked "Load anyway") */
  loadPendingDiff: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  discardAll: () => Promise<void>;
  resolveOurs: (filePath: string) => Promise<void>;
  resolveTheirs: (filePath: string) => Promise<void>;
  commit: (message: string, amend?: boolean) => Promise<void>;
  setCommitMessage: (msg: string) => void;
  setCommitDescription: (desc: string) => void;
  loadStashes: () => Promise<void>;
  selectStash: (index: number) => Promise<void>;
  selectStashFile: (index: number, filePath: string) => Promise<void>;
  pushStash: (message?: string) => Promise<void>;
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
  abortOperation: () => Promise<void>;
  continueOperation: () => Promise<void>;
  loadConflictState: () => Promise<void>;
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

  // LFS actions
  loadLfsInfo: (full?: boolean) => Promise<void>;
  initializeLfs: () => Promise<void>;
  trackLfsPattern: (pattern: string) => Promise<void>;
  untrackLfsPattern: (pattern: string) => Promise<void>;
  pruneLfsObjects: () => Promise<void>;
}

/** Fetch commits + branches without calling set(). Callers merge into their own set(). */
async function fetchRepoData(): Promise<Partial<RepoState>> {
  const [data, branchList] = await Promise.all([getCommits(), getBranches()]);
  const head = branchList.find((b) => b.is_head);
  return {
    commits: data.commits,
    edges: data.edges,
    totalLanes: data.total_lanes,
    headCommitId: data.head_commit_id,
    branches: branchList,
    currentBranch: head?.name ?? null,
  };
}

export const useRepoStore = create<RepoState>()((set, get) => ({
  repoPath: null,
  repoName: null,
  commits: [],
  edges: [],
  totalLanes: 0,
  headCommitId: null,
  branches: [],
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
  commitMessage: "",
  commitDescription: "",
  stashes: [],
  selectedStashIndex: null,
  tags: [],
  forcePushPending: false,
  conflictState: null,
  remoteCheckoutPending: null,
  undoInfo: null,
  lastUndoTime: 0,
  recentRepos: [],
  lfsInfo: null,
  gitIdentity: null,
  forgeStatus: null,
  prCache: {},

  openRepository: async (path: string) => {
    // Skip if this repo is already open
    if (get().repoPath === path && get().commits.length > 0) return;
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
      commitMessage: "",
      commitDescription: "",
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

      // Load LFS, forge, and identity info after core data (non-blocking, fire-and-forget)
      Promise.all([
        get().loadLfsInfo(),
        get().loadForgeStatus(),
        get().loadGitIdentity(),
      ]).catch(() => {});
      // Track in recent repos + save as last opened (fire-and-forget)
      const activeProfile = useProfileStore.getState().activeProfile;
      Promise.all([
        addRecentRepo(path, name, activeProfile?.id ?? null).then(() => get().loadRecentRepos()),
        setUiState("last_repo_path", path),
      ]).catch(() => {});
    } catch (e) {
      const msg = String(e);
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
      toast.error(String(e));
    }
  },

  loadStatus: async () => {
    try {
      const statuses = await getFileStatus();
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
      toast.error(String(e));
    }
  },

  checkout: async (name: string) => {
    const { currentBranch, branches } = get();
    if (name === currentBranch) return;

    // Smart remote branch handling: strip origin/ and check for local counterpart
    const remotePrefix = name.match(/^([^/]+)\//)?.[0];
    const isRemote = branches.some((b) => b.is_remote && b.name === name);

    if (isRemote && remotePrefix) {
      const localName = name.slice(remotePrefix.length);
      const localExists = branches.some((b) => !b.is_remote && b.name === localName);

      if (localExists) {
        // Local branch exists — show dialog to choose between switch or reset
        set({ remoteCheckoutPending: { localName, remoteName: name } });
        return;
      }
      // No local branch — checkout by local name, git will auto-create tracking branch
      set({ isLoading: true, error: null });
      try {
        await checkoutBranch(localName);
        const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
        set({ ...repoData, isLoading: false, fileStatuses: statuses });
        toast.success(`Checked out ${localName} (tracking ${name})`);
      } catch (e) {
        set({ isLoading: false });
        toast.error(String(e));
      }
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
      toast.error(String(e));
    }
  },

  resetLocalToRemote: async () => {
    const pending = get().remoteCheckoutPending;
    if (!pending) return;
    set({ remoteCheckoutPending: null, isLoading: true, error: null });
    try {
      await resetBranchToRemote(pending.localName, pending.remoteName);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses });
      toast.success(`Reset ${pending.localName} to ${pending.remoteName}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e));
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
      toast.error(String(e));
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
      const repoData = await fetchRepoData();
      set({ ...repoData, isLoading: false, prCache: {} }); // invalidate PR cache after fetch
      clearPrCacheCmd().catch(() => {});
      toast.success("Fetch complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e), { id: toastId });
    } finally {
      unlisten();
    }
  },

  pull: async () => {
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
      toast.error(String(e), { id: toastId });
    } finally {
      unlisten();
    }
  },

  push: async () => {
    set({ isLoading: true });
    const toastId = toast.loading("Pushing...");
    const unlisten = await listen<string>("git_progress", (event) => {
      toast.loading(event.payload, { id: toastId });
    });
    try {
      await pushRepo();
      set({ isLoading: false });
      toast.success("Push complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      const errMsg = String(e);
      // Detect rejected push (diverged history after reset)
      if (errMsg.includes("rejected") || errMsg.includes("non-fast-forward") || errMsg.includes("fetch first")) {
        toast.error("Push rejected — remote has diverged", { id: toastId });
        set({ forcePushPending: true });
      } else {
        toast.error(errMsg, { id: toastId });
      }
    } finally {
      unlisten();
    }
  },

  forcePush: async () => {
    set({ forcePushPending: false, isLoading: true });
    const toastId = toast.loading("Force pushing...");
    const unlisten = await listen<string>("git_progress", (event) => {
      toast.loading(event.payload, { id: toastId });
    });
    try {
      await forcePushRepo();
      set({ isLoading: false });
      toast.success("Force push complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e), { id: toastId });
    } finally {
      unlisten();
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
    });
    if (id) {
      try {
        const files = await getCommitFiles(id);
        set({ commitFiles: files });
      } catch (e) {
        toast.error(String(e));
      }
    }
  },

  selectFile: async (path, staged) => {
    set({ selectedFilePath: path, selectedFileStaged: staged, selectedCommitId: null, commitFiles: [], largeDiffPending: null });

    // Check if file is too large before fetching
    const file = get().fileStatuses.find((f) => f.path === path && f.is_staged === staged);
    const totalChanges = (file?.additions ?? 0) + (file?.deletions ?? 0);
    if (totalChanges > LARGE_DIFF_THRESHOLD) {
      set({ activeDiff: null, largeDiffPending: { path, staged, totalChanges } });
      return;
    }

    set({ diffLoading: true });
    try {
      const diff = await getFileDiff(path, staged);
      set({ activeDiff: diff, diffLoading: false });
    } catch (e) {
      set({ diffLoading: false });
      toast.error(String(e));
    }
  },

  selectCommitFile: async (commitId, filePath) => {
    set({ selectedFilePath: filePath, largeDiffPending: null });

    // Check if file is too large before fetching
    const file = get().commitFiles.find((f) => f.path === filePath);
    const totalChanges = (file?.additions ?? 0) + (file?.deletions ?? 0);
    if (totalChanges > LARGE_DIFF_THRESHOLD) {
      set({ activeDiff: null, largeDiffPending: { path: filePath, commitId, totalChanges } });
      return;
    }

    set({ diffLoading: true });
    try {
      const diff = await getCommitFileDiff(commitId, filePath);
      set({ activeDiff: diff, diffLoading: false });
    } catch (e) {
      set({ diffLoading: false });
      toast.error(String(e));
    }
  },

  clearDiff: () => set({ activeDiff: null, largeDiffPending: null, diffLoading: false, selectedFilePath: null }),

  clearSelection: () =>
    set({
      selectedCommitId: null,
      selectedStashIndex: null,
      selectedFilePath: null,
      activeDiff: null,
      largeDiffPending: null,
      commitFiles: [],
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
      toast.error(String(e));
    }
  },

  stage: async (paths) => {
    try {
      await stageFilesCmd(paths);
      await get().loadStatus();
      // Refresh diff if the staged file is currently selected
      const { selectedFilePath } = get();
      if (selectedFilePath && paths.includes(selectedFilePath)) {
        const diff = await getFileDiff(selectedFilePath, true);
        set({ activeDiff: diff, selectedFileStaged: true });
      }
    } catch (e) {
      toast.error(String(e));
    }
  },

  unstage: async (paths) => {
    try {
      await unstageFilesCmd(paths);
      await get().loadStatus();
      const { selectedFilePath } = get();
      if (selectedFilePath && paths.includes(selectedFilePath)) {
        const diff = await getFileDiff(selectedFilePath, false);
        set({ activeDiff: diff, selectedFileStaged: false });
      }
    } catch (e) {
      toast.error(String(e));
    }
  },

  discard: async (paths) => {
    try {
      await discardFilesCmd(paths);
      await get().loadStatus();
      // Clear diff if the discarded file was being viewed
      const { selectedFilePath } = get();
      if (selectedFilePath && paths.includes(selectedFilePath)) {
        set({ activeDiff: null, selectedFilePath: null });
      }
    } catch (e) {
      toast.error(String(e));
    }
  },

  discardAll: async () => {
    try {
      await discardAllCmd();
      await get().loadStatus();
      set({ activeDiff: null, selectedFilePath: null });
      toast.success("All changes discarded");
    } catch (e) {
      toast.error(String(e));
    }
  },

  resolveOurs: async (filePath) => {
    try {
      await resolveOursCmd(filePath);
      await get().loadStatus();
      toast.success(`Resolved ${filePath.split("/").pop()} — kept ours`);
    } catch (e) {
      toast.error(String(e));
    }
  },

  resolveTheirs: async (filePath) => {
    try {
      await resolveTheirsCmd(filePath);
      await get().loadStatus();
      toast.success(`Resolved ${filePath.split("/").pop()} — kept theirs`);
    } catch (e) {
      toast.error(String(e));
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
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({
        ...repoData,
        isLoading: false,
        fileStatuses: statuses,
        commitMessage: "",
        commitDescription: "",
        selectedFilePath: null,
        activeDiff: null,
      });
      toast.success("Committed successfully");
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e));
    }
  },

  setCommitMessage: (msg) => set({ commitMessage: msg }),
  setCommitDescription: (desc) => set({ commitDescription: desc }),

  selectStash: async (index) => {
    set({
      selectedStashIndex: index,
      selectedCommitId: null,
      selectedFilePath: null,
      activeDiff: null,
      commitFiles: [],
    });
    try {
      const files = await getStashFiles(index);
      set({ commitFiles: files });
    } catch (e) {
      toast.error(String(e));
    }
  },

  selectStashFile: async (index, filePath) => {
    set({ selectedFilePath: filePath, largeDiffPending: null });

    const file = get().commitFiles.find((f) => f.path === filePath);
    const totalChanges = (file?.additions ?? 0) + (file?.deletions ?? 0);
    if (totalChanges > LARGE_DIFF_THRESHOLD) {
      set({ activeDiff: null, largeDiffPending: { path: filePath, stashIndex: index, totalChanges } });
      return;
    }

    set({ diffLoading: true });
    try {
      const diff = await getStashFileDiff(index, filePath);
      set({ activeDiff: diff, diffLoading: false });
    } catch (e) {
      set({ diffLoading: false });
      toast.error(String(e));
    }
  },

  loadStashes: async () => {
    try {
      const stashList = await getStashes();
      set({ stashes: stashList });
    } catch (e) {
      toast.error(String(e));
    }
  },

  pushStash: async (message?) => {
    try {
      await stashPushCmd(message);
      const [statuses, stashList] = await Promise.all([
        getFileStatus(),
        getStashes(),
      ]);
      set({
        fileStatuses: statuses,
        stashes: stashList,
        selectedFilePath: null,
        activeDiff: null,
      });
      toast.success("Changes stashed");
    } catch (e) {
      toast.error(String(e));
    }
  },

  popStash: async (index) => {
    try {
      await stashPopCmd(index);
      const [statuses, stashList] = await Promise.all([
        getFileStatus(),
        getStashes(),
      ]);
      set({ fileStatuses: statuses, stashes: stashList });
      toast.success("Stash applied");
    } catch (e) {
      toast.error(String(e));
    }
  },

  dropStash: async (index) => {
    try {
      await stashDropCmd(index);
      const stashList = await getStashes();
      set({ stashes: stashList });
      toast.success("Stash dropped");
    } catch (e) {
      toast.error(String(e));
    }
  },

  loadTags: async () => {
    try {
      const tagList = await getTags();
      set({ tags: tagList });
    } catch (e) {
      toast.error(String(e));
    }
  },

  createNewTag: async (name, commit?, message?) => {
    try {
      await createTagCmd(name, commit, message);
      const tagList = await getTags();
      set({ tags: tagList });
      toast.success(`Tag "${name}" created`);
    } catch (e) {
      toast.error(String(e));
    }
  },

  deleteExistingTag: async (name) => {
    try {
      await deleteTagCmd(name);
      const tagList = await getTags();
      set({ tags: tagList });
      toast.success(`Tag "${name}" deleted`);
    } catch (e) {
      toast.error(String(e));
    }
  },

  pushExistingTag: async (name) => {
    try {
      await pushTagCmd(name);
      toast.success(`Tag "${name}" pushed`);
    } catch (e) {
      toast.error(String(e));
    }
  },

  resetTo: async (commitId, mode) => {
    set({ isLoading: true });
    try {
      await resetToCommitCmd(commitId, `--${mode}`);
      const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses });
      toast.success(mode === "soft" ? "Reset (soft) — changes kept staged" : "Reset (hard) — working tree clean");
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e));
    }
  },

  cherryPick: async (commitId) => {
    set({ isLoading: true });
    try {
      await cherryPickCommit(commitId);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        toast.error("Cherry-pick has conflicts — resolve them, then continue or abort");
      } else {
        toast.success("Cherry-pick successful");
      }
    } catch (e) {
      set({ isLoading: false });
      // Check if the error is a conflict (git cherry-pick exits non-zero on conflict)
      const conflict = await getConflictState().catch(() => null);
      if (conflict?.in_progress) {
        const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus().catch(() => [])]);
        set({ ...repoData, fileStatuses: statuses, conflictState: conflict });
        toast.error("Cherry-pick has conflicts — resolve them, then continue or abort");
      } else {
        toast.error(String(e));
      }
    }
  },

  rebaseOnto: async (targetBranch) => {
    set({ isLoading: true });
    try {
      await rebaseOntoCmd(targetBranch);
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, isLoading: false, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        toast.error("Rebase has conflicts — resolve them, then continue or abort");
      } else {
        toast.success(`Rebased onto ${targetBranch}`);
      }
    } catch (e) {
      set({ isLoading: false });
      const conflict = await getConflictState().catch(() => null);
      if (conflict?.in_progress) {
        const [repoData, statuses] = await Promise.all([fetchRepoData(), getFileStatus().catch(() => [])]);
        set({ ...repoData, fileStatuses: statuses, conflictState: conflict });
        toast.error("Rebase has conflicts — resolve them, then continue or abort");
      } else {
        toast.error(String(e));
      }
    }
  },

  abortOperation: async () => {
    try {
      await abortOperationCmd();
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, fileStatuses: statuses, conflictState: conflict });
      toast.success("Operation aborted");
    } catch (e) {
      toast.error(String(e));
    }
  },

  continueOperation: async () => {
    try {
      await continueOperationCmd();
      const [repoData, statuses, conflict] = await Promise.all([fetchRepoData(), getFileStatus(), getConflictState()]);
      set({ ...repoData, fileStatuses: statuses, conflictState: conflict });
      if (conflict.in_progress) {
        toast.error("Still has conflicts — resolve remaining files");
      } else {
        toast.success("Operation completed");
      }
    } catch (e) {
      toast.error(String(e));
    }
  },

  loadConflictState: async () => {
    if (!get().repoPath) return;
    try {
      const conflict = await getConflictState();
      set({ conflictState: conflict });
    } catch {
      set({ conflictState: null });
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
      toast.error(String(e));
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
      toast.error(String(e));
    }
  },

  reloadRefs: async () => {
    if (!get().repoPath) return;
    try {
      // Refs changed (fetch, push, remote branch update) — only commits and
      // branches need refreshing. Working tree / status is unaffected.
      const repoData = await fetchRepoData();
      set(repoData);
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
      toast.error(String(e));
    }
  },

  deleteForgeToken: async (host: string) => {
    try {
      await deleteForgeTokenCmd(host);
      set({ prCache: {} });
      toast.success("Token removed");
      await get().loadForgeStatus();
    } catch (e) {
      toast.error(String(e));
    }
  },

  openPr: async (url: string) => {
    try {
      await openUrlCmd(url);
    } catch (e) {
      toast.error(String(e));
    }
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
      toast.error(String(e));
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
      toast.error(String(e));
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
      toast.error(String(e));
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
      toast.error(String(e));
    } finally {
      set({ isLoading: false });
    }
  },
}));

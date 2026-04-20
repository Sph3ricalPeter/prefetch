import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type {
  BranchInfo,
  CommitInfo,
  FileDiff,
  FileStatus,
  GraphEdge,
  StashInfo,
  TagInfo,
} from "@/types/git";
import {
  openRepo,
  getCommits,
  getBranches,
  checkoutBranch,
  createBranchCmd,
  fetchRepo,
  pullRepo,
  pushRepo,
  getFileStatus,
  getFileDiff,
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

  // Stash
  stashes: StashInfo[];
  selectedStashIndex: number | null;

  // Tags
  tags: TagInfo[];

  // Recent repos
  recentRepos: RecentRepo[];

  // Actions
  openRepository: (path: string) => Promise<void>;
  loadRecentRepos: () => Promise<void>;
  removeFromRecentRepos: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStatus: () => Promise<void>;
  checkout: (name: string) => Promise<void>;
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
  commit: (message: string, amend?: boolean) => Promise<void>;
  setCommitMessage: (msg: string) => void;
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

  /** Reload all repo data — called by file watcher events */
  reloadAll: () => Promise<void>;
}

async function reloadRepoData(set: (s: Partial<RepoState>) => void) {
  const [data, branchList] = await Promise.all([getCommits(), getBranches()]);
  const head = branchList.find((b) => b.is_head);
  set({
    commits: data.commits,
    edges: data.edges,
    totalLanes: data.total_lanes,
    headCommitId: data.head_commit_id,
    branches: branchList,
    currentBranch: head?.name ?? null,
  });
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
  largeDiffPending: null,
  commitFiles: [],
  commitMessage: "",
  stashes: [],
  selectedStashIndex: null,
  tags: [],
  recentRepos: [],

  openRepository: async (path: string) => {
    // Skip if this repo is already open
    if (get().repoPath === path && get().commits.length > 0) return;
    set({ isLoading: true, error: null });
    try {
      const name = await openRepo(path);
      set({ repoPath: path, repoName: name });
      await reloadRepoData(set);
      const [statuses, stashList, tagList] = await Promise.all([
        getFileStatus(),
        getStashes(),
        getTags(),
      ]);
      set({ isLoading: false, fileStatuses: statuses, stashes: stashList, tags: tagList });
      // Track in recent repos + save as last opened (fire-and-forget)
      Promise.all([
        addRecentRepo(path, name).then(() => get().loadRecentRepos()),
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
      set({ fileStatuses: statuses });
    } catch (e) {
      toast.error(String(e));
    }
  },

  checkout: async (name: string) => {
    const { currentBranch } = get();
    if (name === currentBranch) return;
    set({ isLoading: true, error: null });
    try {
      await checkoutBranch(name);
      await reloadRepoData(set);
      const statuses = await getFileStatus();
      set({ isLoading: false, fileStatuses: statuses });
      toast.success(`Checked out ${name}`);
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e));
    }
  },

  createBranch: async (name: string) => {
    try {
      await createBranchCmd(name);
      await reloadRepoData(set);
      const statuses = await getFileStatus();
      set({ fileStatuses: statuses });
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
      await reloadRepoData(set);
      set({ isLoading: false });
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
      await reloadRepoData(set);
      const statuses = await getFileStatus();
      set({ isLoading: false, fileStatuses: statuses });
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
      toast.error(String(e), { id: toastId });
    } finally {
      unlisten();
    }
  },

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

    try {
      const diff = await getFileDiff(path, staged);
      set({ activeDiff: diff });
    } catch (e) {
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

    try {
      const diff = await getCommitFileDiff(commitId, filePath);
      set({ activeDiff: diff });
    } catch (e) {
      toast.error(String(e));
    }
  },

  clearDiff: () => set({ activeDiff: null, largeDiffPending: null, selectedFilePath: null }),

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
    set({ largeDiffPending: { ...pending, loading: true } });
    try {
      let diff: FileDiff;
      if (pending.stashIndex !== undefined) {
        diff = await getStashFileDiff(pending.stashIndex, pending.path);
      } else if (pending.commitId) {
        diff = await getCommitFileDiff(pending.commitId, pending.path);
      } else {
        diff = await getFileDiff(pending.path, pending.staged ?? false);
      }
      set({ activeDiff: diff, largeDiffPending: null });
    } catch (e) {
      set({ largeDiffPending: null });
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

  commit: async (message, amend = false) => {
    if (!message.trim()) {
      toast.error("Commit message cannot be empty");
      return;
    }
    set({ isLoading: true });
    try {
      await createCommit(message, amend);
      await reloadRepoData(set);
      const statuses = await getFileStatus();
      set({
        isLoading: false,
        fileStatuses: statuses,
        commitMessage: "",
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

    try {
      const diff = await getStashFileDiff(index, filePath);
      set({ activeDiff: diff });
    } catch (e) {
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

  reloadAll: async () => {
    if (!get().repoPath) return;
    try {
      await reloadRepoData(set);
      const [statuses, stashList, tagList] = await Promise.all([
        getFileStatus(),
        getStashes(),
        getTags(),
      ]);
      set({ fileStatuses: statuses, stashes: stashList, tags: tagList });
    } catch {
      // Silently handle — these are background refreshes from the file watcher
    }
  },
}));

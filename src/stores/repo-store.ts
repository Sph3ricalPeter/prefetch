import { create } from "zustand";
import { toast } from "sonner";
import type {
  BranchInfo,
  CommitInfo,
  FileDiff,
  FileStatus,
  GraphEdge,
  StashInfo,
} from "@/types/git";
import {
  openRepo,
  getCommits,
  getBranches,
  checkoutBranch,
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
} from "@/lib/commands";

interface RepoState {
  repoPath: string | null;
  repoName: string | null;
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
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

  // Historical commit files
  commitFiles: FileStatus[];

  commitMessage: string;

  // Stash
  stashes: StashInfo[];
  selectedStashIndex: number | null;

  // Actions
  openRepository: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStatus: () => Promise<void>;
  checkout: (name: string) => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  selectCommit: (id: string | null) => Promise<void>;
  selectFile: (path: string, staged: boolean) => Promise<void>;
  selectCommitFile: (commitId: string, filePath: string) => Promise<void>;
  clearDiff: () => void;
  clearSelection: () => void;
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
}

async function reloadRepoData(set: (s: Partial<RepoState>) => void) {
  const [data, branchList] = await Promise.all([getCommits(), getBranches()]);
  const head = branchList.find((b) => b.is_head);
  set({
    commits: data.commits,
    edges: data.edges,
    totalLanes: data.total_lanes,
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
  branches: [],
  currentBranch: null,
  selectedCommitId: null,
  isLoading: false,
  error: null,
  fileStatuses: [],
  selectedFilePath: null,
  selectedFileStaged: false,
  activeDiff: null,
  commitFiles: [],
  commitMessage: "",
  stashes: [],
  selectedStashIndex: null,

  openRepository: async (path: string) => {
    // Skip if this repo is already open
    if (get().repoPath === path && get().commits.length > 0) return;
    set({ isLoading: true, error: null });
    try {
      const name = await openRepo(path);
      set({ repoPath: path, repoName: name });
      await reloadRepoData(set);
      const [statuses, stashList] = await Promise.all([
        getFileStatus(),
        getStashes(),
      ]);
      set({ isLoading: false, fileStatuses: statuses, stashes: stashList });
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

  fetch: async () => {
    set({ isLoading: true });
    const toastId = toast.loading("Fetching...");
    try {
      await fetchRepo();
      await reloadRepoData(set);
      set({ isLoading: false });
      toast.success("Fetch complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e), { id: toastId });
    }
  },

  pull: async () => {
    set({ isLoading: true });
    const toastId = toast.loading("Pulling...");
    try {
      await pullRepo();
      await reloadRepoData(set);
      const statuses = await getFileStatus();
      set({ isLoading: false, fileStatuses: statuses });
      toast.success("Pull complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e), { id: toastId });
    }
  },

  push: async () => {
    set({ isLoading: true });
    const toastId = toast.loading("Pushing...");
    try {
      await pushRepo();
      set({ isLoading: false });
      toast.success("Push complete", { id: toastId });
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e), { id: toastId });
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
    set({ selectedFilePath: path, selectedFileStaged: staged, selectedCommitId: null, commitFiles: [] });
    try {
      const diff = await getFileDiff(path, staged);
      set({ activeDiff: diff });
    } catch (e) {
      toast.error(String(e));
    }
  },

  selectCommitFile: async (commitId, filePath) => {
    set({ selectedFilePath: filePath });
    try {
      const diff = await getCommitFileDiff(commitId, filePath);
      set({ activeDiff: diff });
    } catch (e) {
      toast.error(String(e));
    }
  },

  clearDiff: () => set({ activeDiff: null, selectedFilePath: null }),

  clearSelection: () =>
    set({
      selectedCommitId: null,
      selectedStashIndex: null,
      selectedFilePath: null,
      activeDiff: null,
      commitFiles: [],
    }),

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
    set({ selectedFilePath: filePath });
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
}));

import { create } from "zustand";
import { toast } from "sonner";
import type {
  BranchInfo,
  CommitInfo,
  FileDiff,
  FileStatus,
  GraphEdge,
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

  fileStatuses: FileStatus[];
  selectedFilePath: string | null;
  selectedFileStaged: boolean;
  selectedFileDiff: FileDiff | null;
  commitMessage: string;

  openRepository: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStatus: () => Promise<void>;
  checkout: (name: string) => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  selectCommit: (id: string | null) => void;
  selectFile: (path: string, staged: boolean) => Promise<void>;
  clearFileSelection: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  commit: (message: string, amend?: boolean) => Promise<void>;
  setCommitMessage: (msg: string) => void;
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
    selectedCommitId: null,
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
  selectedFileDiff: null,
  commitMessage: "",

  openRepository: async (path: string) => {
    set({ isLoading: true, error: null });
    try {
      const name = await openRepo(path);
      set({ repoPath: path, repoName: name });
      await reloadRepoData(set);
      const statuses = await getFileStatus();
      set({ isLoading: false, fileStatuses: statuses });
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
      const { selectedFilePath, selectedFileStaged } = get();
      if (selectedFilePath) {
        const diff = await getFileDiff(selectedFilePath, selectedFileStaged);
        set({ selectedFileDiff: diff });
      }
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

  selectCommit: (id) =>
    set({ selectedCommitId: id, selectedFilePath: null, selectedFileDiff: null }),

  selectFile: async (path, staged) => {
    set({ selectedFilePath: path, selectedFileStaged: staged, selectedCommitId: null });
    try {
      const diff = await getFileDiff(path, staged);
      set({ selectedFileDiff: diff });
    } catch (e) {
      toast.error(String(e));
    }
  },

  clearFileSelection: () => set({ selectedFilePath: null, selectedFileDiff: null }),

  stage: async (paths) => {
    try {
      await stageFilesCmd(paths);
      await get().loadStatus();
    } catch (e) {
      toast.error(String(e));
    }
  },

  unstage: async (paths) => {
    try {
      await unstageFilesCmd(paths);
      await get().loadStatus();
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
        selectedFileDiff: null,
      });
      toast.success("Committed successfully");
    } catch (e) {
      set({ isLoading: false });
      toast.error(String(e));
    }
  },

  setCommitMessage: (msg) => set({ commitMessage: msg }),
}));

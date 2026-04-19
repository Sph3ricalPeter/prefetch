import { create } from "zustand";
import type { BranchInfo, CommitInfo, GraphEdge } from "@/types/git";
import {
  openRepo,
  getCommits,
  getBranches,
  checkoutBranch,
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

  openRepository: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  checkout: (name: string) => Promise<void>;
  selectCommit: (id: string | null) => void;
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

  openRepository: async (path: string) => {
    set({ isLoading: true, error: null });
    try {
      const name = await openRepo(path);
      const [data, branchList] = await Promise.all([
        getCommits(),
        getBranches(),
      ]);
      const head = branchList.find((b) => b.is_head);
      set({
        repoPath: path,
        repoName: name,
        commits: data.commits,
        edges: data.edges,
        totalLanes: data.total_lanes,
        branches: branchList,
        currentBranch: head?.name ?? null,
        isLoading: false,
        selectedCommitId: null,
      });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  loadBranches: async () => {
    try {
      const branchList = await getBranches();
      const head = branchList.find((b) => b.is_head);
      set({
        branches: branchList,
        currentBranch: head?.name ?? null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  checkout: async (name: string) => {
    const { currentBranch } = get();
    if (name === currentBranch) return;

    set({ isLoading: true, error: null });
    try {
      await checkoutBranch(name);
      // Reload branches and commits after checkout
      const [data, branchList] = await Promise.all([
        getCommits(),
        getBranches(),
      ]);
      const head = branchList.find((b) => b.is_head);
      set({
        commits: data.commits,
        edges: data.edges,
        totalLanes: data.total_lanes,
        branches: branchList,
        currentBranch: head?.name ?? null,
        isLoading: false,
        selectedCommitId: null,
      });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  selectCommit: (id) => set({ selectedCommitId: id }),
}));

import { create } from "zustand";
import type { CommitInfo, GraphEdge } from "@/types/git";
import { openRepo, getCommits } from "@/lib/commands";

interface RepoState {
  repoPath: string | null;
  repoName: string | null;
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  selectedCommitId: string | null;
  isLoading: boolean;
  error: string | null;

  openRepository: (path: string) => Promise<void>;
  selectCommit: (id: string | null) => void;
}

export const useRepoStore = create<RepoState>()((set) => ({
  repoPath: null,
  repoName: null,
  commits: [],
  edges: [],
  totalLanes: 0,
  selectedCommitId: null,
  isLoading: false,
  error: null,

  openRepository: async (path: string) => {
    set({ isLoading: true, error: null });
    try {
      const name = await openRepo(path);
      const data = await getCommits();
      set({
        repoPath: path,
        repoName: name,
        commits: data.commits,
        edges: data.edges,
        totalLanes: data.total_lanes,
        isLoading: false,
        selectedCommitId: null,
      });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  selectCommit: (id) => set({ selectedCommitId: id }),
}));

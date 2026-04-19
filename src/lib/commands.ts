import { invoke } from "@tauri-apps/api/core";
import type { BranchInfo, GraphData } from "@/types/git";

export async function openRepo(path: string): Promise<string> {
  return invoke<string>("open_repo", { path });
}

export async function getCommits(limit?: number): Promise<GraphData> {
  return invoke<GraphData>("get_commits", { limit });
}

export async function getBranches(): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("get_branches");
}

export async function checkoutBranch(name: string): Promise<void> {
  return invoke<void>("checkout_branch", { name });
}

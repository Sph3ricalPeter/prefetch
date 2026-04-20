import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  FileDiff,
  FileStatus,
  GraphData,
  StashInfo,
  TagInfo,
} from "@/types/git";

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

export async function createBranchCmd(name: string): Promise<void> {
  return invoke<void>("create_branch", { name });
}

export async function fetchRepo(): Promise<string> {
  return invoke<string>("fetch_repo");
}

export async function pullRepo(): Promise<string> {
  return invoke<string>("pull_repo");
}

export async function pushRepo(): Promise<string> {
  return invoke<string>("push_repo");
}

export async function getFileStatus(): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_file_status");
}

export async function getFileDiff(
  filePath: string,
  staged: boolean,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_file_diff", { filePath, staged });
}

export async function discardFiles(paths: string[]): Promise<void> {
  return invoke<void>("discard_files", { paths });
}

export async function discardAllChanges(): Promise<void> {
  return invoke<void>("discard_all_changes");
}

export async function stageFiles(paths: string[]): Promise<void> {
  return invoke<void>("stage_files", { paths });
}

export async function unstageFiles(paths: string[]): Promise<void> {
  return invoke<void>("unstage_files", { paths });
}

export async function createCommit(
  message: string,
  amend: boolean,
): Promise<string> {
  return invoke<string>("create_commit", { message, amend });
}

export async function getCommitFiles(commitId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_commit_files", { commitId });
}

export async function getCommitFileDiff(
  commitId: string,
  filePath: string,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_commit_file_diff", { commitId, filePath });
}

export async function getStashes(): Promise<StashInfo[]> {
  return invoke<StashInfo[]>("get_stashes");
}

export async function stashPush(message?: string): Promise<string> {
  return invoke<string>("stash_save", { message: message ?? null });
}

export async function stashPop(index: number): Promise<string> {
  return invoke<string>("stash_pop", { index });
}

export async function stashDrop(index: number): Promise<string> {
  return invoke<string>("stash_drop", { index });
}

export async function getStashFiles(index: number): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_stash_files", { index });
}

export async function getStashFileDiff(
  index: number,
  filePath: string,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_stash_file_diff", { index, filePath });
}

export async function getTags(): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("get_tags");
}

export async function createTagCmd(
  name: string,
  commit?: string,
  message?: string,
): Promise<string> {
  return invoke<string>("create_tag", {
    name,
    commit: commit ?? null,
    message: message ?? null,
  });
}

export async function deleteTagCmd(name: string): Promise<string> {
  return invoke<string>("delete_tag", { name });
}

export async function pushTagCmd(name: string): Promise<string> {
  return invoke<string>("push_tag", { name });
}

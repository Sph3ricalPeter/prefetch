import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  ConflictContents,
  ConflictState,
  FileDiff,
  FileStatus,
  ForgeStatus,
  GitIdentity,
  GraphData,
  LfsInfo,
  PrInfo,
  RebaseProgress,
  StashInfo,
  TagInfo,
  UndoAction,
} from "@/types/git";
import type { ActiveProfileConfig } from "@/types/profile";
import { traceIpc } from "@/lib/tracing";

/** Traced invoke — wraps every IPC call with performance marks. */
async function tracedInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const end = traceIpc(command);
  try {
    return await invoke<T>(command, args);
  } finally {
    try { end(); } catch { /* perf cleanup is best-effort */ }
  }
}

export async function openRepo(path: string): Promise<string> {
  return tracedInvoke<string>("open_repo", { path });
}

export async function getCommits(limit?: number): Promise<GraphData> {
  return tracedInvoke<GraphData>("get_commits", { limit });
}

export async function getBranches(): Promise<BranchInfo[]> {
  return tracedInvoke<BranchInfo[]>("get_branches");
}

export async function checkoutBranch(name: string): Promise<void> {
  return tracedInvoke<void>("checkout_branch", { name });
}

export async function forceCheckoutBranch(name: string): Promise<void> {
  return tracedInvoke<void>("force_checkout_branch", { name });
}

export async function resetBranchToRemote(
  branch: string,
  remoteRef: string,
): Promise<void> {
  return tracedInvoke<void>("reset_branch_to_remote", { branch, remoteRef });
}

export async function createBranchCmd(name: string): Promise<void> {
  return tracedInvoke<void>("create_branch", { name });
}

export async function fetchRepo(): Promise<string> {
  return tracedInvoke<string>("fetch_repo");
}

export async function pullRepo(): Promise<string> {
  return tracedInvoke<string>("pull_repo");
}

export async function pushRepo(): Promise<string> {
  return tracedInvoke<string>("push_repo");
}

export async function forcePushRepo(): Promise<string> {
  return tracedInvoke<string>("force_push_repo");
}

export async function getFileStatus(): Promise<FileStatus[]> {
  return tracedInvoke<FileStatus[]>("get_file_status");
}

export async function getFileDiff(
  filePath: string,
  staged: boolean,
): Promise<FileDiff> {
  return tracedInvoke<FileDiff>("get_file_diff", { filePath, staged });
}

export async function discardFiles(paths: string[]): Promise<void> {
  return tracedInvoke<void>("discard_files", { paths });
}

export async function discardAllChanges(): Promise<void> {
  return tracedInvoke<void>("discard_all_changes");
}

export async function stageFiles(paths: string[]): Promise<void> {
  return tracedInvoke<void>("stage_files", { paths });
}

export async function unstageFiles(paths: string[]): Promise<void> {
  return tracedInvoke<void>("unstage_files", { paths });
}

export async function stagePatch(patch: string): Promise<void> {
  return tracedInvoke<void>("stage_patch", { patch });
}

export async function unstagePatch(patch: string): Promise<void> {
  return tracedInvoke<void>("unstage_patch", { patch });
}

export async function getConflictContents(filePath: string): Promise<ConflictContents> {
  return tracedInvoke<ConflictContents>("get_conflict_contents", { filePath });
}

export async function resolveConflictManual(filePath: string, content: string): Promise<void> {
  return tracedInvoke<void>("resolve_conflict_manual", { filePath, content });
}

export async function createCommit(
  message: string,
  amend: boolean,
): Promise<string> {
  return tracedInvoke<string>("create_commit", { message, amend });
}

export async function getCommitFiles(commitId: string): Promise<FileStatus[]> {
  return tracedInvoke<FileStatus[]>("get_commit_files", { commitId });
}

export async function getCommitFileDiff(
  commitId: string,
  filePath: string,
): Promise<FileDiff> {
  return tracedInvoke<FileDiff>("get_commit_file_diff", { commitId, filePath });
}

export async function getStashes(): Promise<StashInfo[]> {
  return tracedInvoke<StashInfo[]>("get_stashes");
}

export async function stashPush(message?: string): Promise<string> {
  return tracedInvoke<string>("stash_save", { message: message ?? null });
}

export async function stashPop(index: number): Promise<string> {
  return tracedInvoke<string>("stash_pop", { index });
}

export async function stashDrop(index: number): Promise<string> {
  return tracedInvoke<string>("stash_drop", { index });
}

export async function stashApply(index: number): Promise<string> {
  return tracedInvoke<string>("stash_apply", { index });
}

export async function getStashFiles(index: number): Promise<FileStatus[]> {
  return tracedInvoke<FileStatus[]>("get_stash_files", { index });
}

export async function getStashFileDiff(
  index: number,
  filePath: string,
): Promise<FileDiff> {
  return tracedInvoke<FileDiff>("get_stash_file_diff", { index, filePath });
}

export async function getTags(): Promise<TagInfo[]> {
  return tracedInvoke<TagInfo[]>("get_tags");
}

export async function createTagCmd(
  name: string,
  commit?: string,
  message?: string,
): Promise<string> {
  return tracedInvoke<string>("create_tag", {
    name,
    commit: commit ?? null,
    message: message ?? null,
  });
}

export async function deleteTagCmd(name: string): Promise<string> {
  return tracedInvoke<string>("delete_tag", { name });
}

export async function pushTagCmd(name: string): Promise<string> {
  return tracedInvoke<string>("push_tag", { name });
}

export async function getUndoAction(): Promise<UndoAction> {
  return tracedInvoke<UndoAction>("get_undo_action");
}

export async function undoLast(): Promise<string> {
  return tracedInvoke<string>("undo_last");
}

export async function resolveConflictOurs(filePath: string): Promise<void> {
  return tracedInvoke<void>("resolve_conflict_ours", { filePath });
}

export async function resolveConflictTheirs(filePath: string): Promise<void> {
  return tracedInvoke<void>("resolve_conflict_theirs", { filePath });
}

export async function resetToCommit(
  commitId: string,
  mode: string,
): Promise<string> {
  return tracedInvoke<string>("reset_to_commit", { commitId, mode });
}

export async function cherryPickCommit(commitId: string): Promise<string> {
  return tracedInvoke<string>("cherry_pick", { commitId });
}

export async function rebaseOnto(target: string): Promise<string> {
  return tracedInvoke<string>("rebase_onto", { target });
}

export async function mergeBranch(target: string): Promise<string> {
  return tracedInvoke<string>("merge_branch", { target });
}

export async function getMergeMessage(): Promise<string> {
  return tracedInvoke<string>("get_merge_message");
}

export async function deleteBranch(name: string, force: boolean): Promise<string> {
  return tracedInvoke<string>("delete_branch", { name, force });
}

export async function getConflictState(): Promise<ConflictState> {
  return tracedInvoke<ConflictState>("get_conflict_state");
}

export async function getRebaseProgress(): Promise<RebaseProgress> {
  return tracedInvoke<RebaseProgress>("get_rebase_progress");
}

export async function abortOperation(): Promise<string> {
  return tracedInvoke<string>("abort_operation");
}

export async function continueOperation(
  message?: string,
): Promise<string> {
  return tracedInvoke<string>("continue_operation", { message: message ?? null });
}

// ── Context menu actions (v0.6) ──────────────────────────────────────────────

export async function revertCommit(commitId: string): Promise<string> {
  return tracedInvoke<string>("revert_commit", { commitId });
}

export async function checkoutDetached(commitId: string): Promise<string> {
  return tracedInvoke<string>("checkout_detached", { commitId });
}

export async function createBranchAt(name: string, commitId: string): Promise<void> {
  return tracedInvoke<void>("create_branch_at", { name, commitId });
}

export async function renameBranchCmd(oldName: string, newName: string): Promise<string> {
  return tracedInvoke<string>("rename_branch", { oldName, newName });
}

export async function deleteRemoteBranch(remote: string, branch: string): Promise<string> {
  return tracedInvoke<string>("delete_remote_branch", { remote, branch });
}

export async function setUpstream(remoteBranch: string): Promise<string> {
  return tracedInvoke<string>("set_upstream", { remoteBranch });
}

export async function stashPushFiles(paths: string[], message?: string): Promise<string> {
  return tracedInvoke<string>("stash_push_files", { paths, message: message ?? null });
}

export async function showInFolder(filePath: string): Promise<void> {
  return tracedInvoke<void>("show_in_folder", { filePath });
}

export async function openInDefaultEditor(filePath: string): Promise<void> {
  return tracedInvoke<void>("open_in_default_editor", { filePath });
}

export async function deleteFileCmd(filePath: string): Promise<void> {
  return tracedInvoke<void>("delete_file", { filePath });
}

// ── Git identity ─────────────────────────────────────────────────────────────

export async function getGitIdentity(): Promise<GitIdentity> {
  return tracedInvoke<GitIdentity>("get_git_identity");
}

// ── Forge (GitHub / GitLab) ───────────────────────────────────────────────────

export async function getForgeStatus(): Promise<ForgeStatus> {
  return tracedInvoke<ForgeStatus>("get_forge_status");
}

export async function saveForgeToken(host: string, token: string, profileId?: string): Promise<void> {
  return tracedInvoke<void>("save_forge_token", { host, token, profileId });
}

export async function deleteForgeToken(host: string, profileId?: string): Promise<void> {
  return tracedInvoke<void>("delete_forge_token", { host, profileId });
}

export async function checkProfileToken(profileId: string, host: string): Promise<boolean> {
  return tracedInvoke<boolean>("check_profile_token", { profileId, host });
}

export async function getPrForBranch(branch: string): Promise<PrInfo | null> {
  return tracedInvoke<PrInfo | null>("get_pr_for_branch", { branch });
}

export async function clearPrCache(): Promise<void> {
  return tracedInvoke<void>("clear_pr_cache");
}

// ── OAuth ───────────────────────────────────────────────────────────────────

export interface OAuthResult {
  host: string;
  success: boolean;
}

export async function startOAuthFlow(
  provider: "github" | "gitlab",
  profileId?: string,
): Promise<OAuthResult> {
  return tracedInvoke<OAuthResult>("start_oauth_flow", { provider, profileId });
}

export async function cancelOAuthFlow(): Promise<void> {
  return tracedInvoke<void>("cancel_oauth_flow");
}

export async function openUrl(url: string): Promise<void> {
  return tracedInvoke<void>("open_url", { url });
}

// ── LFS ───────────────────────────────────────────────────────────────────────

/** Lightweight check — pure file reads, <1ms. Use at repo open. */
export async function lfsCheckInitialized(): Promise<LfsInfo> {
  return tracedInvoke<LfsInfo>("lfs_check_initialized");
}

/** Full LFS details — spawns git lfs subprocesses, 2-5s. Use on-demand only. */
export async function lfsGetInfo(): Promise<LfsInfo> {
  return tracedInvoke<LfsInfo>("lfs_get_info");
}

export async function lfsInitialize(): Promise<string> {
  return tracedInvoke<string>("lfs_initialize");
}

export async function lfsTrackPattern(pattern: string): Promise<string> {
  return tracedInvoke<string>("lfs_track_pattern", { pattern });
}

export async function lfsUntrackPattern(pattern: string): Promise<string> {
  return tracedInvoke<string>("lfs_untrack_pattern", { pattern });
}

export async function lfsPruneObjects(): Promise<string> {
  return tracedInvoke<string>("lfs_prune_objects");
}

// ── Profiles ────────────────────────────────────────────────────────────────

export async function setActiveProfileCmd(
  profile: ActiveProfileConfig | null,
): Promise<void> {
  return tracedInvoke<void>("set_active_profile", { profile });
}

export async function getActiveProfileCmd(): Promise<ActiveProfileConfig | null> {
  return tracedInvoke<ActiveProfileConfig | null>("get_active_profile");
}

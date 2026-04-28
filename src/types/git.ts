export interface CommitInfo {
  id: string;
  short_id: string;
  message: string;
  body: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  parent_ids: string[];
  co_authors: CoAuthor[];
  lane: number;
}

export interface CoAuthor {
  name: string;
  email: string;
}

export type EdgeType = "Straight" | "Merge";

export interface GraphEdge {
  from_row: number;
  from_lane: number;
  to_row: number;
  to_lane: number;
  edge_type: EdgeType;
}

export interface GraphData {
  commits: CommitInfo[];
  edges: GraphEdge[];
  total_lanes: number;
  /** The commit SHA that HEAD currently points to (works for both branch and detached HEAD). */
  head_commit_id: string | null;
}

export interface BranchInfo {
  name: string;
  is_remote: boolean;
  is_head: boolean;
  commit_id: string;
  short_commit_id: string;
  /** Commits ahead of upstream (null if no upstream or remote branch). */
  ahead: number | null;
  /** Commits behind upstream (null if no upstream or remote branch). */
  behind: number | null;
}

/** Porcelain status codes returned by the Rust backend. */
export type StatusType =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "type_change";

export type ConflictType =
  | "both_modified"
  | "both_added"
  | "both_deleted"
  | "deleted_by_us"
  | "deleted_by_them"
  | "added_by_us"
  | "added_by_them";

export interface FileStatus {
  path: string;
  status_type: StatusType;
  is_staged: boolean;
  additions: number | null;
  deletions: number | null;
  is_conflicted: boolean;
  conflict_type: ConflictType | null;
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  is_binary: boolean;
}

export interface DiffHunk {
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  origin: string;
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
}

export interface StashInfo {
  index: number;
  message: string;
  commit_id: string;
  parent_commit_id: string;
}

export interface TagInfo {
  name: string;
  commit_id: string;
  message: string | null;
}

export interface ConflictContents {
  /** Base (common ancestor) — null if file didn't exist in base */
  base: string | null;
  /** Ours (current branch version) */
  ours: string;
  /** Theirs (incoming branch version) */
  theirs: string;
  /** Short commit hash for ours (HEAD) */
  ours_commit_id: string;
  /** Short commit hash for theirs (MERGE_HEAD / REBASE_HEAD) */
  theirs_commit_id: string;
  /** Branch name for ours (current branch) */
  ours_branch: string;
  /** Branch or ref name for theirs (incoming) */
  theirs_branch: string;
}

export interface HunkLineSelection {
  hunkIndex: number;
  lineIndex: number;
}

export type ConflictOperation = "rebase" | "cherry-pick" | "merge" | "";

export interface ConflictState {
  in_progress: boolean;
  operation: ConflictOperation;
}

export interface RebaseProgress {
  /** Current step (1-based) */
  step: number;
  /** Total number of steps */
  total: number;
  /** Original commit message for the current step */
  message: string;
  /** Short commit hash for the current step */
  commit_id: string;
}

export interface UndoAction {
  description: string;
  can_undo: boolean;
}

// ── Forge (GitHub / GitLab) ───────────────────────────────────────────────────

export type PrState = "open" | "closed" | "merged" | "opened";

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: PrState;
}

export type ForgeKind = "github" | "gitlab";

export interface ForgeStatus {
  kind: ForgeKind | null;
  host: string | null;
  owner: string | null;
  repo: string | null;
  has_token: boolean;
}

// ── LFS ───────────────────────────────────────────────────────────────────────

export interface LfsTrackPattern {
  pattern: string;
  /** Which .gitattributes file (usually ".gitattributes") */
  source: string;
}

export interface LfsFileInfo {
  oid: string;
  path: string;
  /** Size of the actual object in bytes */
  size: number;
}

export interface LfsInfo {
  /** Whether the git-lfs binary is on PATH */
  installed: boolean;
  /** Whether LFS hooks are installed in this repo */
  initialized: boolean;
  /** Version string, e.g. "git-lfs/3.5.1 ..." */
  version: string | null;
  tracked_patterns: LfsTrackPattern[];
  file_count: number;
  /** Total byte size of all LFS objects */
  total_size: number;
}

// ── Git identity ─────────────────────────────────────────────────────────────

export type IdentitySource = "local" | "global" | "system" | "unknown" | "profile";

export interface GitIdentity {
  name: string;
  email: string;
  source: IdentitySource;
}

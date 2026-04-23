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

export interface FileStatus {
  path: string;
  status_type: string;
  is_staged: boolean;
  additions: number | null;
  deletions: number | null;
  is_conflicted: boolean;
  /** "both_modified", "both_added", "deleted_by_us", "deleted_by_them", etc. */
  conflict_type: string | null;
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
}

export interface TagInfo {
  name: string;
  commit_id: string;
  message: string | null;
}

export interface ConflictState {
  in_progress: boolean;
  /** "rebase", "cherry-pick", "merge", or "" */
  operation: string;
}

export interface UndoAction {
  description: string;
  can_undo: boolean;
}

// ── Forge (GitHub / GitLab) ───────────────────────────────────────────────────

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  /** "open" | "closed" | "merged" | "opened" */
  state: string;
}

export interface ForgeStatus {
  /** "github" | "gitlab" | null */
  kind: string | null;
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

export interface GitIdentity {
  name: string;
  email: string;
  /** Where the identity was resolved from: "local" | "global" | "system" | "unknown" */
  source: string;
}

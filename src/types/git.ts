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
  /** True when HEAD is an ancestor — rebasing would be a fast-forward. */
  can_fast_forward: boolean;
  /** Short upstream ref name, e.g. "origin/main". Null for remote branches or locals without an upstream. */
  upstream_name: string | null;
  /** Path of the linked worktree holding this branch, when it isn't the open one.
   *  Set means git refuses both checkout and delete for this branch. */
  worktree_path: string | null;
}

export interface WorktreeInfo {
  /** Path as git reports it — forward slashes, even on Windows. */
  path: string;
  head: string;
  /** Branch shorthand, or null for a detached HEAD. */
  branch: string | null;
  /** The worktree the app currently has open. */
  is_current: boolean;
  /** The repository's main worktree (git lists it first). */
  is_main: boolean;
  /** Lock reason when locked. Empty string means locked without a reason. */
  locked: string | null;
  /** Prune reason when the worktree's directory has gone missing. */
  prunable: string | null;
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
  /** For renames/copies: the pre-rename path. `path` is always the new path. */
  old_path: string | null;
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
  is_truncated: boolean;
  total_lines: number;
}

/** One object-level change in a Unity YAML asset (see `git/unity_yaml.rs`). */
export interface UnityObjectChange {
  /** Hierarchy path of the owning GameObject / prefab instance */
  path: string;
  /** `GameObject`, `Transform`, script name, `Prefab <name>`, ... */
  type_name: string;
  /** Unity class (`Transform`, `MonoBehaviour`, `PrefabInstance`, ...), for the icon */
  class_name: string;
  kind: "added" | "removed" | "modified";
  props: UnityPropChange[];
}

export interface UnityPropChange {
  /** Raw serialized path, e.g. `m_SavedProperties.m_Floats._Glossiness` */
  key: string;
  /** Inspector-style name (shader display name or nicified key) */
  label: string;
  /** Inspector-like group within the object; empty for none */
  section: string;
  /** Known from the shader; vectors/colors are otherwise inferred from the value */
  value_type: "float" | "range" | "toggle" | "color" | "vector2" | "vector3" | "vector4" | "texture" | null;
  range: [number, number] | null;
  /** False for unchanged context, shown when the object is expanded */
  changed: boolean;
  old: string | null;
  new: string | null;
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
  /** During rebase: subject line of the commit being replayed */
  rebase_commit_message: string | null;
  /** True when the conflicted file is binary; text fields are empty and the UI
   *  shows a binary resolver instead of the line-by-line conflict editor. */
  is_binary: boolean;
  /** Base64 "ours" blob for image preview (binary image files only). */
  ours_image: string | null;
  /** Base64 "theirs" blob for image preview (binary image files only). */
  theirs_image: string | null;
}

export interface HunkLineSelection {
  hunkIndex: number;
  lineIndex: number;
}

export type ConflictOperation = "rebase" | "cherry-pick" | "revert" | "merge" | "";

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

/** What rewording a commit would rewrite — shown before the user confirms. */
export interface RewordImpact {
  /** Why the commit can't be reworded, or null if it can. */
  blocker: string | null;
  /** How many commits get rewritten (the target plus everything after it). */
  commit_count: number;
  /** Remote-tracking branches containing the commit — a force push is needed. */
  pushed_to: string[];
  /** Other local branches/tags containing it, which would keep the old commits. */
  stranded_refs: string[];
}

// ── Forge (GitHub / GitLab) ───────────────────────────────────────────────────

export type PrState = "open" | "closed" | "merged" | "opened";

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: PrState;
}

export type ForgeKind = "github" | "gitlab" | "bitbucket";

export interface ForgeStatus {
  kind: ForgeKind | null;
  host: string | null;
  owner: string | null;
  repo: string | null;
  has_token: boolean;
}

export interface ForgeRepo {
  name: string;
  full_name: string;
  clone_url_https: string;
  clone_url_ssh: string | null;
  description: string | null;
  is_private: boolean;
  updated_at: string;
}

// ── CI / Pipelines ────────────────────────────────────────────────────────────

export type PipelineStatus =
  | "queued"
  | "in_progress"
  | "success"
  | "warning"
  | "failure"
  | "cancelled"
  | "unknown";

export interface Pipeline {
  id: number;
  /** Workflow name (GitHub Actions) or null (GitLab). */
  name: string | null;
  /** What triggered this pipeline — e.g. "push", "pull_request", "schedule", "merge_request_event". */
  source: string | null;
  /** Name of the schedule that triggered this pipeline (latest run per schedule only; GitLab). */
  schedule_name: string | null;
  status: PipelineStatus;
  branch: string;
  commit_sha: string;
  created_at: string;
  updated_at: string | null;
  duration_secs: number | null;
  url: string;
}

export interface CiJob {
  id: number;
  name: string;
  status: PipelineStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_secs: number | null;
  /** Same-project child pipeline this (GitLab trigger) job started; its jobs are in the jobs map under this id. */
  child_pipeline_id: number | null;
  /** Web URL of any downstream pipeline (child or multi-project). */
  child_pipeline_url: string | null;
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

/** Change Brief — the intent behind a set of changes (see `git/brief.rs`). */
export interface Brief {
  version: number;
  /** Draft file stem; identifies the agent session. */
  session: string;
  /** Lead intent. Its `files` are unused. */
  intent: BriefIntent;
  intents: BriefIntent[];
  /** Optional tracker issues; empty when the repo uses none. */
  issues: BriefIssue[];
  /** Written by Prefetch from the diff alone, not by the agent that did the work. */
  inferred?: boolean;
}

export interface BriefIntent {
  title: string;
  why: string;
  /** `sub` | `enabling` | `unrelated` — free-form from the agent, unknown reads as `sub`. */
  kind: string;
  /** Repo-relative paths. */
  files: string[];
  /** Conventional-commit type (`fix`, `feat`, ...), when the agent gave one. */
  type?: string;
  risk?: BriefRisk;
  /** Derived by Prefetch from `risk` and `.prefetch/risk.json`; absent when unassessed. */
  tier?: RiskTier;
  /** The tier was raised by a `.prefetch/risk.json` rule, not the risk answers. */
  pinned?: boolean;
}

export type RiskTier = "low" | "mid" | "high";

/** One intent of a commit's brief note, as the graph needs it for heat. */
export interface IntentMark {
  tier: RiskTier | null;
  oneWay: boolean;
}

/** The agent's yes/no answers to the skill's risk questions. */
export interface BriefRisk {
  shared: boolean;
  data: boolean;
  external: boolean;
  contract: boolean;
  tested: boolean;
  /** `git revert` would not fully undo it. */
  oneWay: boolean;
  why: string;
}

export interface BriefIssue {
  id: string;
  title: string;
  url: string;
  criteria: string[];
}

export interface WipBriefs {
  briefs: Brief[];
  /** `file.json: reason` for drafts that didn't parse. */
  errors: string[];
}

export interface CommitSuggestion {
  subject: string;
  /** Empty unless a Change Brief supplied the intent. */
  body: string;
}

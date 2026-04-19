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
}

export interface BranchInfo {
  name: string;
  is_remote: boolean;
  is_head: boolean;
  commit_id: string;
  short_commit_id: string;
}

export interface FileStatus {
  path: string;
  status_type: string;
  is_staged: boolean;
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

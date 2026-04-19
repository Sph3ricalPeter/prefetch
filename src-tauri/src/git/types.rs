use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parent_ids: Vec<String>,
    pub co_authors: Vec<CoAuthor>,
    pub lane: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoAuthor {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub from_row: usize,
    pub from_lane: usize,
    pub to_row: usize,
    pub to_lane: usize,
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize)]
pub enum EdgeType {
    Straight,
    Merge,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub commits: Vec<CommitInfo>,
    pub edges: Vec<GraphEdge>,
    pub total_lanes: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub commit_id: String,
    pub short_commit_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status_type: String, // "modified", "added", "deleted", "renamed", "untracked"
    pub is_staged: bool,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub origin: char,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StashInfo {
    pub index: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub commit_id: String,
    pub message: Option<String>,
}

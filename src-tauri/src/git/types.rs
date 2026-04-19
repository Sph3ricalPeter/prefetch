use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parent_ids: Vec<String>,
    pub lane: usize,
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

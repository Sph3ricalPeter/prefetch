export interface CommitInfo {
  id: string;
  short_id: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  parent_ids: string[];
  lane: number;
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

use crate::git::types::{CommitInfo, EdgeType, GraphEdge};
use std::collections::HashMap;

/// Assign lanes to commits and compute graph edges.
///
/// Commits must be in topological order (children before parents).
/// Mutates `lane` on each CommitInfo in-place.
/// Returns (edges, total_lane_count).
pub fn assign_lanes(commits: &mut [CommitInfo]) -> (Vec<GraphEdge>, usize) {
    if commits.is_empty() {
        return (vec![], 0);
    }

    // Map from commit id -> row index for quick lookup (owned keys to avoid borrow conflict)
    let id_to_row: HashMap<String, usize> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c.id.clone(), i))
        .collect();

    // active_lanes[i] = Some(commit_id) means lane i expects that commit next
    let mut active_lanes: Vec<Option<String>> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut max_lane: usize = 0;

    #[allow(clippy::needless_range_loop)]
    for row in 0..commits.len() {
        let commit_id = commits[row].id.clone();
        let parent_ids = commits[row].parent_ids.clone();

        // Find which lane expects this commit
        let lane = find_lane_for_commit(&active_lanes, &commit_id);

        let assigned_lane = match lane {
            Some(l) => {
                // This lane was expecting us — claim it
                active_lanes[l] = None;
                l
            }
            None => {
                // No lane expects us — allocate the leftmost free lane or a new one
                allocate_free_lane(&mut active_lanes)
            }
        };

        commits[row].lane = assigned_lane;
        if assigned_lane >= max_lane {
            max_lane = assigned_lane + 1;
        }

        // Handle parents
        if let Some(first_parent) = parent_ids.first() {
            // First parent continues this commit's lane
            active_lanes[assigned_lane] = Some(first_parent.clone());

            // Create edge from this commit to the first parent
            if let Some(&parent_row) = id_to_row.get(first_parent) {
                edges.push(GraphEdge {
                    from_row: row,
                    from_lane: assigned_lane,
                    to_row: parent_row,
                    to_lane: assigned_lane, // will be corrected when parent is processed
                    edge_type: EdgeType::Straight,
                });
            }

            // Additional parents (merge commits) get their own lanes
            for merge_parent in parent_ids.iter().skip(1) {
                let merge_lane = allocate_free_lane(&mut active_lanes);
                active_lanes[merge_lane] = Some(merge_parent.clone());
                if merge_lane >= max_lane {
                    max_lane = merge_lane + 1;
                }

                if let Some(&parent_row) = id_to_row.get(merge_parent) {
                    edges.push(GraphEdge {
                        from_row: row,
                        from_lane: assigned_lane,
                        to_row: parent_row,
                        to_lane: merge_lane,
                        edge_type: EdgeType::Merge,
                    });
                }
            }
        } else {
            // Root commit — no parents, free the lane
            active_lanes[assigned_lane] = None;
        }
    }

    // Fix edge to_lane: when we created edges, we didn't know the parent's
    // assigned lane yet. Now that all lanes are assigned, correct the to_lane
    // to match the parent's actual lane.
    for edge in &mut edges {
        if edge.to_row < commits.len() {
            edge.to_lane = commits[edge.to_row].lane;
            // Update edge type based on whether lanes differ
            if edge.from_lane != edge.to_lane {
                edge.edge_type = EdgeType::Merge;
            }
        }
    }

    (edges, max_lane)
}

/// Find the lane that is expecting a specific commit id
fn find_lane_for_commit(active_lanes: &[Option<String>], commit_id: &str) -> Option<usize> {
    active_lanes
        .iter()
        .position(|slot| slot.as_deref() == Some(commit_id))
}

/// Find the leftmost free lane, or allocate a new one
fn allocate_free_lane(active_lanes: &mut Vec<Option<String>>) -> usize {
    if let Some(pos) = active_lanes.iter().position(|slot| slot.is_none()) {
        pos
    } else {
        active_lanes.push(None);
        active_lanes.len() - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_commit(id: &str, parent_ids: &[&str]) -> CommitInfo {
        CommitInfo {
            id: id.to_string(),
            short_id: id[..1].to_string(),
            message: format!("Commit {id}"),
            author_name: "Test".to_string(),
            author_email: "test@test.com".to_string(),
            timestamp: 0,
            parent_ids: parent_ids.iter().map(|s| s.to_string()).collect(),
            lane: 0,
        }
    }

    #[test]
    fn test_linear_history() {
        // A -> B -> C (topological: A, B, C — newest first)
        let mut commits = vec![
            make_commit("aaa", &["bbb"]),
            make_commit("bbb", &["ccc"]),
            make_commit("ccc", &[]),
        ];

        let (edges, total_lanes) = assign_lanes(&mut commits);

        // All commits should be in lane 0
        assert_eq!(commits[0].lane, 0);
        assert_eq!(commits[1].lane, 0);
        assert_eq!(commits[2].lane, 0);
        assert_eq!(total_lanes, 1);

        // Two edges: A->B and B->C, both straight
        assert_eq!(edges.len(), 2);
        for edge in &edges {
            assert_eq!(edge.from_lane, edge.to_lane);
        }
    }

    #[test]
    fn test_branch() {
        // A (main) and B (feature) both have parent C
        // Topological: A, B, C
        let mut commits = vec![
            make_commit("aaa", &["ccc"]),
            make_commit("bbb", &["ccc"]),
            make_commit("ccc", &[]),
        ];

        let (edges, total_lanes) = assign_lanes(&mut commits);

        // A should be lane 0, B should be lane 1 (or vice versa)
        assert_ne!(commits[0].lane, commits[1].lane);
        assert!(total_lanes >= 2);
        assert_eq!(edges.len(), 2);
    }

    #[test]
    fn test_merge() {
        // M merges A and B. A has parent C, B has parent C.
        // Topological: M, A, B, C  (or M, B, A, C)
        let mut commits = vec![
            make_commit("mmm", &["aaa", "bbb"]), // merge commit
            make_commit("aaa", &["ccc"]),
            make_commit("bbb", &["ccc"]),
            make_commit("ccc", &[]),
        ];

        let (edges, total_lanes) = assign_lanes(&mut commits);

        // M should have two edges: one to A (straight), one to B (merge)
        assert!(total_lanes >= 2);
        assert!(edges.len() >= 3); // M->A, M->B, A->C, B->C
    }

    #[test]
    fn test_single_commit() {
        let mut commits = vec![make_commit("aaa", &[])];

        let (edges, total_lanes) = assign_lanes(&mut commits);

        assert_eq!(commits[0].lane, 0);
        assert_eq!(total_lanes, 1);
        assert_eq!(edges.len(), 0);
    }

    #[test]
    fn test_empty() {
        let mut commits: Vec<CommitInfo> = vec![];
        let (edges, total_lanes) = assign_lanes(&mut commits);

        assert_eq!(total_lanes, 0);
        assert_eq!(edges.len(), 0);
    }

    #[test]
    fn test_diamond_merge() {
        // D merges B and C. B has parent A. C has parent A.
        // Topological: D, B, C, A
        let mut commits = vec![
            make_commit("ddd", &["bbb", "ccc"]),
            make_commit("bbb", &["aaa"]),
            make_commit("ccc", &["aaa"]),
            make_commit("aaa", &[]),
        ];

        let (edges, total_lanes) = assign_lanes(&mut commits);

        // D should be in some lane, B and C in potentially different lanes
        assert!(total_lanes >= 2);
        // Should have edges: D->B, D->C, B->A, C->A
        assert_eq!(edges.len(), 4);
    }
}

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

    // Map from commit id → row index for quick lookup (owned keys to avoid borrow conflict).
    let id_to_row: HashMap<String, usize> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c.id.clone(), i))
        .collect();

    // active_lanes[i] = Some(row) means lane i expects the commit at that row index next.
    // Using row indices (usize) instead of String IDs avoids per-commit string clones
    // and replaces string comparisons with integer comparisons in lane lookups.
    let mut active_lanes: Vec<Option<usize>> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();

    #[allow(clippy::needless_range_loop)]
    for row in 0..commits.len() {
        // Clone parent_ids: we need to iterate parents after mutating commits[row].lane below.
        let parent_ids = commits[row].parent_ids.clone();

        // Find which lane expects this commit
        let lane = active_lanes.iter().position(|slot| *slot == Some(row));

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

        // Clean up zombie lanes: clear any other slots that also expected this commit.
        // This prevents stale reservations from inflating the total lane count.
        for slot in active_lanes.iter_mut() {
            if *slot == Some(row) {
                *slot = None;
            }
        }

        commits[row].lane = assigned_lane;

        // Handle parents
        if let Some(first_parent) = parent_ids.first() {
            let first_parent_row = id_to_row.get(first_parent.as_str()).copied();

            // First parent continues this commit's lane
            active_lanes[assigned_lane] = first_parent_row;

            // Create edge from this commit to the first parent
            if let Some(parent_row) = first_parent_row {
                edges.push(GraphEdge {
                    from_row: row,
                    from_lane: assigned_lane,
                    to_row: parent_row,
                    to_lane: assigned_lane, // will be corrected when parent is processed
                    edge_type: EdgeType::Straight,
                });
            }

            // Additional parents (merge commits) — reuse an existing lane
            // if one already expects this parent, otherwise allocate new.
            for merge_parent in parent_ids.iter().skip(1) {
                let parent_row = id_to_row.get(merge_parent.as_str()).copied();

                let merge_lane = match parent_row
                    .and_then(|pr| active_lanes.iter().position(|slot| *slot == Some(pr)))
                {
                    Some(existing) => existing,
                    None => {
                        let new_lane = allocate_free_lane(&mut active_lanes);
                        active_lanes[new_lane] = parent_row;
                        new_lane
                    }
                };

                if let Some(parent_row) = parent_row {
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
    // NOTE: We do NOT overwrite edge_type here. The type was set correctly
    // at creation time: Straight = first-parent, Merge = second+ parent.
    // Crossing lanes does not change the semantic edge type.
    for edge in &mut edges {
        if edge.to_row < commits.len() {
            edge.to_lane = commits[edge.to_row].lane;
        }
    }

    // Compute total lanes from actual commit assignments, not peak temporary
    // allocations. Temporary merge lanes that got zombied/corrected away
    // should not inflate the width.
    let total_lanes = commits.iter().map(|c| c.lane + 1).max().unwrap_or(0);

    (edges, total_lanes)
}

/// Find the leftmost free lane, or allocate a new one
fn allocate_free_lane(active_lanes: &mut Vec<Option<usize>>) -> usize {
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
            body: String::new(),
            author_name: "Test".to_string(),
            author_email: "test@test.com".to_string(),
            timestamp: 0,
            parent_ids: parent_ids.iter().map(|s| s.to_string()).collect(),
            co_authors: vec![],
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

        // Diamond merge should need exactly 2 lanes, not more
        assert_eq!(total_lanes, 2);
        // Should have edges: D->B, D->C, B->A, C->A
        assert_eq!(edges.len(), 4);
    }

    #[test]
    fn test_merge_parent_lane_reuse() {
        // B is a merge commit whose second parent (C) is already expected
        // by another lane (A's first-parent chain leads to C).
        // Topological: B, A, C
        let mut commits = vec![
            make_commit("bbb", &["aaa", "ccc"]), // merge: first parent A, merge parent C
            make_commit("aaa", &["ccc"]),        // first parent C
            make_commit("ccc", &[]),             // root
        ];

        let (_edges, total_lanes) = assign_lanes(&mut commits);

        // With lane reuse: B gets lane 0, A continues lane 0 toward C.
        // Merge parent C from B finds C already expected in lane 0 → reuses it.
        // No extra lane needed. Should be at most 1 lane.
        assert!(
            total_lanes <= 1,
            "Merge parent lane reuse failed: expected <= 1 lanes, got {}",
            total_lanes
        );
    }

    #[test]
    fn test_no_zombie_lanes() {
        // Diamond: D merges B and C, both have parent A.
        // After fix, no zombie lanes should persist.
        let mut commits = vec![
            make_commit("ddd", &["bbb", "ccc"]),
            make_commit("bbb", &["aaa"]),
            make_commit("ccc", &["aaa"]),
            make_commit("aaa", &[]),
        ];

        let (_edges, total_lanes) = assign_lanes(&mut commits);
        assert_eq!(
            total_lanes, 2,
            "Diamond merge should need exactly 2 lanes, got {}",
            total_lanes
        );
    }

    #[test]
    fn test_edge_types_preserved() {
        // Merge commit M with parents A (first) and B (second).
        // Edge M->A should be Straight, M->B should be Merge,
        // even if the edge crosses lanes after lane correction.
        let mut commits = vec![
            make_commit("mmm", &["aaa", "bbb"]),
            make_commit("bbb", &["ccc"]),
            make_commit("aaa", &["ccc"]),
            make_commit("ccc", &[]),
        ];

        let (edges, _) = assign_lanes(&mut commits);

        // Find edges from M (row 0)
        let m_edges: Vec<_> = edges.iter().filter(|e| e.from_row == 0).collect();
        assert_eq!(m_edges.len(), 2);

        // Edge to first parent (aaa, row 2) should be Straight
        let to_aaa = m_edges.iter().find(|e| e.to_row == 2).unwrap();
        assert!(
            matches!(to_aaa.edge_type, EdgeType::Straight),
            "First-parent edge should be Straight"
        );

        // Edge to second parent (bbb, row 1) should be Merge
        let to_bbb = m_edges.iter().find(|e| e.to_row == 1).unwrap();
        assert!(
            matches!(to_bbb.edge_type, EdgeType::Merge),
            "Second-parent edge should be Merge"
        );
    }
}

// Graph density — pure module (no React/canvas deps) so the commit-graph canvas,
// the graph header control and the repo store can all share it.
//
// Two orthogonal settings:
//   • density ("comfortable" | "compact") — vertical row pitch only. The avatar
//     and badge-pill sizes stay fixed; comfortable just adds breathing room.
//   • dotNodes (boolean)                  — render commit nodes as small colored
//                                           lane dots instead of author avatars.
// They combine: e.g. comfortable spacing with dot nodes. resolveGraphMetrics()
// flattens both into the values the canvas reads each draw().
export type GraphDensity = "comfortable" | "compact";

export interface DensityMetrics {
  /** Row pitch in px — drives virtualization and every row Y coordinate. */
  rowHeight: number;
  /** Author-avatar node radius in px (constant across tiers). */
  nodeRadius: number;
  /** Ref-badge pill height in px (constant across tiers). */
  labelHeight: number;
}

// Only rowHeight differs between tiers — the node and badge sizes are fixed so
// switching tiers changes spacing alone, not the size of the content.
export const GRAPH_DENSITY: Record<GraphDensity, DensityMetrics> = {
  comfortable: { rowHeight: 40, nodeRadius: 12, labelHeight: 24 },
  compact: { rowHeight: 32, nodeRadius: 12, labelHeight: 24 },
};

export const GRAPH_DENSITY_OPTIONS: ReadonlyArray<{ id: GraphDensity; label: string }> = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

// Horizontal lane pitch. Avatars need room; dots are small, so they pack tighter.
export const LANE_WIDTH = 20;
export const LANE_WIDTH_DOTS = 14;

export function laneWidthFor(dotNodes: boolean): number {
  return dotNodes ? LANE_WIDTH_DOTS : LANE_WIDTH;
}

/** Effective per-draw metrics resolved from the spacing tier + the dot-nodes
 *  toggle. The canvas reassigns its mutable ROW_HEIGHT / NODE_RADIUS /
 *  LABEL_HEIGHT from these and reads `avatars` for node-style gating. */
export interface ResolvedGraphMetrics extends DensityMetrics {
  /** Draw author avatars (true) or plain colored lane dots (false). */
  avatars: boolean;
  /** Horizontal pitch between lanes in px. */
  laneWidth: number;
}

export function resolveGraphMetrics(
  density: GraphDensity,
  dotNodes: boolean,
): ResolvedGraphMetrics {
  const base = GRAPH_DENSITY[density];
  return {
    rowHeight: base.rowHeight,
    // Dots are smaller than avatars.
    nodeRadius: dotNodes ? Math.max(4, Math.round(base.nodeRadius * 0.45)) : base.nodeRadius,
    labelHeight: base.labelHeight,
    avatars: !dotNodes,
    laneWidth: laneWidthFor(dotNodes),
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchInfo,
  CommitInfo,
  GraphEdge,
  StashInfo,
  TagInfo,
} from "@/types/git";

const ROW_HEIGHT = 32;
const LANE_WIDTH = 16;
const NODE_RADIUS = 4;
const GRAPH_PADDING_LEFT = 12;
const TEXT_GAP = 24;
const LABEL_HEIGHT = 16;
const LABEL_PAD_X = 5;
const LABEL_GAP = 3;
const LABEL_RADIUS = 3;

const LANE_COLORS = [
  "#00e5ff", // cyan
  "#76ff03", // lime
  "#ff4081", // pink
  "#ffea00", // yellow
  "#e040fb", // purple
  "#ff6e40", // deep orange
  "#64ffda", // teal
  "#448aff", // blue
  "#b2ff59", // light green
  "#ff5252", // red
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** Consistent color for a branch name — same name always gets same color */
function nameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return LANE_COLORS[Math.abs(hash) % LANE_COLORS.length];
}


function laneX(lane: number): number {
  return GRAPH_PADDING_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/** Draw a rounded rect pill and return its width */
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bgColor: string,
  textColor: string,
  icon?: string,
): number {
  ctx.font = '10px "Geist", system-ui, sans-serif';
  const iconWidth = icon ? ctx.measureText(icon).width + 3 : 0;
  const textWidth = ctx.measureText(text).width;
  const pillWidth = textWidth + iconWidth + LABEL_PAD_X * 2;
  const pillY = y - LABEL_HEIGHT / 2;

  // Background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, pillY, pillWidth, LABEL_HEIGHT, LABEL_RADIUS);
  ctx.fill();

  // Icon + text
  ctx.fillStyle = textColor;
  if (icon) {
    ctx.fillText(icon, x + LABEL_PAD_X, y);
  }
  ctx.fillText(text, x + LABEL_PAD_X + iconWidth, y);

  return pillWidth;
}

/** Stored badge position for hit testing */
interface BadgeHitArea {
  x: number;
  y: number;
  width: number;
  height: number;
  branchName: string;
  row: number;
}

interface CommitGraphCanvasProps {
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  selectedCommitId: string | null;
  onSelectCommit: (id: string | null) => void;
  onCheckoutBranch: (name: string) => void;
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  hasUncommittedChanges: boolean;
  onClickWip: () => void;
}

export function CommitGraphCanvas({
  commits,
  edges,
  totalLanes,
  selectedCommitId,
  onSelectCommit,
  onCheckoutBranch,
  branches,
  tags,
  stashes,
  hasUncommittedChanges,
  onClickWip,
}: CommitGraphCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const rafRef = useRef<number>(0);
  const badgeHitAreasRef = useRef<BadgeHitArea[]>([]);

  const hasWip = hasUncommittedChanges;
  const rowOffset = hasWip ? 1 : 0;
  const textOffset = GRAPH_PADDING_LEFT + totalLanes * LANE_WIDTH + TEXT_GAP;
  const totalRows = commits.length + rowOffset;
  const totalHeight = totalRows * ROW_HEIGHT;

  // Build lookup maps: commitId prefix → labels
  const branchMap = useMemo(() => {
    const map = new Map<string, BranchInfo[]>();
    for (const b of branches) {
      if (!b.commit_id) continue;
      // Find matching commit by prefix
      const commit = commits.find((c) => c.id.startsWith(b.commit_id));
      if (commit) {
        const existing = map.get(commit.id) ?? [];
        existing.push(b);
        map.set(commit.id, existing);
      }
    }
    return map;
  }, [branches, commits]);

  const tagMap = useMemo(() => {
    const map = new Map<string, TagInfo[]>();
    for (const t of tags) {
      if (!t.commit_id) continue;
      const commit = commits.find((c) => c.id.startsWith(t.commit_id));
      if (commit) {
        const existing = map.get(commit.id) ?? [];
        existing.push(t);
        map.set(commit.id, existing);
      }
    }
    return map;
  }, [tags, commits]);

  // Stashes don't have commit_id mapping yet — future: map to commits
  void stashes;

  // Assign a color to each commit based on which branch owns it.
  // Walk backwards from each branch HEAD, coloring commits until
  // we hit one already owned by another branch.
  const commitColorMap = useMemo(() => {
    const colorMap = new Map<string, string>();
    const commitIndex = new Map<string, number>();
    commits.forEach((c, i) => commitIndex.set(c.id, i));

    // Sort branches: HEAD branch first so it claims the main line
    const sorted = [...branches]
      .filter((b) => !b.is_remote)
      .sort((a, b) => (b.is_head ? 1 : 0) - (a.is_head ? 1 : 0));

    for (const branch of sorted) {
      const brColor = nameColor(branch.name);
      // Find the commit this branch points to
      const headCommit = commits.find((c) => c.id.startsWith(branch.commit_id));
      if (!headCommit) continue;

      // Walk backwards through parents
      const queue = [headCommit.id];
      while (queue.length > 0) {
        const cid = queue.shift()!;
        if (colorMap.has(cid)) continue; // already owned
        colorMap.set(cid, brColor);

        const idx = commitIndex.get(cid);
        if (idx === undefined) continue;
        const commit = commits[idx];
        // Follow first parent only (main line of this branch)
        if (commit.parent_ids.length > 0) {
          queue.push(commit.parent_ids[0]);
        }
      }
    }

    return colorMap;
  }, [commits, branches]);

  /** Get the color for a commit — branch-owned color or fallback to lane color */
  const getCommitColor = useCallback(
    (commit: CommitInfo): string => {
      return commitColorMap.get(commit.id) ?? laneColor(commit.lane);
    },
    [commitColorMap],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = scroll.clientWidth;
    const height = scroll.clientHeight;
    const scrollTop = scroll.scrollTop;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const firstVisibleRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 1);
    const lastVisibleRow = Math.min(
      totalRows - 1,
      Math.ceil((scrollTop + height) / ROW_HEIGHT) + 1,
    );

    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = "middle";
    const hitAreas: BadgeHitArea[] = [];

    // --- HEAD row highlight (permanent "you are here") ---
    const headBranch = branches.find((b) => b.is_head && !b.is_remote);
    let headCommitIdx = headBranch
      ? commits.findIndex((c) => c.id.startsWith(headBranch.commit_id))
      : -1;
    // Detached HEAD (e.g. tag checkout): HEAD is the first commit in topological walk
    if (headCommitIdx < 0 && commits.length > 0) {
      headCommitIdx = 0;
    }
    const headRow = headCommitIdx >= 0 ? headCommitIdx + rowOffset : -1;

    if (headRow >= firstVisibleRow && headRow <= lastVisibleRow) {
      const headCommit = commits[headCommitIdx];
      const headColor = headCommit ? getCommitColor(headCommit) : "#ffffff";
      ctx.fillStyle = headColor;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(0, headRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
      ctx.globalAlpha = 1;
    }

    // --- Selected row highlight ---
    const selectedRow = selectedCommitId
      ? commits.findIndex((c) => c.id === selectedCommitId) + rowOffset
      : -1;

    if (selectedRow >= firstVisibleRow && selectedRow <= lastVisibleRow) {
      if (selectedRow === headRow) {
        const headCommit = commits[headCommitIdx];
        ctx.fillStyle = headCommit ? getCommitColor(headCommit) : "#ffffff";
        ctx.globalAlpha = 0.18;
        ctx.fillRect(0, selectedRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "hsl(0 0% 14.9%)";
        ctx.fillRect(0, selectedRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
      }
    }

    if (
      hoveredRow !== null &&
      hoveredRow >= firstVisibleRow &&
      hoveredRow <= lastVisibleRow &&
      hoveredRow !== selectedRow
    ) {
      if (hoveredRow === headRow) {
        const headCommit = commits[headCommitIdx];
        ctx.fillStyle = headCommit ? getCommitColor(headCommit) : "#ffffff";
        ctx.globalAlpha = 0.14;
        ctx.fillRect(0, hoveredRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "hsl(0 0% 10%)";
        ctx.fillRect(0, hoveredRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
      }
    }

    // WIP row highlight handled by general hover/selection above

    // --- Edges (offset by rowOffset) ---
    ctx.lineWidth = 1.5;
    for (const edge of edges) {
      const fromRow = edge.from_row + rowOffset;
      const toRow = edge.to_row + rowOffset;
      if (fromRow > lastVisibleRow + 5 || toRow < firstVisibleRow - 5) continue;

      const fromX = laneX(edge.from_lane);
      const fromY = fromRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const toX = laneX(edge.to_lane);
      const toY = toRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;

      // Color edge by source commit's branch color
      const fromCommit = commits[edge.from_row];
      ctx.strokeStyle = fromCommit ? getCommitColor(fromCommit) : laneColor(edge.from_lane);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);

      if (edge.from_lane === edge.to_lane) {
        // Straight vertical line
        ctx.lineTo(toX, toY);
      } else {
        // Curved connector between different lanes
        // Use a cubic bezier: leave source vertically, arrive at target vertically
        const cp1Y = fromY + (toY - fromY) * 0.4;
        const cp2Y = fromY + (toY - fromY) * 0.6;
        ctx.bezierCurveTo(fromX, cp1Y, toX, cp2Y, toX, toY);
      }

      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- WIP row ---
    if (hasWip && firstVisibleRow === 0) {
      const wipY = ROW_HEIGHT / 2 - scrollTop;
      const nodeX = commits.length > 0 ? laneX(commits[0].lane) : laneX(0);

      // Connect WIP to first commit with a dashed line
      if (commits.length > 0) {
        const firstCommitY = (0 + rowOffset) * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
        ctx.strokeStyle = getCommitColor(commits[0]);
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(nodeX, wipY);
        ctx.lineTo(nodeX, firstCommitY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Empty circle node
      ctx.strokeStyle = "hsl(0 0% 50%)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(nodeX, wipY, NODE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();

      // "// WIP" label
      ctx.font = 'italic 13px "Geist", system-ui, sans-serif';
      ctx.fillStyle = "hsl(0 0% 60%)";
      ctx.fillText("// WIP", textOffset, wipY);
    }

    // --- Commit rows ---
    for (let visRow = Math.max(firstVisibleRow, rowOffset); visRow <= lastVisibleRow; visRow++) {
      const commitIdx = visRow - rowOffset;
      const commit = commits[commitIdx];
      if (!commit) continue;

      const x = laneX(commit.lane);
      const y = visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const color = getCommitColor(commit);

      // Node
      ctx.beginPath();
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // --- Labels (branches + tags) ---
      let labelX = textOffset;
      const commitBranches = branchMap.get(commit.id) ?? [];
      const commitTags = tagMap.get(commit.id) ?? [];
      const hasLabels = commitBranches.length > 0 || commitTags.length > 0;
      const maxLabelArea = 220; // max px for labels before SHA

      if (hasLabels) {
        let usedWidth = 0;
        let labelCount = 0;
        const totalLabels = commitBranches.length + commitTags.length;

        // Draw branch pills
        for (const branch of commitBranches) {
          if (usedWidth > maxLabelArea - 40) {
            // Draw overflow "+N"
            const remaining = totalLabels - labelCount;
            if (remaining > 0) {
              drawPill(ctx, labelX + usedWidth + LABEL_GAP, y, `+${remaining}`, "rgba(255,255,255,0.1)", "hsl(0 0% 60%)");
            }
            break;
          }
          const displayName = branch.is_remote
            ? branch.name.replace(/^origin\//, "↑")
            : branch.name;
          // Color by branch name so different branches are always distinguishable
          const bColor = nameColor(branch.name.replace(/^origin\//, ""));
          const bgAlpha = branch.is_head ? 0.3 : 0.15;
          const bg = branch.is_remote
            ? `rgba(255,255,255,0.08)`
            : `${bColor}${Math.round(bgAlpha * 255).toString(16).padStart(2, "0")}`;
          const textCol = branch.is_remote ? "hsl(0 0% 55%)" : bColor;
          const pillX = labelX + usedWidth;
          const w = drawPill(ctx, pillX, y, displayName, bg, textCol);
          // Store hit area for double-click checkout (use absolute Y with scrollTop)
          hitAreas.push({
            x: pillX,
            y: visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2 - LABEL_HEIGHT / 2,
            width: w,
            height: LABEL_HEIGHT,
            branchName: branch.name,
            row: visRow,
          });
          usedWidth += w + LABEL_GAP;
          labelCount++;
        }

        // Draw tag pills
        for (const tag of commitTags) {
          if (usedWidth > maxLabelArea - 40) {
            const remaining = totalLabels - labelCount;
            if (remaining > 0) {
              drawPill(ctx, labelX + usedWidth + LABEL_GAP, y, `+${remaining}`, "rgba(255,255,255,0.1)", "hsl(0 0% 60%)");
            }
            break;
          }
          const tagPillX = labelX + usedWidth;
          const w = drawPill(ctx, tagPillX, y, tag.name, "rgba(255,255,255,0.08)", "hsl(0 0% 60%)", "⬡");
          hitAreas.push({
            x: tagPillX,
            y: visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2 - LABEL_HEIGHT / 2,
            width: w,
            height: LABEL_HEIGHT,
            branchName: tag.name, // reuse branchName field — checkout works for tags too
            row: visRow,
          });
          usedWidth += w + LABEL_GAP;
          labelCount++;
        }

        labelX += usedWidth + 8;
      }

      // Short SHA
      ctx.font = '11px "Geist Mono", ui-monospace, monospace';
      ctx.fillStyle = "hsl(0 0% 63.9%)";
      ctx.fillText(commit.short_id, labelX, y);

      // Message
      const msgX = labelX + 64;
      const maxMsgWidth = width - msgX - 160;
      ctx.font = '13px "Geist", system-ui, sans-serif';
      ctx.fillStyle = "hsl(0 0% 90%)";
      ctx.fillText(truncateText(ctx, commit.message, maxMsgWidth), msgX, y);

      // Author + time (right-aligned)
      const metaText = `${commit.author_name}  ${formatRelativeTime(commit.timestamp)}`;
      ctx.font = '11px "Geist", system-ui, sans-serif';
      ctx.fillStyle = "hsl(0 0% 50%)";
      const metaWidth = ctx.measureText(metaText).width;
      ctx.fillText(metaText, width - metaWidth - 16, y);
    }

    badgeHitAreasRef.current = hitAreas;
  }, [commits, edges, selectedCommitId, hoveredRow, textOffset, hasWip, rowOffset, totalRows, branchMap, tagMap, getCommitColor, branches]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const handleScroll = useCallback(() => requestDraw(), [requestDraw]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const y = e.clientY - rect.top + scroll.scrollTop;
      const visRow = Math.floor(y / ROW_HEIGHT);

      // WIP row
      if (hasWip && visRow === 0) {
        onClickWip();
        return;
      }

      const commitIdx = visRow - rowOffset;
      if (commitIdx >= 0 && commitIdx < commits.length) {
        const id = commits[commitIdx].id;
        onSelectCommit(id === selectedCommitId ? null : id);
      }
    },
    [commits, selectedCommitId, onSelectCommit, hasWip, rowOffset, onClickWip],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if double-click hit a branch badge
      for (const badge of badgeHitAreasRef.current) {
        if (
          clickX >= badge.x &&
          clickX <= badge.x + badge.width &&
          clickY >= badge.y &&
          clickY <= badge.y + badge.height
        ) {
          onCheckoutBranch(badge.branchName);
          return;
        }
      }
    },
    [onCheckoutBranch],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const y = my + scroll.scrollTop;
      const row = Math.floor(y / ROW_HEIGHT);

      setHoveredRow(row >= 0 && row < totalRows ? row : null);

      // Change cursor to pointer when hovering a branch badge
      const overBadge = badgeHitAreasRef.current.some(
        (b) => mx >= b.x && mx <= b.x + b.width && my >= b.y && my <= b.y + b.height,
      );
      scroll.style.cursor = overBadge ? "pointer" : "";
    },
    [totalRows],
  );

  const handleMouseLeave = useCallback(() => setHoveredRow(null), []);

  useEffect(() => {
    requestDraw();

    const scroll = scrollRef.current;
    if (!scroll) return;

    const observer = new ResizeObserver(() => requestDraw());
    observer.observe(scroll);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [requestDraw]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden"
        onScroll={handleScroll}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div style={{ height: Math.max(totalHeight, 1) }} />
      </div>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
      />
    </div>
  );
}

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
  "#4ec9b0",
  "#569cd6",
  "#c586c0",
  "#ce9178",
  "#dcdcaa",
  "#9cdcfe",
  "#d7ba7d",
  "#608b4e",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** Consistent color for a branch name — same name always gets same color */
function branchColor(name: string): string {
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

interface CommitGraphCanvasProps {
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  selectedCommitId: string | null;
  onSelectCommit: (id: string | null) => void;
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

    // --- Row highlights ---
    const selectedRow = selectedCommitId
      ? commits.findIndex((c) => c.id === selectedCommitId) + rowOffset
      : -1;

    if (selectedRow >= firstVisibleRow && selectedRow <= lastVisibleRow) {
      ctx.fillStyle = "hsl(0 0% 14.9%)";
      ctx.fillRect(0, selectedRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
    }

    if (
      hoveredRow !== null &&
      hoveredRow >= firstVisibleRow &&
      hoveredRow <= lastVisibleRow &&
      hoveredRow !== selectedRow
    ) {
      ctx.fillStyle = "hsl(0 0% 10%)";
      ctx.fillRect(0, hoveredRow * ROW_HEIGHT - scrollTop, width, ROW_HEIGHT);
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

      ctx.strokeStyle = laneColor(edge.from_lane);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);

      if (edge.from_lane === edge.to_lane) {
        ctx.lineTo(toX, toY);
      } else {
        const midY = fromY + ROW_HEIGHT;
        ctx.lineTo(fromX, midY);
        ctx.quadraticCurveTo(fromX, midY + 8, toX, midY + 8);
        ctx.lineTo(toX, toY);
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
        ctx.strokeStyle = laneColor(commits[0].lane);
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
      const color = laneColor(commit.lane);

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
          const bColor = branchColor(branch.name.replace(/^origin\//, ""));
          const bgAlpha = branch.is_head ? 0.3 : 0.15;
          const bg = branch.is_remote
            ? `rgba(255,255,255,0.08)`
            : `${bColor}${Math.round(bgAlpha * 255).toString(16).padStart(2, "0")}`;
          const textCol = branch.is_remote ? "hsl(0 0% 55%)" : bColor;
          const w = drawPill(ctx, labelX + usedWidth, y, displayName, bg, textCol);
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
          const w = drawPill(ctx, labelX + usedWidth, y, `🏷 ${tag.name}`, "rgba(234,179,8,0.15)", "#eab308");
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
  }, [commits, edges, selectedCommitId, hoveredRow, textOffset, hasWip, rowOffset, totalRows, branchMap, tagMap]);

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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const y = e.clientY - rect.top + scroll.scrollTop;
      const row = Math.floor(y / ROW_HEIGHT);

      setHoveredRow(row >= 0 && row < totalRows ? row : null);
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

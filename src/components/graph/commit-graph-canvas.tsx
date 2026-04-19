import { useCallback, useEffect, useRef, useState } from "react";
import type { CommitInfo, GraphEdge } from "@/types/git";

const ROW_HEIGHT = 32;
const LANE_WIDTH = 16;
const NODE_RADIUS = 4;
const GRAPH_PADDING_LEFT = 12;
const TEXT_GAP = 24;

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

function laneX(lane: number): number {
  return GRAPH_PADDING_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function rowY(row: number, scrollTop: number): number {
  return row * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
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

interface CommitGraphCanvasProps {
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  selectedCommitId: string | null;
  onSelectCommit: (id: string | null) => void;
}

export function CommitGraphCanvas({
  commits,
  edges,
  totalLanes,
  selectedCommitId,
  onSelectCommit,
}: CommitGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const scrollTopRef = useRef(0);
  const rafRef = useRef<number>(0);

  const textOffset = GRAPH_PADDING_LEFT + totalLanes * LANE_WIDTH + TEXT_GAP;
  const totalHeight = commits.length * ROW_HEIGHT;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Size canvas to container
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const scrollTop = scrollTopRef.current;
    const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 1);
    const lastRow = Math.min(
      commits.length - 1,
      Math.ceil((scrollTop + height) / ROW_HEIGHT) + 1,
    );

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw selected row highlight
    const selectedRow = commits.findIndex((c) => c.id === selectedCommitId);
    if (selectedRow >= firstRow && selectedRow <= lastRow) {
      const y = selectedRow * ROW_HEIGHT - scrollTop;
      ctx.fillStyle = "hsl(0 0% 14.9%)";
      ctx.fillRect(0, y, width, ROW_HEIGHT);
    }

    // Draw hovered row highlight
    if (
      hoveredRow !== null &&
      hoveredRow >= firstRow &&
      hoveredRow <= lastRow &&
      hoveredRow !== selectedRow
    ) {
      const y = hoveredRow * ROW_HEIGHT - scrollTop;
      ctx.fillStyle = "hsl(0 0% 10%)";
      ctx.fillRect(0, y, width, ROW_HEIGHT);
    }

    // Draw edges
    ctx.lineWidth = 1.5;
    for (const edge of edges) {
      if (edge.from_row > lastRow + 5 || edge.to_row < firstRow - 5) continue;

      const fromX = laneX(edge.from_lane);
      const fromY = rowY(edge.from_row, scrollTop);
      const toX = laneX(edge.to_lane);
      const toY = rowY(edge.to_row, scrollTop);

      ctx.strokeStyle = laneColor(edge.from_lane);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);

      if (edge.from_lane === edge.to_lane) {
        // Straight vertical line
        ctx.lineTo(toX, toY);
      } else {
        // Diagonal merge connector with curve
        const midY = fromY + ROW_HEIGHT;
        ctx.lineTo(fromX, midY);
        ctx.quadraticCurveTo(fromX, midY + 8, toX, midY + 8);
        ctx.lineTo(toX, toY);
      }

      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw commit nodes and text
    ctx.textBaseline = "middle";

    for (let row = firstRow; row <= lastRow; row++) {
      const commit = commits[row];
      if (!commit) continue;

      const x = laneX(commit.lane);
      const y = rowY(row, scrollTop);
      const color = laneColor(commit.lane);

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Short SHA
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillStyle = "hsl(0 0% 63.9%)";
      ctx.fillText(commit.short_id, textOffset, y);

      // Commit message
      const msgX = textOffset + 64;
      const maxMsgWidth = width - msgX - 160;
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillStyle = "hsl(0 0% 90%)";
      const truncatedMsg = truncateText(ctx, commit.message, maxMsgWidth);
      ctx.fillText(truncatedMsg, msgX, y);

      // Author + time (right-aligned)
      const timeStr = formatRelativeTime(commit.timestamp);
      const metaText = `${commit.author_name}  ${timeStr}`;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = "hsl(0 0% 50%)";
      const metaWidth = ctx.measureText(metaText).width;
      ctx.fillText(metaText, width - metaWidth - 16, y);
    }
  }, [commits, edges, selectedCommitId, hoveredRow, textOffset]);

  // Redraw on scroll
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    scrollTopRef.current = container.scrollTop;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Handle click
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top + container.scrollTop;
      const row = Math.floor(y / ROW_HEIGHT);

      if (row >= 0 && row < commits.length) {
        const commit = commits[row];
        onSelectCommit(
          commit.id === selectedCommitId ? null : commit.id,
        );
      }
    },
    [commits, selectedCommitId, onSelectCommit],
  );

  // Handle hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top + container.scrollTop;
      const row = Math.floor(y / ROW_HEIGHT);

      if (row >= 0 && row < commits.length) {
        setHoveredRow(row);
      } else {
        setHoveredRow(null);
      }
    },
    [commits.length],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredRow(null);
  }, []);

  // Initial draw + resize observer
  useEffect(() => {
    draw();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-y-auto overflow-x-hidden"
      onScroll={handleScroll}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Spacer div to create scrollable area */}
      <div style={{ height: totalHeight, pointerEvents: "none" }} />

      {/* Canvas overlays the visible area */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 top-0"
        style={{
          position: "sticky",
          top: 0,
        }}
      />
    </div>
  );
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  const measured = ctx.measureText(text);
  if (measured.width <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + "…").width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

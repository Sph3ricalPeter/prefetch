import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchInfo,
  CommitInfo,
  GraphEdge,
  StashInfo,
  TagInfo,
} from "@/types/git";
import { gravatarUrl } from "@/lib/gravatar";

const ROW_HEIGHT = 32;
const LANE_WIDTH = 20;
const NODE_RADIUS = 10;          // Change 4: was 8 (16px -> 20px diameter)
const SCROLLBAR_PAD = 6;         // matches scrollbar width for visual balance
const GRAPH_PADDING_LEFT = 12 + SCROLLBAR_PAD; // left padding accounts for scrollbar parity
const TEXT_GAP = 24;
const LABEL_HEIGHT = 20;         // Change 2: was 16
const LABEL_PAD_X = 7;           // Change 2: was 5
const LABEL_GAP = 3;
const LABEL_RADIUS = 4;          // Change 2: was 3
const ROW_RADIUS = 6;            // Change 1: matches CSS rounded-md
const GRAPH_PADDING_TOP = 6;     // top padding matching left padding
const ROW_INSET = 2;             // vertical inset so row highlights don't touch

// Type scale constants (must stay in sync with src/index.css @theme tokens)
const FONT_SANS = '"Inter", system-ui, sans-serif';
const SIZE_LABEL = 11;
const SIZE_BODY = 12;

// Design system grays — must match index.css tokens (240° cool hue)
const COLOR_FG       = "hsl(240 5% 96%)";  // --foreground
const COLOR_MUTED    = "hsl(240 5% 65%)";  // --muted-foreground
const COLOR_DIM      = "hsl(240 5% 45%)";  // --dim (tertiary)
const COLOR_FAINT    = "hsl(240 5% 30%)";  // --faint (ghost)
const BG_SELECTED    = "hsl(240 6% 10%)";  // --secondary
const BG_HOVER       = "hsl(240 6% 8%)";   // between bg and secondary
const BG_PAGE        = "hsl(240 6% 3.9%)"; // --background (for clearing behind separator labels)

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

// Module-level avatar image cache — persists across renders and remounts.
// null = load attempted but failed (permanent fallback to initials).
const avatarCache = new Map<string, HTMLImageElement | null>();

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** Pick a readable text color (black or white) for a given hex background */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
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

// Change 3: Time-group classification for commit timestamps
type TimeGroup = "Today" | "Yesterday" | "This week" | "Last week" | "This month" | "Last month" | "Older";

function getTimeGroup(timestamp: number): TimeGroup {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const startOfYesterday = startOfToday - 86400;
  const dayOfWeek = now.getDay() || 7; // Sunday = 7
  const startOfThisWeek = startOfToday - (dayOfWeek - 1) * 86400;
  const startOfLastWeek = startOfThisWeek - 7 * 86400;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime() / 1000;

  if (timestamp >= startOfToday) return "Today";
  if (timestamp >= startOfYesterday) return "Yesterday";
  if (timestamp >= startOfThisWeek) return "This week";
  if (timestamp >= startOfLastWeek) return "Last week";
  if (timestamp >= startOfThisMonth) return "This month";
  if (timestamp >= startOfLastMonth) return "Last month";
  return "Older";
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "\u2026").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "\u2026";
}

/** Draw a small tag icon (matches lucide Tag shape) */
function drawTagIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const w = 13;
  const h = 9;
  const cx = x + w / 2;
  const cy = y;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Tag body: rectangle with pointed left edge
  ctx.moveTo(cx - w / 2 + 1, cy);           // left point
  ctx.lineTo(cx - w / 2 + 3, cy - h / 2);   // top-left
  ctx.lineTo(cx + w / 2, cy - h / 2);        // top-right
  ctx.lineTo(cx + w / 2, cy + h / 2);        // bottom-right
  ctx.lineTo(cx - w / 2 + 3, cy + h / 2);   // bottom-left
  ctx.closePath();
  ctx.stroke();
  // Small circle (tag hole)
  ctx.beginPath();
  ctx.arc(cx + w / 2 - 3, cy, 1, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  return w + 5;
}

/** Draw a rounded rect pill and return its width */
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bgColor: string,
  textColor: string,
  drawIcon?: (ctx: CanvasRenderingContext2D, ix: number, iy: number, color: string) => number,
): number {
  ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;
  const iconWidth = drawIcon ? drawIcon(ctx, 0, -1000, textColor) : 0; // dry-run to measure width
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
  if (drawIcon) {
    drawIcon(ctx, x + LABEL_PAD_X, y, textColor);
  }
  ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;
  ctx.fillStyle = textColor;
  ctx.fillText(text, x + LABEL_PAD_X + iconWidth, y);

  return pillWidth;
}

/** Draw a small monitor/screen icon (local branch indicator) */
function drawLocalIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const iconW = 11;
  const halfH = 6;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Monitor screen (rounded rect)
  ctx.roundRect(x, y - halfH, iconW, halfH * 2 - 3, 1.5);
  ctx.stroke();
  // Stand
  ctx.beginPath();
  ctx.moveTo(x + iconW / 2, y + halfH - 3);
  ctx.lineTo(x + iconW / 2, y + halfH - 1);
  // Base
  ctx.moveTo(x + 2, y + halfH - 1);
  ctx.lineTo(x + iconW - 2, y + halfH - 1);
  ctx.stroke();
  ctx.restore();
  return iconW + 3;
}

/** Draw a small up-arrow icon (remote branch indicator) */
function drawRemoteIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const iconW = 9;
  const halfH = 5;    // shorter vertically
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6; // Change 2: was 1.4
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Vertical stem
  ctx.moveTo(x + iconW / 2, y + halfH);
  ctx.lineTo(x + iconW / 2, y - halfH);
  // Arrow head
  ctx.moveTo(x + 1, y - halfH + 3);
  ctx.lineTo(x + iconW / 2, y - halfH);
  ctx.lineTo(x + iconW - 1, y - halfH + 3);
  ctx.stroke();
  ctx.restore();
  return iconW + 3;
}

/** Draw a small file-edit icon for WIP row */
function drawFileEditIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const iconW = 10;
  const halfH = 5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Paper outline
  ctx.moveTo(x + 1, y - halfH);
  ctx.lineTo(x + iconW - 2, y - halfH);
  ctx.lineTo(x + iconW - 2, y + halfH);
  ctx.lineTo(x + 1, y + halfH);
  ctx.closePath();
  ctx.stroke();
  // Lines on paper
  ctx.beginPath();
  ctx.moveTo(x + 3, y - 2);
  ctx.lineTo(x + iconW - 4, y - 2);
  ctx.moveTo(x + 3, y + 1);
  ctx.lineTo(x + iconW - 4, y + 1);
  ctx.stroke();
  ctx.restore();
  return iconW + 3;
}

interface MergedBranchGroup {
  baseName: string;
  local: BranchInfo | null;
  remote: BranchInfo | null;
  isHead: boolean;
}

function groupBranches(branches: BranchInfo[]): MergedBranchGroup[] {
  const map = new Map<string, MergedBranchGroup>();
  for (const b of branches) {
    const baseName = b.is_remote ? b.name.replace(/^[^/]+\//, "") : b.name;
    const existing = map.get(baseName) ?? {
      baseName,
      local: null,
      remote: null,
      isHead: false,
    };
    if (b.is_remote) {
      existing.remote = b;
    } else {
      existing.local = b;
      existing.isHead = existing.isHead || b.is_head;
    }
    map.set(baseName, existing);
  }
  // Sort: HEAD first, then local+remote, then local-only, then remote-only
  return [...map.values()].sort((a, b) => {
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
    const aScore = (a.local ? 2 : 0) + (a.remote ? 1 : 0);
    const bScore = (b.local ? 2 : 0) + (b.remote ? 1 : 0);
    return bScore - aScore;
  });
}

/** Draw a merged branch pill with local/remote indicator icons */
function drawMergedBranchPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  group: MergedBranchGroup,
): number {
  const bColor = nameColor(group.baseName);
  const isRemoteOnly = !group.local && !!group.remote;
  const bgAlpha = group.isHead ? 0.3 : 0.15;

  const bg = isRemoteOnly
    ? "rgba(255,255,255,0.08)"
    : `${bColor}${Math.round(bgAlpha * 255)
        .toString(16)
        .padStart(2, "0")}`;
  const textCol = isRemoteOnly ? COLOR_DIM : bColor;

  // Measure text
  ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;
  const textWidth = ctx.measureText(group.baseName).width;

  // Calculate icon widths — Change 2: was 11/10
  let iconsWidth = 0;
  if (group.local) iconsWidth += 15; // 11px icon + 4px gap before remote
  if (group.remote) iconsWidth += 12;

  const pillWidth = LABEL_PAD_X + iconsWidth + textWidth + LABEL_PAD_X;
  const pillY = y - LABEL_HEIGHT / 2;

  // Background
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, pillY, pillWidth, LABEL_HEIGHT, LABEL_RADIUS);
  ctx.fill();

  // Icons — Change 2: advance widths updated
  let iconX = x + LABEL_PAD_X;
  if (group.local) {
    drawLocalIcon(ctx, iconX, y, textCol);
    iconX += 15; // 11px icon + 4px gap
  }
  if (group.remote) {
    drawRemoteIcon(ctx, iconX, y, textCol);
    iconX += 12;
  }

  // Text
  ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;
  ctx.fillStyle = textCol;
  ctx.fillText(group.baseName, x + LABEL_PAD_X + iconsWidth, y);

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

/** Stored body-text position for hover tooltip (Change 6) */
interface BodyHitArea {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  body: string;
}

/** Stored avatar position for hover tooltip */
interface AvatarHitArea {
  cx: number;
  cy: number;
  row: number;
  commitIdx: number;
}

/** Canvas hover info for tooltip overlay (Change 6) */
interface CanvasHoverInfo {
  type: "body" | "avatar";
  text: string;
  x: number;
  y: number;
  row: number;
}

interface CommitGraphCanvasProps {
  commits: CommitInfo[];
  edges: GraphEdge[];
  totalLanes: number;
  selectedCommitId: string | null;
  headCommitId: string | null;
  onSelectCommit: (id: string | null) => void;
  onCheckoutBranch: (name: string) => void;
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  hasUncommittedChanges: boolean;
  fileStatusCount: number;
  isWipSelected: boolean;
  onClickWip: () => void;
  onCommitContextMenu?: (commitId: string, x: number, y: number) => void;
}

export function CommitGraphCanvas({
  commits,
  edges,
  totalLanes,
  selectedCommitId,
  headCommitId,
  onSelectCommit,
  onCheckoutBranch,
  branches,
  tags,
  stashes,
  hasUncommittedChanges,
  fileStatusCount,
  isWipSelected,
  onClickWip,
  onCommitContextMenu,
}: CommitGraphCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredRowRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const badgeHitAreasRef = useRef<BadgeHitArea[]>([]);
  const bodyHitAreasRef = useRef<BodyHitArea[]>([]);       // Change 6
  const avatarHitAreasRef = useRef<AvatarHitArea[]>([]);
  const [canvasHover, setCanvasHover] = useState<CanvasHoverInfo | null>(null); // Change 6
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);     // Change 6
  // Stable ref so async avatar-load callbacks always reach the latest draw
  const requestDrawRef = useRef<() => void>(() => {});

  const hasWip = hasUncommittedChanges;
  const rowOffset = hasWip ? 1 : 0;
  const textOffset = GRAPH_PADDING_LEFT + totalLanes * LANE_WIDTH + TEXT_GAP;
  const totalRows = commits.length + rowOffset;
  const totalHeight = totalRows * ROW_HEIGHT + GRAPH_PADDING_TOP;

  // Build lookup maps: commitId prefix -> labels
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

  // Stashes don't have commit_id mapping yet -- future: map to commits
  void stashes;

  // Change 3: Pre-compute time-group boundaries
  const timeGroupBoundaries = useMemo(() => {
    const boundaries = new Map<number, TimeGroup>();
    let prevGroup: TimeGroup | null = null;
    for (let i = 0; i < commits.length; i++) {
      const group = getTimeGroup(commits[i].timestamp);
      if (group !== prevGroup) {
        boundaries.set(i + rowOffset, group);
        prevGroup = group;
      }
    }
    return boundaries;
  }, [commits, rowOffset]);

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

  /** Get the color for a commit -- branch-owned color or fallback to lane color */
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
    const scrollTop = scroll.scrollTop - GRAPH_PADDING_TOP; // offset so first row starts below top padding

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
    const bodyHitAreas: BodyHitArea[] = [];
    const avatarHitAreas: AvatarHitArea[] = [];

    // --- HEAD row highlight (permanent "you are here") ---
    // Use headCommitId from the backend -- works for both branch checkout and detached HEAD (tag checkout)
    let headCommitIdx = headCommitId
      ? commits.findIndex((c) => c.id === headCommitId || c.id.startsWith(headCommitId))
      : -1;
    // Fallback: try via branch is_head flag
    if (headCommitIdx < 0) {
      const headBranch = branches.find((b) => b.is_head && !b.is_remote);
      if (headBranch) {
        headCommitIdx = commits.findIndex((c) => c.id.startsWith(headBranch.commit_id));
      }
    }
    const headRow = headCommitIdx >= 0 ? headCommitIdx + rowOffset : -1;
    const isDetachedHead = !branches.some((b) => b.is_head && !b.is_remote);

    // HEAD highlight color: branch color when on a branch, neutral gray when detached (tag checkout)
    const headHighlightColor = isDetachedHead
      ? COLOR_MUTED
      : (commits[headCommitIdx] ? getCommitColor(commits[headCommitIdx]) : COLOR_FG);

    // Change 1: All row highlights use roundRect instead of fillRect
    if (headRow >= firstVisibleRow && headRow <= lastVisibleRow) {
      ctx.fillStyle = headHighlightColor;
      ctx.globalAlpha = isDetachedHead ? 0.12 : 0.08;
      ctx.beginPath();
      ctx.roundRect(SCROLLBAR_PAD, headRow * ROW_HEIGHT - scrollTop + ROW_INSET, width - SCROLLBAR_PAD, ROW_HEIGHT - ROW_INSET * 2, ROW_RADIUS);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // --- Selected row highlight ---
    const selectedRow = selectedCommitId
      ? commits.findIndex((c) => c.id === selectedCommitId) + rowOffset
      : -1;

    if (selectedRow >= firstVisibleRow && selectedRow <= lastVisibleRow) {
      if (selectedRow === headRow) {
        ctx.fillStyle = headHighlightColor;
        ctx.globalAlpha = isDetachedHead ? 0.22 : 0.18;
        ctx.beginPath();
        ctx.roundRect(SCROLLBAR_PAD, selectedRow * ROW_HEIGHT - scrollTop + ROW_INSET, width - SCROLLBAR_PAD, ROW_HEIGHT - ROW_INSET * 2, ROW_RADIUS);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = BG_SELECTED;
        ctx.beginPath();
        ctx.roundRect(SCROLLBAR_PAD, selectedRow * ROW_HEIGHT - scrollTop + ROW_INSET, width - SCROLLBAR_PAD, ROW_HEIGHT - ROW_INSET * 2, ROW_RADIUS);
        ctx.fill();
      }
    }

    // WIP row selected highlight
    if (isWipSelected && hasWip && 0 >= firstVisibleRow && 0 <= lastVisibleRow) {
      ctx.fillStyle = BG_SELECTED;
      ctx.beginPath();
      ctx.roundRect(SCROLLBAR_PAD, 0 * ROW_HEIGHT - scrollTop + ROW_INSET, width - SCROLLBAR_PAD, ROW_HEIGHT - ROW_INSET * 2, ROW_RADIUS);
      ctx.fill();
    }

    const hoveredRow = hoveredRowRef.current;
    if (
      hoveredRow !== null &&
      hoveredRow >= firstVisibleRow &&
      hoveredRow <= lastVisibleRow &&
      hoveredRow !== selectedRow &&
      !(isWipSelected && hasWip && hoveredRow === 0)
    ) {
      if (hoveredRow === headRow) {
        ctx.fillStyle = headHighlightColor;
        ctx.globalAlpha = isDetachedHead ? 0.18 : 0.14;
        ctx.beginPath();
        ctx.roundRect(SCROLLBAR_PAD, hoveredRow * ROW_HEIGHT - scrollTop + ROW_INSET, width - SCROLLBAR_PAD, ROW_HEIGHT - ROW_INSET * 2, ROW_RADIUS);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = BG_HOVER;
        ctx.beginPath();
        ctx.roundRect(SCROLLBAR_PAD, hoveredRow * ROW_HEIGHT - scrollTop + ROW_INSET, width - SCROLLBAR_PAD, ROW_HEIGHT - ROW_INSET * 2, ROW_RADIUS);
        ctx.fill();
      }
    }

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

      // Color first-parent edges by source commit (branch continuity),
      // merge-parent edges by target commit (shows incoming branch)
      if (edge.edge_type === "Merge") {
        const toCommit = commits[edge.to_row];
        ctx.strokeStyle = toCommit ? getCommitColor(toCommit) : laneColor(edge.to_lane);
      } else {
        const fromCommit = commits[edge.from_row];
        ctx.strokeStyle = fromCommit ? getCommitColor(fromCommit) : laneColor(edge.from_lane);
      }
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

      // Empty circle node (subtle fill when selected)
      ctx.strokeStyle = COLOR_DIM;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(nodeX, wipY, NODE_RADIUS, 0, Math.PI * 2);
      if (isWipSelected) {
        ctx.fillStyle = COLOR_FAINT;
        ctx.fill();
      }
      ctx.stroke();

      // File edit icon + change count
      const wipTextColor = COLOR_MUTED;
      const wipIconW = drawFileEditIcon(ctx, textOffset, wipY, wipTextColor);
      ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;
      ctx.fillStyle = wipTextColor;
      const changeText =
        fileStatusCount === 1 ? "1 change" : `${fileStatusCount} changes`;
      ctx.fillText(changeText, textOffset + wipIconW, wipY);
    }

    // --- Commit rows ---
    for (let visRow = Math.max(firstVisibleRow, rowOffset); visRow <= lastVisibleRow; visRow++) {
      const commitIdx = visRow - rowOffset;
      const commit = commits[commitIdx];
      if (!commit) continue;

      const x = laneX(commit.lane);
      const y = visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const color = getCommitColor(commit);

      // Node -- avatar image or fallback initial circle
      {
        const email = commit.author_email;
        let img = avatarCache.get(email);
        if (img === undefined) {
          // First encounter -- start loading gravatar
          avatarCache.set(email, null);
          const loadImg = new Image();
          loadImg.crossOrigin = "anonymous";
          loadImg.src = gravatarUrl(email, NODE_RADIUS * 4); // 2x for retina
          loadImg.onload = () => {
            avatarCache.set(email, loadImg);
            requestDrawRef.current();
          };
          loadImg.onerror = () => {
            // Stays null -- permanent fallback to initials
          };
          img = null;
        }

        if (img) {
          // Gravatar -- draw circular clipped image
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(
            img,
            x - NODE_RADIUS,
            y - NODE_RADIUS,
            NODE_RADIUS * 2,
            NODE_RADIUS * 2,
          );
          ctx.restore();
        } else {
          // Fallback -- colored circle with author initial
          ctx.beginPath();
          ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.save();
          ctx.fillStyle = contrastText(color);
          ctx.font = `bold ${Math.round(NODE_RADIUS * 1.2)}px ${FONT_SANS}`;
          ctx.textAlign = "center";
          ctx.fillText(
            commit.author_name.charAt(0).toUpperCase(),
            x,
            y,
          );
          ctx.restore();
        }

        // Thin ring in branch color for visual separation from edges
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Store avatar hit area for tooltip
        avatarHitAreas.push({ cx: x, cy: y, row: visRow, commitIdx: commitIdx });
      }

      // --- Labels (branches + tags) ---
      let labelX = textOffset;
      const commitBranches = branchMap.get(commit.id) ?? [];
      const commitTags = tagMap.get(commit.id) ?? [];
      const hasLabels = commitBranches.length > 0 || commitTags.length > 0;
      const maxLabelArea = 260; // Change 2: was 220

      if (hasLabels) {
        let usedWidth = 0;
        let labelCount = 0;
        const branchGroups = groupBranches(commitBranches);
        const totalLabels = branchGroups.length + commitTags.length;

        // Draw merged branch pills
        for (const group of branchGroups) {
          if (usedWidth > maxLabelArea - 40) {
            const remaining = totalLabels - labelCount;
            if (remaining > 0) {
              drawPill(ctx, labelX + usedWidth + LABEL_GAP, y, `+${remaining}`, "rgba(255,255,255,0.1)", COLOR_DIM);
            }
            break;
          }
          const pillX = labelX + usedWidth;
          const w = drawMergedBranchPill(ctx, pillX, y, group);
          // Store hit area -- prefer local branch name for checkout
          hitAreas.push({
            x: pillX,
            y: visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2 - LABEL_HEIGHT / 2,
            width: w,
            height: LABEL_HEIGHT,
            branchName: group.local?.name ?? group.remote!.name,
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
              drawPill(ctx, labelX + usedWidth + LABEL_GAP, y, `+${remaining}`, "rgba(255,255,255,0.1)", COLOR_DIM);
            }
            break;
          }
          const tagPillX = labelX + usedWidth;
          const w = drawPill(ctx, tagPillX, y, tag.name, "rgba(255,255,255,0.08)", COLOR_DIM, drawTagIcon);
          hitAreas.push({
            x: tagPillX,
            y: visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2 - LABEL_HEIGHT / 2,
            width: w,
            height: LABEL_HEIGHT,
            branchName: tag.name, // reuse branchName field -- checkout works for tags too
            row: visRow,
          });
          usedWidth += w + LABEL_GAP;
          labelCount++;
        }

        labelX += usedWidth + 8;
      }

      // Short SHA
      ctx.font = `${SIZE_LABEL}px ${FONT_SANS}`;
      ctx.fillStyle = COLOR_DIM;
      ctx.fillText(commit.short_id, labelX, y);

      // Message + Body (Change 3: reclaimed right space, Change 6: inline body)
      const msgX = labelX + 64;
      const totalAvailWidth = width - msgX - 80; // Change 3: was -160, now -80 (time-group label area)
      ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;

      const fullMsgWidth = ctx.measureText(commit.message).width;
      if (fullMsgWidth <= totalAvailWidth) {
        // Message fits — draw it, then body if available
        ctx.fillStyle = COLOR_FG;
        ctx.fillText(commit.message, msgX, y);

        // Change 6: Draw body text after message
        if (commit.body) {
          const bodyGap = 8;
          const bodyX = msgX + fullMsgWidth + bodyGap;
          const bodyAvail = totalAvailWidth - fullMsgWidth - bodyGap;
          if (bodyAvail > 30) {
            ctx.fillStyle = COLOR_DIM;
            const bodyOneLine = commit.body.replace(/\n/g, " ").trim();
            const bodyText = truncateText(ctx, bodyOneLine, bodyAvail);
            ctx.fillText(bodyText, bodyX, y);

            // Store hit area for tooltip
            const drawnBodyWidth = ctx.measureText(bodyText).width;
            bodyHitAreas.push({
              x: bodyX,
              y: visRow * ROW_HEIGHT - scrollTop,
              width: drawnBodyWidth,
              height: ROW_HEIGHT,
              row: visRow,
              body: commit.body,
            });
          }
        }
      } else {
        // Message alone overflows — truncate it, no room for body
        ctx.fillStyle = COLOR_FG;
        ctx.fillText(truncateText(ctx, commit.message, totalAvailWidth), msgX, y);
      }

      // Change 3: removed author + time (was here)
    }

    // Change 3: Draw time-group separator lines
    ctx.font = `${SIZE_LABEL}px ${FONT_SANS}`;
    for (const [row, group] of timeGroupBoundaries) {
      if (row < firstVisibleRow || row > lastVisibleRow) continue;
      const separatorY = row * ROW_HEIGHT - scrollTop; // top edge of the first row in group

      // Faint horizontal line across the text area
      ctx.strokeStyle = COLOR_FAINT;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(textOffset, separatorY);
      ctx.lineTo(width - 12, separatorY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Right-aligned label with background clear-rect
      const label = group;
      const labelWidth = ctx.measureText(label).width;
      const labelPad = 6;
      const labelDrawX = width - labelWidth - 16;

      // Clear a gap in the line behind the label
      ctx.fillStyle = BG_PAGE;
      ctx.fillRect(labelDrawX - labelPad, separatorY - 7, labelWidth + labelPad * 2, 14);

      // Draw the label text
      ctx.fillStyle = COLOR_FAINT;
      ctx.fillText(label, labelDrawX, separatorY);
    }

    badgeHitAreasRef.current = hitAreas;
    bodyHitAreasRef.current = bodyHitAreas;
    avatarHitAreasRef.current = avatarHitAreas;
  }, [commits, edges, selectedCommitId, headCommitId, textOffset, hasWip, rowOffset, totalRows, branchMap, tagMap, getCommitColor, branches, isWipSelected, fileStatusCount, timeGroupBoundaries]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  // Keep a stable ref so async avatar-load callbacks always reach the latest draw.
  // Must be in an effect, not in render body, per react-hooks/refs rule.
  useEffect(() => {
    requestDrawRef.current = requestDraw;
  }, [requestDraw]);

  const handleScroll = useCallback(() => requestDraw(), [requestDraw]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const y = e.clientY - rect.top + scroll.scrollTop;
      const visRow = Math.floor((y - GRAPH_PADDING_TOP) / ROW_HEIGHT);

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
      const row = Math.floor((y - GRAPH_PADDING_TOP) / ROW_HEIGHT);

      const newHovered = row >= 0 && row < totalRows ? row : null;
      if (newHovered !== hoveredRowRef.current) {
        hoveredRowRef.current = newHovered;
        requestDrawRef.current();
      }

      // Change cursor to pointer when hovering a branch badge
      const overBadge = badgeHitAreasRef.current.some(
        (b) => mx >= b.x && mx <= b.x + b.width && my >= b.y && my <= b.y + b.height,
      );
      scroll.style.cursor = overBadge ? "pointer" : "";

      // Hover tooltips: body text and avatar
      const overBody = bodyHitAreasRef.current.find(
        (b) => mx >= b.x && mx <= b.x + b.width && my >= b.y && my <= b.y + b.height,
      );
      const overAvatar = !overBody
        ? avatarHitAreasRef.current.find(
            (a) => Math.hypot(mx - a.cx, my - a.cy) <= NODE_RADIUS,
          )
        : undefined;

      if (overBody) {
        if (!canvasHover || canvasHover.row !== overBody.row || canvasHover.type !== "body") {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
            setCanvasHover({
              type: "body",
              text: overBody.body,
              x: e.clientX,
              y: e.clientY,
              row: overBody.row,
            });
          }, 300);
        }
      } else if (overAvatar) {
        const commit = commits[overAvatar.commitIdx];
        if (commit && (!canvasHover || canvasHover.row !== overAvatar.row || canvasHover.type !== "avatar")) {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          const date = new Date(commit.timestamp * 1000);
          const dateStr = date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          hoverTimerRef.current = setTimeout(() => {
            setCanvasHover({
              type: "avatar",
              text: `${commit.author_name}\n${commit.author_email}\n${dateStr}`,
              x: e.clientX,
              y: e.clientY,
              row: overAvatar.row,
            });
          }, 300);
        }
      } else {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        if (canvasHover) setCanvasHover(null);
      }
    },
    [totalRows, canvasHover, commits],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredRowRef.current = null;
    requestDrawRef.current();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setCanvasHover(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onCommitContextMenu) return;
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const y = e.clientY - rect.top + scroll.scrollTop;
      const visRow = Math.floor((y - GRAPH_PADDING_TOP) / ROW_HEIGHT);
      const commitIdx = visRow - rowOffset;

      if (commitIdx >= 0 && commitIdx < commits.length) {
        e.preventDefault();
        onCommitContextMenu(commits[commitIdx].id, e.clientX, e.clientY);
      }
    },
    [commits, rowOffset, onCommitContextMenu],
  );

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
        onContextMenu={handleContextMenu}
      >
        <div style={{ height: Math.max(totalHeight, 1) }} />
      </div>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
      />

      {/* Change 6: Canvas tooltip overlay for commit body */}
      {canvasHover && (
        <div
          className="pointer-events-none fixed z-50 max-w-sm rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-lg"
          style={{
            left: canvasHover.x + 12,
            top: canvasHover.y + 12,
          }}
        >
          <p className="whitespace-pre-wrap">{canvasHover.text}</p>
        </div>
      )}
    </div>
  );
}

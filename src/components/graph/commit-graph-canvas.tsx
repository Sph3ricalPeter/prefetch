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

// ── Hierarchical branch color system ──────────────────────────────
// Root branches (main/dev) get fixed base colors. Known prefixes
// (feature/, fix/, etc.) derive from their parent's color with a
// hue shift + desaturation so lineage is visible at a glance.
// Unknown branches get their own base color from a palette.
// Remote-only branches use a darker tone instead of flat gray.

interface HSL { h: number; s: number; l: number }

function hslToHex({ h, s, l }: HSL): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Fixed base colors for well-known root branches
const MAIN_HSL: HSL = { h: 215, s: 80, l: 65 };  // blue
const DEV_HSL: HSL  = { h: 175, s: 85, l: 50 };  // cyan

// Palette for unknown root branches — spread across the hue wheel
const ROOT_PALETTE: HSL[] = [
  { h: 340, s: 82, l: 63 },  // pink
  { h: 50,  s: 88, l: 52 },  // gold
  { h: 280, s: 72, l: 65 },  // purple
  { h: 100, s: 78, l: 50 },  // green
  { h: 15,  s: 85, l: 58 },  // orange
  { h: 0,   s: 78, l: 60 },  // red
  { h: 195, s: 75, l: 55 },  // teal
  { h: 260, s: 68, l: 68 },  // lavender
];

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Determine base HSL + depth for a branch from its name */
function branchInfo(name: string): { base: HSL; depth: number; hash: number } {
  const clean = name.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  const h = strHash(clean);

  // Root: main / master
  if (clean === "main" || clean === "master")
    return { base: MAIN_HSL, depth: 0, hash: h };
  // Root: dev / develop
  if (clean === "dev" || clean === "develop" || clean === "development")
    return { base: DEV_HSL, depth: 0, hash: h };

  // Depth 1 from dev — feature / fix / chore work
  const devPrefixes = ["feature/", "feat/", "fix/", "hotfix/", "bugfix/", "chore/", "refactor/"];
  for (const p of devPrefixes) {
    if (clean.startsWith(p)) return { base: DEV_HSL, depth: 1, hash: h };
  }
  // Depth 1 from main — release branches
  if (clean.startsWith("release/") || clean.startsWith("rel/"))
    return { base: MAIN_HSL, depth: 1, hash: h };

  // Unknown branch → own root color from palette
  return { base: ROOT_PALETTE[h % ROOT_PALETTE.length], depth: 0, hash: h };
}

/** Derive color from a base at a given depth — shifts hue per sibling */
function deriveHsl(base: HSL, depth: number, hash: number): HSL {
  const d = Math.min(depth, 3);
  // Siblings get a ±25° hue shift so feature/a and feature/b are distinct
  const hueShift = d > 0 ? ((hash % 50) - 25) : 0;
  return {
    h: (base.h + hueShift + 360) % 360,
    s: Math.max(35, base.s - d * 14),
    l: Math.min(82, base.l + d * 6),
  };
}

/** Darker/muted variant for remote-only branches */
function darkenHsl(hsl: HSL): HSL {
  return {
    h: hsl.h,
    s: Math.max(20, hsl.s - 30),
    l: Math.max(28, hsl.l - 18),
  };
}

/** Display color for a branch (hex) */
function branchColor(name: string): string {
  const { base, depth, hash } = branchInfo(name);
  return hslToHex(deriveHsl(base, depth, hash));
}

/** Darker color for remote-only branches (hex) */
function branchColorDim(name: string): string {
  const { base, depth, hash } = branchInfo(name);
  return hslToHex(darkenHsl(deriveHsl(base, depth, hash)));
}

/** Fallback color for orphan commits (no branch ownership) — golden angle spacing */
function laneColor(lane: number): string {
  const h = (lane * 137.5) % 360;
  return hslToHex({ h, s: 70, l: 60 });
}

// Module-level avatar image cache — persists across renders and remounts.
// null = load attempted but failed (permanent fallback to initials).
const avatarCache = new Map<string, HTMLImageElement | null>();

/** Pick a readable text color (black or white) for a given hex background */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
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
  // Binary search for the longest prefix that fits with ellipsis — O(log n) measureText calls
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "\u2026").width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo > 0 ? text.slice(0, lo) + "\u2026" : "\u2026";
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
  const bColor = branchColor(group.baseName);
  const dimColor = branchColorDim(group.baseName);
  const isRemoteOnly = !group.local && !!group.remote;
  const bgAlpha = group.isHead ? 0.3 : 0.15;

  const bg = isRemoteOnly
    ? `${dimColor}${Math.round(0.15 * 255).toString(16).padStart(2, "0")}`
    : `${bColor}${Math.round(bgAlpha * 255)
        .toString(16)
        .padStart(2, "0")}`;
  const textCol = isRemoteOnly ? dimColor : bColor;

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

/** Draw a small stash/archive icon (layers/stack) */
function drawStashIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const w = 12;
  const h = 9;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Three stacked horizontal lines (archive/layers icon)
  ctx.beginPath();
  // Top layer (diamond shape)
  ctx.moveTo(x, y);
  ctx.lineTo(x + w / 2, y - h / 2);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w / 2, y + h / 2);
  ctx.closePath();
  ctx.stroke();
  // Middle line
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + w / 2, y + h / 2 + 2);
  ctx.lineTo(x + w, y + 2);
  ctx.stroke();
  ctx.restore();
  return w + 5;
}

/** Stored badge position for hit testing */
interface BadgeHitArea {
  x: number;
  y: number;
  width: number;
  height: number;
  branchName: string;
  row: number;
  stashIndex?: number;
  badgeType: "branch" | "tag" | "stash";
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
  onSelectStash?: (index: number) => void;
  onCommitContextMenu?: (commitId: string, x: number, y: number) => void;
  onStashContextMenu?: (index: number, x: number, y: number) => void;
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
  onSelectStash,
  onCommitContextMenu,
  onStashContextMenu,
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

  const stashMap = useMemo(() => {
    const map = new Map<string, StashInfo[]>();
    for (const s of stashes) {
      if (!s.parent_commit_id) continue;
      const commit = commits.find((c) => c.id.startsWith(s.parent_commit_id));
      if (commit) {
        const existing = map.get(commit.id) ?? [];
        existing.push(s);
        map.set(commit.id, existing);
      }
    }
    return map;
  }, [stashes, commits]);

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
      const brColor = branchColor(branch.name);
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

  // Pre-compute HEAD row info to avoid O(n) findIndex inside draw() on every frame
  const headInfo = useMemo(() => {
    let idx = headCommitId
      ? commits.findIndex((c) => c.id === headCommitId || c.id.startsWith(headCommitId))
      : -1;
    if (idx < 0) {
      const headBranch = branches.find((b) => b.is_head && !b.is_remote);
      if (headBranch) {
        idx = commits.findIndex((c) => c.id.startsWith(headBranch.commit_id));
      }
    }
    const isDetached = !branches.some((b) => b.is_head && !b.is_remote);
    const highlightColor = isDetached
      ? COLOR_MUTED
      : (idx >= 0 && commits[idx] ? (commitColorMap.get(commits[idx].id) ?? laneColor(commits[idx].lane)) : COLOR_FG);
    return { row: idx >= 0 ? idx + rowOffset : -1, isDetached, highlightColor };
  }, [headCommitId, commits, branches, rowOffset, commitColorMap]);

  // Pre-compute selected row to avoid O(n) findIndex inside draw() on every frame
  const selectedRowIdx = useMemo(() => {
    if (!selectedCommitId) return -1;
    const idx = commits.findIndex((c) => c.id === selectedCommitId);
    return idx >= 0 ? idx + rowOffset : -1;
  }, [selectedCommitId, commits, rowOffset]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = scroll.clientWidth;
    const height = scroll.clientHeight;
    // Guard: skip render when panel has been flex-shrunk to 0 (prevents blank screen)
    if (width <= 0 || height <= 0) return;
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
    const headRow = headInfo.row;
    const isDetachedHead = headInfo.isDetached;
    const headHighlightColor = headInfo.highlightColor;

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
    const selectedRow = selectedRowIdx;

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

    // --- Edges (offset by rowOffset) — batched by color to minimize stroke() calls ---
    ctx.lineWidth = 1.5;
    const edgesByColor = new Map<string, { fX: number; fY: number; tX: number; tY: number; sameLane: boolean }[]>();
    for (const edge of edges) {
      const fromRow = edge.from_row + rowOffset;
      const toRow = edge.to_row + rowOffset;
      if (fromRow > lastVisibleRow + 5 || toRow < firstVisibleRow - 5) continue;

      // Color first-parent edges by source commit (branch continuity),
      // merge-parent edges by target commit (shows incoming branch)
      let color: string;
      if (edge.edge_type === "Merge") {
        const toCommit = commits[edge.to_row];
        color = toCommit ? getCommitColor(toCommit) : laneColor(edge.to_lane);
      } else {
        const fromCommit = commits[edge.from_row];
        color = fromCommit ? getCommitColor(fromCommit) : laneColor(edge.from_lane);
      }

      let group = edgesByColor.get(color);
      if (!group) { group = []; edgesByColor.set(color, group); }
      group.push({
        fX: laneX(edge.from_lane),
        fY: fromRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2,
        tX: laneX(edge.to_lane),
        tY: toRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2,
        sameLane: edge.from_lane === edge.to_lane,
      });
    }
    ctx.globalAlpha = 0.7;
    for (const [color, segs] of edgesByColor) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s.fX, s.fY);
        if (s.sameLane) {
          ctx.lineTo(s.tX, s.tY);
        } else {
          const cp1Y = s.fY + (s.tY - s.fY) * 0.4;
          const cp2Y = s.fY + (s.tY - s.fY) * 0.6;
          ctx.bezierCurveTo(s.fX, cp1Y, s.tX, cp2Y, s.tX, s.tY);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

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

      // --- Labels (branches + tags + stashes) ---
      let labelX = textOffset;
      const commitBranches = branchMap.get(commit.id) ?? [];
      const commitTags = tagMap.get(commit.id) ?? [];
      const commitStashes = stashMap.get(commit.id) ?? [];
      const hasLabels = commitBranches.length > 0 || commitTags.length > 0 || commitStashes.length > 0;
      const maxLabelArea = 260; // Change 2: was 220

      if (hasLabels) {
        let usedWidth = 0;
        let labelCount = 0;
        const branchGroups = groupBranches(commitBranches);
        const totalLabels = branchGroups.length + commitTags.length + commitStashes.length;

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
            badgeType: "branch",
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
            badgeType: "tag",
          });
          usedWidth += w + LABEL_GAP;
          labelCount++;
        }

        // Draw stash pills
        for (const stash of commitStashes) {
          if (usedWidth > maxLabelArea - 40) {
            const remaining = totalLabels - labelCount;
            if (remaining > 0) {
              drawPill(ctx, labelX + usedWidth + LABEL_GAP, y, `+${remaining}`, "rgba(255,255,255,0.1)", COLOR_DIM);
            }
            break;
          }
          const stashPillX = labelX + usedWidth;
          // Truncate stash message for the pill
          ctx.font = `${SIZE_BODY}px ${FONT_SANS}`;
          const stashLabel = truncateText(ctx, stash.message, 120);
          const w = drawPill(ctx, stashPillX, y, stashLabel, "rgba(255,255,255,0.08)", COLOR_DIM, drawStashIcon);
          hitAreas.push({
            x: stashPillX,
            y: visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2 - LABEL_HEIGHT / 2,
            width: w,
            height: LABEL_HEIGHT,
            branchName: `stash@{${stash.index}}`,
            row: visRow,
            stashIndex: stash.index,
            badgeType: "stash",
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
  }, [commits, edges, headInfo, selectedRowIdx, textOffset, hasWip, rowOffset, totalRows, branchMap, tagMap, stashMap, getCommitColor, isWipSelected, fileStatusCount, timeGroupBoundaries]);

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

      // Check if double-click hit a badge
      for (const badge of badgeHitAreasRef.current) {
        if (
          clickX >= badge.x &&
          clickX <= badge.x + badge.width &&
          clickY >= badge.y &&
          clickY <= badge.y + badge.height
        ) {
          if (badge.stashIndex != null && onSelectStash) {
            onSelectStash(badge.stashIndex);
          } else {
            onCheckoutBranch(badge.branchName);
          }
          return;
        }
      }
    },
    [onCheckoutBranch, onSelectStash],
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
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top + scroll.scrollTop;

      // Check if right-click landed on a badge (stash or branch)
      for (const badge of badgeHitAreasRef.current) {
        if (
          clickX >= badge.x &&
          clickX <= badge.x + badge.width &&
          clickY >= badge.y &&
          clickY <= badge.y + badge.height
        ) {
          if (badge.badgeType === "stash" && badge.stashIndex != null && onStashContextMenu) {
            e.preventDefault();
            onStashContextMenu(badge.stashIndex, e.clientX, e.clientY);
            return;
          }
          // Branch and tag badges fall through to commit context menu
          break;
        }
      }

      // Fall back to commit context menu
      if (!onCommitContextMenu) return;
      const visRow = Math.floor((clickY - GRAPH_PADDING_TOP) / ROW_HEIGHT);
      const commitIdx = visRow - rowOffset;

      if (commitIdx >= 0 && commitIdx < commits.length) {
        e.preventDefault();
        onCommitContextMenu(commits[commitIdx].id, e.clientX, e.clientY);
      }
    },
    [commits, rowOffset, onCommitContextMenu, onStashContextMenu],
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

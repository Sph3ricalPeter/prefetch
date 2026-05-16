import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Monitor, ArrowUp, Tag, Archive } from "lucide-react";
import type {
  BranchInfo,
  CommitInfo,
  GraphEdge,
  StashInfo,
  TagInfo,
} from "@/types/git";
import { gravatarUrl } from "@/lib/gravatar";
import { searchUserAvatar } from "@/lib/commands";
import { useThemeStore, FONT_FAMILIES } from "@/stores/theme-store";

export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 20;
const NODE_RADIUS = 12;          // avatar diameter 24px
const CURVE_RADIUS = 6;          // Constant corner radius for cross-lane edges (GitKraken-style)
const SCROLLBAR_PAD = 6;         // visual breathing room for left edge
// Inset between the right edge of the badge column and the first graph lane.
// Small so node centers sit ~one node-radius into the graph column.
const GRAPH_INSET_LEFT = SCROLLBAR_PAD;
// Inset between the right edge of the graph column and the start of label / message text.
const MESSAGE_INSET_LEFT = 12;
const LABEL_HEIGHT = 24;         // badge pill height
const LABEL_PAD_X = 8;
const LABEL_GAP = 3;
const LABEL_RADIUS = 5;
const ROW_RADIUS = 6;            // Change 1: matches CSS rounded-md
const GRAPH_PADDING_TOP = 6;     // top padding matching left padding
const ROW_INSET = 2;             // vertical inset so row highlights don't touch

// Mutable font config — updated from the theme store before each draw() call.
// Module-level so standalone drawing helpers can read it without extra parameters.
const fontCfg = {
  sans: '"Inter", system-ui, sans-serif',
  sizeBody: 12,
  sizeLabel: 11,
};

// Graph colors are now provided by the active app theme via useThemeStore().
// See AppThemeGraph in src/lib/themes.ts for the shape.

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

// Tracks emails already tried for forge avatar lookup to avoid duplicate API calls.
// true = forge lookup in progress or completed (no result).
const forgeAvatarAttempted = new Set<string>();

/** Pick a readable text color (black or white) for a given hex background */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
}

/** Two-letter initials from author name (e.g. "Vojtech Vavera" → "VV") */
function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

/** Stable per-contributor color derived from email hash */
function authorColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  }
  const h = ((hash % 360) + 360) % 360;
  return hslToHex({ h, s: 55, l: 50 });
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

export type { DateFormatId } from "@/lib/date-format";
import { type DateFormatId } from "@/lib/date-format";

function formatRelativeDate(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  const date = new Date(timestamp * 1000);
  const thisYear = new Date().getFullYear();
  if (date.getFullYear() === thisYear) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDate(timestamp: number, fmt: DateFormatId, availWidth: number, ctx: CanvasRenderingContext2D): string {
  if (fmt === "relative") return formatRelativeDate(timestamp);
  const date = new Date(timestamp * 1000);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  const fits = (s: string) => ctx.measureText(s).width <= availWidth;

  if (fmt === "iso") {
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const isoTime = `${iso} ${time}`;
    if (fits(isoTime)) return isoTime;
    return iso;
  }
  const thisYear = new Date().getFullYear();
  const short = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const long = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  if (fmt === "long" || (fmt === "short" && date.getFullYear() !== thisYear)) {
    const longTime = `${long} ${time}`;
    if (fits(longTime)) return longTime;
    if (fits(long)) return long;
    return short;
  }
  const shortTime = `${short} ${time}`;
  if (fits(shortTime)) return shortTime;
  return short;
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

/** Draw a rounded rect pill and return its width. Pass `maxContentWidth` to
 *  truncate the text label so the pill fits a bounded area. Returns 0 if even
 *  the icon + ellipsis don't fit. */
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bgColor: string,
  textColor: string,
  drawIcon?: (ctx: CanvasRenderingContext2D, ix: number, iy: number, color: string) => number,
  maxContentWidth?: number,
): number {
  ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
  const iconWidth = drawIcon ? drawIcon(ctx, 0, -1000, textColor) : 0; // dry-run to measure width
  let displayText = text;
  if (maxContentWidth !== undefined) {
    const availTextW = maxContentWidth - LABEL_PAD_X * 2 - iconWidth;
    if (availTextW <= 0) return 0;
    displayText = truncateText(ctx, text, availTextW);
  }
  const textWidth = ctx.measureText(displayText).width;
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
  ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
  ctx.fillStyle = textColor;
  ctx.fillText(displayText, x + LABEL_PAD_X + iconWidth, y);

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

/** Draw a small checkmark icon — used to mark the current (HEAD) branch */
function drawCheckIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const w = 10;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + 1, y);
  ctx.lineTo(x + 4, y + 3);
  ctx.lineTo(x + w - 1, y - 4);
  ctx.stroke();
  ctx.restore();
  return w + 4; // icon + trailing gap
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

// Icon widths used during pill layout — kept as constants so dry-run measurement
// matches the actual draw.
const CHECK_ICON_W = 14;   // 10px glyph + 4px trailing gap
const LOCAL_ICON_W = 15;   // 11px glyph + 4px leading gap
const REMOTE_ICON_W = 12;  // 9px glyph + 3px leading gap

/** Layout: [check?] [name] [local?] [remote?]
 *  HEAD branch gets a leading checkmark; local / remote indicators sit on the
 *  right of the name (issue #38). Pass `maxContentWidth` to truncate the name
 *  so the pill fits a bounded area (e.g. the badge column). */
function drawMergedBranchPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  group: MergedBranchGroup,
  maxContentWidth?: number,
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

  const checkW = group.isHead ? CHECK_ICON_W : 0;
  let trailingIconsW = 0;
  if (group.local) trailingIconsW += LOCAL_ICON_W;
  if (group.remote) trailingIconsW += REMOTE_ICON_W;

  ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
  let displayName = group.baseName;
  if (maxContentWidth !== undefined) {
    const availTextW =
      maxContentWidth - LABEL_PAD_X * 2 - checkW - trailingIconsW;
    if (availTextW <= 0) return 0;
    displayName = truncateText(ctx, group.baseName, availTextW);
  }
  const textWidth = ctx.measureText(displayName).width;

  const pillWidth =
    LABEL_PAD_X + checkW + textWidth + trailingIconsW + LABEL_PAD_X;
  const pillY = y - LABEL_HEIGHT / 2;

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, pillY, pillWidth, LABEL_HEIGHT, LABEL_RADIUS);
  ctx.fill();

  let cursorX = x + LABEL_PAD_X;
  if (group.isHead) {
    drawCheckIcon(ctx, cursorX, y, textCol);
    cursorX += CHECK_ICON_W;
  }
  ctx.fillStyle = textCol;
  ctx.fillText(displayName, cursorX, y);
  cursorX += textWidth;
  if (group.local) {
    drawLocalIcon(ctx, cursorX, y, textCol);
    cursorX += LOCAL_ICON_W;
  }
  if (group.remote) {
    drawRemoteIcon(ctx, cursorX, y, textCol);
    cursorX += REMOTE_ICON_W;
  }

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

/** A ref shown in the hover dropdown when multiple refs sit on one commit (#39). */
interface DropdownRef {
  kind: "branch" | "tag" | "stash";
  refName: string;
  displayName: string;
  isHead: boolean;
  hasLocal: boolean;
  hasRemote: boolean;
  isRemoteOnly: boolean;
  /** Branch/tag color hex used for the row swatch. */
  color: string;
  stashIndex?: number;
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
  /** Populated when N>1 refs sit on this commit — drives the hover dropdown (#39). */
  dropdownItems?: DropdownRef[];
  /** Commit id this row corresponds to, used when an item selects the commit. */
  commitId?: string;
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

/** Stored author-column position for hover tooltip when email is truncated */
interface AuthorHitArea {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  tooltip: string;
}

/** Canvas hover info for tooltip overlay */
interface CanvasHoverInfo {
  type: "body" | "avatar" | "author";
  text: string;
  x: number;
  y: number;
  row: number;
}

/** Column widths driving the badge | graph | sha | message | author | date layout. */
export interface GraphColumnWidths {
  badge: number;
  graph: number;
  sha: number;
  author: number;
  date: number;
}

/** Which optional columns are visible (all hidden by default). */
export interface GraphColumnVisibility {
  sha: boolean;
  author: boolean;
  date: boolean;
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
  /** Optional `focusRefName` scopes branch/tag actions to a single ref — used by
   *  the hover dropdown so right-clicking a specific item shows only its actions. */
  onCommitContextMenu?: (
    commitId: string,
    x: number,
    y: number,
    focusRefName?: string,
  ) => void;
  onStashContextMenu?: (index: number, x: number, y: number) => void;
  columnWidths: GraphColumnWidths;
  columnVisibility: GraphColumnVisibility;
  dateFormat: DateFormatId;
  /** Ref name → unix timestamp of its tip commit. Drives MRU edge-draw order. */
  refMru: Map<string, number>;
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
  columnWidths,
  columnVisibility,
  dateFormat,
  refMru,
}: CommitGraphCanvasProps) {
  const graphColors = useThemeStore((s) => s.appTheme.graph);
  const fontFamilyId = useThemeStore((s) => s.fontFamilyId);
  const fontScale = useThemeStore((s) => s.fontScale);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredRowRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const badgeHitAreasRef = useRef<BadgeHitArea[]>([]);
  const bodyHitAreasRef = useRef<BodyHitArea[]>([]);       // Change 6
  const avatarHitAreasRef = useRef<AvatarHitArea[]>([]);
  const authorHitAreasRef = useRef<AuthorHitArea[]>([]);
  const [canvasHover, setCanvasHover] = useState<CanvasHoverInfo | null>(null); // Change 6
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);     // Change 6
  // Hover dropdown state (#39) — opens when pointer rests over a badge whose
  // commit has multiple refs. Anchored to the badge's left edge.
  const [hoverDropdown, setHoverDropdown] = useState<{
    row: number;
    commitId: string;
    items: DropdownRef[];
    /** Container-relative coords for the dropdown anchor. */
    x: number;
    y: number;
  } | null>(null);
  const openHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref so async avatar-load callbacks always reach the latest draw
  const requestDrawRef = useRef<() => void>(() => {});

  const hasWip = hasUncommittedChanges;
  const rowOffset = hasWip ? 1 : 0;
  // Column-driven layout: badge | graph | [sha] | message | [author] | [date]
  const graphLeft = columnWidths.badge + GRAPH_INSET_LEFT;
  const shaColLeft = columnWidths.badge + columnWidths.graph;
  const shaEffW = columnVisibility.sha ? columnWidths.sha : 0;
  const msgLeft = shaColLeft + shaEffW + MESSAGE_INSET_LEFT;
  // totalLanes is unused inside the canvas now (column widths drive layout) but the
  // parent panel uses it to size the default graph column width and clamp the resize.
  void totalLanes;
  const laneX = useCallback(
    (lane: number) => graphLeft + lane * LANE_WIDTH + LANE_WIDTH / 2,
    [graphLeft],
  );
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
        // Follow all parents so merge-parent commits (e.g. remote
        // side of a git-pull merge) get the correct branch color.
        for (const pid of commit.parent_ids) {
          queue.push(pid);
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

  // Map each branch color to the MRU timestamp of the most recent branch that
  // resolves to that color. Used to sort the edge draw order so the most
  // recently updated branch's lines paint on top.
  const colorMru = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of branches) {
      const baseName = b.is_remote ? b.name.replace(/^[^/]+\//, "") : b.name;
      const color = branchColor(baseName);
      const ts = refMru.get(b.name) ?? 0;
      const prev = map.get(color);
      if (prev === undefined || ts > prev) map.set(color, ts);
    }
    return map;
  }, [branches, refMru]);

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
      ? graphColors.muted
      : (idx >= 0 && commits[idx] ? (commitColorMap.get(commits[idx].id) ?? laneColor(commits[idx].lane)) : graphColors.fg);
    return { row: idx >= 0 ? idx + rowOffset : -1, isDetached, highlightColor };
  }, [headCommitId, commits, branches, rowOffset, commitColorMap, graphColors]);

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

    // Sync module-level font config so all drawing helpers use current settings
    const family = FONT_FAMILIES.find((f) => f.id === fontFamilyId) ?? FONT_FAMILIES[0];
    fontCfg.sans = family.value;
    fontCfg.sizeBody = Math.round(12 * fontScale);
    fontCfg.sizeLabel = Math.round(11 * fontScale);

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
    const authorHitAreas: AuthorHitArea[] = [];

    // --- HEAD row highlight (permanent "you are here") ---
    const headRow = headInfo.row;
    const isDetachedHead = headInfo.isDetached;
    const headHighlightColor = headInfo.highlightColor;

    // Row highlight rect starts at the avatar's left edge so the badge column
    // stays unhighlighted. Falls back to the canvas left for rows without a
    // commit (e.g. WIP).
    const HIGHLIGHT_LEFT_PAD = 5;
    const rowHighlightLeft = (visRow: number): number => {
      const commitIdx = visRow - rowOffset;
      if (commitIdx >= 0 && commitIdx < commits.length) {
        return laneX(commits[commitIdx].lane) - NODE_RADIUS - HIGHLIGHT_LEFT_PAD;
      }
      // WIP row uses HEAD's lane
      if (hasWip && visRow === 0) {
        const hci = headRow >= 0 ? headRow - rowOffset : -1;
        if (hci >= 0 && hci < commits.length) {
          return laneX(commits[hci].lane) - NODE_RADIUS - HIGHLIGHT_LEFT_PAD;
        }
      }
      return SCROLLBAR_PAD;
    };
    const fillRowHighlight = (visRow: number) => {
      const left = rowHighlightLeft(visRow);
      ctx.beginPath();
      ctx.roundRect(
        left,
        visRow * ROW_HEIGHT - scrollTop + ROW_INSET,
        width - left,
        ROW_HEIGHT - ROW_INSET * 2,
        ROW_RADIUS,
      );
      ctx.fill();
    };

    if (headRow >= firstVisibleRow && headRow <= lastVisibleRow) {
      ctx.fillStyle = headHighlightColor;
      ctx.globalAlpha = isDetachedHead ? 0.12 : 0.08;
      fillRowHighlight(headRow);
      ctx.globalAlpha = 1;
    }

    // --- Selected row highlight ---
    const selectedRow = selectedRowIdx;

    if (selectedRow >= firstVisibleRow && selectedRow <= lastVisibleRow) {
      if (selectedRow === headRow) {
        ctx.fillStyle = headHighlightColor;
        ctx.globalAlpha = isDetachedHead ? 0.22 : 0.18;
        fillRowHighlight(selectedRow);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = graphColors.bgSelected;
        fillRowHighlight(selectedRow);
      }
    }

    // WIP row selected highlight
    if (isWipSelected && hasWip && 0 >= firstVisibleRow && 0 <= lastVisibleRow) {
      ctx.fillStyle = graphColors.bgSelected;
      fillRowHighlight(0);
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
        fillRowHighlight(hoveredRow);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = graphColors.bgHover;
        fillRowHighlight(hoveredRow);
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
    // Sort by MRU ascending so the most recently updated branch's color paints
    // last (i.e. on top of older branches). Unknown colors (lane fallbacks) get
    // 0 and draw underneath.
    const sortedColors = Array.from(edgesByColor.entries()).sort(
      (a, b) => (colorMru.get(a[0]) ?? 0) - (colorMru.get(b[0]) ?? 0),
    );
    for (const [color, segs] of sortedColors) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s.fX, s.fY);
        if (s.sameLane) {
          ctx.lineTo(s.tX, s.tY);
        } else {
          // GitKraken-style L-shaped edge: horizontal from source to
          // target's lane, one constant-radius corner, then vertical
          // straight down into the target node from above.
          const maxR = Math.min(Math.abs(s.tY - s.fY), Math.abs(s.tX - s.fX));
          const r = Math.min(CURVE_RADIUS, maxR);
          ctx.arcTo(s.tX, s.fY, s.tX, s.tY, r);
          ctx.lineTo(s.tX, s.tY);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- WIP row ---
    if (hasWip && firstVisibleRow === 0) {
      const wipY = ROW_HEIGHT / 2 - scrollTop;
      // Place WIP node on HEAD's lane, not commits[0]'s lane
      const headCommitIdx = headRow >= 0 ? headRow - rowOffset : -1;
      const headCommit = headCommitIdx >= 0 ? commits[headCommitIdx] : null;
      const nodeX = headCommit ? laneX(headCommit.lane) : (commits.length > 0 ? laneX(commits[0].lane) : laneX(0));

      // Connect WIP to HEAD commit with a dashed line
      if (headCommit) {
        const headY = headRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
        ctx.strokeStyle = getCommitColor(headCommit);
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(nodeX, wipY);
        ctx.lineTo(nodeX, headY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else if (commits.length > 0) {
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
      ctx.strokeStyle = graphColors.dim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(nodeX, wipY, NODE_RADIUS, 0, Math.PI * 2);
      if (isWipSelected) {
        ctx.fillStyle = graphColors.faint;
        ctx.fill();
      }
      ctx.stroke();

      // File edit icon + change count
      const wipTextColor = graphColors.muted;
      const wipIconW = drawFileEditIcon(ctx, msgLeft, wipY, wipTextColor);
      ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
      ctx.fillStyle = wipTextColor;
      const changeText =
        fileStatusCount === 1 ? "1 change" : `${fileStatusCount} changes`;
      ctx.fillText(changeText, msgLeft + wipIconW, wipY);
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
            // Gravatar failed -- try forge API as fallback
            if (!forgeAvatarAttempted.has(email)) {
              forgeAvatarAttempted.add(email);
              searchUserAvatar(email).then((url) => {
                if (url) {
                  const forgeImg = new Image();
                  forgeImg.crossOrigin = "anonymous";
                  forgeImg.src = url;
                  forgeImg.onload = () => {
                    avatarCache.set(email, forgeImg);
                    requestDrawRef.current();
                  };
                }
              }).catch(() => {});
            }
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
          // Fallback -- stable-color circle with two-letter initials
          const avatarBg = authorColor(email);
          ctx.beginPath();
          ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = avatarBg;
          ctx.fill();
          ctx.save();
          ctx.fillStyle = contrastText(avatarBg);
          const initials = authorInitials(commit.author_name);
          const fontSize = initials.length > 1 ? Math.round(NODE_RADIUS * 0.95) : Math.round(NODE_RADIUS * 1.2);
          ctx.font = `bold ${fontSize}px ${fontCfg.sans}`;
          ctx.textAlign = "center";
          ctx.fillText(initials, x, y);
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

      // --- Badge column (left of graph): primary ref + optional +N indicator ---
      const commitBranches = branchMap.get(commit.id) ?? [];
      const commitTags = tagMap.get(commit.id) ?? [];
      const commitStashes = stashMap.get(commit.id) ?? [];
      const branchGroups = groupBranches(commitBranches);

      // Unified, MRU-sorted list of refs at this commit. Branches sort with HEAD
      // already promoted by groupBranches; refMru breaks remaining ties.
      const badgeItems: Array<
        | { kind: "branch"; group: MergedBranchGroup; refName: string; mru: number }
        | { kind: "tag"; tag: TagInfo; refName: string; mru: number }
        | { kind: "stash"; stash: StashInfo; refName: string; mru: number }
      > = [];
      for (const g of branchGroups) {
        const refName = g.local?.name ?? g.remote?.name ?? g.baseName;
        badgeItems.push({ kind: "branch", group: g, refName, mru: refMru.get(refName) ?? 0 });
      }
      for (const t of commitTags) {
        badgeItems.push({ kind: "tag", tag: t, refName: t.name, mru: refMru.get(t.name) ?? 0 });
      }
      for (const s of commitStashes) {
        badgeItems.push({
          kind: "stash",
          stash: s,
          refName: `stash@{${s.index}}`,
          mru: 0,
        });
      }
      // HEAD branch always primary; otherwise MRU desc.
      badgeItems.sort((a, b) => {
        const aHead = a.kind === "branch" && a.group.isHead ? 1 : 0;
        const bHead = b.kind === "branch" && b.group.isHead ? 1 : 0;
        if (aHead !== bHead) return bHead - aHead;
        return b.mru - a.mru;
      });

      if (badgeItems.length > 0) {
        const primary = badgeItems[0];
        const extra = badgeItems.length - 1;
        // Left-aligned inside the badge column with small left inset; reserve a
        // small right gap before the link starts.
        const badgeColLeft = SCROLLBAR_PAD + 6;
        const badgeColRight = columnWidths.badge - 6;
        const totalAvail = Math.max(0, badgeColRight - badgeColLeft);

        // Measure +N chip
        let nChipW = 0;
        if (extra > 0) {
          ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
          nChipW = ctx.measureText(`+${extra}`).width + LABEL_PAD_X * 2;
        }
        const gapBeforeChip = extra > 0 ? LABEL_GAP : 0;
        const maxPrimaryW = Math.max(0, totalAvail - nChipW - gapBeforeChip);

        // Draw primary pill
        let primaryW = 0;
        let primaryColor = graphColors.dim;
        if (maxPrimaryW > 20) {
          if (primary.kind === "branch") {
            primaryW = drawMergedBranchPill(ctx, badgeColLeft, y, primary.group, maxPrimaryW);
            primaryColor = branchColor(primary.group.baseName);
          } else if (primary.kind === "tag") {
            primaryW = drawPill(
              ctx,
              badgeColLeft,
              y,
              primary.tag.name,
              "rgba(255,255,255,0.08)",
              graphColors.dim,
              drawTagIcon,
              maxPrimaryW,
            );
          } else {
            primaryW = drawPill(
              ctx,
              badgeColLeft,
              y,
              primary.stash.message,
              "rgba(255,255,255,0.08)",
              graphColors.dim,
              drawStashIcon,
              maxPrimaryW,
            );
          }
        }

        // Build dropdown ref list when there are stacked refs (drives #39).
        let dropdownItems: DropdownRef[] | undefined;
        if (extra > 0) {
          dropdownItems = badgeItems.map((it): DropdownRef => {
            if (it.kind === "branch") {
              const g = it.group;
              return {
                kind: "branch",
                refName: it.refName,
                displayName: g.baseName,
                isHead: g.isHead,
                hasLocal: !!g.local,
                hasRemote: !!g.remote,
                isRemoteOnly: !g.local && !!g.remote,
                color: branchColor(g.baseName),
              };
            }
            if (it.kind === "tag") {
              return {
                kind: "tag",
                refName: it.refName,
                displayName: it.tag.name,
                isHead: false,
                hasLocal: false,
                hasRemote: false,
                isRemoteOnly: false,
                color: graphColors.dim,
              };
            }
            return {
              kind: "stash",
              refName: it.refName,
              displayName: it.stash.message,
              isHead: false,
              hasLocal: false,
              hasRemote: false,
              isRemoteOnly: false,
              color: graphColors.dim,
              stashIndex: it.stash.index,
            };
          });
        }

        // Hit area for the primary badge — preserves single-click select-stash
        // and double-click checkout behavior at the new badge location.
        if (primaryW > 0) {
          // Hit area spans badge + +N chip so hover-open works over either.
          const hitWidth =
            primaryW + (extra > 0 ? LABEL_GAP + nChipW : 0);
          hitAreas.push({
            x: badgeColLeft,
            y: visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2 - LABEL_HEIGHT / 2,
            width: hitWidth,
            height: LABEL_HEIGHT,
            branchName: primary.refName,
            row: visRow,
            stashIndex: primary.kind === "stash" ? primary.stash.index : undefined,
            badgeType: primary.kind,
            dropdownItems,
            commitId: commit.id,
          });
        }

        // +N chip (non-interactive in this pass — hover dropdown lands in #39)
        if (extra > 0 && primaryW > 0) {
          drawPill(
            ctx,
            badgeColLeft + primaryW + LABEL_GAP,
            y,
            `+${extra}`,
            "rgba(255,255,255,0.1)",
            graphColors.dim,
          );
        }

        // Link from right edge of badge content to the commit node, colored
        // by the primary badge so lineage is visible.
        if (primaryW > 0) {
          const linkStartX =
            badgeColLeft + primaryW + (extra > 0 ? LABEL_GAP + nChipW : 0) + 2;
          const linkEndX = x - NODE_RADIUS - 2;
          if (linkEndX > linkStartX + 1) {
            ctx.save();
            ctx.strokeStyle = primaryColor;
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(linkStartX, y);
            ctx.lineTo(linkEndX, y);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // --- Column drawing: [SHA] | Message | [Author] | [Date] ---
      const dateEffW = columnVisibility.date ? columnWidths.date : 0;
      const authorEffW = columnVisibility.author ? columnWidths.author : 0;
      const rightColsW = dateEffW + authorEffW;
      const authorColLeft = width - rightColsW;
      const dateColLeft = width - dateEffW;

      // SHA column
      if (columnVisibility.sha) {
        ctx.font = `${fontCfg.sizeLabel}px ${fontCfg.sans}`;
        ctx.fillStyle = graphColors.dim;
        ctx.fillText(commit.short_id, shaColLeft + 8, y);
      }

      // Message + Body
      const msgRight = rightColsW > 0 ? authorColLeft - 8 : width - 16;
      const msgAvail = Math.max(0, msgRight - msgLeft);
      ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;

      const fullMsgWidth = ctx.measureText(commit.message).width;
      if (fullMsgWidth <= msgAvail) {
        ctx.fillStyle = graphColors.fg;
        ctx.fillText(commit.message, msgLeft, y);

        if (commit.body) {
          const bodyGap = 8;
          const bodyX = msgLeft + fullMsgWidth + bodyGap;
          const bodyAvailW = msgAvail - fullMsgWidth - bodyGap;
          if (bodyAvailW > 30) {
            ctx.fillStyle = graphColors.dim;
            const bodyOneLine = commit.body.replace(/\n/g, " ").trim();
            const bodyText = truncateText(ctx, bodyOneLine, bodyAvailW);
            ctx.fillText(bodyText, bodyX, y);

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
        ctx.fillStyle = graphColors.fg;
        ctx.fillText(truncateText(ctx, commit.message, msgAvail), msgLeft, y);
      }

      // Author column — show name + email when space allows
      if (columnVisibility.author) {
        ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
        const authorPad = 8;
        const authorAvail = authorEffW - authorPad * 2;
        const authorX = authorColLeft + authorPad;
        let emailShown = false;
        if (authorAvail > 10) {
          const nameW = ctx.measureText(commit.author_name).width;
          const emailGap = 6;
          const remaining = authorAvail - nameW - emailGap;

          if (remaining > 10 && commit.author_email) {
            ctx.fillStyle = graphColors.fg;
            ctx.fillText(commit.author_name, authorX, y);
            ctx.fillStyle = graphColors.dim;
            const emailText = truncateText(ctx, commit.author_email, remaining);
            ctx.fillText(emailText, authorX + nameW + emailGap, y);
            emailShown = ctx.measureText(commit.author_email).width <= remaining;
          } else {
            ctx.fillStyle = graphColors.fg;
            ctx.fillText(truncateText(ctx, commit.author_name, authorAvail), authorX, y);
          }

          if (!emailShown) {
            authorHitAreas.push({
              x: authorX,
              y: visRow * ROW_HEIGHT - scrollTop,
              width: authorAvail,
              height: ROW_HEIGHT,
              row: visRow,
              tooltip: `${commit.author_name} <${commit.author_email}>`,
            });
          }
        }
      }

      // Date column
      if (columnVisibility.date) {
        ctx.font = `${fontCfg.sizeLabel}px ${fontCfg.sans}`;
        ctx.fillStyle = graphColors.dim;
        const dateAvail = dateEffW - 16;
        if (dateAvail > 10) {
          ctx.fillText(formatDate(commit.timestamp, dateFormat, dateAvail, ctx), dateColLeft + 8, y);
        }
      }
    }

    // Draw time-group separator lines — label right-aligned within the message column
    ctx.font = `${fontCfg.sizeLabel}px ${fontCfg.sans}`;
    const tgDateEffW = columnVisibility.date ? columnWidths.date : 0;
    const tgAuthorEffW = columnVisibility.author ? columnWidths.author : 0;
    const tgRightColsW = tgDateEffW + tgAuthorEffW;
    const tgMsgRight = tgRightColsW > 0 ? width - tgRightColsW - 8 : width - 16;
    for (const [row, group] of timeGroupBoundaries) {
      if (row < firstVisibleRow || row > lastVisibleRow) continue;
      const separatorY = row * ROW_HEIGHT - scrollTop;

      // Faint horizontal line — spans from message start all the way to the right
      ctx.strokeStyle = graphColors.faint;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(msgLeft, separatorY);
      ctx.lineTo(width - 12, separatorY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Right-aligned label within the message column area
      const label = group;
      const labelWidth = ctx.measureText(label).width;
      const labelPad = 6;
      const labelDrawX = tgMsgRight - labelWidth - 8;

      ctx.fillStyle = graphColors.bgPage;
      ctx.fillRect(labelDrawX - labelPad, separatorY - 7, labelWidth + labelPad * 2, 14);

      ctx.fillStyle = graphColors.faint;
      ctx.fillText(label, labelDrawX, separatorY);
    }

    badgeHitAreasRef.current = hitAreas;
    bodyHitAreasRef.current = bodyHitAreas;
    avatarHitAreasRef.current = avatarHitAreas;
    authorHitAreasRef.current = authorHitAreas;
  }, [commits, edges, headInfo, selectedRowIdx, msgLeft, shaColLeft, laneX, hasWip, rowOffset, totalRows, branchMap, tagMap, stashMap, getCommitColor, colorMru, refMru, columnWidths, columnVisibility, dateFormat, isWipSelected, fileStatusCount, timeGroupBoundaries, graphColors, fontFamilyId, fontScale]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  // Keep a stable ref so async avatar-load callbacks always reach the latest draw.
  // Must be in an effect, not in render body, per react-hooks/refs rule.
  useEffect(() => {
    requestDrawRef.current = requestDraw;
  }, [requestDraw]);

  const handleScroll = useCallback(() => {
    requestDraw();
    // Close the hover dropdown — its anchor is in canvas coords which scroll away.
    if (openHoverTimer.current) {
      clearTimeout(openHoverTimer.current);
      openHoverTimer.current = null;
    }
    if (closeHoverTimer.current) {
      clearTimeout(closeHoverTimer.current);
      closeHoverTimer.current = null;
    }
    setHoverDropdown(null);
  }, [requestDraw]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if click hit a stash badge
      for (const badge of badgeHitAreasRef.current) {
        if (
          badge.stashIndex != null &&
          clickX >= badge.x &&
          clickX <= badge.x + badge.width &&
          clickY >= badge.y &&
          clickY <= badge.y + badge.height
        ) {
          if (onSelectStash) onSelectStash(badge.stashIndex);
          return;
        }
      }

      const y = clickY + scroll.scrollTop;
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
    [commits, selectedCommitId, onSelectCommit, onSelectStash, hasWip, rowOffset, onClickWip],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const rect = scroll.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if double-click hit a branch badge → checkout
      for (const badge of badgeHitAreasRef.current) {
        if (
          badge.badgeType === "branch" &&
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
      const overBadgeArea = badgeHitAreasRef.current.find(
        (b) => mx >= b.x && mx <= b.x + b.width && my >= b.y && my <= b.y + b.height,
      );
      const overBadge = !!overBadgeArea;
      scroll.style.cursor = overBadge ? "pointer" : "";

      // Hover dropdown (#39): open after 150ms over a badge with stacked refs;
      // close after 200ms when pointer leaves the badge (cancelled if it enters
      // the dropdown).
      if (overBadgeArea && overBadgeArea.dropdownItems && overBadgeArea.commitId) {
        if (closeHoverTimer.current) {
          clearTimeout(closeHoverTimer.current);
          closeHoverTimer.current = null;
        }
        const sameRow = hoverDropdown && hoverDropdown.row === overBadgeArea.row;
        if (!sameRow && !openHoverTimer.current) {
          const targetRow = overBadgeArea.row;
          const items = overBadgeArea.dropdownItems;
          const commitId = overBadgeArea.commitId;
          const ax = overBadgeArea.x;
          const ay = overBadgeArea.y + overBadgeArea.height + 2;
          openHoverTimer.current = setTimeout(() => {
            openHoverTimer.current = null;
            setHoverDropdown({ row: targetRow, commitId, items, x: ax, y: ay });
          }, 150);
        }
      } else {
        if (openHoverTimer.current) {
          clearTimeout(openHoverTimer.current);
          openHoverTimer.current = null;
        }
        if (hoverDropdown && !closeHoverTimer.current) {
          closeHoverTimer.current = setTimeout(() => {
            closeHoverTimer.current = null;
            setHoverDropdown(null);
          }, 200);
        }
      }

      // Hover tooltips: body text and avatar
      const overBody = bodyHitAreasRef.current.find(
        (b) => mx >= b.x && mx <= b.x + b.width && my >= b.y && my <= b.y + b.height,
      );
      const overAvatar = !overBody
        ? avatarHitAreasRef.current.find(
            (a) => Math.hypot(mx - a.cx, my - a.cy) <= NODE_RADIUS,
          )
        : undefined;
      const overAuthor = !overBody && !overAvatar
        ? authorHitAreasRef.current.find(
            (a) => mx >= a.x && mx <= a.x + a.width && my >= a.y && my <= a.y + a.height,
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
      } else if (overAuthor) {
        if (!canvasHover || canvasHover.row !== overAuthor.row || canvasHover.type !== "author") {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
            setCanvasHover({
              type: "author",
              text: overAuthor.tooltip,
              x: e.clientX,
              y: e.clientY,
              row: overAuthor.row,
            });
          }, 300);
        }
      } else {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        if (canvasHover) setCanvasHover(null);
      }
    },
    [totalRows, canvasHover, commits, hoverDropdown],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredRowRef.current = null;
    requestDrawRef.current();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setCanvasHover(null);
    // Don't close the dropdown immediately — pointer may be travelling toward it.
    if (openHoverTimer.current) {
      clearTimeout(openHoverTimer.current);
      openHoverTimer.current = null;
    }
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

  // Hover dropdown is closed by the local event handlers (single-click in the
  // dropdown, mouseLeave, scroll, Esc) — external selection changes leave it
  // alone, and the next pointer move will dismiss it naturally.

  // Esc closes the hover dropdown (#39).
  useEffect(() => {
    if (!hoverDropdown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHoverDropdown(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverDropdown]);

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

      {/* Hover dropdown listing every ref on a multi-ref commit (#39). */}
      {hoverDropdown && (
        <div
          className="absolute z-40 min-w-[180px] border border-border bg-card shadow-lg overflow-hidden p-px"
          style={{ borderRadius: LABEL_RADIUS, left: hoverDropdown.x, top: hoverDropdown.y }}
          onMouseEnter={() => {
            if (closeHoverTimer.current) {
              clearTimeout(closeHoverTimer.current);
              closeHoverTimer.current = null;
            }
          }}
          onMouseLeave={() => {
            if (closeHoverTimer.current) clearTimeout(closeHoverTimer.current);
            closeHoverTimer.current = setTimeout(() => {
              closeHoverTimer.current = null;
              setHoverDropdown(null);
            }, 200);
          }}
        >
          {hoverDropdown.items.map((it, idx) => (
            <DropdownItemRow
              key={`${it.kind}:${it.refName}:${idx}`}
              item={it}
              onSingleClick={(e) => {
                // Don't close on single click — the browser may still be in the
                // middle of dispatching a double-click. Action fires either way.
                if (it.kind === "stash" && it.stashIndex != null) {
                  onSelectStash?.(it.stashIndex);
                } else {
                  onSelectCommit(
                    hoverDropdown.commitId === selectedCommitId
                      ? null
                      : hoverDropdown.commitId,
                  );
                }
                e.stopPropagation();
              }}
              onDoubleClick={(e) => {
                // Double-click triggers checkout — close the dropdown as the
                // user has committed to an action.
                if (it.kind === "branch" || it.kind === "tag") {
                  onCheckoutBranch(it.refName);
                  setHoverDropdown(null);
                }
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                // Show the context menu but leave the dropdown open so the
                // user can still see / interact with siblings. Dismissal
                // happens only on mouse-out, scroll, or Esc.
                e.preventDefault();
                if (it.kind === "stash" && it.stashIndex != null && onStashContextMenu) {
                  onStashContextMenu(it.stashIndex, e.clientX, e.clientY);
                } else if (onCommitContextMenu) {
                  onCommitContextMenu(
                    hoverDropdown.commitId,
                    e.clientX,
                    e.clientY,
                    it.refName,
                  );
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Single row inside the hover dropdown — styled as a mini-badge that mirrors the
 *  canvas badge visual: colored background tint, optional HEAD checkmark on the
 *  left, name, then local/remote indicator icons on the right. */
function DropdownItemRow({
  item,
  onSingleClick,
  onDoubleClick,
  onContextMenu,
}: {
  item: DropdownRef;
  onSingleClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const isStash = item.kind === "stash";
  const isTag = item.kind === "tag";
  const isBranch = item.kind === "branch";
  // Tint matches the canvas pill — 0.3 alpha for HEAD, 0.15 otherwise. Stashes
  // and tags share a neutral muted background.
  const bgStyle =
    isBranch && !item.isRemoteOnly
      ? { backgroundColor: `${item.color}${item.isHead ? "4d" : "26"}` } // hex alpha 4d≈0.3, 26≈0.15
      : { backgroundColor: "rgba(255,255,255,0.06)" };
  const colorStyle = { color: isBranch ? item.color : undefined };

  return (
    <div
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 text-xs hover:brightness-125"
      style={{ ...bgStyle, height: LABEL_HEIGHT, borderRadius: LABEL_RADIUS }}
    >
      {item.isHead && (
        <Check className="h-3 w-3 shrink-0" style={colorStyle} aria-hidden="true" />
      )}
      {isTag && (
        <Tag className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      {isStash && (
        <Archive className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span
        className={`truncate ${isBranch ? "" : "text-muted-foreground"}`}
        style={isBranch ? colorStyle : undefined}
      >
        {item.displayName}
      </span>
      {item.hasLocal && (
        <Monitor className="ml-auto h-3 w-3 shrink-0" style={colorStyle} aria-hidden="true" />
      )}
      {item.hasRemote && (
        <ArrowUp className={`h-3 w-3 shrink-0 ${item.hasLocal ? "" : "ml-auto"}`} style={colorStyle} aria-hidden="true" />
      )}
    </div>
  );
}

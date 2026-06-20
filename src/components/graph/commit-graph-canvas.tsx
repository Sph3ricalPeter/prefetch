import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Monitor, Cloud, Tag, Archive } from "lucide-react";
import type {
  BranchInfo,
  CommitInfo,
  GraphEdge,
  StashInfo,
  TagInfo,
} from "@/types/git";
import { loadAvatarForEmail } from "@/lib/avatar-load";
import { parseCommitType, COMMIT_TYPE_META, COMMIT_TYPE_ICON_NODES } from "@/lib/commit-type";
import { getInitials as authorInitials, getAvatarColor as authorColor, getContrastColor as contrastText, detectBot, type BotInfo, drawProfileIconOnCanvas, getProfileIcon, darkenHex } from "@/lib/avatar";
import { useThemeStore, FONT_FAMILIES } from "@/stores/theme-store";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";

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
const TYPE_ICON_SIZE = 13;
const TYPE_ICON_GAP = 5;
const LABEL_HEIGHT = 24;         // badge pill height
const LABEL_PAD_X = 8;
const LABEL_RADIUS = 5;
const ROW_RADIUS = 6;            // Change 1: matches CSS rounded-md
const GRAPH_PADDING_TOP = 6;     // top padding matching left padding
const ROW_INSET = 2;             // vertical inset so row highlights don't touch
const GRAPH_DIM_ALPHA = 0.25;    // opacity for commit rows that don't match the filter
const SEARCH_HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.28)"; // amber, matches the diff/log search highlight

// Mutable font config — updated from the theme store before each draw() call.
// Module-level so standalone drawing helpers can read it without extra parameters.
const fontCfg = {
  sans: '"Inter", system-ui, sans-serif',
  sizeBody: 12,
  sizeLabel: 11,
};

// Cached Intl.DateTimeFormat instances — toLocaleDateString() recreates one
// internally on every call (~100x slower than reusing a formatter).
const intlDateShort = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const intlDateLong = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const intlDateFull = new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

// Per-frame text-width cache — avoids redundant ctx.measureText() calls for
// identical font+text combos within a single draw pass. Cleared at the top of draw().
let textWidthCache = new Map<string, number>();

function cachedMeasureText(ctx: CanvasRenderingContext2D, text: string): number {
  const key = `${ctx.font}\0${text}`;
  let w = textWidthCache.get(key);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    textWidthCache.set(key, w);
  }
  return w;
}

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

/** Color for a lane — used for commits not on any active branch's first-parent chain */
function laneColor(lane: number): string {
  return hslToHex(ROOT_PALETTE[lane % ROOT_PALETTE.length]);
}

function drawBotAvatar(
  ctx: CanvasRenderingContext2D,
  bot: BotInfo,
  cx: number,
  cy: number,
  radius: number,
): void {
  // Filled circle background
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bot.bgColor;
  ctx.fill();

  // Icon — scaled to fit inside the circle
  const iconSize = radius * 1.4;
  const scale = iconSize / bot.iconViewBox;
  ctx.save();
  ctx.translate(cx - iconSize / 2, cy - iconSize / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = bot.fgColor;

  if (bot.iconStroke) {
    ctx.strokeStyle = bot.fgColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  for (const [element, attrs] of bot.iconElements) {
    switch (element) {
      case "path": {
        const p = new Path2D(attrs.d);
        if (attrs.fill === "currentColor" || !bot.iconStroke) ctx.fill(p);
        if (bot.iconStroke) ctx.stroke(p);
        break;
      }
      case "rect": {
        ctx.beginPath();
        ctx.roundRect(
          parseFloat(attrs.x || "0"),
          parseFloat(attrs.y || "0"),
          parseFloat(attrs.width),
          parseFloat(attrs.height),
          parseFloat(attrs.rx || "0"),
        );
        if (bot.iconStroke) ctx.stroke();
        else ctx.fill();
        break;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(parseFloat(attrs.x1), parseFloat(attrs.y1));
        ctx.lineTo(parseFloat(attrs.x2), parseFloat(attrs.y2));
        if (bot.iconStroke) ctx.stroke();
        break;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(parseFloat(attrs.cx), parseFloat(attrs.cy), parseFloat(attrs.r), 0, Math.PI * 2);
        if (attrs.fill === "currentColor" || !bot.iconStroke) ctx.fill();
        if (bot.iconStroke) ctx.stroke();
        break;
      }
    }
  }
  ctx.restore();
}

import { avatarImageCache } from "@/lib/avatar-cache";



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

// Pre-computed date parts cache — avoids Date allocation and Intl formatting
// inside the draw loop entirely. Entries persist across frames; the cache grows
// at most to the number of unique timestamps in the commit list.
interface DateParts {
  year: number;
  short: string;
  long: string;
  iso: string;
  time: string;
  relative: string;
  relativeAt: number;
}
const datePartsCache = new Map<number, DateParts>();

function getDateParts(timestamp: number, nowSec: number): DateParts {
  let p = datePartsCache.get(timestamp);
  if (p && Math.abs(nowSec - p.relativeAt) < 30) return p;

  if (!p) {
    const d = new Date(timestamp * 1000);
    p = {
      year: d.getFullYear(),
      short: intlDateShort.format(d),
      long: intlDateLong.format(d),
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      relative: "",
      relativeAt: 0,
    };
  }

  const diff = nowSec - timestamp;
  if (diff < 60) p.relative = "now";
  else if (diff < 3600) p.relative = `${Math.floor(diff / 60)}m`;
  else if (diff < 86400) p.relative = `${Math.floor(diff / 3600)}h`;
  else if (diff < 604800) p.relative = `${Math.floor(diff / 86400)}d`;
  else p.relative = p.year === drawThisYear ? p.short : p.long;
  p.relativeAt = nowSec;

  datePartsCache.set(timestamp, p);
  return p;
}

// Set once at the start of each draw() frame so per-row helpers avoid
// allocating Date objects or calling Date.now() repeatedly.
let drawNowSec = 0;
let drawThisYear = 0;

function formatDate(timestamp: number, fmt: DateFormatId, availWidth: number, ctx: CanvasRenderingContext2D): string {
  const p = getDateParts(timestamp, drawNowSec);
  if (fmt === "relative") return p.relative;

  const fits = (s: string) => cachedMeasureText(ctx, s) <= availWidth;

  if (fmt === "iso") {
    const isoTime = `${p.iso} ${p.time}`;
    if (fits(isoTime)) return isoTime;
    return p.iso;
  }

  if (fmt === "long" || (fmt === "short" && p.year !== drawThisYear)) {
    const longTime = `${p.long} ${p.time}`;
    if (fits(longTime)) return longTime;
    if (fits(p.long)) return p.long;
    return p.short;
  }
  const shortTime = `${p.short} ${p.time}`;
  if (fits(shortTime)) return shortTime;
  return p.short;
}

/** Match a commit against a lowercased, non-empty filter query across sha,
 *  message/body, author, several date representations, and ref names (branch /
 *  tag / stash). `refNames` is precomputed by the caller from the ref maps. */
function commitMatchesQuery(
  commit: CommitInfo,
  q: string,
  refNames: string[],
): boolean {
  if (
    commit.short_id.toLowerCase().includes(q) ||
    commit.id.toLowerCase().includes(q) ||
    commit.message.toLowerCase().includes(q) ||
    commit.body.toLowerCase().includes(q) ||
    commit.author_name.toLowerCase().includes(q) ||
    commit.author_email.toLowerCase().includes(q)
  ) {
    return true;
  }

  // Date representations — match regardless of the column's display format.
  const d = new Date(commit.timestamp * 1000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (
    iso.includes(q) ||
    time.includes(q) ||
    intlDateShort.format(d).toLowerCase().includes(q) ||
    intlDateLong.format(d).toLowerCase().includes(q) ||
    intlDateFull.format(d).toLowerCase().includes(q)
  ) {
    return true;
  }

  return refNames.some((n) => n.toLowerCase().includes(q));
}

/**
 * Draw translucent amber rects behind every case-insensitive occurrence of
 * `query` in the about-to-be-drawn `text` — the canvas equivalent of the
 * diff/log search highlight. Call it right before the matching `fillText`, with
 * the same font already set and the same `x`/`y` (textBaseline "middle").
 * `text` must be the actually-rendered string (already truncated). No-op when
 * `query` is empty or absent from `text`.
 */
function drawSearchHighlight(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  query: string,
  fontSize: number,
): void {
  if (!query || !text) return;
  const lower = text.toLowerCase();
  let idx = lower.indexOf(query);
  if (idx === -1) return;
  const h = fontSize + 4;
  const top = y - h / 2;
  const prevFill = ctx.fillStyle;
  ctx.fillStyle = SEARCH_HIGHLIGHT_COLOR;
  while (idx !== -1) {
    const preW = ctx.measureText(text.slice(0, idx)).width;
    const matchW = ctx.measureText(text.slice(idx, idx + query.length)).width;
    ctx.fillRect(x + preW, top, matchW, h);
    idx = lower.indexOf(query, idx + query.length);
  }
  ctx.fillStyle = prevFill;
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (cachedMeasureText(ctx, text) <= maxWidth) return text;
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

// -- Lucide icon data (extracted from lucide-react for 1:1 canvas parity) ----

type LucideNodeData = readonly (readonly [string, Record<string, string>])[];

const ICON_TAG: LucideNodeData = [
  ["path", { d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" }],
  ["circle", { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor" }],
];

const ICON_MONITOR: LucideNodeData = [
  ["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2" }],
  ["line", { x1: "8", x2: "16", y1: "21", y2: "21" }],
  ["line", { x1: "12", x2: "12", y1: "17", y2: "21" }],
];

const ICON_CLOUD: LucideNodeData = [
  ["path", { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" }],
];

const ICON_CHECK: LucideNodeData = [
  ["path", { d: "M20 6 9 17l-5-5" }],
];

const ICON_ARCHIVE: LucideNodeData = [
  ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1" }],
  ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
  ["path", { d: "M10 12h4" }],
];

const ICON_FILE_DIFF: LucideNodeData = [
  ["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
  ["path", { d: "M9 10h6" }],
  ["path", { d: "M12 13V7" }],
  ["path", { d: "M9 17h6" }],
];

function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  nodes: LucideNodeData,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(x, y - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [element, attrs] of nodes) {
    switch (element) {
      case "path": {
        const p = new Path2D(attrs.d);
        if (attrs.fill === "currentColor") {
          ctx.fillStyle = color;
          ctx.fill(p);
        }
        ctx.stroke(p);
        break;
      }
      case "rect": {
        ctx.beginPath();
        ctx.roundRect(
          parseFloat(attrs.x || "0"),
          parseFloat(attrs.y || "0"),
          parseFloat(attrs.width),
          parseFloat(attrs.height),
          parseFloat(attrs.rx || "0"),
        );
        ctx.stroke();
        break;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(parseFloat(attrs.x1), parseFloat(attrs.y1));
        ctx.lineTo(parseFloat(attrs.x2), parseFloat(attrs.y2));
        ctx.stroke();
        break;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(
          parseFloat(attrs.cx),
          parseFloat(attrs.cy),
          parseFloat(attrs.r),
          0,
          Math.PI * 2,
        );
        if (attrs.fill === "currentColor") {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
    }
  }
  ctx.restore();
}

// -- Icon wrappers (same signatures as before, backed by lucide data) ---------

function drawTagIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const size = 16;
  drawLucideIcon(ctx, ICON_TAG, x, y, size, color);
  return size + 4;
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
  cornerRadii?: number | number[],
  highlightQuery?: string,
): number {
  ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
  const iconWidth = drawIcon ? drawIcon(ctx, 0, -1000, textColor) : 0; // dry-run to measure width
  const trailingW = iconWidth > 0 ? TRAILING_ICON_GAP + iconWidth : 0;
  let displayText = text;
  if (maxContentWidth !== undefined) {
    const availTextW = maxContentWidth - LABEL_PAD_X * 2 - trailingW;
    if (availTextW <= 0) return 0;
    displayText = truncateText(ctx, text, availTextW);
  }
  const textWidth = cachedMeasureText(ctx, displayText);
  const pillWidth = LABEL_PAD_X + textWidth + trailingW + LABEL_PAD_X;
  const pillY = y - LABEL_HEIGHT / 2;

  // Background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, pillY, pillWidth, LABEL_HEIGHT, cornerRadii ?? LABEL_RADIUS);
  ctx.fill();

  // Text + trailing icon
  ctx.fillStyle = textColor;
  ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
  if (highlightQuery) drawSearchHighlight(ctx, displayText, x + LABEL_PAD_X, y, highlightQuery, fontCfg.sizeBody);
  ctx.fillText(displayText, x + LABEL_PAD_X, y);
  if (drawIcon) {
    drawIcon(ctx, x + LABEL_PAD_X + textWidth + TRAILING_ICON_GAP, y, textColor);
  }

  return pillWidth;
}

function drawLocalIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const size = 14;
  drawLucideIcon(ctx, ICON_MONITOR, x, y, size, color);
  return size + 1;
}

function drawRemoteIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const size = 14;
  drawLucideIcon(ctx, ICON_CLOUD, x, y, size, color);
  return size;
}

function drawCheckIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const size = 14;
  drawLucideIcon(ctx, ICON_CHECK, x, y, size, color);
  return size + 2;
}

function drawFileEditIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const size = 14;
  drawLucideIcon(ctx, ICON_FILE_DIFF, x, y, size, color);
  return size + 1;
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
const CHECK_ICON_W = 16;          // 14px icon + 2px gap
const TRAILING_ICON_GAP = 3;      // left margin before trailing icons
const LOCAL_ICON_W = 15;          // 14px icon + 1px gap
const REMOTE_ICON_W = 14;         // 14px icon

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
  cornerRadii?: number | number[],
  highlightQuery?: string,
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
  if (group.local) trailingIconsW += TRAILING_ICON_GAP + LOCAL_ICON_W;
  if (group.remote) trailingIconsW += TRAILING_ICON_GAP + REMOTE_ICON_W;

  ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
  let displayName = group.baseName;
  if (maxContentWidth !== undefined) {
    const availTextW =
      maxContentWidth - LABEL_PAD_X * 2 - checkW - trailingIconsW;
    if (availTextW <= 0) return 0;
    displayName = truncateText(ctx, group.baseName, availTextW);
  }
  const textWidth = cachedMeasureText(ctx, displayName);

  const pillWidth =
    LABEL_PAD_X + checkW + textWidth + trailingIconsW + LABEL_PAD_X;
  const pillY = y - LABEL_HEIGHT / 2;

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, pillY, pillWidth, LABEL_HEIGHT, cornerRadii ?? LABEL_RADIUS);
  ctx.fill();

  let cursorX = x + LABEL_PAD_X;
  if (group.isHead) {
    drawCheckIcon(ctx, cursorX, y, textCol);
    cursorX += CHECK_ICON_W;
  }
  ctx.fillStyle = textCol;
  if (highlightQuery) drawSearchHighlight(ctx, displayName, cursorX, y, highlightQuery, fontCfg.sizeBody);
  ctx.fillText(displayName, cursorX, y);
  cursorX += textWidth;
  if (group.local) {
    cursorX += TRAILING_ICON_GAP;
    drawLocalIcon(ctx, cursorX, y, textCol);
    cursorX += LOCAL_ICON_W;
  }
  if (group.remote) {
    cursorX += TRAILING_ICON_GAP;
    drawRemoteIcon(ctx, cursorX, y, textCol);
    cursorX += REMOTE_ICON_W;
  }

  return pillWidth;
}

function drawStashIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): number {
  const size = 16;
  drawLucideIcon(ctx, ICON_ARCHIVE, x, y, size, color);
  return size + 3;
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
  const cardColor = useThemeStore((s) => `hsl(${s.appTheme.cssVars["--card"]})`);
  const fontFamilyId = useThemeStore((s) => s.fontFamilyId);
  const fontScale = useThemeStore((s) => s.fontScale);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const filterQuery = useRepoStore((s) => s.filterQuery);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredRowRef = useRef<number | null>(null);
  const hoveredBadgeRowRef = useRef<number | null>(null);
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
    /** Total badge+chip width so the dropdown can match it. */
    width: number;
  } | null>(null);
  const openHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRowRef = useRef<number | null>(null);
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

  // Global filter — set of commit ids that match the query. `null` means no
  // active filter (nothing dimmed). Computed over all commits (cheap, in
  // memory); the draw loop dims rows whose id is absent from the set.
  const filterMatchSet = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const c of commits) {
      const refNames: string[] = [];
      for (const b of branchMap.get(c.id) ?? []) refNames.push(b.name);
      for (const t of tagMap.get(c.id) ?? []) refNames.push(t.name);
      for (const s of stashMap.get(c.id) ?? []) refNames.push(s.message);
      if (commitMatchesQuery(c, q, refNames)) set.add(c.id);
    }
    return set;
  }, [filterQuery, commits, branchMap, tagMap, stashMap]);

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

    // Build one walker per unique branch-tip commit (local + remote).
    // When local and remote share a commit, prefer local. HEAD always wins.
    const walkerByCommit = new Map<string, { color: string; row: number; isHead: boolean; isRemote: boolean }>();
    for (const b of branches) {
      const baseName = b.is_remote ? b.name.replace(/^[^/]+\//, "") : b.name;
      const commit = commits.find((c) => c.id.startsWith(b.commit_id));
      if (!commit) continue;
      const row = commitIndex.get(commit.id) ?? 0;
      const existing = walkerByCommit.get(commit.id);
      if (!existing || b.is_head || (!b.is_remote && existing.isRemote)) {
        walkerByCommit.set(commit.id, {
          color: branchColor(baseName),
          row,
          isHead: b.is_head || (existing?.isHead ?? false),
          isRemote: b.is_remote && (!existing || existing.isRemote),
        });
      }
    }

    const tipCommits = new Set(walkerByCommit.keys());

    // Oldest (highest row) first so downstream branches paint first;
    // HEAD last so it paints on top of shared segments.
    const sorted = [...walkerByCommit.entries()].sort((a, b) => {
      if (a[1].isHead !== b[1].isHead) return a[1].isHead ? 1 : -1;
      return b[1].row - a[1].row;
    });

    // Pass 1 — first-parents only; stop at other branch tips so each
    // segment of a shared linear chain gets its own branch color.
    for (const [tipId, { color }] of sorted) {
      let cid: string | undefined = tipId;
      let first = true;
      while (cid) {
        if (!first && tipCommits.has(cid)) break;
        first = false;
        colorMap.set(cid, color);
        const idx = commitIndex.get(cid);
        if (idx === undefined) break;
        cid = commits[idx].parent_ids[0];
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
    textWidthCache = new Map();
    drawNowSec = Date.now() / 1000;
    drawThisYear = new Date().getFullYear();

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

    // --- WIP node lane ---
    // The WIP/working-tree node normally sits in HEAD's lane and connects
    // straight down. But when commits between the WIP row and HEAD occupy
    // HEAD's lane (e.g. a linear chain of branches ahead of HEAD, all in
    // lane 0), a straight connector overlaps that chain and the WIP node
    // looks like it descends from the topmost branch instead of HEAD.
    // In that case route the WIP node into its own free lane and curve the
    // connector into HEAD's lane (GitKraken-style divergence).
    const wipHeadIdx = headRow >= 0 ? headRow - rowOffset : -1;
    const wipHeadCommit =
      wipHeadIdx >= 0 && wipHeadIdx < commits.length ? commits[wipHeadIdx] : null;
    let wipLane = wipHeadCommit
      ? wipHeadCommit.lane
      : commits.length > 0
        ? commits[0].lane
        : 0;
    if (wipHeadCommit && wipHeadIdx > 0) {
      // Lanes occupied by commit nodes strictly above HEAD — the span the
      // WIP connector would pass through.
      const occupied = new Set<number>();
      for (let i = 0; i < wipHeadIdx; i++) occupied.add(commits[i].lane);
      if (occupied.has(wipHeadCommit.lane)) {
        let l = 0;
        while (occupied.has(l)) l++;
        wipLane = l;
      }
    }

    // Row highlight rect starts at the avatar's left edge so the badge column
    // stays unhighlighted. Falls back to the canvas left for rows without a
    // commit (e.g. WIP).
    const HIGHLIGHT_LEFT_PAD = 5;
    const rowHighlightLeft = (visRow: number): number => {
      const commitIdx = visRow - rowOffset;
      if (commitIdx >= 0 && commitIdx < commits.length) {
        return laneX(commits[commitIdx].lane) - NODE_RADIUS - HIGHLIGHT_LEFT_PAD;
      }
      // WIP row uses its own (possibly routed) lane
      if (hasWip && visRow === 0) {
        return laneX(wipLane) - NODE_RADIUS - HIGHLIGHT_LEFT_PAD;
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
    ctx.lineWidth = 2;
    const edgesByColor = new Map<string, { fX: number; fY: number; tX: number; tY: number; sameLane: boolean; isMerge: boolean }[]>();
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
        isMerge: edge.edge_type === "Merge",
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
          // GitKraken-style L-shaped edge with one constant-radius corner.
          // Convex at divergence (Straight first-parent edge): corner near
          // the target row — vertical down the source lane then curve into
          // the older parent on the side.
          // Concave at merge (Merge edge): corner near the source row —
          // horizontal off the merge commit then vertical down into the
          // merge-parent's lane.
          const maxR = Math.min(Math.abs(s.tY - s.fY), Math.abs(s.tX - s.fX));
          const r = Math.min(CURVE_RADIUS, maxR);
          if (s.isMerge) {
            ctx.arcTo(s.tX, s.fY, s.tX, s.tY, r);
          } else {
            ctx.arcTo(s.fX, s.tY, s.tX, s.tY, r);
          }
          ctx.lineTo(s.tX, s.tY);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- WIP row ---
    if (hasWip && firstVisibleRow === 0) {
      const wipY = ROW_HEIGHT / 2 - scrollTop;
      // Place WIP node on its own lane (== HEAD's lane unless routed around
      // intermediate commits — see wipLane computation above).
      const headCommit = wipHeadCommit;
      const nodeX = laneX(wipLane);

      // Connect WIP to HEAD commit with a dashed line
      if (headCommit) {
        const headY = headRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
        const headX = laneX(headCommit.lane);
        ctx.strokeStyle = getCommitColor(headCommit);
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(nodeX, wipY);
        if (nodeX === headX) {
          ctx.lineTo(nodeX, headY);
        } else {
          // WIP routed into its own lane — drop down the WIP lane then curve
          // into HEAD's lane so the divergence from HEAD reads clearly.
          const maxR = Math.min(Math.abs(headY - wipY), Math.abs(headX - nodeX));
          const r = Math.min(CURVE_RADIUS, maxR);
          ctx.arcTo(nodeX, headY, headX, headY, r);
          ctx.lineTo(headX, headY);
        }
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
      ctx.lineWidth = 2;
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
    // Lowercased filter query, for drawing the match highlight behind text.
    const hq = filterQuery.trim().toLowerCase();
    for (let visRow = Math.max(firstVisibleRow, rowOffset); visRow <= lastVisibleRow; visRow++) {
      const commitIdx = visRow - rowOffset;
      const commit = commits[commitIdx];
      if (!commit) continue;

      const x = laneX(commit.lane);
      const y = visRow * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const color = getCommitColor(commit);

      // Dim the whole row when a filter is active and this commit doesn't match.
      // Inner save()/restore() blocks preserve this alpha; reset at row end.
      const dimmed =
        filterMatchSet !== null && !filterMatchSet.has(commit.id);
      if (dimmed) {
        // Paint an opaque background disc over the lane line first, so the
        // alpha-composited node below blends against the background instead of
        // revealing the edge beneath it.
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS + 2, 0, Math.PI * 2);
        ctx.fillStyle = graphColors.bgPage;
        ctx.fill();
      }
      ctx.globalAlpha = dimmed ? GRAPH_DIM_ALPHA : 1;

      // Node -- bot icon, avatar image, profile icon, or fallback initial circle
      {
        const email = commit.author_email;
        const bot = detectBot(commit.author_name, email);
        const isProfileMatch = activeProfile && activeProfile.user_email.toLowerCase() === email.toLowerCase();

        if (bot) {
          drawBotAvatar(ctx, bot, x, y, NODE_RADIUS);
        } else if (isProfileMatch) {
          const isForgeAvatar = activeProfile.icon?.startsWith("forge:");
          const hasCustomIcon = activeProfile.icon && !isForgeAvatar && getProfileIcon(activeProfile.icon);

          if (isForgeAvatar && activeProfile.avatar_url) {
            const cacheKey = `profile:${activeProfile.id}`;
            let img = avatarImageCache.get(cacheKey);
            if (img === undefined) {
              avatarImageCache.set(cacheKey, null);
              const loadImg = new Image();
              // No crossOrigin: the canvas only draws avatars (never reads pixels
              // back), and requiring CORS breaks forge avatars (e.g. GitLab) whose
              // host doesn't send Access-Control-Allow-Origin headers.
              loadImg.src = activeProfile.avatar_url;
              loadImg.onload = () => {
                avatarImageCache.set(cacheKey, loadImg);
                requestDrawRef.current();
              };
              img = null;
            }
            if (img) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
              ctx.clip();
              ctx.drawImage(img, x - NODE_RADIUS, y - NODE_RADIUS, NODE_RADIUS * 2, NODE_RADIUS * 2);
              ctx.restore();
            } else {
              const avatarBg = darkenHex(activeProfile.color, 0.45);
              ctx.beginPath();
              ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
              ctx.fillStyle = avatarBg;
              ctx.fill();
            }
          } else if (hasCustomIcon) {
            drawProfileIconOnCanvas(ctx, activeProfile.icon!, x, y, NODE_RADIUS, darkenHex(activeProfile.color, 0.45));
          } else {
            const avatarBg = darkenHex(activeProfile.color, 0.45);
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
        } else {
          // Read-only: avatars are loaded by the prefetch effect (issue #70),
          // not initiated here on the scroll hot path. Fall back to initials
          // until the image is ready.
          const img = avatarImageCache.get(email) ?? null;

          if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, x - NODE_RADIUS, y - NODE_RADIUS, NODE_RADIUS * 2, NODE_RADIUS * 2);
            ctx.restore();
          } else {
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
        }

        // Dark separator ring then branch color ring
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = "#09090b";
        ctx.lineWidth = 3.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
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
          nChipW = cachedMeasureText(ctx, `+${extra}`) + LABEL_PAD_X * 2;
        }
        const gapBeforeChip = extra > 0 ? 1 : 0;
        const maxPrimaryW = Math.max(0, totalAvail - nChipW - gapBeforeChip);

        // Draw primary pill — flatten right corners when a +N chip follows,
        // flatten bottom corners when the hover dropdown is open.
        let primaryW = 0;
        let primaryColor = graphColors.dim;
        const isDropdownRow = dropdownRowRef.current === visRow;
        const joinedRadii = extra > 0
          ? (isDropdownRow
              ? [LABEL_RADIUS, 2, 0, 0]
              : [LABEL_RADIUS, 2, 2, LABEL_RADIUS])
          : undefined;
        if (maxPrimaryW > 20) {
          if (primary.kind === "branch") {
            primaryW = drawMergedBranchPill(ctx, badgeColLeft, y, primary.group, maxPrimaryW, joinedRadii, hq);
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
              joinedRadii,
              hq,
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
              joinedRadii,
              hq,
            );
          }
        }

        // Build dropdown ref list when there are stacked refs (drives #39).
        let dropdownItems: DropdownRef[] | undefined;
        if (extra > 0) {
          dropdownItems = badgeItems.slice(1).map((it): DropdownRef => {
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
            primaryW + (extra > 0 ? 1 + nChipW : 0);
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

        // +N chip — joined to primary pill via flat left corners,
        // bottom corners flatten when hover dropdown is open.
        if (extra > 0 && primaryW > 0) {
          drawPill(
            ctx,
            badgeColLeft + primaryW + 1,
            y,
            `+${extra}`,
            isDropdownRow ? cardColor : "rgba(255,255,255,0.1)",
            graphColors.dim,
            undefined,
            undefined,
            isDropdownRow
              ? [2, LABEL_RADIUS, 0, 0]
              : [2, LABEL_RADIUS, LABEL_RADIUS, 2],
          );
        }

        // Hover highlight overlay on badge
        if (primaryW > 0 && hoveredBadgeRowRef.current === visRow) {
          const hlW = primaryW + (extra > 0 ? 1 + nChipW : 0);
          const hlRadii = isDropdownRow
            ? [LABEL_RADIUS, LABEL_RADIUS, 0, 0]
            : LABEL_RADIUS;
          ctx.save();
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.beginPath();
          ctx.roundRect(badgeColLeft, y - LABEL_HEIGHT / 2, hlW, LABEL_HEIGHT, hlRadii);
          ctx.fill();
          ctx.restore();
        }

        // Link from right edge of badge content to the commit node, colored
        // by the primary badge so lineage is visible.
        if (primaryW > 0) {
          const linkStartX =
            badgeColLeft + primaryW + (extra > 0 ? 1 + nChipW : 0) + 2;
          const linkEndX = x - NODE_RADIUS - 2;
          if (linkEndX > linkStartX + 1) {
            ctx.save();
            ctx.strokeStyle = primaryColor;
            // Set absolutely (inside save/restore), so fold in the row dim here.
            ctx.globalAlpha = dimmed ? 0.7 * GRAPH_DIM_ALPHA : 0.7;
            ctx.lineWidth = 2;
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
        drawSearchHighlight(ctx, commit.short_id, shaColLeft + 8, y, hq, fontCfg.sizeLabel);
        ctx.fillText(commit.short_id, shaColLeft + 8, y);
      }

      // Message + Body
      const msgRight = rightColsW > 0 ? authorColLeft - 8 : width - 16;
      const msgAvail = Math.max(0, msgRight - msgLeft);
      ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;

      // Conventional-commit type: draw its icon, then tint the "feat:" prefix
      // in its color; the rest of the subject stays default foreground.
      const parsedType = parseCommitType(commit.message);
      const typeColor = parsedType ? COMMIT_TYPE_META[parsedType.type].color : "";
      const typeIconAdvance = parsedType ? TYPE_ICON_SIZE + TYPE_ICON_GAP : 0;
      if (parsedType) {
        drawLucideIcon(ctx, COMMIT_TYPE_ICON_NODES[parsedType.type], msgLeft, y, TYPE_ICON_SIZE, typeColor);
      }
      const textLeft = msgLeft + typeIconAdvance;
      const textAvail = msgAvail - typeIconAdvance;
      const fullMsgWidth = cachedMeasureText(ctx, commit.message);
      if (fullMsgWidth <= textAvail) {
        if (parsedType) {
          ctx.fillStyle = typeColor;
          drawSearchHighlight(ctx, parsedType.prefix, textLeft, y, hq, fontCfg.sizeBody);
          ctx.fillText(parsedType.prefix, textLeft, y);
          const prefixW = cachedMeasureText(ctx, parsedType.prefix);
          ctx.fillStyle = graphColors.fg;
          const restText = commit.message.slice(parsedType.prefix.length);
          drawSearchHighlight(ctx, restText, textLeft + prefixW, y, hq, fontCfg.sizeBody);
          ctx.fillText(restText, textLeft + prefixW, y);
        } else {
          ctx.fillStyle = graphColors.fg;
          drawSearchHighlight(ctx, commit.message, textLeft, y, hq, fontCfg.sizeBody);
          ctx.fillText(commit.message, textLeft, y);
        }

        if (commit.body) {
          const bodyGap = 8;
          const bodyX = textLeft + fullMsgWidth + bodyGap;
          const bodyAvailW = textAvail - fullMsgWidth - bodyGap;
          if (bodyAvailW > 30) {
            ctx.fillStyle = graphColors.dim;
            const bodyOneLine = commit.body.replace(/\n/g, " ").trim();
            const bodyText = truncateText(ctx, bodyOneLine, bodyAvailW);
            drawSearchHighlight(ctx, bodyText, bodyX, y, hq, fontCfg.sizeBody);
            ctx.fillText(bodyText, bodyX, y);

            const drawnBodyWidth = cachedMeasureText(ctx, bodyText);
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
      } else if (parsedType) {
        ctx.fillStyle = typeColor;
        drawSearchHighlight(ctx, parsedType.prefix, textLeft, y, hq, fontCfg.sizeBody);
        ctx.fillText(parsedType.prefix, textLeft, y);
        const prefixW = cachedMeasureText(ctx, parsedType.prefix);
        ctx.fillStyle = graphColors.fg;
        const rest = commit.message.slice(parsedType.prefix.length);
        const restTrunc = truncateText(ctx, rest, Math.max(0, textAvail - prefixW));
        drawSearchHighlight(ctx, restTrunc, textLeft + prefixW, y, hq, fontCfg.sizeBody);
        ctx.fillText(restTrunc, textLeft + prefixW, y);
      } else {
        ctx.fillStyle = graphColors.fg;
        const msgTrunc = truncateText(ctx, commit.message, textAvail);
        drawSearchHighlight(ctx, msgTrunc, textLeft, y, hq, fontCfg.sizeBody);
        ctx.fillText(msgTrunc, textLeft, y);
      }

      // Author column — show name + email when space allows
      if (columnVisibility.author) {
        ctx.font = `${fontCfg.sizeBody}px ${fontCfg.sans}`;
        const authorPad = 8;
        const authorAvail = authorEffW - authorPad * 2;
        const authorX = authorColLeft + authorPad;
        let emailShown = false;
        if (authorAvail > 10) {
          const nameW = cachedMeasureText(ctx, commit.author_name);
          const emailGap = 6;
          const remaining = authorAvail - nameW - emailGap;

          if (remaining > 10 && commit.author_email) {
            ctx.fillStyle = graphColors.fg;
            drawSearchHighlight(ctx, commit.author_name, authorX, y, hq, fontCfg.sizeBody);
            ctx.fillText(commit.author_name, authorX, y);
            ctx.fillStyle = graphColors.dim;
            const emailText = truncateText(ctx, commit.author_email, remaining);
            drawSearchHighlight(ctx, emailText, authorX + nameW + emailGap, y, hq, fontCfg.sizeBody);
            ctx.fillText(emailText, authorX + nameW + emailGap, y);
            emailShown = cachedMeasureText(ctx, commit.author_email) <= remaining;
          } else {
            ctx.fillStyle = graphColors.fg;
            const nameTrunc = truncateText(ctx, commit.author_name, authorAvail);
            drawSearchHighlight(ctx, nameTrunc, authorX, y, hq, fontCfg.sizeBody);
            ctx.fillText(nameTrunc, authorX, y);
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
          const dateText = formatDate(commit.timestamp, dateFormat, dateAvail, ctx);
          drawSearchHighlight(ctx, dateText, dateColLeft + 8, y, hq, fontCfg.sizeLabel);
          ctx.fillText(dateText, dateColLeft + 8, y);
        }
      }

      // Reset row dim before the next row / subsequent passes.
      ctx.globalAlpha = 1;
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
      const labelWidth = cachedMeasureText(ctx, label);
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
  }, [commits, edges, headInfo, selectedRowIdx, msgLeft, shaColLeft, laneX, hasWip, rowOffset, totalRows, branchMap, tagMap, stashMap, filterMatchSet, filterQuery, getCommitColor, colorMru, refMru, columnWidths, columnVisibility, dateFormat, isWipSelected, fileStatusCount, timeGroupBoundaries, graphColors, cardColor, fontFamilyId, fontScale, activeProfile]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  // Keep a stable ref so async avatar-load callbacks always reach the latest draw.
  // Must be in an effect, not in render body, per react-hooks/refs rule.
  useEffect(() => {
    requestDrawRef.current = requestDraw;
  }, [requestDraw]);

  useEffect(() => {
    dropdownRowRef.current = hoverDropdown?.row ?? null;
    requestDraw();
  }, [hoverDropdown?.row, requestDraw]);

  // Prefetch avatars off the scroll hot path (#70). Keyed by distinct author
  // email — far fewer than commits — and kicked off once whenever the commit
  // set changes. The draw loop only reads the cache; loads never start there.
  // Redraws coalesce through requestDraw's RAF, so a burst of resolving images
  // collapses to at most one repaint per frame.
  useEffect(() => {
    const emails = new Set<string>();
    for (const c of commits) {
      if (c.author_email) emails.add(c.author_email);
    }
    for (const email of emails) {
      loadAvatarForEmail(email, NODE_RADIUS * 4, () => requestDrawRef.current());
    }
  }, [commits]);

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
      const newBadgeRow = overBadgeArea ? overBadgeArea.row : null;
      if (newBadgeRow !== hoveredBadgeRowRef.current) {
        hoveredBadgeRowRef.current = newBadgeRow;
        requestDrawRef.current();
      }

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
          const ay = overBadgeArea.y + overBadgeArea.height;
          const aw = overBadgeArea.width;
          openHoverTimer.current = setTimeout(() => {
            openHoverTimer.current = null;
            setHoverDropdown({ row: targetRow, commitId, items, x: ax, y: ay, width: aw });
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
          const dateStr = intlDateFull.format(date);
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
    hoveredBadgeRowRef.current = null;
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
      let hitBadge: BadgeHitArea | null = null;
      for (const badge of badgeHitAreasRef.current) {
        if (
          clickX >= badge.x &&
          clickX <= badge.x + badge.width &&
          clickY >= badge.y &&
          clickY <= badge.y + badge.height
        ) {
          hitBadge = badge;
          break;
        }
      }

      if (hitBadge) {
        if (hitBadge.badgeType === "stash" && hitBadge.stashIndex != null && onStashContextMenu) {
          e.preventDefault();
          onStashContextMenu(hitBadge.stashIndex, e.clientX, e.clientY);
          return;
        }
        if (onCommitContextMenu && hitBadge.commitId) {
          e.preventDefault();
          onCommitContextMenu(hitBadge.commitId, e.clientX, e.clientY, hitBadge.branchName);
          return;
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
          className="absolute z-40 flex flex-col gap-px border border-border border-t-0 bg-card shadow-lg overflow-hidden"
          style={{ borderRadius: `0 0 ${LABEL_RADIUS}px ${LABEL_RADIUS}px`, left: hoverDropdown.x, top: hoverDropdown.y, width: hoverDropdown.width }}
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
  const colorStyle = { color: isBranch ? item.color : undefined };

  return (
    <div
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="flex cursor-pointer select-none items-center gap-1.5 px-2 text-xs transition-colors hover:bg-secondary"
      style={{ height: LABEL_HEIGHT }}
    >
      {item.isHead && (
        <Check className="h-3 w-3 shrink-0" style={colorStyle} aria-hidden="true" />
      )}
      <span
        className={`truncate ${isBranch ? "" : "text-muted-foreground"}`}
        style={isBranch ? colorStyle : undefined}
      >
        {item.displayName}
      </span>
      {isTag && (
        <Tag className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      {isStash && (
        <Archive className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      {item.hasLocal && (
        <Monitor className="h-3 w-3 shrink-0" style={colorStyle} aria-hidden="true" />
      )}
      {item.hasRemote && (
        <Cloud className="h-3 w-3 shrink-0" style={colorStyle} aria-hidden="true" />
      )}
    </div>
  );
}

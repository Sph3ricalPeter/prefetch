/**
 * Pure layout helpers for the commit graph — branch coloring and time-group
 * bucketing. Extracted from the canvas painter so the color hierarchy and
 * temporal classification can be reasoned about (and tested) without a
 * `CanvasRenderingContext2D`. Nothing here reads canvas or theme state.
 */

// ── Hierarchical branch color system ──────────────────────────────
// Root branches (main/dev) get fixed base colors. Known prefixes
// (feature/, fix/, etc.) derive from their parent's color with a
// hue shift + desaturation so lineage is visible at a glance.
// Unknown branches get their own base color from a palette.
// Remote-only branches use a darker tone instead of flat gray.

interface HSL {
  h: number;
  s: number;
  l: number;
}

function hslToHex({ h, s, l }: HSL): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Fixed base colors for well-known root branches
const MAIN_HSL: HSL = { h: 215, s: 80, l: 65 }; // blue
const DEV_HSL: HSL = { h: 175, s: 85, l: 50 }; // cyan

// Palette for unknown root branches — spread across the hue wheel
const ROOT_PALETTE: HSL[] = [
  { h: 340, s: 82, l: 63 }, // pink
  { h: 50, s: 88, l: 52 }, // gold
  { h: 280, s: 72, l: 65 }, // purple
  { h: 100, s: 78, l: 50 }, // green
  { h: 15, s: 85, l: 58 }, // orange
  { h: 0, s: 78, l: 60 }, // red
  { h: 195, s: 75, l: 55 }, // teal
  { h: 260, s: 68, l: 68 }, // lavender
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
  if (clean === "main" || clean === "master") return { base: MAIN_HSL, depth: 0, hash: h };
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
  const hueShift = d > 0 ? (hash % 50) - 25 : 0;
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
export function branchColor(name: string): string {
  const { base, depth, hash } = branchInfo(name);
  return hslToHex(deriveHsl(base, depth, hash));
}

/** Darker color for remote-only branches (hex) */
export function branchColorDim(name: string): string {
  const { base, depth, hash } = branchInfo(name);
  return hslToHex(darkenHsl(deriveHsl(base, depth, hash)));
}

/** Color for a lane — used for commits not on any active branch's first-parent chain */
export function laneColor(lane: number): string {
  return hslToHex(ROOT_PALETTE[lane % ROOT_PALETTE.length]);
}

// ── Time-group classification for commit timestamps ───────────────

export type TimeGroup =
  | "Today"
  | "Yesterday"
  | "This week"
  | "Last week"
  | "This month"
  | "Last month"
  | "Older";

export function getTimeGroup(timestamp: number): TimeGroup {
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

// Conventional-commit type detection and presentation metadata.
// Pure module (no React/canvas deps) so it can be used by both the canvas
// commit graph and DOM components. Colors are tuned for the dark theme.

export type CommitType =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert";

export interface CommitTypeMeta {
  /** Display label, e.g. "feat". */
  label: string;
  /** Hex color used for the prefix tint (canvas) and icon/prefix (DOM). */
  color: string;
}

export const COMMIT_TYPE_META: Record<CommitType, CommitTypeMeta> = {
  feat: { label: "feat", color: "#a98bdb" }, // purple
  fix: { label: "fix", color: "#e5635f" }, // red
  docs: { label: "docs", color: "#5fb0e8" }, // light blue
  style: { label: "style", color: "#d57ba8" }, // pink
  refactor: { label: "refactor", color: "#e3c34d" }, // yellow
  perf: { label: "perf", color: "#e0954f" }, // orange
  test: { label: "test", color: "#5bbf7e" }, // green
  build: { label: "build", color: "#4a78c2" }, // dark blue
  ci: { label: "ci", color: "#4fb6a8" }, // teal
  chore: { label: "chore", color: "#9aa0a6" }, // gray
  revert: { label: "revert", color: "#9aa0a6" }, // gray
};

// Canvas icon path data (lucide v1.8.0), so the commit graph can stroke the
// same glyphs the DOM renders via lucide-react. These mirror the lucide-react
// icons mapped in detail-panel.tsx (COMMIT_TYPE_ICONS) — keep them in sync.
// Same dual pattern the codebase already uses for the Tag icon (ICON_TAG on
// canvas + <Tag/> in the DOM).
export type IconNode = readonly (readonly [string, Record<string, string>])[];

export const COMMIT_TYPE_ICON_NODES: Record<CommitType, IconNode> = {
  feat: [
    ["path", { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }],
    ["path", { d: "M20 2v4" }],
    ["path", { d: "M22 4h-4" }],
    ["circle", { cx: "4", cy: "20", r: "2" }],
  ],
  fix: [
    ["path", { d: "M12 20v-9" }],
    ["path", { d: "M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" }],
    ["path", { d: "M14.12 3.88 16 2" }],
    ["path", { d: "M21 21a4 4 0 0 0-3.81-4" }],
    ["path", { d: "M21 5a4 4 0 0 1-3.55 3.97" }],
    ["path", { d: "M22 13h-4" }],
    ["path", { d: "M3 21a4 4 0 0 1 3.81-4" }],
    ["path", { d: "M3 5a4 4 0 0 0 3.55 3.97" }],
    ["path", { d: "M6 13H2" }],
    ["path", { d: "m8 2 1.88 1.88" }],
    ["path", { d: "M9 7.13V6a3 3 0 1 1 6 0v1.13" }],
  ],
  docs: [
    ["path", { d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" }],
    ["path", { d: "M8 11h8" }],
    ["path", { d: "M8 7h6" }],
  ],
  style: [
    ["path", { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }],
    ["circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" }],
    ["circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" }],
    ["circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" }],
    ["circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" }],
  ],
  refactor: [
    ["path", { d: "m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" }],
    ["path", { d: "m18 15 4-4" }],
    ["path", { d: "m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" }],
  ],
  perf: [
    ["path", { d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" }],
  ],
  test: [
    ["path", { d: "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" }],
    ["path", { d: "M6.453 15h11.094" }],
    ["path", { d: "M8.5 2h7" }],
  ],
  build: [
    ["path", { d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" }],
    ["path", { d: "M12 22V12" }],
    ["path", { d: "M3.29 7 12 12 20.71 7" }],
    ["path", { d: "m7.5 4.27 9 5.15" }],
  ],
  ci: [
    ["rect", { width: "8", height: "8", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M7 11v4a2 2 0 0 0 2 2h4" }],
    ["rect", { width: "8", height: "8", x: "13", y: "13", rx: "2" }],
  ],
  chore: [
    ["path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" }],
  ],
  revert: [
    ["path", { d: "M9 14 4 9l5-5" }],
    ["path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" }],
  ],
};

const COMMIT_TYPE_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?(!)?:/i;

export interface ParsedCommitType {
  /** Normalized (lowercase) conventional-commit type. */
  type: CommitType;
  /** The matched prefix verbatim, up to and including the colon (e.g. "feat(api)!:"). */
  prefix: string;
  /** Whether the commit is marked breaking (trailing "!"). */
  breaking: boolean;
}

/**
 * Parse the conventional-commit type prefix from a commit subject.
 * Returns null when the subject doesn't start with a recognized type.
 */
export function parseCommitType(message: string): ParsedCommitType | null {
  const m = COMMIT_TYPE_RE.exec(message);
  if (!m) return null;
  return {
    type: m[1].toLowerCase() as CommitType,
    prefix: m[0],
    breaking: m[3] === "!",
  };
}

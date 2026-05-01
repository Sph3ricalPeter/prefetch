// ── Theme definitions ─────────────────────────────────────────────────────
// Single source of truth for all app + code themes.
// App themes control the UI chrome (CSS vars, canvas graph colors).
// Code themes control syntax highlighting (Shiki) + diff/merge colors.

// ── App Theme ─────────────────────────────────────────────────────────────

export interface AppThemeGraph {
  fg: string;
  muted: string;
  dim: string;
  faint: string;
  bgPage: string;
  bgHover: string;
  bgSelected: string;
}

export interface AppTheme {
  id: string;
  label: string;
  type: "dark" | "light";
  cssVars: Record<string, string>;
  graph: AppThemeGraph;
  extended: Record<string, string>;
  scrollbar: { thumb: string; thumbHover: string };
  noiseOpacity: number;
}

// ── Code Theme ────────────────────────────────────────────────────────────

export interface CodeThemeDiff {
  addedBg: string;
  addedLineBg: string;
  removedBg: string;
  removedLineBg: string;
  hunkHeaderBg: string;
  hunkHeaderFg: string;
  gutterBg: string;
  gutterFg: string;
}

export interface ShikiThemeDef {
  name: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  tokenColors: { scope: string | string[]; settings: { foreground?: string; fontStyle?: string } }[];
}

export interface CodeThemeCodemirror {
  bg: string;
  fg: string;
  caret: string;
  selection: string;
  gutterBg: string;
  gutterFg: string;
  activeLine: string;
  activeLineGutter: string;
  foldPlaceholderBg: string;
  foldPlaceholderFg: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipFg: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  diffAdded: string;
  diffRemoved: string;
  diffHeader: string;
  diffHeaderFg: string;
  mergeChanged: string;
  mergeDeleted: string;
  conflictOurs: string;
  conflictTheirs: string;
  conflictEdited: string;
  emptyLineIndicator: string;
  gutterOurs: string;
  gutterTheirs: string;
  gutterOursArrow: string;
  gutterTheirsArrow: string;
  gutterRemoveHover: string;
}

export interface CodeTheme {
  id: string;
  label: string;
  shikiTheme: ShikiThemeDef;
  codemirror: CodeThemeCodemirror;
  diff: CodeThemeDiff;
}

// ── Default pairing ───────────────────────────────────────────────────────

export const DEFAULT_CODE_THEME: Record<string, string> = {
  dark: "prefetch-dark",
  "dark-dimmed": "prefetch-dimmed",
  "tokyo-night": "tokyo-night",
  light: "light",
};

// ══════════════════════════════════════════════════════════════════════════
//  APP THEMES
// ══════════════════════════════════════════════════════════════════════════

const darkAppTheme: AppTheme = {
  id: "dark",
  label: "Dark",
  type: "dark",
  cssVars: {
    "--background": "240 6% 3.9%",
    "--foreground": "240 5% 96%",
    "--card": "240 7% 7%",
    "--card-foreground": "240 5% 96%",
    "--popover": "240 7% 7%",
    "--popover-foreground": "240 5% 96%",
    "--primary": "240 5% 96%",
    "--primary-foreground": "240 6% 9%",
    "--secondary": "240 6% 10%",
    "--secondary-foreground": "240 5% 96%",
    "--muted": "240 6% 10%",
    "--muted-foreground": "240 5% 64.9%",
    "--accent": "240 6% 10%",
    "--accent-foreground": "240 5% 96%",
    "--destructive": "0 62.8% 30.6%",
    "--destructive-foreground": "240 5% 96%",
    "--border": "240 5% 11.6%",
    "--input": "240 5% 11.6%",
    "--ring": "263 70% 76%",
    "--sidebar-background": "240 8% 4.3%",
    "--sidebar-foreground": "240 5% 96%",
    "--sidebar-primary": "240 5% 96%",
    "--sidebar-primary-foreground": "240 6% 9%",
    "--sidebar-accent": "240 6% 10%",
    "--sidebar-accent-foreground": "240 5% 96%",
    "--sidebar-border": "240 5% 11.6%",
    "--sidebar-ring": "263 70% 76%",
  },
  graph: {
    fg: "hsl(240 5% 96%)",
    muted: "hsl(240 5% 65%)",
    dim: "hsl(240 5% 45%)",
    faint: "hsl(240 5% 30%)",
    bgPage: "hsl(240 6% 3.9%)",
    bgHover: "hsl(240 6% 8%)",
    bgSelected: "hsl(240 6% 10%)",
  },
  extended: {
    dim: "hsl(240 5% 45%)",
    faint: "hsl(240 5% 30%)",
    brand: "#a78bfa",
    brandDim: "#7c3aed",
    brandGlow: "rgba(167, 139, 250, 0.08)",
    success: "#34d399",
  },
  scrollbar: { thumb: "hsl(240 5% 16%)", thumbHover: "hsl(240 5% 24%)" },
  noiseOpacity: 0.025,
};

const darkDimmedAppTheme: AppTheme = {
  id: "dark-dimmed",
  label: "Dark Dimmed",
  type: "dark",
  cssVars: {
    "--background": "220 10% 7%",
    "--foreground": "220 9% 86%",
    "--card": "220 10% 10%",
    "--card-foreground": "220 9% 86%",
    "--popover": "220 10% 10%",
    "--popover-foreground": "220 9% 86%",
    "--primary": "220 9% 86%",
    "--primary-foreground": "220 10% 10%",
    "--secondary": "220 10% 14%",
    "--secondary-foreground": "220 9% 86%",
    "--muted": "220 10% 14%",
    "--muted-foreground": "220 9% 58%",
    "--accent": "220 10% 14%",
    "--accent-foreground": "220 9% 86%",
    "--destructive": "0 55% 35%",
    "--destructive-foreground": "220 9% 86%",
    "--border": "220 10% 16%",
    "--input": "220 10% 16%",
    "--ring": "220 60% 60%",
    "--sidebar-background": "220 10% 6%",
    "--sidebar-foreground": "220 9% 86%",
    "--sidebar-primary": "220 9% 86%",
    "--sidebar-primary-foreground": "220 10% 10%",
    "--sidebar-accent": "220 10% 14%",
    "--sidebar-accent-foreground": "220 9% 86%",
    "--sidebar-border": "220 10% 16%",
    "--sidebar-ring": "220 60% 60%",
  },
  graph: {
    fg: "hsl(220 9% 86%)",
    muted: "hsl(220 9% 58%)",
    dim: "hsl(220 9% 42%)",
    faint: "hsl(220 9% 28%)",
    bgPage: "hsl(220 10% 7%)",
    bgHover: "hsl(220 10% 11%)",
    bgSelected: "hsl(220 10% 14%)",
  },
  extended: {
    dim: "hsl(220 9% 42%)",
    faint: "hsl(220 9% 28%)",
    brand: "#6b9eff",
    brandDim: "#3d72cc",
    brandGlow: "rgba(107, 158, 255, 0.08)",
    success: "#2dd4a8",
  },
  scrollbar: { thumb: "hsl(220 10% 20%)", thumbHover: "hsl(220 10% 28%)" },
  noiseOpacity: 0.02,
};

const tokyoNightAppTheme: AppTheme = {
  id: "tokyo-night",
  label: "Tokyo Night",
  type: "dark",
  cssVars: {
    "--background": "235 21% 11%",
    "--foreground": "224 20% 80%",
    "--card": "235 21% 14%",
    "--card-foreground": "224 20% 80%",
    "--popover": "235 21% 14%",
    "--popover-foreground": "224 20% 80%",
    "--primary": "224 20% 80%",
    "--primary-foreground": "235 21% 13%",
    "--secondary": "235 18% 17%",
    "--secondary-foreground": "224 20% 80%",
    "--muted": "235 18% 17%",
    "--muted-foreground": "224 15% 55%",
    "--accent": "235 18% 17%",
    "--accent-foreground": "224 20% 80%",
    "--destructive": "0 60% 45%",
    "--destructive-foreground": "224 20% 90%",
    "--border": "235 15% 19%",
    "--input": "235 15% 19%",
    "--ring": "263 70% 70%",
    "--sidebar-background": "235 21% 10%",
    "--sidebar-foreground": "224 20% 80%",
    "--sidebar-primary": "224 20% 80%",
    "--sidebar-primary-foreground": "235 21% 13%",
    "--sidebar-accent": "235 18% 17%",
    "--sidebar-accent-foreground": "224 20% 80%",
    "--sidebar-border": "235 15% 19%",
    "--sidebar-ring": "263 70% 70%",
  },
  graph: {
    fg: "hsl(224 20% 80%)",
    muted: "hsl(224 15% 55%)",
    dim: "hsl(224 12% 40%)",
    faint: "hsl(224 12% 28%)",
    bgPage: "hsl(235 21% 11%)",
    bgHover: "hsl(235 21% 15%)",
    bgSelected: "hsl(235 18% 17%)",
  },
  extended: {
    dim: "hsl(224 12% 40%)",
    faint: "hsl(224 12% 28%)",
    brand: "#bb9af7",
    brandDim: "#9d7cd8",
    brandGlow: "rgba(187, 154, 247, 0.08)",
    success: "#9ece6a",
  },
  scrollbar: { thumb: "hsl(235 15% 22%)", thumbHover: "hsl(235 15% 30%)" },
  noiseOpacity: 0.02,
};

const lightAppTheme: AppTheme = {
  id: "light",
  label: "Light",
  type: "light",
  cssVars: {
    "--background": "0 0% 98%",
    "--foreground": "240 6% 10%",
    "--card": "0 0% 100%",
    "--card-foreground": "240 6% 10%",
    "--popover": "0 0% 100%",
    "--popover-foreground": "240 6% 10%",
    "--primary": "240 6% 10%",
    "--primary-foreground": "0 0% 98%",
    "--secondary": "240 5% 93%",
    "--secondary-foreground": "240 6% 10%",
    "--muted": "240 5% 93%",
    "--muted-foreground": "240 4% 46%",
    "--accent": "240 5% 93%",
    "--accent-foreground": "240 6% 10%",
    "--destructive": "0 72% 51%",
    "--destructive-foreground": "0 0% 98%",
    "--border": "240 6% 88%",
    "--input": "240 6% 88%",
    "--ring": "263 70% 55%",
    "--sidebar-background": "240 5% 95%",
    "--sidebar-foreground": "240 6% 10%",
    "--sidebar-primary": "240 6% 10%",
    "--sidebar-primary-foreground": "0 0% 98%",
    "--sidebar-accent": "240 5% 90%",
    "--sidebar-accent-foreground": "240 6% 10%",
    "--sidebar-border": "240 6% 88%",
    "--sidebar-ring": "263 70% 55%",
  },
  graph: {
    fg: "hsl(240 6% 10%)",
    muted: "hsl(240 4% 46%)",
    dim: "hsl(240 4% 60%)",
    faint: "hsl(240 4% 78%)",
    bgPage: "hsl(0 0% 98%)",
    bgHover: "hsl(240 5% 95%)",
    bgSelected: "hsl(240 5% 93%)",
  },
  extended: {
    dim: "hsl(240 4% 60%)",
    faint: "hsl(240 4% 78%)",
    brand: "#7c3aed",
    brandDim: "#6d28d9",
    brandGlow: "rgba(124, 58, 237, 0.06)",
    success: "#16a34a",
  },
  scrollbar: { thumb: "hsl(240 5% 82%)", thumbHover: "hsl(240 5% 72%)" },
  noiseOpacity: 0,
};

export const APP_THEMES: AppTheme[] = [
  darkAppTheme,
  darkDimmedAppTheme,
  tokyoNightAppTheme,
  lightAppTheme,
];

export function getAppTheme(id: string): AppTheme {
  return APP_THEMES.find((t) => t.id === id) ?? darkAppTheme;
}

// ══════════════════════════════════════════════════════════════════════════
//  CODE THEMES
// ══════════════════════════════════════════════════════════════════════════

// ── Shiki theme definitions ──────────────────────────────────────────────

const shikiPrefetchDark: ShikiThemeDef = {
  name: "prefetch-dark",
  type: "dark",
  colors: {
    "editor.background": "#09090b",
    "editor.foreground": "#a1a1aa",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#52525b" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#34d399" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#c084fc" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#c084fc" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#60a5fa" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#fbbf24" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#e4e4e7" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f87171" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#c084fc" } },
    { scope: ["punctuation"], settings: { foreground: "#71717a" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#93c5fd" } },
    { scope: ["constant.other"], settings: { foreground: "#2dd4bf" } },
  ],
};

const shikiPrefetchDimmed: ShikiThemeDef = {
  name: "prefetch-dimmed",
  type: "dark",
  colors: {
    "editor.background": "#141820",
    "editor.foreground": "#8b949e",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#545d68" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#56d4a0" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#9ca4f4" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#d2a8ff" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#79c0ff" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#e2b86b" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#c9d1d9" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f0837a" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#d2a8ff" } },
    { scope: ["punctuation"], settings: { foreground: "#6e7681" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#79c0ff" } },
    { scope: ["constant.other"], settings: { foreground: "#56d4a0" } },
  ],
};

const shikiTokyoNight: ShikiThemeDef = {
  name: "tokyo-night",
  type: "dark",
  colors: {
    "editor.background": "#1a1b26",
    "editor.foreground": "#a9b1d6",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#565f89", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#9ece6a" } },
    { scope: ["constant.numeric"], settings: { foreground: "#ff9e64" } },
    { scope: ["constant.language"], settings: { foreground: "#ff9e64" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#bb9af7" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#7aa2f7" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#2ac3de" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#c0caf5" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f7768e" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#bb9af7" } },
    { scope: ["punctuation"], settings: { foreground: "#565f89" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#73daca" } },
    { scope: ["constant.other"], settings: { foreground: "#ff9e64" } },
  ],
};

const shikiLight: ShikiThemeDef = {
  name: "prefetch-light",
  type: "light",
  colors: {
    "editor.background": "#fafafa",
    "editor.foreground": "#3f3f46",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#a1a1aa", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#16a34a" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#7c3aed" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#7c3aed" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#2563eb" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#d97706" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#27272a" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#dc2626" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#7c3aed" } },
    { scope: ["punctuation"], settings: { foreground: "#a1a1aa" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#2563eb" } },
    { scope: ["constant.other"], settings: { foreground: "#0d9488" } },
  ],
};

// ── CodeMirror theme data ────────────────────────────────────────────────

const cmPrefetchDark: CodeThemeCodemirror = {
  bg: "hsl(240 6% 3.9%)",
  fg: "hsl(240 5% 65%)",
  caret: "hsl(240 5% 96%)",
  selection: "hsl(240 6% 15%)",
  gutterBg: "hsl(240 6% 3.9%)",
  gutterFg: "hsl(240 5% 30%)",
  activeLine: "hsl(240 6% 6%)",
  activeLineGutter: "hsl(240 6% 8%)",
  foldPlaceholderBg: "hsl(240 6% 10%)",
  foldPlaceholderFg: "hsl(240 5% 45%)",
  tooltipBg: "hsl(240 7% 7%)",
  tooltipBorder: "hsl(240 5% 11.6%)",
  tooltipFg: "hsl(240 5% 96%)",
  scrollbarThumb: "hsl(240 5% 16%)",
  scrollbarThumbHover: "hsl(240 5% 24%)",
  diffAdded: "rgba(34, 197, 94, 0.1)",
  diffRemoved: "rgba(239, 68, 68, 0.1)",
  diffHeader: "hsl(240 6% 10%)",
  diffHeaderFg: "hsl(240 5% 45%)",
  mergeChanged: "rgba(34, 197, 94, 0.08)",
  mergeDeleted: "rgba(239, 68, 68, 0.08)",
  conflictOurs: "rgba(59, 130, 246, 0.08)",
  conflictTheirs: "rgba(168, 85, 247, 0.08)",
  conflictEdited: "rgba(34, 197, 94, 0.08)",
  emptyLineIndicator: "hsl(240 5% 25%)",
  gutterOurs: "rgba(59, 130, 246, 0.5)",
  gutterTheirs: "rgba(168, 85, 247, 0.5)",
  gutterOursArrow: "rgba(59, 130, 246, 0.8)",
  gutterTheirsArrow: "rgba(168, 85, 247, 0.8)",
  gutterRemoveHover: "hsl(0 70% 60%)",
};

const cmPrefetchDimmed: CodeThemeCodemirror = {
  bg: "hsl(220 10% 7%)",
  fg: "hsl(220 9% 58%)",
  caret: "hsl(220 9% 86%)",
  selection: "hsl(220 10% 18%)",
  gutterBg: "hsl(220 10% 7%)",
  gutterFg: "hsl(220 9% 28%)",
  activeLine: "hsl(220 10% 10%)",
  activeLineGutter: "hsl(220 10% 12%)",
  foldPlaceholderBg: "hsl(220 10% 14%)",
  foldPlaceholderFg: "hsl(220 9% 42%)",
  tooltipBg: "hsl(220 10% 10%)",
  tooltipBorder: "hsl(220 10% 16%)",
  tooltipFg: "hsl(220 9% 86%)",
  scrollbarThumb: "hsl(220 10% 20%)",
  scrollbarThumbHover: "hsl(220 10% 28%)",
  diffAdded: "rgba(45, 212, 168, 0.08)",
  diffRemoved: "rgba(240, 131, 122, 0.08)",
  diffHeader: "hsl(220 10% 14%)",
  diffHeaderFg: "hsl(220 9% 42%)",
  mergeChanged: "rgba(45, 212, 168, 0.06)",
  mergeDeleted: "rgba(240, 131, 122, 0.06)",
  conflictOurs: "rgba(121, 192, 255, 0.08)",
  conflictTheirs: "rgba(210, 168, 255, 0.08)",
  conflictEdited: "rgba(45, 212, 168, 0.06)",
  emptyLineIndicator: "hsl(220 9% 22%)",
  gutterOurs: "rgba(121, 192, 255, 0.5)",
  gutterTheirs: "rgba(210, 168, 255, 0.5)",
  gutterOursArrow: "rgba(121, 192, 255, 0.8)",
  gutterTheirsArrow: "rgba(210, 168, 255, 0.8)",
  gutterRemoveHover: "hsl(0 60% 55%)",
};

const cmTokyoNight: CodeThemeCodemirror = {
  bg: "hsl(235 21% 11%)",
  fg: "hsl(224 20% 68%)",
  caret: "hsl(224 20% 80%)",
  selection: "hsl(235 21% 20%)",
  gutterBg: "hsl(235 21% 11%)",
  gutterFg: "hsl(224 12% 30%)",
  activeLine: "hsl(235 21% 14%)",
  activeLineGutter: "hsl(235 21% 16%)",
  foldPlaceholderBg: "hsl(235 18% 17%)",
  foldPlaceholderFg: "hsl(224 12% 40%)",
  tooltipBg: "hsl(235 21% 14%)",
  tooltipBorder: "hsl(235 15% 19%)",
  tooltipFg: "hsl(224 20% 80%)",
  scrollbarThumb: "hsl(235 15% 22%)",
  scrollbarThumbHover: "hsl(235 15% 30%)",
  diffAdded: "rgba(158, 206, 106, 0.1)",
  diffRemoved: "rgba(247, 118, 142, 0.1)",
  diffHeader: "hsl(235 18% 17%)",
  diffHeaderFg: "hsl(224 12% 40%)",
  mergeChanged: "rgba(158, 206, 106, 0.08)",
  mergeDeleted: "rgba(247, 118, 142, 0.08)",
  conflictOurs: "rgba(122, 162, 247, 0.1)",
  conflictTheirs: "rgba(187, 154, 247, 0.1)",
  conflictEdited: "rgba(158, 206, 106, 0.08)",
  emptyLineIndicator: "hsl(224 12% 25%)",
  gutterOurs: "rgba(122, 162, 247, 0.5)",
  gutterTheirs: "rgba(187, 154, 247, 0.5)",
  gutterOursArrow: "rgba(122, 162, 247, 0.8)",
  gutterTheirsArrow: "rgba(187, 154, 247, 0.8)",
  gutterRemoveHover: "hsl(0 65% 55%)",
};

const cmLight: CodeThemeCodemirror = {
  bg: "hsl(0 0% 98%)",
  fg: "hsl(240 6% 25%)",
  caret: "hsl(240 6% 10%)",
  selection: "hsl(240 60% 92%)",
  gutterBg: "hsl(0 0% 98%)",
  gutterFg: "hsl(240 4% 68%)",
  activeLine: "hsl(240 5% 95%)",
  activeLineGutter: "hsl(240 5% 93%)",
  foldPlaceholderBg: "hsl(240 5% 93%)",
  foldPlaceholderFg: "hsl(240 4% 60%)",
  tooltipBg: "hsl(0 0% 100%)",
  tooltipBorder: "hsl(240 6% 88%)",
  tooltipFg: "hsl(240 6% 10%)",
  scrollbarThumb: "hsl(240 5% 82%)",
  scrollbarThumbHover: "hsl(240 5% 72%)",
  diffAdded: "rgba(22, 163, 74, 0.08)",
  diffRemoved: "rgba(220, 38, 38, 0.08)",
  diffHeader: "hsl(240 5% 93%)",
  diffHeaderFg: "hsl(240 4% 46%)",
  mergeChanged: "rgba(22, 163, 74, 0.06)",
  mergeDeleted: "rgba(220, 38, 38, 0.06)",
  conflictOurs: "rgba(37, 99, 235, 0.06)",
  conflictTheirs: "rgba(124, 58, 237, 0.06)",
  conflictEdited: "rgba(22, 163, 74, 0.06)",
  emptyLineIndicator: "hsl(240 4% 78%)",
  gutterOurs: "rgba(37, 99, 235, 0.4)",
  gutterTheirs: "rgba(124, 58, 237, 0.4)",
  gutterOursArrow: "rgba(37, 99, 235, 0.7)",
  gutterTheirsArrow: "rgba(124, 58, 237, 0.7)",
  gutterRemoveHover: "hsl(0 72% 51%)",
};

// ── Diff color sets ──────────────────────────────────────────────────────

const diffPrefetchDark: CodeThemeDiff = {
  addedBg: "rgba(34, 197, 94, 0.1)",
  addedLineBg: "rgba(34, 197, 94, 0.15)",
  removedBg: "rgba(239, 68, 68, 0.1)",
  removedLineBg: "rgba(239, 68, 68, 0.15)",
  hunkHeaderBg: "hsl(240 6% 10%)",
  hunkHeaderFg: "hsl(240 5% 45%)",
  gutterBg: "hsl(240 6% 3.9%)",
  gutterFg: "hsl(240 5% 30%)",
};

const diffPrefetchDimmed: CodeThemeDiff = {
  addedBg: "rgba(45, 212, 168, 0.08)",
  addedLineBg: "rgba(45, 212, 168, 0.12)",
  removedBg: "rgba(240, 131, 122, 0.08)",
  removedLineBg: "rgba(240, 131, 122, 0.12)",
  hunkHeaderBg: "hsl(220 10% 14%)",
  hunkHeaderFg: "hsl(220 9% 42%)",
  gutterBg: "hsl(220 10% 7%)",
  gutterFg: "hsl(220 9% 28%)",
};

const diffTokyoNight: CodeThemeDiff = {
  addedBg: "rgba(158, 206, 106, 0.1)",
  addedLineBg: "rgba(158, 206, 106, 0.15)",
  removedBg: "rgba(247, 118, 142, 0.1)",
  removedLineBg: "rgba(247, 118, 142, 0.15)",
  hunkHeaderBg: "hsl(235 18% 17%)",
  hunkHeaderFg: "hsl(224 12% 40%)",
  gutterBg: "hsl(235 21% 11%)",
  gutterFg: "hsl(224 12% 30%)",
};

const diffLight: CodeThemeDiff = {
  addedBg: "rgba(22, 163, 74, 0.08)",
  addedLineBg: "rgba(22, 163, 74, 0.12)",
  removedBg: "rgba(220, 38, 38, 0.08)",
  removedLineBg: "rgba(220, 38, 38, 0.12)",
  hunkHeaderBg: "hsl(240 5% 93%)",
  hunkHeaderFg: "hsl(240 4% 46%)",
  gutterBg: "hsl(0 0% 98%)",
  gutterFg: "hsl(240 4% 68%)",
};

// ── Assembled code themes ────────────────────────────────────────────────

const prefetchDarkCodeTheme: CodeTheme = {
  id: "prefetch-dark",
  label: "Dark",
  shikiTheme: shikiPrefetchDark,
  codemirror: cmPrefetchDark,
  diff: diffPrefetchDark,
};

const prefetchDimmedCodeTheme: CodeTheme = {
  id: "prefetch-dimmed",
  label: "Dark Dimmed",
  shikiTheme: shikiPrefetchDimmed,
  codemirror: cmPrefetchDimmed,
  diff: diffPrefetchDimmed,
};

const tokyoNightCodeTheme: CodeTheme = {
  id: "tokyo-night",
  label: "Tokyo Night",
  shikiTheme: shikiTokyoNight,
  codemirror: cmTokyoNight,
  diff: diffTokyoNight,
};

const lightCodeTheme: CodeTheme = {
  id: "light",
  label: "Light",
  shikiTheme: shikiLight,
  codemirror: cmLight,
  diff: diffLight,
};

export const CODE_THEMES: CodeTheme[] = [
  prefetchDarkCodeTheme,
  prefetchDimmedCodeTheme,
  tokyoNightCodeTheme,
  lightCodeTheme,
];

export function getCodeTheme(id: string): CodeTheme {
  return CODE_THEMES.find((t) => t.id === id) ?? prefetchDarkCodeTheme;
}

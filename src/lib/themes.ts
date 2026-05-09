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

export interface CodeThemeConflict {
  ours: string;
  theirs: string;
  auto: string;
  suspicious: string;
  output: string;
  oursText: string;
  theirsText: string;
  autoText: string;
  suspiciousText: string;
  outputText: string;
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
  conflict: CodeThemeConflict;
}

// ── Default pairing ───────────────────────────────────────────────────────

export const DEFAULT_CODE_THEME: Record<string, string> = {
  dark: "vs-dark",
  "dark-dimmed": "vs-dark-dimmed",
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

const shikiMaterialDark: ShikiThemeDef = {
  name: "material-dark",
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

const shikiVsDarkDimmed: ShikiThemeDef = {
  name: "vs-dark-dimmed",
  type: "dark",
  colors: {
    "editor.background": "#1d2028",
    "editor.foreground": "#b0b8c4",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#5c7852", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#b88468" } },
    { scope: ["constant.numeric"], settings: { foreground: "#98b490" } },
    { scope: ["constant.language"], settings: { foreground: "#6a90b8" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#6a90b8" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#c0b888" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#58a898" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#88b0d0" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#6a90b8" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#88b0d0" } },
    { scope: ["punctuation"], settings: { foreground: "#606870" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#88b0d0" } },
    { scope: ["constant.other"], settings: { foreground: "#58a8c8" } },
  ],
};

const shikiMinimalDark: ShikiThemeDef = {
  name: "minimal-dark",
  type: "dark",
  colors: {
    "editor.background": "#1a1a1c",
    "editor.foreground": "#e4e4e4",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6a6a70", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#d4c088" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#c8b8e0" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#7ab0d8" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#e4e4e4" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#e4e4e4" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#e4e4e4" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#7ab0d8" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#e4e4e4" } },
    { scope: ["punctuation"], settings: { foreground: "#909094" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#e4e4e4" } },
    { scope: ["constant.other"], settings: { foreground: "#c8b8e0" } },
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

const cmMaterialDark: CodeThemeCodemirror = {
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
  conflictTheirs: "rgba(20, 184, 166, 0.08)",
  conflictEdited: "rgba(34, 197, 94, 0.08)",
  emptyLineIndicator: "hsl(240 5% 25%)",
  gutterOurs: "rgba(59, 130, 246, 0.5)",
  gutterTheirs: "rgba(20, 184, 166, 0.5)",
  gutterOursArrow: "rgba(59, 130, 246, 0.8)",
  gutterTheirsArrow: "rgba(20, 184, 166, 0.8)",
  gutterRemoveHover: "hsl(0 70% 60%)",
};

const cmVsDarkDimmed: CodeThemeCodemirror = {
  bg: "#1d2028",
  fg: "#b0b8c4",
  caret: "#8890a0",
  selection: "#253050",
  gutterBg: "#1d2028",
  gutterFg: "#505860",
  activeLine: "#222830",
  activeLineGutter: "#252b33",
  foldPlaceholderBg: "#2a3038",
  foldPlaceholderFg: "#606870",
  tooltipBg: "#222830",
  tooltipBorder: "#383e48",
  tooltipFg: "#b0b8c4",
  scrollbarThumb: "#363e48",
  scrollbarThumbHover: "#444c58",
  diffAdded: "rgba(35, 134, 54, 0.15)",
  diffRemoved: "rgba(206, 50, 50, 0.15)",
  diffHeader: "#2a3038",
  diffHeaderFg: "#606870",
  mergeChanged: "rgba(35, 134, 54, 0.10)",
  mergeDeleted: "rgba(206, 50, 50, 0.10)",
  conflictOurs: "rgba(59, 130, 246, 0.10)",
  conflictTheirs: "rgba(20, 184, 166, 0.10)",
  conflictEdited: "rgba(35, 134, 54, 0.10)",
  emptyLineIndicator: "#404850",
  gutterOurs: "rgba(59, 130, 246, 0.5)",
  gutterTheirs: "rgba(20, 184, 166, 0.5)",
  gutterOursArrow: "rgba(59, 130, 246, 0.8)",
  gutterTheirsArrow: "rgba(20, 184, 166, 0.8)",
  gutterRemoveHover: "#c83030",
};

const cmMinimalDark: CodeThemeCodemirror = {
  bg: "#1a1a1c",
  fg: "#e4e4e4",
  caret: "#e4e4e4",
  selection: "#2a2a30",
  gutterBg: "#1a1a1c",
  gutterFg: "#6a6a70",
  activeLine: "#1e1e22",
  activeLineGutter: "#222226",
  foldPlaceholderBg: "#262628",
  foldPlaceholderFg: "#6a6a70",
  tooltipBg: "#222224",
  tooltipBorder: "#383838",
  tooltipFg: "#e4e4e4",
  scrollbarThumb: "#333338",
  scrollbarThumbHover: "#404044",
  diffAdded: "rgba(120, 140, 100, 0.12)",
  diffRemoved: "rgba(160, 80, 80, 0.12)",
  diffHeader: "#262628",
  diffHeaderFg: "#505054",
  mergeChanged: "rgba(120, 140, 100, 0.08)",
  mergeDeleted: "rgba(160, 80, 80, 0.08)",
  conflictOurs: "rgba(90, 110, 140, 0.10)",
  conflictTheirs: "rgba(80, 130, 120, 0.10)",
  conflictEdited: "rgba(120, 140, 100, 0.10)",
  emptyLineIndicator: "#383838",
  gutterOurs: "rgba(90, 110, 140, 0.5)",
  gutterTheirs: "rgba(80, 130, 120, 0.5)",
  gutterOursArrow: "rgba(90, 110, 140, 0.8)",
  gutterTheirsArrow: "rgba(80, 130, 120, 0.8)",
  gutterRemoveHover: "#a05050",
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
  conflictTheirs: "rgba(115, 218, 202, 0.1)",
  conflictEdited: "rgba(158, 206, 106, 0.08)",
  emptyLineIndicator: "hsl(224 12% 25%)",
  gutterOurs: "rgba(122, 162, 247, 0.5)",
  gutterTheirs: "rgba(115, 218, 202, 0.5)",
  gutterOursArrow: "rgba(122, 162, 247, 0.8)",
  gutterTheirsArrow: "rgba(115, 218, 202, 0.8)",
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
  conflictTheirs: "rgba(13, 148, 136, 0.06)",
  conflictEdited: "rgba(22, 163, 74, 0.06)",
  emptyLineIndicator: "hsl(240 4% 78%)",
  gutterOurs: "rgba(37, 99, 235, 0.4)",
  gutterTheirs: "rgba(13, 148, 136, 0.4)",
  gutterOursArrow: "rgba(37, 99, 235, 0.7)",
  gutterTheirsArrow: "rgba(13, 148, 136, 0.7)",
  gutterRemoveHover: "hsl(0 72% 51%)",
};

// ── Diff color sets ──────────────────────────────────────────────────────

const diffMaterialDark: CodeThemeDiff = {
  addedBg: "rgba(34, 197, 94, 0.1)",
  addedLineBg: "rgba(34, 197, 94, 0.15)",
  removedBg: "rgba(239, 68, 68, 0.1)",
  removedLineBg: "rgba(239, 68, 68, 0.15)",
  hunkHeaderBg: "hsl(240 6% 10%)",
  hunkHeaderFg: "hsl(240 5% 45%)",
  gutterBg: "hsl(240 6% 3.9%)",
  gutterFg: "hsl(240 5% 30%)",
};

const diffVsDarkDimmed: CodeThemeDiff = {
  addedBg: "rgba(35, 134, 54, 0.10)",
  addedLineBg: "rgba(35, 134, 54, 0.18)",
  removedBg: "rgba(206, 50, 50, 0.10)",
  removedLineBg: "rgba(206, 50, 50, 0.18)",
  hunkHeaderBg: "#2a3038",
  hunkHeaderFg: "#606870",
  gutterBg: "#1d2028",
  gutterFg: "#505860",
};

const diffMinimalDark: CodeThemeDiff = {
  addedBg: "rgba(120, 140, 100, 0.08)",
  addedLineBg: "rgba(120, 140, 100, 0.14)",
  removedBg: "rgba(160, 80, 80, 0.08)",
  removedLineBg: "rgba(160, 80, 80, 0.14)",
  hunkHeaderBg: "#262628",
  hunkHeaderFg: "#505054",
  gutterBg: "#1a1a1c",
  gutterFg: "#404044",
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

// ── Conflict color sets ──────────────────────────────────────────────────

const DARK_CONFLICT: CodeThemeConflict = {
  ours: "59, 130, 246",
  theirs: "20, 184, 166",
  auto: "168, 85, 247",
  suspicious: "244, 63, 94",
  output: "34, 197, 94",
  oursText: "#60a5fa",
  theirsText: "#2dd4bf",
  autoText: "#a78bfa",
  suspiciousText: "#fb7185",
  outputText: "#34d399",
};

const LIGHT_CONFLICT: CodeThemeConflict = {
  ours: "37, 99, 235",
  theirs: "13, 148, 136",
  auto: "124, 58, 237",
  suspicious: "225, 29, 72",
  output: "22, 163, 74",
  oursText: "#2563eb",
  theirsText: "#0d9488",
  autoText: "#7c3aed",
  suspiciousText: "#e11d48",
  outputText: "#16a34a",
};

// ── VS Dark theme ───────────────────────────────────────────────────────

const shikiVsDark: ShikiThemeDef = {
  name: "vs-dark",
  type: "dark",
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6a9955", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#ce9178" } },
    { scope: ["constant.numeric"], settings: { foreground: "#b5cea8" } },
    { scope: ["constant.language"], settings: { foreground: "#569cd6" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#569cd6" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#dcdcaa" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#4ec9b0" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#9cdcfe" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#569cd6" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#9cdcfe" } },
    { scope: ["punctuation"], settings: { foreground: "#808080" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#9cdcfe" } },
    { scope: ["constant.other"], settings: { foreground: "#4fc1ff" } },
  ],
};

const cmVsDark: CodeThemeCodemirror = {
  bg: "#1e1e1e",
  fg: "#d4d4d4",
  caret: "#aeafad",
  selection: "#264f78",
  gutterBg: "#1e1e1e",
  gutterFg: "#858585",
  activeLine: "#2a2d2e",
  activeLineGutter: "#2a2d2e",
  foldPlaceholderBg: "#333333",
  foldPlaceholderFg: "#808080",
  tooltipBg: "#252526",
  tooltipBorder: "#454545",
  tooltipFg: "#cccccc",
  scrollbarThumb: "#424242",
  scrollbarThumbHover: "#4f4f4f",
  diffAdded: "rgba(35, 134, 54, 0.2)",
  diffRemoved: "rgba(206, 50, 50, 0.2)",
  diffHeader: "#333333",
  diffHeaderFg: "#808080",
  mergeChanged: "rgba(35, 134, 54, 0.15)",
  mergeDeleted: "rgba(206, 50, 50, 0.15)",
  conflictOurs: "rgba(59, 130, 246, 0.12)",
  conflictTheirs: "rgba(20, 184, 166, 0.12)",
  conflictEdited: "rgba(35, 134, 54, 0.12)",
  emptyLineIndicator: "#585858",
  gutterOurs: "rgba(59, 130, 246, 0.5)",
  gutterTheirs: "rgba(20, 184, 166, 0.5)",
  gutterOursArrow: "rgba(59, 130, 246, 0.8)",
  gutterTheirsArrow: "rgba(20, 184, 166, 0.8)",
  gutterRemoveHover: "#d32f2f",
};

const diffVsDark: CodeThemeDiff = {
  addedBg: "rgba(35, 134, 54, 0.15)",
  addedLineBg: "rgba(35, 134, 54, 0.22)",
  removedBg: "rgba(206, 50, 50, 0.15)",
  removedLineBg: "rgba(206, 50, 50, 0.22)",
  hunkHeaderBg: "#333333",
  hunkHeaderFg: "#808080",
  gutterBg: "#1e1e1e",
  gutterFg: "#858585",
};

// ── GitHub Dark theme ───────────────────────────────────────────────────

const shikiGithubDark: ShikiThemeDef = {
  name: "github-dark",
  type: "dark",
  colors: {
    "editor.background": "#0d1117",
    "editor.foreground": "#e6edf3",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#8b949e", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#a5d6ff" } },
    { scope: ["constant.numeric"], settings: { foreground: "#79c0ff" } },
    { scope: ["constant.language"], settings: { foreground: "#79c0ff" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#ff7b72" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#d2a8ff" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#79c0ff" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#e6edf3" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#7ee787" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#79c0ff" } },
    { scope: ["punctuation"], settings: { foreground: "#8b949e" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#79c0ff" } },
    { scope: ["constant.other"], settings: { foreground: "#79c0ff" } },
  ],
};

const cmGithubDark: CodeThemeCodemirror = {
  bg: "#0d1117",
  fg: "#e6edf3",
  caret: "#58a6ff",
  selection: "#1f3a5f",
  gutterBg: "#0d1117",
  gutterFg: "#484f58",
  activeLine: "#161b22",
  activeLineGutter: "#161b22",
  foldPlaceholderBg: "#161b22",
  foldPlaceholderFg: "#484f58",
  tooltipBg: "#161b22",
  tooltipBorder: "#30363d",
  tooltipFg: "#e6edf3",
  scrollbarThumb: "#30363d",
  scrollbarThumbHover: "#484f58",
  diffAdded: "rgba(63, 185, 80, 0.1)",
  diffRemoved: "rgba(248, 81, 73, 0.1)",
  diffHeader: "#161b22",
  diffHeaderFg: "#484f58",
  mergeChanged: "rgba(63, 185, 80, 0.08)",
  mergeDeleted: "rgba(248, 81, 73, 0.08)",
  conflictOurs: "rgba(59, 130, 246, 0.1)",
  conflictTheirs: "rgba(20, 184, 166, 0.1)",
  conflictEdited: "rgba(63, 185, 80, 0.1)",
  emptyLineIndicator: "#30363d",
  gutterOurs: "rgba(59, 130, 246, 0.5)",
  gutterTheirs: "rgba(20, 184, 166, 0.5)",
  gutterOursArrow: "rgba(59, 130, 246, 0.8)",
  gutterTheirsArrow: "rgba(20, 184, 166, 0.8)",
  gutterRemoveHover: "#f85149",
};

const diffGithubDark: CodeThemeDiff = {
  addedBg: "rgba(63, 185, 80, 0.1)",
  addedLineBg: "rgba(63, 185, 80, 0.15)",
  removedBg: "rgba(248, 81, 73, 0.1)",
  removedLineBg: "rgba(248, 81, 73, 0.15)",
  hunkHeaderBg: "#161b22",
  hunkHeaderFg: "#484f58",
  gutterBg: "#0d1117",
  gutterFg: "#484f58",
};

// ── Monokai theme ───────────────────────────────────────────────────────

const shikiMonokai: ShikiThemeDef = {
  name: "monokai",
  type: "dark",
  colors: {
    "editor.background": "#272822",
    "editor.foreground": "#f8f8f2",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#75715e", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#e6db74" } },
    { scope: ["constant.numeric"], settings: { foreground: "#ae81ff" } },
    { scope: ["constant.language"], settings: { foreground: "#ae81ff" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#f92672" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#a6e22e" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#66d9ef", fontStyle: "italic" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#f8f8f2" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f92672" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#a6e22e" } },
    { scope: ["punctuation"], settings: { foreground: "#f8f8f2" } },
    { scope: ["meta.object-literal.key"], settings: { foreground: "#f8f8f2" } },
    { scope: ["constant.other"], settings: { foreground: "#66d9ef" } },
  ],
};

const cmMonokai: CodeThemeCodemirror = {
  bg: "#272822",
  fg: "#f8f8f2",
  caret: "#f8f8f0",
  selection: "#49483e",
  gutterBg: "#272822",
  gutterFg: "#75715e",
  activeLine: "#3e3d32",
  activeLineGutter: "#3e3d32",
  foldPlaceholderBg: "#3e3d32",
  foldPlaceholderFg: "#75715e",
  tooltipBg: "#3e3d32",
  tooltipBorder: "#575746",
  tooltipFg: "#f8f8f2",
  scrollbarThumb: "#49483e",
  scrollbarThumbHover: "#575746",
  diffAdded: "rgba(166, 226, 46, 0.1)",
  diffRemoved: "rgba(249, 38, 114, 0.1)",
  diffHeader: "#3e3d32",
  diffHeaderFg: "#75715e",
  mergeChanged: "rgba(166, 226, 46, 0.08)",
  mergeDeleted: "rgba(249, 38, 114, 0.08)",
  conflictOurs: "rgba(59, 130, 246, 0.12)",
  conflictTheirs: "rgba(20, 184, 166, 0.12)",
  conflictEdited: "rgba(166, 226, 46, 0.1)",
  emptyLineIndicator: "#575746",
  gutterOurs: "rgba(59, 130, 246, 0.5)",
  gutterTheirs: "rgba(20, 184, 166, 0.5)",
  gutterOursArrow: "rgba(59, 130, 246, 0.8)",
  gutterTheirsArrow: "rgba(20, 184, 166, 0.8)",
  gutterRemoveHover: "#f92672",
};

const diffMonokai: CodeThemeDiff = {
  addedBg: "rgba(166, 226, 46, 0.1)",
  addedLineBg: "rgba(166, 226, 46, 0.15)",
  removedBg: "rgba(249, 38, 114, 0.1)",
  removedLineBg: "rgba(249, 38, 114, 0.15)",
  hunkHeaderBg: "#3e3d32",
  hunkHeaderFg: "#75715e",
  gutterBg: "#272822",
  gutterFg: "#75715e",
};

// ── Assembled code themes ────────────────────────────────────────────────

const materialDarkCodeTheme: CodeTheme = {
  id: "material-dark",
  label: "Material Dark",
  shikiTheme: shikiMaterialDark,
  codemirror: cmMaterialDark,
  diff: diffMaterialDark,
  conflict: DARK_CONFLICT,
};

const tokyoNightCodeTheme: CodeTheme = {
  id: "tokyo-night",
  label: "Tokyo Night",
  shikiTheme: shikiTokyoNight,
  codemirror: cmTokyoNight,
  diff: diffTokyoNight,
  conflict: DARK_CONFLICT,
};

const lightCodeTheme: CodeTheme = {
  id: "light",
  label: "Light",
  shikiTheme: shikiLight,
  codemirror: cmLight,
  diff: diffLight,
  conflict: LIGHT_CONFLICT,
};

const vsDarkCodeTheme: CodeTheme = {
  id: "vs-dark",
  label: "VS Dark",
  shikiTheme: shikiVsDark,
  codemirror: cmVsDark,
  diff: diffVsDark,
  conflict: DARK_CONFLICT,
};

const vsDarkDimmedCodeTheme: CodeTheme = {
  id: "vs-dark-dimmed",
  label: "VS Dark Dimmed",
  shikiTheme: shikiVsDarkDimmed,
  codemirror: cmVsDarkDimmed,
  diff: diffVsDarkDimmed,
  conflict: DARK_CONFLICT,
};

const minimalDarkCodeTheme: CodeTheme = {
  id: "minimal-dark",
  label: "Minimal Dark",
  shikiTheme: shikiMinimalDark,
  codemirror: cmMinimalDark,
  diff: diffMinimalDark,
  conflict: DARK_CONFLICT,
};

const githubDarkCodeTheme: CodeTheme = {
  id: "github-dark",
  label: "GitHub Dark",
  shikiTheme: shikiGithubDark,
  codemirror: cmGithubDark,
  diff: diffGithubDark,
  conflict: DARK_CONFLICT,
};

const monokaiCodeTheme: CodeTheme = {
  id: "monokai",
  label: "Monokai",
  shikiTheme: shikiMonokai,
  codemirror: cmMonokai,
  diff: diffMonokai,
  conflict: DARK_CONFLICT,
};

export const CODE_THEMES: CodeTheme[] = [
  vsDarkCodeTheme,
  vsDarkDimmedCodeTheme,
  minimalDarkCodeTheme,
  materialDarkCodeTheme,
  tokyoNightCodeTheme,
  githubDarkCodeTheme,
  monokaiCodeTheme,
  lightCodeTheme,
];

export function getCodeTheme(id: string): CodeTheme {
  return CODE_THEMES.find((t) => t.id === id) ?? vsDarkCodeTheme;
}

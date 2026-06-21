import { create } from "zustand";
import { getUiState, setUiState } from "@/lib/database";
import {
  type AppTheme,
  type CodeTheme,
  getAppTheme,
  getCodeTheme,
  DEFAULT_CODE_THEME,
} from "@/lib/themes";

// ── Font options ─────────────────────────────────────────────────────────

export interface FontOption {
  id: string;
  label: string;
  value: string;
}

export const FONT_FAMILIES: FontOption[] = [
  { id: "inter", label: "Inter", value: '"Inter", system-ui, sans-serif' },
  { id: "geist", label: "Geist", value: '"Geist", system-ui, sans-serif' },
  { id: "system", label: "System", value: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
];

export const MONO_FONTS: FontOption[] = [
  { id: "jetbrains", label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
  { id: "geist-mono", label: "Geist Mono", value: '"Geist Mono", ui-monospace, monospace' },
  { id: "system-mono", label: "System", value: 'ui-monospace, "Cascadia Code", "Consolas", monospace' },
];

export const DEFAULT_MONO_FONT: Record<string, string> = {
  inter: "jetbrains",
  geist: "geist-mono",
  system: "system-mono",
};

export const FONT_SCALES = [
  { label: "90%", value: 0.9 },
  { label: "100%", value: 1.0 },
  { label: "110%", value: 1.1 },
  { label: "120%", value: 1.2 },
] as const;

// Base (100%-scale) font sizes in px. Drives the DOM type scale via CSS vars
// (see applyFontScale) AND the Canvas commit graph, which can't read CSS vars
// and so reads these numbers directly (commit-graph-canvas.tsx).
export const BASE_TEXT_SIZES = {
  caption: 12,
  captionLh: 16,
  label: 14,
  labelLh: 18,
  xs: 14,
  xsLh: 18,
  sm: 16,
  smLh: 20,
};

function getFontOption(list: FontOption[], id: string): FontOption {
  return list.find((f) => f.id === id) ?? list[0];
}

// ── State ────────────────────────────────────────────────────────────────

interface ThemeState {
  appThemeId: string;
  codeThemeId: string;
  appTheme: AppTheme;
  codeTheme: CodeTheme;
  fontFamilyId: string;
  monoFontId: string;
  fontScale: number;
  setAppTheme: (id: string) => void;
  setCodeTheme: (id: string) => void;
  setFontFamily: (id: string) => void;
  setMonoFont: (id: string) => void;
  setFontScale: (scale: number) => void;
  loadThemePreferences: () => Promise<void>;
}

function applyFonts(sans: FontOption, mono: FontOption) {
  const root = document.documentElement;
  root.style.setProperty("--font-sans", sans.value);
  root.style.setProperty("--font-mono", mono.value);
}

function applyMonoFont(mono: FontOption) {
  document.documentElement.style.setProperty("--font-mono", mono.value);
}

function applyFontScale(scale: number) {
  const root = document.documentElement;
  const s = (base: number) => `${Math.round(base * scale * 10) / 10}px`;
  root.style.setProperty("--text-caption", s(BASE_TEXT_SIZES.caption));
  root.style.setProperty("--text-caption--line-height", s(BASE_TEXT_SIZES.captionLh));
  root.style.setProperty("--text-label", s(BASE_TEXT_SIZES.label));
  root.style.setProperty("--text-label--line-height", s(BASE_TEXT_SIZES.labelLh));
  root.style.setProperty("--text-xs", s(BASE_TEXT_SIZES.xs));
  root.style.setProperty("--text-xs--line-height", s(BASE_TEXT_SIZES.xsLh));
  root.style.setProperty("--text-sm", s(BASE_TEXT_SIZES.sm));
  root.style.setProperty("--text-sm--line-height", s(BASE_TEXT_SIZES.smLh));
}

function applyAppTheme(theme: AppTheme) {
  const root = document.documentElement;

  for (const [key, value] of Object.entries(theme.cssVars)) {
    root.style.setProperty(key, value);
  }

  root.style.setProperty("--color-dim", theme.extended.dim);
  root.style.setProperty("--color-faint", theme.extended.faint);
  root.style.setProperty("--color-brand", theme.extended.brand);
  root.style.setProperty("--color-brand-dim", theme.extended.brandDim);
  root.style.setProperty("--color-brand-glow", theme.extended.brandGlow);
  root.style.setProperty("--color-success", theme.extended.success);

  root.style.setProperty("--scrollbar-thumb", theme.scrollbar.thumb);
  root.style.setProperty("--scrollbar-thumb-hover", theme.scrollbar.thumbHover);
  root.style.setProperty("--noise-opacity", String(theme.noiseOpacity));

  root.setAttribute("data-theme", theme.id);
  root.setAttribute("data-theme-type", theme.type);
}

function applyCodeTheme(theme: CodeTheme) {
  const root = document.documentElement;

  root.style.setProperty("--diff-added-bg", theme.diff.addedBg);
  root.style.setProperty("--diff-added-line-bg", theme.diff.addedLineBg);
  root.style.setProperty("--diff-removed-bg", theme.diff.removedBg);
  root.style.setProperty("--diff-removed-line-bg", theme.diff.removedLineBg);
  root.style.setProperty("--diff-hunk-header-bg", theme.diff.hunkHeaderBg);
  root.style.setProperty("--diff-hunk-header-fg", theme.diff.hunkHeaderFg);
  root.style.setProperty("--diff-gutter-bg", theme.diff.gutterBg);
  root.style.setProperty("--diff-gutter-fg", theme.diff.gutterFg);

  root.style.setProperty("--conflict-ours", theme.conflict.ours);
  root.style.setProperty("--conflict-theirs", theme.conflict.theirs);
  root.style.setProperty("--conflict-auto", theme.conflict.auto);
  root.style.setProperty("--conflict-suspicious", theme.conflict.suspicious);
  root.style.setProperty("--conflict-output", theme.conflict.output);
  root.style.setProperty("--conflict-ours-text", theme.conflict.oursText);
  root.style.setProperty("--conflict-theirs-text", theme.conflict.theirsText);
  root.style.setProperty("--conflict-auto-text", theme.conflict.autoText);
  root.style.setProperty("--conflict-suspicious-text", theme.conflict.suspiciousText);
  root.style.setProperty("--conflict-output-text", theme.conflict.outputText);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  appThemeId: "dark",
  codeThemeId: "vs-dark",
  appTheme: getAppTheme("dark"),
  codeTheme: getCodeTheme("vs-dark"),
  fontFamilyId: "inter",
  monoFontId: "jetbrains",
  fontScale: 1.0,

  setAppTheme: (id) => {
    const theme = getAppTheme(id);
    applyAppTheme(theme);
    set({ appThemeId: id, appTheme: theme });
    setUiState("app_theme", id).catch(() => {});
  },

  setCodeTheme: (id) => {
    const theme = getCodeTheme(id);
    applyCodeTheme(theme);
    set({ codeThemeId: id, codeTheme: theme });
    setUiState("code_theme", id).catch(() => {});
  },

  setFontFamily: (id) => {
    const { monoFontId, fontFamilyId } = get();
    const sans = getFontOption(FONT_FAMILIES, id);

    // Auto-follow mono if the user hasn't customized it away from the default pairing
    const currentDefault = DEFAULT_MONO_FONT[fontFamilyId];
    const shouldFollowMono = monoFontId === currentDefault;
    const newMonoId = shouldFollowMono ? (DEFAULT_MONO_FONT[id] ?? monoFontId) : monoFontId;
    const mono = getFontOption(MONO_FONTS, newMonoId);

    applyFonts(sans, mono);
    set({ fontFamilyId: id, monoFontId: newMonoId });
    setUiState("font_family", id).catch(() => {});
    if (shouldFollowMono) setUiState("mono_font", newMonoId).catch(() => {});
  },

  setMonoFont: (id) => {
    const mono = getFontOption(MONO_FONTS, id);
    applyMonoFont(mono);
    set({ monoFontId: id });
    setUiState("mono_font", id).catch(() => {});
  },

  setFontScale: (scale) => {
    applyFontScale(scale);
    set({ fontScale: scale });
    setUiState("font_scale", String(scale)).catch(() => {});
  },

  loadThemePreferences: async () => {
    try {
      const [appId, codeId, fontFamId, monoId, fontScaleStr] = await Promise.all([
        getUiState("app_theme"),
        getUiState("code_theme"),
        getUiState("font_family"),
        getUiState("mono_font"),
        getUiState("font_scale"),
      ]);

      const resolvedAppId = appId ?? "dark";
      const resolvedCodeId =
        codeId ?? DEFAULT_CODE_THEME[resolvedAppId] ?? "vs-dark";
      const resolvedFontFamilyId = fontFamId ?? "inter";
      const resolvedMonoFontId = monoId ?? DEFAULT_MONO_FONT[resolvedFontFamilyId] ?? "jetbrains";
      const resolvedFontScale = fontScaleStr ? parseFloat(fontScaleStr) : 1.0;

      const appTheme = getAppTheme(resolvedAppId);
      const codeTheme = getCodeTheme(resolvedCodeId);
      const sans = getFontOption(FONT_FAMILIES, resolvedFontFamilyId);
      const mono = getFontOption(MONO_FONTS, resolvedMonoFontId);

      applyAppTheme(appTheme);
      applyCodeTheme(codeTheme);
      applyFonts(sans, mono);
      // Always apply — BASE_TEXT_SIZES is the source of truth for the type
      // scale, and the CSS fallbacks in index.css can drift from it. Skipping
      // at scale 1.0 would leave the stale CSS values in place on restart.
      applyFontScale(resolvedFontScale);

      set({
        appThemeId: resolvedAppId,
        codeThemeId: resolvedCodeId,
        appTheme,
        codeTheme,
        fontFamilyId: resolvedFontFamilyId,
        monoFontId: resolvedMonoFontId,
        fontScale: resolvedFontScale,
      });
    } catch {
      // DB not ready yet — keep defaults, they'll match the CSS
    }
  },
}));

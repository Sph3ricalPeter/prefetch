import { create } from "zustand";
import { getUiState, setUiState } from "@/lib/database";
import {
  type AppTheme,
  type CodeTheme,
  getAppTheme,
  getCodeTheme,
  DEFAULT_CODE_THEME,
} from "@/lib/themes";

interface ThemeState {
  appThemeId: string;
  codeThemeId: string;
  appTheme: AppTheme;
  codeTheme: CodeTheme;
  setAppTheme: (id: string) => void;
  setCodeTheme: (id: string) => void;
  loadThemePreferences: () => Promise<void>;
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
}

export const useThemeStore = create<ThemeState>((set) => ({
  appThemeId: "dark",
  codeThemeId: "prefetch-dark",
  appTheme: getAppTheme("dark"),
  codeTheme: getCodeTheme("prefetch-dark"),

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

  loadThemePreferences: async () => {
    try {
      const [appId, codeId] = await Promise.all([
        getUiState("app_theme"),
        getUiState("code_theme"),
      ]);

      const resolvedAppId = appId ?? "dark";
      const resolvedCodeId =
        codeId ?? DEFAULT_CODE_THEME[resolvedAppId] ?? "prefetch-dark";

      const appTheme = getAppTheme(resolvedAppId);
      const codeTheme = getCodeTheme(resolvedCodeId);

      applyAppTheme(appTheme);
      applyCodeTheme(codeTheme);

      set({
        appThemeId: resolvedAppId,
        codeThemeId: resolvedCodeId,
        appTheme,
        codeTheme,
      });
    } catch {
      // DB not ready yet — keep defaults, they'll match the CSS
    }
  },
}));

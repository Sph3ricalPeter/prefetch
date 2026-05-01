import { useThemeStore } from "@/stores/theme-store";
import { APP_THEMES, CODE_THEMES, DEFAULT_CODE_THEME } from "@/lib/themes";

export function AppearanceSection() {
  const appThemeId = useThemeStore((s) => s.appThemeId);
  const codeThemeId = useThemeStore((s) => s.codeThemeId);
  const setAppTheme = useThemeStore((s) => s.setAppTheme);
  const setCodeTheme = useThemeStore((s) => s.setCodeTheme);

  const handleAppTheme = (id: string) => {
    setAppTheme(id);
    const paired = DEFAULT_CODE_THEME[id];
    if (paired && codeThemeId === DEFAULT_CODE_THEME[appThemeId]) {
      setCodeTheme(paired);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Appearance</h2>
        <p className="text-xs text-muted-foreground">
          Customize the look of the app and code views.
        </p>
      </div>

      {/* App theme */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          App theme
        </label>
        <p className="text-xs text-muted-foreground">
          Controls the overall UI chrome — sidebar, panels, borders, and commit graph.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {APP_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => handleAppTheme(t.id)}
              className={`group relative rounded-lg border p-3 text-left transition-colors ${
                appThemeId === t.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground/30 hover:bg-secondary"
              }`}
            >
              <ThemePreview theme={t} />
              <span className="mt-2 block text-xs font-medium text-foreground">
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Code theme */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          Code theme
        </label>
        <p className="text-xs text-muted-foreground">
          Controls syntax highlighting and diff colors in the code viewer.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CODE_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setCodeTheme(t.id)}
              className={`group relative rounded-lg border p-3 text-left transition-colors ${
                codeThemeId === t.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground/30 hover:bg-secondary"
              }`}
            >
              <CodeThemePreview theme={t} />
              <span className="mt-2 block text-xs font-medium text-foreground">
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ theme }: { theme: typeof APP_THEMES[number] }) {
  const bg = `hsl(${theme.cssVars["--background"]})`;
  const card = `hsl(${theme.cssVars["--card"]})`;
  const border = `hsl(${theme.cssVars["--border"]})`;
  const muted = `hsl(${theme.cssVars["--muted-foreground"]})`;
  const fg = `hsl(${theme.cssVars["--foreground"]})`;

  return (
    <div
      className="h-16 rounded-md overflow-hidden flex"
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
    >
      {/* Sidebar preview */}
      <div
        className="w-1/4 shrink-0"
        style={{ backgroundColor: `hsl(${theme.cssVars["--sidebar-background"]})`, borderRight: `1px solid ${border}` }}
      >
        <div className="mt-2 mx-1.5 space-y-1">
          <div className="h-1.5 rounded-sm" style={{ backgroundColor: muted, width: "70%", opacity: 0.4 }} />
          <div className="h-1.5 rounded-sm" style={{ backgroundColor: theme.extended.brand, width: "85%", opacity: 0.5 }} />
          <div className="h-1.5 rounded-sm" style={{ backgroundColor: muted, width: "55%", opacity: 0.4 }} />
        </div>
      </div>
      {/* Main area preview */}
      <div className="flex-1 p-1.5 space-y-1">
        <div className="h-1.5 rounded-sm" style={{ backgroundColor: fg, width: "60%", opacity: 0.3 }} />
        <div className="h-1.5 rounded-sm" style={{ backgroundColor: muted, width: "80%", opacity: 0.25 }} />
        <div className="h-5 rounded" style={{ backgroundColor: card }} />
      </div>
    </div>
  );
}

function CodeThemePreview({ theme }: { theme: typeof CODE_THEMES[number] }) {
  const bg = theme.shikiTheme.colors["editor.background"];
  const fg = theme.shikiTheme.colors["editor.foreground"];
  const tokens = theme.shikiTheme.tokenColors;

  const keywordColor = tokens.find((t) =>
    Array.isArray(t.scope)
      ? t.scope.includes("keyword")
      : t.scope === "keyword",
  )?.settings.foreground ?? fg;
  const stringColor = tokens.find((t) =>
    Array.isArray(t.scope)
      ? t.scope.some((s) => s.startsWith("string"))
      : t.scope?.startsWith("string"),
  )?.settings.foreground ?? fg;
  const funcColor = tokens.find((t) =>
    Array.isArray(t.scope)
      ? t.scope.some((s) => s.includes("function"))
      : t.scope?.includes("function"),
  )?.settings.foreground ?? fg;

  return (
    <div
      className="h-16 rounded-md overflow-hidden p-2 space-y-1 font-mono"
      style={{ backgroundColor: bg, border: `1px solid ${bg}` }}
    >
      <div className="flex gap-1 items-center">
        <span className="h-1.5 rounded-sm" style={{ backgroundColor: keywordColor, width: 16, opacity: 0.8, display: "inline-block" }} />
        <span className="h-1.5 rounded-sm" style={{ backgroundColor: funcColor, width: 24, opacity: 0.8, display: "inline-block" }} />
        <span className="h-1.5 rounded-sm" style={{ backgroundColor: fg, width: 8, opacity: 0.4, display: "inline-block" }} />
      </div>
      <div className="flex gap-1 items-center">
        <span className="h-1.5 rounded-sm" style={{ backgroundColor: fg, width: 12, opacity: 0.3, display: "inline-block" }} />
        <span className="h-1.5 rounded-sm" style={{ backgroundColor: stringColor, width: 32, opacity: 0.8, display: "inline-block" }} />
      </div>
      <div className="flex gap-1 items-center">
        <span className="h-3 rounded-sm" style={{ backgroundColor: theme.diff.addedBg, width: "100%", display: "inline-block" }} />
      </div>
    </div>
  );
}

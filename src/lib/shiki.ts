import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";
import { CODE_THEMES } from "@/lib/themes";

let highlighterPromise: Promise<Highlighter> | null = null;

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  toml: "toml",
  sql: "sql",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  vue: "vue",
  svelte: "svelte",
};

// Common languages to preload
const PRELOADED_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "rust",
  "json",
  "css",
  "html",
  "markdown",
  "bash",
  "toml",
  "yaml",
] as const;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: CODE_THEMES.map((t) => t.shikiTheme),
      langs: [...PRELOADED_LANGS],
    });
  }
  return highlighterPromise;
}

export function detectLang(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return LANG_MAP[ext];
}

export async function highlightLines(
  code: string,
  lang: string | undefined,
  themeId?: string,
): Promise<ThemedToken[][]> {
  const hl = await getHighlighter();

  const resolvedLang = lang ?? "text";
  const resolvedTheme = themeId ?? "prefetch-dark";

  // Dynamically load language if not preloaded
  const loadedLangs = hl.getLoadedLanguages();
  if (!loadedLangs.includes(resolvedLang as never)) {
    try {
      await hl.loadLanguage(resolvedLang as never);
    } catch {
      const fallbackFg =
        CODE_THEMES.find((t) => t.shikiTheme.name === resolvedTheme)
          ?.shikiTheme.colors["editor.foreground"] ?? "#a1a1aa";
      return code.split("\n").map((line) => [
        { content: line, color: fallbackFg, offset: 0 },
      ]);
    }
  }

  return hl.codeToTokensBase(code, {
    lang: resolvedLang as never,
    theme: resolvedTheme as never,
  });
}

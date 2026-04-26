import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";

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

// Custom dark theme matching the app's design tokens
const PREFETCH_DARK = {
  name: "prefetch-dark",
  type: "dark" as const,
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
      themes: [PREFETCH_DARK],
      langs: [...PRELOADED_LANGS],
    });
  }
  return highlighterPromise;
}

/**
 * Detect shiki language ID from a file path extension.
 * Returns undefined if unknown (caller should fall back to plaintext).
 */
export function detectLang(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return LANG_MAP[ext];
}

/**
 * Tokenize code lines with Shiki for syntax highlighting.
 * Returns an array of token arrays — one per line.
 */
export async function highlightLines(
  code: string,
  lang: string | undefined,
): Promise<ThemedToken[][]> {
  const hl = await getHighlighter();

  const resolvedLang = lang ?? "text";

  // Dynamically load language if not preloaded
  const loadedLangs = hl.getLoadedLanguages();
  if (!loadedLangs.includes(resolvedLang as never)) {
    try {
      await hl.loadLanguage(resolvedLang as never);
    } catch {
      // Fallback to plain text if language not available
      return code.split("\n").map((line) => [
        { content: line, color: "#a1a1aa", offset: 0 },
      ]);
    }
  }

  return hl.codeToTokensBase(code, {
    lang: resolvedLang as never,
    theme: "prefetch-dark" as never,
  });
}

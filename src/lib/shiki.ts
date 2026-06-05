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

// Shiki's builtin special languages need no grammar load.
const BUILTIN_LANGS = new Set(["text", "plaintext", "txt", "ansi"]);

// In-flight on-demand language loads, keyed by language id. Shiki's
// `loadLanguage` is NOT safe to call concurrently for the same grammar —
// racing registrations can reject or yield a half-initialized grammar. The
// conflict editor highlights several panes (ours/theirs/base/output) in the
// same tick, so without this dedupe the first view of a non-preloaded language
// (e.g. C#) loses highlighting on every pane until reopened. Share one load
// promise per language so all callers await the fully-registered grammar.
const langLoadPromises = new Map<string, Promise<boolean>>();

function ensureLanguageLoaded(
  hl: Highlighter,
  lang: string,
): Promise<boolean> {
  if (BUILTIN_LANGS.has(lang)) return Promise.resolve(true);
  if (hl.getLoadedLanguages().includes(lang as never)) return Promise.resolve(true);

  let pending = langLoadPromises.get(lang);
  if (!pending) {
    pending = hl
      .loadLanguage(lang as never)
      .then(() => true)
      .catch(() => {
        // Drop the failed promise so a later attempt can retry the load.
        langLoadPromises.delete(lang);
        return false;
      });
    langLoadPromises.set(lang, pending);
  }
  return pending;
}

/**
 * Yields control to the browser's macrotask queue (so click/render/paint can run).
 * Plain `await Promise.resolve()` only drains microtasks — clicks won't get a turn.
 * Use this between heavy synchronous calls (e.g. Shiki tokenization) so the UI
 * stays responsive while a large diff is being highlighted.
 */
export function yieldToMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function highlightLines(
  code: string,
  lang: string | undefined,
  themeId?: string,
): Promise<ThemedToken[][]> {
  const hl = await getHighlighter();

  const resolvedLang = lang ?? "text";
  const resolvedTheme = themeId ?? "vs-dark";

  // Dynamically load language if not preloaded (deduped across concurrent callers)
  const loaded = await ensureLanguageLoaded(hl, resolvedLang);
  if (!loaded) {
    const fallbackFg =
      CODE_THEMES.find((t) => t.shikiTheme.name === resolvedTheme)
        ?.shikiTheme.colors["editor.foreground"] ?? "#a1a1aa";
    return code.split("\n").map((line) => [
      { content: line, color: fallbackFg, offset: 0 },
    ]);
  }

  return hl.codeToTokensBase(code, {
    lang: resolvedLang as never,
    theme: resolvedTheme as never,
  });
}

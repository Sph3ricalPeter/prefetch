import {
  createHighlighter,
  type Highlighter,
  type LanguageRegistration,
  type ThemedToken,
} from "shiki";
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
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  dockerfile: "docker",
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
  odin: "odin",
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

// Custom Dockerfile grammar. Shiki's bundled `docker` grammar only tags the
// leading instruction keyword, comments, and quoted strings — the shell command
// that makes up the bulk of a `RUN`/`CMD` line is left uncolored, so Dockerfiles
// look nearly plain. This superset keeps that behaviour and additionally embeds
// the shell grammar (`source.shell`) inside RUN/CMD/ENTRYPOINT/SHELL/HEALTHCHECK
// so their commands, flags, paths and strings get highlighted too.
//
// The embedded `source.shell` is provided by the `bash` grammar, which must be
// present in the highlighter's langs — it is, via PRELOADED_LANGS. We register
// this grammar object directly (not via on-demand load) so it overrides the
// bundled `docker` grammar. Deliberately no `embeddedLangs: ["bash"]`: that would
// make a missing bash throw at highlighter creation and break *all* highlighting;
// without it, only the shell regions degrade to plain text if bash ever goes away.
const DOCKERFILE_GRAMMAR: LanguageRegistration = {
  name: "docker",
  scopeName: "source.dockerfile",
  aliases: ["dockerfile"],
  patterns: [
    { include: "#comment" },
    { include: "#from" },
    { include: "#shell-instruction" },
    { include: "#instruction" },
    { include: "#string" },
  ],
  repository: {
    comment: {
      match: "^(\\s*)((#).*$)",
      captures: {
        2: { name: "comment.line.number-sign.dockerfile" },
        3: { name: "punctuation.definition.comment.dockerfile" },
      },
    },
    from: {
      match: "^\\s*(?i:(FROM))\\b(?:.*?\\b(?i:(AS))\\b)?",
      captures: {
        1: { name: "keyword.other.special-method.dockerfile" },
        2: { name: "keyword.other.special-method.dockerfile" },
      },
    },
    "shell-instruction": {
      begin: "^\\s*(?i:(ONBUILD)\\s+)?(?i:(RUN|CMD|ENTRYPOINT|SHELL|HEALTHCHECK))\\b",
      beginCaptures: {
        1: { name: "keyword.control.dockerfile" },
        2: { name: "keyword.other.special-method.dockerfile" },
      },
      // End at the first line NOT continued with a trailing backslash.
      end: "(?<!\\\\)$",
      patterns: [{ include: "source.shell" }],
    },
    instruction: {
      match:
        "^\\s*(?i:(ONBUILD)\\s+)?(?i:(ADD|ARG|COPY|ENV|EXPOSE|LABEL|MAINTAINER|STOPSIGNAL|USER|VOLUME|WORKDIR))\\b",
      captures: {
        1: { name: "keyword.control.dockerfile" },
        2: { name: "keyword.other.special-method.dockerfile" },
      },
    },
    string: {
      patterns: [
        {
          name: "string.quoted.double.dockerfile",
          begin: "\"",
          beginCaptures: { 0: { name: "punctuation.definition.string.begin.dockerfile" } },
          end: "\"",
          endCaptures: { 0: { name: "punctuation.definition.string.end.dockerfile" } },
          patterns: [{ match: "\\\\.", name: "constant.character.escaped.dockerfile" }],
        },
        {
          name: "string.quoted.single.dockerfile",
          begin: "'",
          beginCaptures: { 0: { name: "punctuation.definition.string.begin.dockerfile" } },
          end: "'",
          endCaptures: { 0: { name: "punctuation.definition.string.end.dockerfile" } },
        },
      ],
    },
  },
};

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: CODE_THEMES.map((t) => t.shikiTheme),
      // DOCKERFILE_GRAMMAR embeds `source.shell`; bash (which provides it) is in
      // PRELOADED_LANGS, so it is registered before this grammar tokenizes.
      langs: [...PRELOADED_LANGS, DOCKERFILE_GRAMMAR],
    });
  }
  return highlighterPromise;
}

// Files identified by their whole name rather than an extension.
const FILENAME_MAP: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
};

export function detectLang(filePath: string): string | undefined {
  const base = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";

  // Exact-name files, e.g. "Dockerfile", "Containerfile".
  const byName = FILENAME_MAP[base];
  if (byName) return byName;

  // Tagged Dockerfiles, e.g. "Dockerfile.dev", "Dockerfile.prod".
  if (base.startsWith("dockerfile.")) return "docker";

  // Extension lookup, e.g. "config.yaml", "README.md", "app.dockerfile".
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return LANG_MAP[base.slice(dot + 1)];
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
    // `loadLanguage` throws *synchronously* for an id absent from the bundle
    // (e.g. a bogus ```fence language), so call it inside the promise chain —
    // otherwise the throw escapes before `.catch` and rejects the caller.
    pending = Promise.resolve()
      .then(() => hl.loadLanguage(lang as never))
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

// Opening fence of a Markdown code block, capturing its info-string language:
// up to 3 leading spaces (GFM), a ``` or ~~~ run, then the first info token.
const FENCE_RE = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]+)/gm;

// Fence info-strings use their own aliases, distinct from file extensions. Map
// the common ones to Shiki language ids; anything else is tried verbatim and
// silently skipped by ensureLanguageLoaded if it isn't a real grammar.
const FENCE_ALIASES: Record<string, string> = {
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  ts: "typescript",
  js: "javascript",
  py: "python",
  rs: "rust",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  golang: "go",
  kt: "kotlin",
  rb: "ruby",
  dockerfile: "docker",
};

// Shiki's Markdown grammar can tokenize ```<lang> code blocks with that
// language's grammar, but only once the grammar is loaded — otherwise the block
// stays plain. Scan the source for fences and load each referenced language so
// the subsequent tokenize picks them up (verified: loading after the highlighter
// exists and re-tokenizing applies the embedded grammar).
async function ensureMarkdownFenceLangs(hl: Highlighter, code: string): Promise<void> {
  const langs = new Set<string>();
  for (const m of code.matchAll(FENCE_RE)) {
    const raw = m[1].toLowerCase();
    langs.add(FENCE_ALIASES[raw] ?? raw);
  }
  if (langs.size === 0) return;
  await Promise.all([...langs].map((l) => ensureLanguageLoaded(hl, l)));
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

  // Load languages referenced by fenced code blocks so they highlight per-language.
  if (resolvedLang === "markdown") {
    await ensureMarkdownFenceLangs(hl, code);
  }

  return hl.codeToTokensBase(code, {
    lang: resolvedLang as never,
    theme: resolvedTheme as never,
  });
}

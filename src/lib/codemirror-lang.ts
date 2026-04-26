import type { Extension } from "@codemirror/state";

/**
 * Lazy loaders for CodeMirror language extensions.
 * Each function dynamically imports the language package and returns the extension.
 */
const LANG_LOADERS: Record<string, () => Promise<Extension>> = {
  typescript: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true }),
    ),
  javascript: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript()),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),
  jsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true }),
    ),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  markdown: () =>
    import("@codemirror/lang-markdown").then((m) => m.markdown()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
};

/** Map file extensions to language IDs */
const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rs: "rust",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  json: "json",
  md: "markdown",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
};

/**
 * Load a CodeMirror language extension for the given file path.
 * Returns null if no language support is available.
 */
export async function getLanguageExtension(
  filePath: string,
): Promise<Extension | null> {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  const lang = EXT_MAP[ext];
  if (!lang) return null;
  const loader = LANG_LOADERS[lang];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

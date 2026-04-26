import { EditorView } from "@codemirror/view";

/**
 * CodeMirror 6 dark theme matching the Prefetch design system.
 * HSL values from index.css @theme tokens.
 */
export const prefetchDarkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "hsl(240 6% 3.9%)",
      color: "hsl(240 5% 65%)",
      fontSize: "12px",
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    },
    ".cm-content": {
      caretColor: "hsl(240 5% 96%)",
      padding: "0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "hsl(240 5% 96%)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "hsl(240 6% 15%)",
    },
    ".cm-gutters": {
      backgroundColor: "hsl(240 6% 3.9%)",
      color: "hsl(240 5% 30%)",
      border: "none",
      minWidth: "3em",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "hsl(240 6% 8%)",
    },
    ".cm-activeLine": {
      backgroundColor: "hsl(240 6% 6%)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "hsl(240 6% 10%)",
      border: "none",
      color: "hsl(240 5% 45%)",
    },
    ".cm-tooltip": {
      backgroundColor: "hsl(240 7% 7%)",
      border: "1px solid hsl(240 5% 11.6%)",
      color: "hsl(240 5% 96%)",
    },
    // Diff line decorations
    ".cm-diff-added": {
      backgroundColor: "rgba(34, 197, 94, 0.1)",
    },
    ".cm-diff-removed": {
      backgroundColor: "rgba(239, 68, 68, 0.1)",
    },
    ".cm-diff-header": {
      backgroundColor: "hsl(240 6% 10%)",
      color: "hsl(240 5% 45%)",
    },
    // Merge view styling
    ".cm-mergeView": {
      fontSize: "12px",
    },
    ".cm-changedLine": {
      backgroundColor: "rgba(34, 197, 94, 0.08)",
    },
    ".cm-deletedChunk": {
      backgroundColor: "rgba(239, 68, 68, 0.08)",
    },
    // Conflict output line sources
    ".cm-output-ours": {
      backgroundColor: "rgba(59, 130, 246, 0.08)",
    },
    ".cm-output-theirs": {
      backgroundColor: "rgba(168, 85, 247, 0.08)",
    },
    ".cm-output-unchanged": {
      opacity: "0.5",
    },
    // Faint ↵ indicator on empty lines so they're visible in the output
    ".cm-empty-line-indicator": {
      color: "hsl(240 5% 25%)",
      fontSize: "10px",
      userSelect: "none",
      pointerEvents: "none",
    },
    ".cm-output-edited": {
      backgroundColor: "rgba(34, 197, 94, 0.08)",
    },
    // Source indicator gutter (output pane)
    ".cm-source-gutter": {
      width: "20px",
      minWidth: "20px",
    },
    ".cm-source-gutter .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
      cursor: "pointer",
    },
    ".cm-gutter-ours": {
      borderLeft: "2px solid rgba(59, 130, 246, 0.5)",
    },
    ".cm-gutter-theirs": {
      borderLeft: "2px solid rgba(168, 85, 247, 0.5)",
    },
    ".cm-gutter-unchanged": {
      borderLeft: "2px solid transparent",
    },
    // Source arrow icons via CSS pseudo-elements (no DOM in GutterMarker)
    ".cm-gutter-ours::after": {
      content: '"›"',
      color: "rgba(59, 130, 246, 0.8)",
      fontSize: "14px",
      lineHeight: "1",
    },
    ".cm-gutter-theirs::after": {
      content: '"‹"',
      color: "rgba(168, 85, 247, 0.8)",
      fontSize: "14px",
      lineHeight: "1",
    },
    // On hover: show remove indicator (replaces arrow)
    ".cm-source-gutter .cm-gutterElement.cm-gutter-ours:hover::after": {
      content: '"−"',
      color: "hsl(0 70% 60%)",
    },
    ".cm-source-gutter .cm-gutterElement.cm-gutter-theirs:hover::after": {
      content: '"−"',
      color: "hsl(0 70% 60%)",
    },
    // When manually edited, keep arrows on hover (no remove action)
    "&.cm-manually-edited .cm-source-gutter .cm-gutterElement.cm-gutter-ours:hover::after":
      {
        content: '"›"',
        color: "rgba(59, 130, 246, 0.8)",
        cursor: "default",
      },
    "&.cm-manually-edited .cm-source-gutter .cm-gutterElement.cm-gutter-theirs:hover::after":
      {
        content: '"‹"',
        color: "rgba(168, 85, 247, 0.8)",
        cursor: "default",
      },
    // Scrollbar styling matching the app
    ".cm-scroller::-webkit-scrollbar": {
      width: "6px",
      height: "6px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
      background: "transparent",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      background: "hsl(240 5% 16%)",
      borderRadius: "3px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      background: "hsl(240 5% 24%)",
    },
  },
  { dark: true },
);

import { EditorView } from "@codemirror/view";
import type { CodeThemeCodemirror } from "@/lib/themes";

export function getCodemirrorTheme(cm: CodeThemeCodemirror, isDark = true) {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: cm.bg,
        color: cm.fg,
        fontSize: "12px",
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      },
      ".cm-content": {
        caretColor: cm.caret,
        padding: "0",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: cm.caret,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: cm.selection,
      },
      ".cm-gutters": {
        backgroundColor: cm.gutterBg,
        color: cm.gutterFg,
        border: "none",
        minWidth: "3em",
      },
      ".cm-activeLineGutter": {
        backgroundColor: cm.activeLineGutter,
      },
      ".cm-activeLine": {
        backgroundColor: cm.activeLine,
      },
      ".cm-foldPlaceholder": {
        backgroundColor: cm.foldPlaceholderBg,
        border: "none",
        color: cm.foldPlaceholderFg,
      },
      ".cm-tooltip": {
        backgroundColor: cm.tooltipBg,
        border: `1px solid ${cm.tooltipBorder}`,
        color: cm.tooltipFg,
      },
      ".cm-diff-added": {
        backgroundColor: cm.diffAdded,
      },
      ".cm-diff-removed": {
        backgroundColor: cm.diffRemoved,
      },
      ".cm-diff-header": {
        backgroundColor: cm.diffHeader,
        color: cm.diffHeaderFg,
      },
      ".cm-mergeView": {
        fontSize: "12px",
      },
      ".cm-changedLine": {
        backgroundColor: cm.mergeChanged,
      },
      ".cm-deletedChunk": {
        backgroundColor: cm.mergeDeleted,
      },
      ".cm-output-ours": {
        backgroundColor: cm.conflictOurs,
      },
      ".cm-output-theirs": {
        backgroundColor: cm.conflictTheirs,
      },
      ".cm-output-unchanged": {
        opacity: "0.5",
      },
      ".cm-empty-line-indicator": {
        color: cm.emptyLineIndicator,
        fontSize: "10px",
        userSelect: "none",
        pointerEvents: "none",
      },
      ".cm-output-edited": {
        backgroundColor: cm.conflictEdited,
      },
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
        borderLeft: `2px solid ${cm.gutterOurs}`,
      },
      ".cm-gutter-theirs": {
        borderLeft: `2px solid ${cm.gutterTheirs}`,
      },
      ".cm-gutter-unchanged": {
        borderLeft: "2px solid transparent",
      },
      ".cm-gutter-ours::after": {
        content: '"›"',
        color: cm.gutterOursArrow,
        fontSize: "14px",
        lineHeight: "1",
      },
      ".cm-gutter-theirs::after": {
        content: '"‹"',
        color: cm.gutterTheirsArrow,
        fontSize: "14px",
        lineHeight: "1",
      },
      ".cm-source-gutter .cm-gutterElement.cm-gutter-ours:hover::after": {
        content: '"−"',
        color: cm.gutterRemoveHover,
      },
      ".cm-source-gutter .cm-gutterElement.cm-gutter-theirs:hover::after": {
        content: '"−"',
        color: cm.gutterRemoveHover,
      },
      "&.cm-manually-edited .cm-source-gutter .cm-gutterElement.cm-gutter-unchanged:hover::after":
        {
          content: '""',
          cursor: "default",
        },
      ".cm-scroller::-webkit-scrollbar": {
        width: "6px",
        height: "6px",
      },
      ".cm-scroller::-webkit-scrollbar-track": {
        background: "transparent",
      },
      ".cm-scroller::-webkit-scrollbar-thumb": {
        background: cm.scrollbarThumb,
        borderRadius: "3px",
      },
      ".cm-scroller::-webkit-scrollbar-thumb:hover": {
        background: cm.scrollbarThumbHover,
      },
    },
    { dark: isDark },
  );
}

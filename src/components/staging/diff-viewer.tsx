import type { FileDiff } from "@/types/git";
import { DiffViewerReadonly } from "@/components/staging/diff-viewer-readonly";
import { DiffViewerInteractive } from "@/components/staging/diff-viewer-interactive";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { useExpandableContext, type DiffSource } from "@/hooks/use-expandable-context";
import { ImageDiffViewer } from "@/components/staging/image-diff-viewer";
import { isImageFile } from "@/lib/utils";

interface DiffViewerProps {
  diff: FileDiff;
  filePath?: string;
  mode?: "readonly" | "interactive";
  source?: DiffSource;
  staged?: boolean;
  onBack?: () => void;
}

function EmptyState({ message, filePath, onBack }: { message: string; filePath?: string; onBack?: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <DiffToolbar filePath={filePath} onBack={onBack} />
      <div className="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground">
        {message}
      </div>
    </div>
  );
}

export function DiffViewer({ diff, filePath, mode = "readonly", source = {}, staged = false, onBack }: DiffViewerProps) {
  const resolvedPath = filePath ?? diff.path;
  // Key the hook to diff.path (the actually-rendered diff) rather than filePath
  // (the user's current selection). During a click → loading transition, filePath
  // updates immediately but activeDiff lags behind the IPC; tying the hook to
  // diff.path keeps state stable across that window so the spinner can paint
  // without an extra re-render of the (heavy) diff subtree.
  const ctx = useExpandableContext(diff.hunks, diff.path, source);

  if (diff.is_binary) {
    if (isImageFile(resolvedPath)) {
      return <ImageDiffViewer filePath={resolvedPath} source={source} staged={staged} onBack={onBack} />;
    }
    return <EmptyState message="Binary file — cannot display diff" filePath={resolvedPath} onBack={onBack} />;
  }

  if (diff.is_truncated && diff.hunks.length === 0) {
    return <EmptyState message={`File too large to display (${diff.total_lines.toLocaleString()} lines)`} filePath={resolvedPath} onBack={onBack} />;
  }

  if (diff.hunks.length === 0) {
    return <EmptyState message="No changes" filePath={resolvedPath} onBack={onBack} />;
  }

  const toolbarProps = {
    onExpandAll: ctx.expandAllGaps,
    onCollapseAll: ctx.collapseAll,
    isExpanded: ctx.isExpanded,
    filePath: resolvedPath,
    onBack,
  };

  return (
    <div className="flex flex-col h-full">
      {mode === "interactive" ? (
        <DiffViewerInteractive diff={diff} filePath={resolvedPath} expandCtx={ctx} staged={staged} toolbarProps={toolbarProps} />
      ) : (
        <>
          <DiffToolbar {...toolbarProps} />
          <DiffViewerReadonly diff={diff} filePath={resolvedPath} expandCtx={ctx} />
        </>
      )}
      {diff.is_truncated && diff.hunks.length > 0 && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          Diff truncated — showing first 50,000 of {diff.total_lines.toLocaleString()} lines
        </div>
      )}
    </div>
  );
}

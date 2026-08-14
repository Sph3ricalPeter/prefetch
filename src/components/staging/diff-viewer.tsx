import type { FileDiff } from "@/types/git";
import { DiffViewerBody } from "@/components/staging/diff-viewer-body";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { useExpandableContext, type DiffSource } from "@/hooks/use-expandable-context";
import { ImageDiffViewer } from "@/components/staging/image-diff-viewer";
import { isImageFile } from "@/lib/utils";

interface DiffViewerProps {
  diff: FileDiff;
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

export function DiffViewer({ diff, mode = "readonly", source = {}, staged = false, onBack }: DiffViewerProps) {
  // Everything here follows diff.path — the actually-rendered diff — not the
  // user's current selection. During a click → load transition the selection
  // updates immediately while activeDiff lags behind the IPC; using diff.path
  // keeps the path text, the language and the expand state in step with the
  // content on screen, so the whole viewer swaps in one frame.
  const resolvedPath = diff.path;
  const ctx = useExpandableContext(diff.hunks, resolvedPath, source);

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
      <DiffViewerBody
        diff={diff}
        filePath={resolvedPath}
        expandCtx={ctx}
        interactive={mode === "interactive"}
        staged={staged}
        commitSha={source.commitId}
        toolbarProps={toolbarProps}
      />
      {diff.is_truncated && diff.hunks.length > 0 && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          Diff truncated — showing first 50,000 of {diff.total_lines.toLocaleString()} lines
        </div>
      )}
    </div>
  );
}

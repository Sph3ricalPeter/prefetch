import type { FileDiff } from "@/types/git";
import { DiffViewerReadonly } from "@/components/staging/diff-viewer-readonly";
import { DiffViewerInteractive } from "@/components/staging/diff-viewer-interactive";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { useExpandableContext, type DiffSource } from "@/hooks/use-expandable-context";

interface DiffViewerProps {
  diff: FileDiff;
  filePath?: string;
  mode?: "readonly" | "interactive";
  source?: DiffSource;
  staged?: boolean;
  onBack?: () => void;
}

export function DiffViewer({ diff, filePath, mode = "readonly", source = {}, staged = false, onBack }: DiffViewerProps) {
  const resolvedPath = filePath ?? diff.path;
  const ctx = useExpandableContext(diff.hunks, resolvedPath, source);

  if (diff.is_binary) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Binary file — cannot display diff
      </div>
    );
  }

  if (diff.is_truncated && diff.hunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8">
        <p className="text-sm text-muted-foreground">
          File too large to display ({diff.total_lines.toLocaleString()} lines)
        </p>
      </div>
    );
  }

  if (diff.hunks.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        No changes
      </div>
    );
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

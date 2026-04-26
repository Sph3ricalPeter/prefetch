import type { FileDiff } from "@/types/git";
import { DiffViewerReadonly } from "@/components/staging/diff-viewer-readonly";
import { DiffViewerInteractive } from "@/components/staging/diff-viewer-interactive";

interface DiffViewerProps {
  diff: FileDiff;
  filePath?: string;
  mode?: "readonly" | "interactive";
}

/**
 * Orchestrator component that renders the appropriate diff viewer
 * based on the context (readonly for commits/stashes, interactive for working tree).
 */
export function DiffViewer({ diff, filePath, mode = "readonly" }: DiffViewerProps) {
  if (diff.is_binary) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Binary file — cannot display diff
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

  const resolvedPath = filePath ?? diff.path;

  if (mode === "interactive") {
    return <DiffViewerInteractive diff={diff} filePath={resolvedPath} />;
  }

  return <DiffViewerReadonly diff={diff} filePath={resolvedPath} />;
}

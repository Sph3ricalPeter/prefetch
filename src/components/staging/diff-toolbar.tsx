import { useRepoStore } from "@/stores/repo-store";
import { ArrowLeft, Columns2, Rows3, WrapText, UnfoldVertical, FoldVertical } from "lucide-react";

interface DiffToolbarProps {
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  isExpanded?: boolean;
  rightSlot?: React.ReactNode;
  filePath?: string;
  onBack?: () => void;
}

export function DiffToolbar({ onExpandAll, onCollapseAll, isExpanded, rightSlot, filePath, onBack }: DiffToolbarProps) {
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const setDiffViewMode = useRepoStore((s) => s.setDiffViewMode);
  const setDiffWrapLines = useRepoStore((s) => s.setDiffWrapLines);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
      {/* Height anchor — uses same box model as bordered action buttons so toolbar never shifts when rightSlot appears */}
      <div className="w-0 overflow-hidden border border-transparent py-1 text-xs font-medium leading-normal shrink-0" aria-hidden>{"​"}</div>
      {/* Back + file path */}
      {onBack && (
        <button
          onClick={onBack}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {filePath && (
        <span className="truncate text-xs font-medium text-foreground min-w-0" title={filePath}>
          {filePath}
        </span>
      )}
      {(onBack || filePath) && <span className="w-px h-4 bg-border shrink-0" />}

      {/* View mode toggle */}
      <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
        <button
          onClick={() => setDiffViewMode("unified")}
          title="Unified diff"
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            diffViewMode === "unified"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Rows3 className="w-3.5 h-3.5" />
          <span>Unified</span>
        </button>
        <button
          onClick={() => setDiffViewMode("side-by-side")}
          title="Side-by-side diff"
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            diffViewMode === "side-by-side"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Columns2 className="w-3.5 h-3.5" />
          <span>Split</span>
        </button>
      </div>

      {/* Wrap lines toggle */}
      <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
        <button
          onClick={() => setDiffWrapLines(!diffWrapLines)}
          title={diffWrapLines ? "Disable line wrapping" : "Enable line wrapping"}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            diffWrapLines
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <WrapText className="w-3.5 h-3.5" />
          <span>Wrap</span>
        </button>
      </div>

      {/* Expand/Collapse all context toggle */}
      {onExpandAll && onCollapseAll && (
        <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
          <button
            onClick={isExpanded ? onCollapseAll : onExpandAll}
            title={isExpanded ? "Collapse all context" : "Expand all context"}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              isExpanded
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isExpanded ? <FoldVertical className="w-3.5 h-3.5" /> : <UnfoldVertical className="w-3.5 h-3.5" />}
            <span>{isExpanded ? "Fold" : "Expand"}</span>
          </button>
        </div>
      )}

      {/* Right slot for selection controls etc. */}
      {rightSlot && <div className="ml-auto flex items-center gap-1 shrink-0">{rightSlot}</div>}
    </div>
  );
}

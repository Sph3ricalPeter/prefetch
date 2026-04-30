import { useRepoStore } from "@/stores/repo-store";
import { Columns2, Rows3, WrapText } from "lucide-react";

/**
 * Toolbar rendered above the diff viewer with view-mode and wrap-lines toggles.
 * Preferences are persisted to SQLite via the repo store.
 */
export function DiffToolbar() {
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const setDiffViewMode = useRepoStore((s) => s.setDiffViewMode);
  const setDiffWrapLines = useRepoStore((s) => s.setDiffWrapLines);

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
      {/* View mode toggle */}
      <div className="flex items-center rounded-md bg-secondary p-0.5">
        <button
          onClick={() => setDiffViewMode("unified")}
          title="Unified diff"
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-caption transition-colors ${
            diffViewMode === "unified"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Rows3 className="w-3 h-3" />
          <span>Unified</span>
        </button>
        <button
          onClick={() => setDiffViewMode("side-by-side")}
          title="Side-by-side diff"
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-caption transition-colors ${
            diffViewMode === "side-by-side"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Columns2 className="w-3 h-3" />
          <span>Split</span>
        </button>
      </div>

      {/* Wrap lines toggle */}
      <div className="flex items-center rounded-md bg-secondary p-0.5 ml-1">
        <button
          onClick={() => setDiffWrapLines(!diffWrapLines)}
          title={diffWrapLines ? "Disable line wrapping" : "Enable line wrapping"}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-caption transition-colors ${
            diffWrapLines
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <WrapText className="w-3 h-3" />
          <span>Wrap</span>
        </button>
      </div>
    </div>
  );
}

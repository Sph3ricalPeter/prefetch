import type { FileDiff } from "@/types/git";

interface DiffViewerProps {
  diff: FileDiff;
}

export function DiffViewer({ diff }: DiffViewerProps) {
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

  return (
    <div className="overflow-auto text-xs font-mono leading-5">
      {diff.hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div className="sticky top-0 bg-secondary/80 px-3 py-1 text-muted-foreground backdrop-blur-sm">
            {hunk.header}
          </div>

          {/* Lines */}
          {hunk.lines.map((line, li) => {
            const bgClass =
              line.origin === "+"
                ? "bg-green-500/10"
                : line.origin === "-"
                  ? "bg-red-500/10"
                  : "";

            const textClass =
              line.origin === "+"
                ? "text-green-400"
                : line.origin === "-"
                  ? "text-red-400"
                  : "text-muted-foreground";

            return (
              <div key={li} className={`flex ${bgClass}`}>
                {/* Origin column */}
                <span
                  className={`w-5 shrink-0 text-center select-none ${textClass}`}
                >
                  {line.origin === " " ? "" : line.origin}
                </span>

                {/* Content */}
                <pre className={`flex-1 px-2 whitespace-pre-wrap break-all ${textClass}`}>
                  {line.content || " "}
                </pre>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileDiff, DiffLine } from "@/types/git";
import { highlightLines, detectLang } from "@/lib/shiki";
import { useRepoStore } from "@/stores/repo-store";
import { Plus, CheckSquare } from "lucide-react";
import type { ThemedToken } from "shiki";

interface DiffViewerInteractiveProps {
  diff: FileDiff;
  filePath: string;
}

/**
 * Wrapper that resets selection state when the diff identity changes
 * by re-keying the inner component.
 */
export function DiffViewerInteractive({ diff, filePath }: DiffViewerInteractiveProps) {
  // Use a stable identity key derived from the diff content
  const diffKey = useMemo(
    () => `${diff.path}:${diff.hunks.length}:${diff.hunks.reduce((n, h) => n + h.lines.length, 0)}`,
    [diff],
  );

  return <DiffViewerInteractiveInner key={diffKey} diff={diff} filePath={filePath} />;
}

function DiffViewerInteractiveInner({ diff, filePath }: DiffViewerInteractiveProps) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());
  const stageHunk = useRepoStore((s) => s.stageHunk);
  const stageLines = useRepoStore((s) => s.stageLines);

  const lang = useMemo(() => detectLang(filePath), [filePath]);

  // Highlight all hunks
  useEffect(() => {
    let cancelled = false;
    async function highlight() {
      const result = new Map<number, ThemedToken[][]>();
      for (let hi = 0; hi < diff.hunks.length; hi++) {
        const code = diff.hunks[hi].lines.map((l) => l.content).join("\n");
        try {
          const tokens = await highlightLines(code, lang);
          if (!cancelled) result.set(hi, tokens);
        } catch { /* fallback: no highlighting */ }
      }
      if (!cancelled) setTokensByHunk(result);
    }
    highlight();
    return () => { cancelled = true; };
  }, [diff, lang]);

  const toggleLine = useCallback((hunkIdx: number, lineIdx: number) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      const key = `${hunkIdx}:${lineIdx}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleHunk = useCallback((hunkIdx: number) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      const hunk = diff.hunks[hunkIdx];
      if (!hunk) return prev;

      const hunkKeys = hunk.lines
        .map((line, li) => ({ key: `${hunkIdx}:${li}`, line }))
        .filter(({ line }) => line.origin === "+" || line.origin === "-");

      const allSelected = hunkKeys.every(({ key }) => next.has(key));

      if (allSelected) {
        // Deselect all
        for (const { key } of hunkKeys) next.delete(key);
      } else {
        // Select all
        for (const { key } of hunkKeys) next.add(key);
      }

      return next;
    });
  }, [diff]);

  const handleStageSelected = useCallback(async () => {
    if (selectedLines.size === 0) return;
    const selections = [...selectedLines].map((key) => {
      const [hi, li] = key.split(":").map(Number);
      return { hunkIndex: hi, lineIndex: li };
    });
    await stageLines(filePath, selections);
    setSelectedLines(new Set());
  }, [selectedLines, filePath, stageLines]);

  const handleStageHunk = useCallback(async (hunkIdx: number) => {
    await stageHunk(filePath, hunkIdx);
  }, [filePath, stageHunk]);

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
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      {selectedLines.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
          <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {selectedLines.size} line{selectedLines.size > 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handleStageSelected}
            className="ml-auto rounded-md bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
          >
            Stage Selected
          </button>
        </div>
      )}

      {/* Diff content */}
      <div className="overflow-auto flex-1 text-xs font-mono leading-5">
        {diff.hunks.map((hunk, hi) => {
          const hunkTokens = tokensByHunk.get(hi);
          const hunkChangeKeys = hunk.lines
            .map((line, li) => ({ key: `${hi}:${li}`, line }))
            .filter(({ line }) => line.origin === "+" || line.origin === "-");
          const allHunkSelected = hunkChangeKeys.length > 0 && hunkChangeKeys.every(({ key }) => selectedLines.has(key));

          return (
            <div
              key={hi}
              style={{
                contentVisibility: "auto",
                containIntrinsicSize: `auto ${hunk.lines.length * 20}px`,
              }}
            >
              {/* Hunk header with stage button */}
              <div className="sticky top-0 z-10 flex items-center bg-secondary px-1 py-0.5 backdrop-blur-sm group">
                <button
                  onClick={() => handleStageHunk(hi)}
                  title="Stage this hunk"
                  className="flex items-center justify-center w-5 h-5 rounded text-green-400 hover:bg-green-500/20 transition-colors mr-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => toggleHunk(hi)}
                  title={allHunkSelected ? "Deselect hunk" : "Select hunk"}
                  className={`flex items-center justify-center w-5 h-5 rounded transition-colors mr-2 shrink-0 ${
                    allHunkSelected
                      ? "text-blue-400 bg-blue-500/20"
                      : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <CheckSquare className="w-3 h-3" />
                </button>
                <span className="text-muted-foreground text-xs truncate">
                  {hunk.header}
                </span>
              </div>

              {/* Lines */}
              {hunk.lines.map((line, li) => (
                <InteractiveDiffLine
                  key={li}
                  line={line}
                  hunkIndex={hi}
                  lineIndex={li}
                  tokens={hunkTokens?.[li]}
                  isSelected={selectedLines.has(`${hi}:${li}`)}
                  onToggle={toggleLine}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface InteractiveDiffLineProps {
  line: DiffLine;
  hunkIndex: number;
  lineIndex: number;
  tokens?: ThemedToken[];
  isSelected: boolean;
  onToggle: (hunkIdx: number, lineIdx: number) => void;
}

function InteractiveDiffLine({
  line,
  hunkIndex,
  lineIndex,
  tokens,
  isSelected,
  onToggle,
}: InteractiveDiffLineProps) {
  const isChangeLine = line.origin === "+" || line.origin === "-";

  const bgClass = isSelected
    ? "bg-blue-500/15"
    : line.origin === "+"
      ? "bg-green-500/10"
      : line.origin === "-"
        ? "bg-red-500/10"
        : "";

  const originClass =
    line.origin === "+"
      ? "text-green-400"
      : line.origin === "-"
        ? "text-red-400"
        : "text-muted-foreground/50";

  return (
    <div
      className={`flex ${bgClass} group/line cursor-default`}
      onClick={isChangeLine ? () => onToggle(hunkIndex, lineIndex) : undefined}
    >
      {/* Selection gutter */}
      <span className="w-5 shrink-0 flex items-center justify-center select-none">
        {isChangeLine && (
          <span
            className={`w-2.5 h-2.5 rounded-sm border transition-colors ${
              isSelected
                ? "bg-blue-500 border-blue-400"
                : "border-transparent group-hover/line:border-muted-foreground/30"
            }`}
          />
        )}
      </span>
      {/* Old line number */}
      <span className="w-9 shrink-0 text-right pr-1 select-none text-muted-foreground/30 text-[10px]">
        {line.old_lineno ?? ""}
      </span>
      {/* New line number */}
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {line.new_lineno ?? ""}
      </span>
      {/* Origin column */}
      <span className={`w-5 shrink-0 text-center select-none ${originClass}`}>
        {line.origin === " " ? "" : line.origin}
      </span>
      {/* Content with syntax highlighting */}
      <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
        {tokens && tokens.length > 0 ? (
          tokens.map((token, i) => (
            <span
              key={i}
              style={{
                color: token.color,
                opacity: line.origin === " " ? 1 : 0.85,
              }}
            >
              {token.content}
            </span>
          ))
        ) : (
          <span className={line.origin === "+" ? "text-green-400" : line.origin === "-" ? "text-red-400" : "text-muted-foreground"}>
            {line.content || " "}
          </span>
        )}
      </pre>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, DiffHunk, DiffLine } from "@/types/git";
import { highlightLines, detectLang } from "@/lib/shiki";
import { useRepoStore } from "@/stores/repo-store";
import { useThemeStore } from "@/stores/theme-store";
import { DiffMinimap } from "@/components/staging/diff-minimap";
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
  const diffKey = useMemo(
    () => `${diff.path}:${diff.hunks.length}:${diff.hunks.reduce((n, h) => n + h.lines.length, 0)}`,
    [diff],
  );

  return <DiffViewerInteractiveInner key={diffKey} diff={diff} filePath={filePath} />;
}

function DiffViewerInteractiveInner({ diff, filePath }: DiffViewerInteractiveProps) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageHunk = useRepoStore((s) => s.stageHunk);
  const stageLines = useRepoStore((s) => s.stageLines);
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const shikiThemeId = useThemeStore((s) => s.codeTheme.shikiTheme.name);

  const lang = useMemo(() => detectLang(filePath), [filePath]);

  // Highlight hunks progressively — render each as it finishes
  useEffect(() => {
    let cancelled = false;
    const tokenMap = new Map<number, import("@/lib/shiki").ShikiToken[][]>();
    async function highlight() {
      for (let hi = 0; hi < diff.hunks.length; hi++) {
        if (cancelled) return;
        const hunk = diff.hunks[hi];
        if (hunk.lines.length > 5000 || !lang) continue;
        const code = hunk.lines.map((l) => l.content).join("\n");
        try {
          const tokens = await highlightLines(code, lang, shikiThemeId);
          if (!cancelled) {
            tokenMap.set(hi, tokens);
            setTokensByHunk(new Map(tokenMap));
          }
        } catch { /* fallback: no highlighting */ }
      }
    }
    highlight();
    return () => {
      cancelled = true;
      setTokensByHunk(new Map());
    };
  }, [diff, lang, shikiThemeId]);

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
        for (const { key } of hunkKeys) next.delete(key);
      } else {
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

  const wrapClass = diffWrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Selection toolbar */}
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

      {/* Diff content + minimap */}
      <div className="flex flex-1 min-h-0">
        <div ref={scrollRef} className="overflow-auto flex-1 text-xs font-mono leading-5">
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
                {diffViewMode === "side-by-side" ? (
                  <InteractiveSideBySideHunk
                    hunk={hunk}
                    hunkIndex={hi}
                    hunkTokens={hunkTokens}
                    wrapClass={wrapClass}
                    selectedLines={selectedLines}
                    onToggle={toggleLine}
                  />
                ) : (
                  hunk.lines.map((line, li) => (
                    <InteractiveDiffLine
                      key={li}
                      line={line}
                      hunkIndex={hi}
                      lineIndex={li}
                      tokens={hunkTokens?.[li]}
                      isSelected={selectedLines.has(`${hi}:${li}`)}
                      onToggle={toggleLine}
                      wrapClass={wrapClass}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
        <DiffMinimap diff={diff} scrollRef={scrollRef} />
      </div>
    </div>
  );
}

// ── Unified interactive line ────────────────────────────────────────────────

interface InteractiveDiffLineProps {
  line: DiffLine;
  hunkIndex: number;
  lineIndex: number;
  tokens?: ThemedToken[];
  isSelected: boolean;
  onToggle: (hunkIdx: number, lineIdx: number) => void;
  wrapClass: string;
}

function InteractiveDiffLine({
  line,
  hunkIndex,
  lineIndex,
  tokens,
  isSelected,
  onToggle,
  wrapClass,
}: InteractiveDiffLineProps) {
  const isChangeLine = line.origin === "+" || line.origin === "-";

  const bgClass = isSelected
    ? "bg-blue-500/15"
    : line.origin === "+"
      ? "bg-[var(--diff-added-bg)]"
      : line.origin === "-"
        ? "bg-[var(--diff-removed-bg)]"
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
      <pre className={`flex-1 px-2 ${wrapClass}`}>
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

// ── Side-by-side interactive hunk ───────────────────────────────────────────

interface InteractiveSideBySideHunkProps {
  hunk: DiffHunk;
  hunkIndex: number;
  hunkTokens?: ThemedToken[][];
  wrapClass: string;
  selectedLines: Set<string>;
  onToggle: (hunkIdx: number, lineIdx: number) => void;
}

interface SideBySidePair {
  leftIdx: number | null;
  rightIdx: number | null;
  left: DiffLine | null;
  right: DiffLine | null;
}

function buildSideBySidePairs(hunk: DiffHunk): SideBySidePair[] {
  const pairs: SideBySidePair[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.origin === " ") {
      pairs.push({ left: line, right: line, leftIdx: i, rightIdx: i });
      i++;
    } else if (line.origin === "-") {
      const dels: number[] = [];
      while (i < lines.length && lines[i].origin === "-") {
        dels.push(i);
        i++;
      }
      const adds: number[] = [];
      while (i < lines.length && lines[i].origin === "+") {
        adds.push(i);
        i++;
      }
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        pairs.push({
          left: j < dels.length ? lines[dels[j]] : null,
          right: j < adds.length ? lines[adds[j]] : null,
          leftIdx: j < dels.length ? dels[j] : null,
          rightIdx: j < adds.length ? adds[j] : null,
        });
      }
    } else if (line.origin === "+") {
      pairs.push({ left: null, right: line, leftIdx: null, rightIdx: i });
      i++;
    } else {
      i++;
    }
  }

  return pairs;
}

function InteractiveSideBySideHunk({
  hunk,
  hunkIndex,
  hunkTokens,
  wrapClass,
  selectedLines,
  onToggle,
}: InteractiveSideBySideHunkProps) {
  const pairs = useMemo(() => buildSideBySidePairs(hunk), [hunk]);

  return (
    <div>
      {pairs.map((pair, i) => (
        <div key={i} className="flex">
          {/* Left (old) side */}
          <SideBySideCell
            line={pair.left}
            lineIdx={pair.leftIdx}
            hunkIndex={hunkIndex}
            tokens={pair.leftIdx !== null ? hunkTokens?.[pair.leftIdx] : undefined}
            wrapClass={wrapClass}
            isSelected={pair.leftIdx !== null ? selectedLines.has(`${hunkIndex}:${pair.leftIdx}`) : false}
            onToggle={onToggle}
            side="left"
            oppositeLine={pair.right}
          />
          {/* Right (new) side */}
          <SideBySideCell
            line={pair.right}
            lineIdx={pair.rightIdx}
            hunkIndex={hunkIndex}
            tokens={pair.rightIdx !== null ? hunkTokens?.[pair.rightIdx] : undefined}
            wrapClass={wrapClass}
            isSelected={pair.rightIdx !== null ? selectedLines.has(`${hunkIndex}:${pair.rightIdx}`) : false}
            onToggle={onToggle}
            side="right"
            oppositeLine={pair.left}
          />
        </div>
      ))}
    </div>
  );
}

interface SideBySideCellProps {
  line: DiffLine | null;
  lineIdx: number | null;
  hunkIndex: number;
  tokens?: ThemedToken[];
  wrapClass: string;
  isSelected: boolean;
  onToggle: (hunkIdx: number, lineIdx: number) => void;
  side: "left" | "right";
  oppositeLine: DiffLine | null;
}

function SideBySideCell({
  line,
  lineIdx,
  hunkIndex,
  tokens,
  wrapClass,
  isSelected,
  onToggle,
  side,
  oppositeLine,
}: SideBySideCellProps) {
  const isChangeLine = line !== null && (line.origin === "+" || line.origin === "-");
  const isEmpty = line === null;

  const bgClass = isEmpty
    ? oppositeLine && (oppositeLine.origin === "+" || oppositeLine.origin === "-")
      ? "bg-secondary/30"
      : ""
    : isSelected
      ? "bg-blue-500/15"
      : line.origin === "+"
        ? "bg-[var(--diff-added-bg)]"
        : line.origin === "-"
          ? "bg-[var(--diff-removed-bg)]"
          : "";

  return (
    <div
      className={`flex flex-1 min-w-0 overflow-hidden ${side === "left" ? "border-r border-border" : ""} ${bgClass} group/line cursor-default`}
      onClick={isChangeLine && lineIdx !== null ? () => onToggle(hunkIndex, lineIdx) : undefined}
    >
      {line ? (
        <>
          {/* Selection gutter */}
          {isChangeLine && (
            <span className="w-4 shrink-0 flex items-center justify-center select-none">
              <span
                className={`w-2 h-2 rounded-sm border transition-colors ${
                  isSelected
                    ? "bg-blue-500 border-blue-400"
                    : "border-transparent group-hover/line:border-muted-foreground/30"
                }`}
              />
            </span>
          )}
          {!isChangeLine && <span className="w-4 shrink-0" />}
          {/* Line number */}
          <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
            {side === "left" ? (line.old_lineno ?? "") : (line.new_lineno ?? "")}
          </span>
          {/* Origin */}
          <span className={`w-4 shrink-0 text-center select-none ${
            line.origin === "+" ? "text-green-400" : line.origin === "-" ? "text-red-400" : "text-muted-foreground/50"
          }`}>
            {line.origin === " " ? "" : line.origin}
          </span>
          {/* Content */}
          <pre className={`flex-1 px-1 ${wrapClass}`}>
            {tokens && tokens.length > 0 ? (
              tokens.map((token, ti) => (
                <span
                  key={ti}
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
        </>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  );
}

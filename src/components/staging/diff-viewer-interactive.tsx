import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, DiffHunk, DiffLine } from "@/types/git";
import { highlightLines, detectLang } from "@/lib/shiki";
import { useRepoStore } from "@/stores/repo-store";
import { useThemeStore } from "@/stores/theme-store";
import { getDataAttrFromEvent } from "@/lib/utils";
import { DiffMinimap } from "@/components/staging/diff-minimap";
import { Plus, Check, Minus, ChevronDown, ChevronUp, UnfoldVertical, RotateCcw } from "lucide-react";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import type { ExpandableContext } from "@/hooks/use-expandable-context";
import type { ThemedToken } from "shiki";

interface ToolbarProps {
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  isExpanded?: boolean;
  filePath?: string;
  onBack?: () => void;
}

interface DiffViewerInteractiveProps {
  diff: FileDiff;
  filePath: string;
  expandCtx?: ExpandableContext;
  staged?: boolean;
  toolbarProps?: ToolbarProps;
}

/**
 * Wrapper that resets selection state when the diff identity changes
 * by re-keying the inner component.
 */
export function DiffViewerInteractive({ diff, filePath, expandCtx, staged = false, toolbarProps }: DiffViewerInteractiveProps) {
  const diffKey = useMemo(
    () => `${diff.path}:${diff.hunks.length}:${diff.hunks.reduce((n, h) => n + h.lines.length, 0)}`,
    [diff],
  );

  return <DiffViewerInteractiveInner key={diffKey} diff={diff} filePath={filePath} expandCtx={expandCtx} staged={staged} toolbarProps={toolbarProps} />;
}

function DiffViewerInteractiveInner({ diff, filePath, expandCtx, staged = false, toolbarProps }: DiffViewerInteractiveProps) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());
  const [fileTokens, setFileTokens] = useState<ThemedToken[][] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageHunk = useRepoStore((s) => s.stageHunk);
  const unstageHunk = useRepoStore((s) => s.unstageHunk);
  const stageLines = useRepoStore((s) => s.stageLines);
  const unstageLines = useRepoStore((s) => s.unstageLines);
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const isLoading = useRepoStore((s) => s.isLoading);
  const shikiThemeId = useThemeStore((s) => s.codeTheme.shikiTheme.name);

  const lang = useMemo(() => detectLang(filePath), [filePath]);

  // Ordered list of all changeable line keys for range calculations
  const changeableKeys = useMemo(() => {
    const keys: string[] = [];
    for (let hi = 0; hi < diff.hunks.length; hi++) {
      for (let li = 0; li < diff.hunks[hi].lines.length; li++) {
        if (diff.hunks[hi].lines[li].origin === "+" || diff.hunks[hi].lines[li].origin === "-") {
          keys.push(`${hi}:${li}`);
        }
      }
    }
    return keys;
  }, [diff]);

  const getRange = useCallback((from: string, to: string): string[] => {
    const fromIdx = changeableKeys.indexOf(from);
    const toIdx = changeableKeys.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return [];
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    return changeableKeys.slice(start, end + 1);
  }, [changeableKeys]);

  // Drag state: tracked via ref to avoid re-renders during drag
  const dragRef = useRef<{
    active: boolean;
    addMode: boolean; // true = selecting, false = deselecting
    startKey: string;
    lastKey: string;
    baseSelection: Set<string>; // selection state before drag started
  } | null>(null);
  const anchorRef = useRef<string | null>(null);

  // Highlight hunks progressively — render each as it finishes
  useEffect(() => {
    let cancelled = false;
    const tokenMap = new Map<number, Awaited<ReturnType<typeof highlightLines>>>();
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

  // Highlight full file for expanded context lines
  useEffect(() => {
    const fl = expandCtx?.fileLines;
    if (!fl || !lang || fl.length > 10000) {
      setFileTokens(null);
      return;
    }
    let cancelled = false;
    const code = fl.join("\n");
    highlightLines(code, lang, shikiThemeId).then((tokens) => {
      if (!cancelled) setFileTokens(tokens);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [expandCtx?.fileLines, lang, shikiThemeId]);

  const getLineKeyFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent) => getDataAttrFromEvent(e, "data-line-key", scrollRef.current),
    [],
  );

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    const key = getLineKeyFromEvent(e);
    if (e.button !== 0) return;
    if (!key || !changeableKeys.includes(key)) return;

    // Prevent text selection during drag
    e.preventDefault();

    if (e.shiftKey && anchorRef.current) {
      // Shift+click: select range from anchor to clicked line
      const range = getRange(anchorRef.current, key);
      setSelectedLines((prev) => {
        const next = new Set(prev);
        for (const k of range) next.add(k);
        return next;
      });
      return;
    }

    // Start drag — add mode is based on whether we're selecting or deselecting
    const willSelect = !selectedLines.has(key);
    anchorRef.current = key;
    dragRef.current = {
      active: true,
      addMode: willSelect,
      startKey: key,
      lastKey: key,
      baseSelection: new Set(selectedLines),
    };

    // Toggle the clicked line
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(key); else next.delete(key);
      return next;
    });
  }, [getLineKeyFromEvent, changeableKeys, getRange, selectedLines]);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current?.active) return;
    const key = getLineKeyFromEvent(e);
    if (!key || !changeableKeys.includes(key) || key === dragRef.current.lastKey) return;

    dragRef.current.lastKey = key;
    const range = getRange(dragRef.current.startKey, key);
    setSelectedLines(() => {
      const next = new Set(dragRef.current!.baseSelection);
      for (const k of range) {
        if (dragRef.current!.addMode) next.add(k); else next.delete(k);
      }
      return next;
    });
  }, [getLineKeyFromEvent, changeableKeys, getRange]);

  // Global mouseup to end drag
  useEffect(() => {
    const handleMouseUp = () => {
      if (dragRef.current?.active) dragRef.current.active = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
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

  const handleApplySelected = useCallback(async () => {
    if (selectedLines.size === 0) return;
    const selections = [...selectedLines].map((key) => {
      const [hi, li] = key.split(":").map(Number);
      return { hunkIndex: hi, lineIndex: li };
    });
    if (staged) {
      await unstageLines(filePath, selections);
    } else {
      await stageLines(filePath, selections);
    }
    setSelectedLines(new Set());
  }, [selectedLines, filePath, stageLines, unstageLines, staged]);

  const handleApplyHunk = useCallback(async (hunkIdx: number) => {
    if (staged) {
      await unstageHunk(filePath, hunkIdx);
    } else {
      await stageHunk(filePath, hunkIdx);
    }
  }, [filePath, stageHunk, unstageHunk, staged]);

  const wrapClass = diffWrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre";

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const getHunkIndexFromEvent = useCallback((e: React.MouseEvent): number | null => {
    const val = getDataAttrFromEvent(e, "data-hunk-index", scrollRef.current);
    return val !== null ? Number(val) : null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const lineKey = getLineKeyFromEvent(e);
    const hunkIndex = getHunkIndexFromEvent(e);
    if (hunkIndex === null) return;

    e.preventDefault();
    const items: ContextMenuItem[] = [];
    const actionLabel = staged ? "Unstage" : "Stage";

    if (selectedLines.size > 0) {
      items.push({
        label: `${actionLabel} ${selectedLines.size} selected line${selectedLines.size > 1 ? "s" : ""}`,
        onClick: handleApplySelected,
      });
      items.push({ separator: true });
    }

    items.push({
      label: `${actionLabel} this hunk`,
      onClick: () => handleApplyHunk(hunkIndex),
    });

    if (lineKey) {
      const [hi, li] = lineKey.split(":").map(Number);
      const line = diff.hunks[hi]?.lines[li];
      if (line) {
        items.push({ separator: true });
        items.push({
          label: "Copy line content",
          onClick: () => navigator.clipboard.writeText(line.content),
        });
      }
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [getLineKeyFromEvent, getHunkIndexFromEvent, selectedLines, staged, handleApplySelected, handleApplyHunk, diff]);

  const lineLabel = `${selectedLines.size} line${selectedLines.size > 1 ? "s" : ""}`;
  const selectionSlot = selectedLines.size > 0 ? (
    <>
      <button
        onClick={() => setSelectedLines(new Set())}
        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground hover:border-border-hover"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Clear
      </button>
      <button
        onClick={handleApplySelected}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
          staged
            ? "border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:border-orange-500/40"
            : "border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500/40"
        }`}
      >
        {staged ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        {staged ? `Unstage ${lineLabel}` : `Stage ${lineLabel}`}
      </button>
    </>
  ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <DiffToolbar {...toolbarProps} rightSlot={selectionSlot} />

      {/* Diff content + minimap */}
      <div className="relative flex flex-1 min-h-0">
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        )}
        <div
          ref={scrollRef}
          className={`overflow-auto flex-1 text-xs font-mono leading-5 select-none ${isLoading ? "pointer-events-none" : ""}`}
          onMouseDown={handleContainerMouseDown}
          onMouseMove={handleContainerMouseMove}
          onContextMenu={handleContextMenu}
        >
          {diff.hunks.map((hunk, hi) => {
            const hunkTokens = tokensByHunk.get(hi);
            const hunkChangeKeys = hunk.lines
              .map((line, li) => ({ key: `${hi}:${li}`, line }))
              .filter(({ line }) => line.origin === "+" || line.origin === "-");
            const selectedCount = hunkChangeKeys.filter(({ key }) => selectedLines.has(key)).length;
            const allHunkSelected = hunkChangeKeys.length > 0 && selectedCount === hunkChangeKeys.length;
            const someHunkSelected = selectedCount > 0 && !allHunkSelected;
            const gapRender = expandCtx?.getGapRender(hi);

            return (
              <div key={hi} data-hunk-index={hi}>
                {/* Expandable gap before this hunk */}
                {gapRender && (
                  <>
                    {gapRender.topLines.length > 0 &&
                      (diffViewMode === "side-by-side" ? (
                        <InteractiveSideBySideContextBlock lines={gapRender.topLines} wrapClass={wrapClass} fileTokens={fileTokens} />
                      ) : (
                        gapRender.topLines.map((line, i) => (
                          <InteractiveContextLine key={`gt-${hi}-${i}`} line={line} tokens={fileTokens?.[line.new_lineno! - 1]} wrapClass={wrapClass} />
                        ))
                      ))}
                    {gapRender.remainingCount > 0 && (
                      <InteractiveExpandSeparator
                        remainingCount={gapRender.remainingCount}
                        onExpandDown={gapRender.onExpandDown}
                        onExpandUp={gapRender.onExpandUp}
                      />
                    )}
                    {gapRender.bottomLines.length > 0 &&
                      (diffViewMode === "side-by-side" ? (
                        <InteractiveSideBySideContextBlock lines={gapRender.bottomLines} wrapClass={wrapClass} fileTokens={fileTokens} />
                      ) : (
                        gapRender.bottomLines.map((line, i) => (
                          <InteractiveContextLine key={`gb-${hi}-${i}`} line={line} tokens={fileTokens?.[line.new_lineno! - 1]} wrapClass={wrapClass} />
                        ))
                      ))}
                  </>
                )}

                {/* Hunk header with stage button (hidden when gap fully expanded) */}
                {(!gapRender || gapRender.remainingCount > 0) && (
                  <div className="sticky top-0 z-10 flex items-center bg-secondary px-1 py-0.5 backdrop-blur-sm group">
                    <button
                      onClick={() => handleApplyHunk(hi)}
                      title={staged ? "Unstage this hunk" : "Stage this hunk"}
                      className={`flex items-center justify-center w-5 h-5 rounded transition-colors mr-1 shrink-0 ${
                        staged
                          ? "text-orange-400 hover:bg-orange-500/20"
                          : "text-green-400 hover:bg-green-500/20"
                      }`}
                    >
                      {staged ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => toggleHunk(hi)}
                      title={allHunkSelected ? "Deselect hunk" : "Select hunk"}
                      className="flex items-center justify-center w-5 h-5 mr-2 shrink-0"
                    >
                      <span
                        className={`flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-colors ${
                          allHunkSelected
                            ? "bg-blue-500 border-blue-400"
                            : someHunkSelected
                              ? "bg-blue-500/50 border-blue-400/70"
                              : "border-muted-foreground/40 hover:border-muted-foreground/70"
                        }`}
                      >
                        {allHunkSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        {someHunkSelected && <Minus className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                      </span>
                    </button>
                    <span className="text-muted-foreground text-xs truncate">
                      {hunk.header}
                    </span>
                  </div>
                )}

                {/* Lines */}
                <div
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize: `auto ${hunk.lines.length * 20}px`,
                  }}
                >
                  {diffViewMode === "side-by-side" ? (
                    <InteractiveSideBySideHunk
                      hunk={hunk}
                      hunkIndex={hi}
                      hunkTokens={hunkTokens}
                      wrapClass={wrapClass}
                      selectedLines={selectedLines}
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
                        wrapClass={wrapClass}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <DiffMinimap diff={diff} scrollRef={scrollRef} expandCtx={expandCtx} />
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
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
  wrapClass: string;
}

function InteractiveDiffLine({
  line,
  hunkIndex,
  lineIndex,
  tokens,
  isSelected,
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
      data-line-key={isChangeLine ? `${hunkIndex}:${lineIndex}` : undefined}
    >
      {/* Selection checkbox */}
      <span className="w-5 shrink-0 flex items-center justify-center select-none">
        {isChangeLine && (
          <span
            className={`flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-colors ${
              isSelected
                ? "bg-blue-500 border-blue-400"
                : "border-muted-foreground/20 group-hover/line:border-muted-foreground/50"
            }`}
          >
            {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
          </span>
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
                opacity: line.origin === " " ? 1 : 0.95,
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
      data-line-key={isChangeLine && lineIdx !== null ? `${hunkIndex}:${lineIdx}` : undefined}
    >
      {line ? (
        <>
          {/* Selection checkbox */}
          {isChangeLine && (
            <span className="w-5 shrink-0 flex items-center justify-center select-none">
              <span
                className={`flex items-center justify-center w-3 h-3 rounded-[3px] border transition-colors ${
                  isSelected
                    ? "bg-blue-500 border-blue-400"
                    : "border-muted-foreground/20 group-hover/line:border-muted-foreground/50"
                }`}
              >
                {isSelected && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
              </span>
            </span>
          )}
          {!isChangeLine && <span className="w-5 shrink-0" />}
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
                    opacity: line.origin === " " ? 1 : 0.95,
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

// ── Expanded context lines (unified) ───────────────────────────────────────

interface InteractiveContextLineProps {
  line: DiffLine;
  tokens?: ThemedToken[];
  wrapClass: string;
}

function InteractiveContextLine({ line, tokens, wrapClass }: InteractiveContextLineProps) {
  return (
    <div className="flex">
      <span className="w-5 shrink-0" />
      <span className="w-9 shrink-0 text-right pr-1 select-none text-muted-foreground/30 text-[10px]">
        {line.old_lineno ?? ""}
      </span>
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {line.new_lineno ?? ""}
      </span>
      <span className="w-5 shrink-0 text-center select-none text-muted-foreground/50" />
      <pre className={`flex-1 px-2 ${wrapClass}`}>
        {tokens && tokens.length > 0 ? (
          tokens.map((token, i) => (
            <span key={i} style={{ color: token.color }}>{token.content}</span>
          ))
        ) : (
          <span className="text-muted-foreground">{line.content || " "}</span>
        )}
      </pre>
    </div>
  );
}

// ── Expanded context lines (side-by-side) ──────────────────────────────────

interface InteractiveSideBySideContextBlockProps {
  lines: DiffLine[];
  wrapClass: string;
  fileTokens?: ThemedToken[][] | null;
}

function InteractiveSideBySideContextBlock({ lines, wrapClass, fileTokens }: InteractiveSideBySideContextBlockProps) {
  return (
    <div>
      {lines.map((line, i) => {
        const tokens = line.new_lineno != null ? fileTokens?.[line.new_lineno - 1] : undefined;
        return (
          <div key={i} className="flex">
            <div className="flex flex-1 min-w-0 overflow-hidden border-r border-border">
              <span className="w-5 shrink-0" />
              <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                {line.old_lineno ?? ""}
              </span>
              <span className="w-4 shrink-0 text-center select-none text-muted-foreground/50" />
              <pre className={`flex-1 px-1 ${wrapClass}`}>
                {tokens && tokens.length > 0 ? (
                  tokens.map((token, ti) => (
                    <span key={ti} style={{ color: token.color }}>{token.content}</span>
                  ))
                ) : (
                  <span className="text-muted-foreground">{line.content || " "}</span>
                )}
              </pre>
            </div>
            <div className="flex flex-1 min-w-0 overflow-hidden">
              <span className="w-5 shrink-0" />
              <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                {line.new_lineno ?? ""}
              </span>
              <span className="w-4 shrink-0 text-center select-none text-muted-foreground/50" />
              <pre className={`flex-1 px-1 ${wrapClass}`}>
                {tokens && tokens.length > 0 ? (
                  tokens.map((token, ti) => (
                    <span key={ti} style={{ color: token.color }}>{token.content}</span>
                  ))
                ) : (
                  <span className="text-muted-foreground">{line.content || " "}</span>
                )}
              </pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Expand separator for interactive viewer ────────────────────────────────

interface InteractiveExpandSeparatorProps {
  remainingCount: number;
  onExpandDown: () => void;
  onExpandUp: () => void;
}

function InteractiveExpandSeparator({ remainingCount, onExpandDown, onExpandUp }: InteractiveExpandSeparatorProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 bg-secondary/60 text-muted-foreground border-y border-border/50 select-none">
      <span className="w-5 shrink-0" />
      <button
        onClick={onExpandDown}
        title="Show lines above"
        className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-foreground transition-colors"
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      <button
        onClick={onExpandUp}
        title="Show lines below"
        className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-foreground transition-colors"
      >
        <ChevronUp className="w-3 h-3" />
      </button>
      <button
        onClick={() => { onExpandDown(); onExpandUp(); }}
        title="Expand all hidden lines"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-foreground transition-colors"
      >
        <UnfoldVertical className="w-3 h-3" />
        <span>{remainingCount} hidden lines</span>
      </button>
    </div>
  );
}

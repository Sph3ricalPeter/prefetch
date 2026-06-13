import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import type { FileDiff, DiffHunk, DiffLine } from "@/types/git";
import { highlightLines, detectLang, yieldToMacrotask } from "@/lib/shiki";
import { useRepoStore } from "@/stores/repo-store";
import { useThemeStore } from "@/stores/theme-store";
import { getDataAttrFromEvent } from "@/lib/utils";
import { DiffMinimap } from "@/components/staging/diff-minimap";
import { Plus, Check, Minus, UnfoldVertical, RotateCcw, Copy } from "lucide-react";
import { DiffToolbar } from "@/components/staging/diff-toolbar";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import type { ExpandableContext } from "@/hooks/use-expandable-context";
import type { ThemedToken } from "shiki";
import { alignBlock, computeHunkIntraLineRanges, type CharRange } from "@/lib/intra-line-diff";
import { HighlightedLineContent } from "@/components/staging/highlighted-line-content";
import { LINE_CONTAINMENT, SCROLL_CONTAINER_STYLE } from "@/lib/diff-styles";
import { useDiffLineSelection } from "@/hooks/use-diff-line-selection";
import { buildSelectionRef } from "@/lib/diff-selection";
import { toast } from "sonner";

/** Write text to the clipboard and surface a toast (success or failure). */
function copyWithToast(text: string, message: string, description?: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(message, description ? { description } : undefined),
    () => toast.error("Failed to copy to clipboard"),
  );
}

interface ToolbarProps {
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  isExpanded?: boolean;
  filePath?: string;
  onBack?: () => void;
}

interface DiffViewerBodyProps {
  diff: FileDiff;
  filePath: string;
  expandCtx?: ExpandableContext;
  /** When true, lines/hunks can be staged/unstaged. When false, the viewer is
   *  read-only but still supports line selection + copy. */
  interactive?: boolean;
  /** Relevant only when interactive: whether the diff shows already-staged changes. */
  staged?: boolean;
  /** Short/long SHA of the commit being viewed; appended to copied selection refs. */
  commitSha?: string | null;
  toolbarProps?: ToolbarProps;
}

/**
 * Shared diff viewer body for both the interactive (working-tree staging) and
 * read-only (commit/stash) modes. Line selection, syntax highlighting, the
 * minimap and the copy-selection-reference action are identical across modes;
 * the `interactive` flag gates the staging-only affordances (stage buttons and
 * stage/unstage menu items).
 *
 * Wrapper resets selection state when the diff identity changes by re-keying
 * the inner component.
 */
export function DiffViewerBody({ diff, filePath, expandCtx, interactive = false, staged = false, commitSha, toolbarProps }: DiffViewerBodyProps) {
  const diffKey = useMemo(
    () => `${diff.path}:${commitSha ?? ""}:${staged}:${diff.hunks.length}:${diff.hunks.reduce((n, h) => n + h.lines.length, 0)}`,
    [diff, commitSha, staged],
  );

  return (
    <DiffViewerBodyInner
      key={diffKey}
      diff={diff}
      filePath={filePath}
      expandCtx={expandCtx}
      interactive={interactive}
      staged={staged}
      commitSha={commitSha}
      toolbarProps={toolbarProps}
    />
  );
}

function DiffViewerBodyInner({ diff, filePath, expandCtx, interactive = false, staged = false, commitSha, toolbarProps }: DiffViewerBodyProps) {
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());
  const [fileTokens, setFileTokens] = useState<ThemedToken[][] | null>(null);
  const [oldFileTokens, setOldFileTokens] = useState<ThemedToken[][] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    selectedLines,
    clearSelection,
    toggleHunk,
    handleContainerMouseDown,
    handleContainerMouseMove,
  } = useDiffLineSelection(diff, scrollRef);
  const stageHunk = useRepoStore((s) => s.stageHunk);
  const unstageHunk = useRepoStore((s) => s.unstageHunk);
  const stageLines = useRepoStore((s) => s.stageLines);
  const unstageLines = useRepoStore((s) => s.unstageLines);
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const isLoading = useRepoStore((s) => s.isLoading);
  const shikiThemeId = useThemeStore((s) => s.codeTheme.shikiTheme.name);

  const lang = useMemo(() => detectLang(filePath), [filePath]);
  const hasDeletions = useMemo(
    () => diff.hunks.some((h) => h.lines.some((l) => l.origin === "-")),
    [diff],
  );
  // Character-level diff per paired -/+ line, for dim/highlight rendering.
  const intraLineRangesByHunk = useMemo(
    () => diff.hunks.map(computeHunkIntraLineRanges),
    [diff],
  );

  // Highlight hunks progressively — render each as it finishes.
  // Yields between hunks so clicks/renders can interrupt long highlighting runs.
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
        await yieldToMacrotask();
      }
    }
    highlight();
    return () => {
      cancelled = true;
      setTokensByHunk(new Map());
    };
  }, [diff, lang, shikiThemeId]);

  // Highlight full file for expanded context lines.
  // Deferred behind a macrotask so the click→render→paint cycle gets priority.
  useEffect(() => {
    const fl = expandCtx?.fileLines;
    if (!fl || !lang || fl.length > 5000) {
      return () => { setFileTokens(null); };
    }
    let cancelled = false;
    (async () => {
      await yieldToMacrotask();
      if (cancelled) return;
      try {
        const tokens = await highlightLines(fl.join("\n"), lang, shikiThemeId);
        if (!cancelled) setFileTokens(tokens);
      } catch { /* fallback: no highlighting */ }
    })();
    return () => { cancelled = true; setFileTokens(null); };
  }, [expandCtx?.fileLines, lang, shikiThemeId]);

  // Eagerly fetch file content for full-context syntax highlighting.
  // Old-file fetch is skipped when the diff has no deletions.
  const fetchFileLines = expandCtx?.fetchFileLines;
  const fetchOldFileLines = expandCtx?.fetchOldFileLines;
  useEffect(() => {
    if (!lang) return;
    fetchFileLines?.();
    if (hasDeletions) fetchOldFileLines?.();
  }, [lang, hasDeletions, fetchFileLines, fetchOldFileLines]);

  // Highlight old file (for deletion line tokens). Same deferral as new-file.
  useEffect(() => {
    const ofl = expandCtx?.oldFileLines;
    if (!ofl || !lang || ofl.length > 5000) {
      return () => { setOldFileTokens(null); };
    }
    let cancelled = false;
    (async () => {
      await yieldToMacrotask();
      if (cancelled) return;
      try {
        const tokens = await highlightLines(ofl.join("\n"), lang, shikiThemeId);
        if (!cancelled) setOldFileTokens(tokens);
      } catch { /* fallback: no highlighting */ }
    })();
    return () => { cancelled = true; setOldFileTokens(null); };
  }, [expandCtx?.oldFileLines, lang, shikiThemeId]);

  const getLineKeyFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent) => getDataAttrFromEvent(e, "data-line-key", scrollRef.current),
    [],
  );

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
    clearSelection();
  }, [selectedLines, filePath, stageLines, unstageLines, staged, clearSelection]);

  const handleApplyHunk = useCallback(async (hunkIdx: number) => {
    if (staged) {
      await unstageHunk(filePath, hunkIdx);
    } else {
      await stageHunk(filePath, hunkIdx);
    }
  }, [filePath, stageHunk, unstageHunk, staged]);

  const copySelectionRef = useCallback(() => {
    const ref = buildSelectionRef(filePath, diff, selectedLines, commitSha);
    if (ref) copyWithToast(ref, "Copied selection reference", ref);
  }, [filePath, diff, selectedLines, commitSha]);

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
    const actionLabel = staged ? "Unstage" : "Stage";

    // Build menu grouped by action type, not by scope: all stage/unstage
    // actions, then all copy actions, then destructive actions. Within each
    // group the most specific target (selection) comes before the broader one
    // (hunk/line).
    const stageItems: ContextMenuItem[] = [];
    const copyItems: ContextMenuItem[] = [];
    const destructiveItems: ContextMenuItem[] = [];

    const line = (() => {
      if (!lineKey) return null;
      const [hi, li] = lineKey.split(":").map(Number);
      return diff.hunks[hi]?.lines[li] ?? null;
    })();

    // Stage / unstage actions (interactive only).
    if (interactive && selectedLines.size > 0) {
      stageItems.push({
        label: `${actionLabel} ${selectedLines.size} selected line${selectedLines.size > 1 ? "s" : ""}`,
        onClick: handleApplySelected,
        icon: staged ? Minus : Plus,
      });
    }
    if (interactive && hunkIndex !== null) {
      stageItems.push({
        label: `${actionLabel} this hunk`,
        onClick: () => handleApplyHunk(hunkIndex),
        icon: staged ? Minus : Plus,
      });
    }

    // Copy actions.
    if (selectedLines.size > 0) {
      copyItems.push({ label: "Copy selection reference", onClick: copySelectionRef, icon: Copy });
    }
    if (line) {
      copyItems.push({
        label: "Copy line content",
        onClick: () => copyWithToast(line.content, "Copied line content"),
        icon: Copy,
      });
    }

    // Destructive actions.
    if (selectedLines.size > 0) {
      destructiveItems.push({ label: "Clear selection", onClick: clearSelection, icon: RotateCcw });
    }

    const items: ContextMenuItem[] = [];
    for (const group of [stageItems, copyItems, destructiveItems]) {
      if (group.length === 0) continue;
      if (items.length > 0) items.push({ separator: true });
      items.push(...group);
    }

    if (items.length === 0) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [getLineKeyFromEvent, getHunkIndexFromEvent, selectedLines, staged, interactive, handleApplySelected, handleApplyHunk, copySelectionRef, clearSelection, diff]);

  const lineLabel = `${selectedLines.size} line${selectedLines.size > 1 ? "s" : ""}`;
  const selectionSlot = selectedLines.size > 0 ? (
    <>
      <button
        onClick={clearSelection}
        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground hover:border-border-hover"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Clear
      </button>
      {interactive && (
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
      )}
    </>
  ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <DiffToolbar {...toolbarProps} rightSlot={selectionSlot} />

      {/* Diff content + minimap */}
      <div className="relative flex flex-1 min-h-0">
        <div
          ref={scrollRef}
          className={`overflow-auto flex-1 text-xs font-mono leading-5 select-none ${isLoading ? "pointer-events-none" : ""}`}
          style={SCROLL_CONTAINER_STYLE}
          onMouseDown={handleContainerMouseDown}
          onMouseMove={handleContainerMouseMove}
          onContextMenu={handleContextMenu}
        >
          {diff.hunks.map((hunk, hi) => {
            const hunkTokens = tokensByHunk.get(hi);
            const intraLineRanges = intraLineRangesByHunk[hi];
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
                        <SideBySideContextBlock lines={gapRender.topLines} wrapClass={wrapClass} fileTokens={fileTokens} />
                      ) : (
                        gapRender.topLines.map((line, i) => (
                          <ContextLine key={`gt-${hi}-${i}`} line={line} tokens={fileTokens?.[line.new_lineno! - 1]} wrapClass={wrapClass} />
                        ))
                      ))}
                    {gapRender.remainingCount > 0 && (
                      <ExpandSeparator
                        remainingCount={gapRender.remainingCount}
                        onExpandAll={gapRender.onExpandAll}
                      />
                    )}
                    {gapRender.bottomLines.length > 0 &&
                      (diffViewMode === "side-by-side" ? (
                        <SideBySideContextBlock lines={gapRender.bottomLines} wrapClass={wrapClass} fileTokens={fileTokens} />
                      ) : (
                        gapRender.bottomLines.map((line, i) => (
                          <ContextLine key={`gb-${hi}-${i}`} line={line} tokens={fileTokens?.[line.new_lineno! - 1]} wrapClass={wrapClass} />
                        ))
                      ))}
                  </>
                )}

                {/* Hunk header — select-hunk checkbox always; stage button only when interactive
                    (hidden when gap fully expanded) */}
                {(!gapRender || gapRender.remainingCount > 0) && (
                  <div className="sticky top-0 z-10 flex items-center bg-secondary px-1 py-0.5 backdrop-blur-sm group">
                    {interactive && (
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
                    )}
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
                    <SideBySideHunk
                      hunk={hunk}
                      hunkIndex={hi}
                      hunkTokens={hunkTokens}
                      wrapClass={wrapClass}
                      selectedLines={selectedLines}
                      fileTokens={fileTokens}
                      oldFileTokens={oldFileTokens}
                      intraLineRanges={intraLineRanges}
                    />
                  ) : (
                    hunk.lines.map((line, li) => (
                      <DiffLine
                        key={li}
                        line={line}
                        hunkIndex={hi}
                        lineIndex={li}
                        tokens={resolveLineTokens(line, li, hunkTokens, fileTokens, oldFileTokens)}
                        ranges={intraLineRanges.get(li)}
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

/**
 * Pick the best available token source for a diff line.
 * - Lines present in the new file (additions + context): use new-file tokens.
 * - Lines only in the old file (deletions): use old-file tokens.
 * - Fall back to per-hunk tokens while full-file highlights are loading.
 */
function resolveLineTokens(
  line: DiffLine,
  hunkLineIndex: number,
  hunkTokens: ThemedToken[][] | undefined,
  fileTokens: ThemedToken[][] | null,
  oldFileTokens: ThemedToken[][] | null,
): ThemedToken[] | undefined {
  if (fileTokens && line.new_lineno != null) return fileTokens[line.new_lineno - 1];
  if (oldFileTokens && line.old_lineno != null) return oldFileTokens[line.old_lineno - 1];
  return hunkTokens?.[hunkLineIndex];
}

// ── Unified single-pane line ────────────────────────────────────────────────

interface DiffLineProps {
  line: DiffLine;
  hunkIndex: number;
  lineIndex: number;
  tokens?: ThemedToken[];
  ranges?: CharRange[];
  isSelected: boolean;
  wrapClass: string;
}

const DiffLine = memo(DiffLineImpl);

function DiffLineImpl({
  line,
  hunkIndex,
  lineIndex,
  tokens,
  ranges,
  isSelected,
  wrapClass,
}: DiffLineProps) {
  const isChangeLine = line.origin === "+" || line.origin === "-";
  const isContext = line.origin === " ";

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
      className={`flex ${bgClass} ${isContext ? "opacity-80" : ""} group/line cursor-default`}
      style={LINE_CONTAINMENT}
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
      <span className="w-9 shrink-0 text-right pr-1 select-none text-muted-foreground/30 text-caption">
        {line.old_lineno ?? ""}
      </span>
      {/* New line number */}
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
        {line.new_lineno ?? ""}
      </span>
      {/* Origin column */}
      <span className={`w-5 shrink-0 text-center select-none ${originClass}`}>
        {line.origin === " " ? "" : line.origin}
      </span>
      {/* Content with syntax highlighting */}
      <pre className={`flex-1 px-2 ${wrapClass}`}>
        <HighlightedLineContent tokens={tokens} line={line} ranges={ranges} />
      </pre>
    </div>
  );
}

// ── Side-by-side hunk ───────────────────────────────────────────────────────

interface SideBySideHunkProps {
  hunk: DiffHunk;
  hunkIndex: number;
  hunkTokens?: ThemedToken[][];
  wrapClass: string;
  selectedLines: Set<string>;
  fileTokens?: ThemedToken[][] | null;
  oldFileTokens?: ThemedToken[][] | null;
  intraLineRanges: Map<number, CharRange[]>;
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
      const matched = alignBlock(dels, adds, lines);
      let di = 0, ai = 0;
      for (const [matchDel, matchAdd] of matched) {
        while (dels[di] !== matchDel) {
          pairs.push({ left: lines[dels[di]], right: null, leftIdx: dels[di], rightIdx: null });
          di++;
        }
        while (adds[ai] !== matchAdd) {
          pairs.push({ left: null, right: lines[adds[ai]], leftIdx: null, rightIdx: adds[ai] });
          ai++;
        }
        pairs.push({ left: lines[dels[di]], right: lines[adds[ai]], leftIdx: dels[di], rightIdx: adds[ai] });
        di++;
        ai++;
      }
      while (di < dels.length) {
        pairs.push({ left: lines[dels[di]], right: null, leftIdx: dels[di], rightIdx: null });
        di++;
      }
      while (ai < adds.length) {
        pairs.push({ left: null, right: lines[adds[ai]], leftIdx: null, rightIdx: adds[ai] });
        ai++;
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

function SideBySideHunk({
  hunk,
  hunkIndex,
  hunkTokens,
  wrapClass,
  selectedLines,
  fileTokens,
  oldFileTokens,
  intraLineRanges,
}: SideBySideHunkProps) {
  const pairs = useMemo(() => buildSideBySidePairs(hunk), [hunk]);

  return (
    <div>
      {pairs.map((pair, i) => {
        // Left (old) side: prefer old-file tokens; fall back to new-file tokens for context, then per-hunk.
        const leftTokens = oldFileTokens && pair.left?.old_lineno != null
          ? oldFileTokens[pair.left.old_lineno - 1]
          : fileTokens && pair.left?.new_lineno != null
            ? fileTokens[pair.left.new_lineno - 1]
            : (pair.leftIdx !== null ? hunkTokens?.[pair.leftIdx] : undefined);
        // Right (new) side: prefer new-file tokens; fall back to per-hunk.
        const rightTokens = fileTokens && pair.right?.new_lineno != null
          ? fileTokens[pair.right.new_lineno - 1]
          : (pair.rightIdx !== null ? hunkTokens?.[pair.rightIdx] : undefined);
        const leftRanges = pair.leftIdx !== null ? intraLineRanges.get(pair.leftIdx) : undefined;
        const rightRanges = pair.rightIdx !== null ? intraLineRanges.get(pair.rightIdx) : undefined;

        return (
          <div key={i} className="flex group/diffpair">
            {/* Left (old) side */}
            <SideBySideCell
              line={pair.left}
              lineIdx={pair.leftIdx}
              hunkIndex={hunkIndex}
              tokens={leftTokens}
              ranges={leftRanges}
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
              tokens={rightTokens}
              ranges={rightRanges}
              wrapClass={wrapClass}
              isSelected={pair.rightIdx !== null ? selectedLines.has(`${hunkIndex}:${pair.rightIdx}`) : false}
              side="right"
              oppositeLine={pair.left}
            />
          </div>
        );
      })}
    </div>
  );
}

interface SideBySideCellProps {
  line: DiffLine | null;
  lineIdx: number | null;
  hunkIndex: number;
  tokens?: ThemedToken[];
  ranges?: CharRange[];
  wrapClass: string;
  isSelected: boolean;
  side: "left" | "right";
  oppositeLine: DiffLine | null;
}

const SideBySideCell = memo(SideBySideCellImpl);

function SideBySideCellImpl({
  line,
  lineIdx,
  hunkIndex,
  tokens,
  ranges,
  wrapClass,
  isSelected,
  side,
  oppositeLine,
}: SideBySideCellProps) {
  const isChangeLine = line !== null && (line.origin === "+" || line.origin === "-");
  const isContext = line !== null && line.origin === " ";
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
      className={`flex flex-1 min-w-0 overflow-hidden ${side === "left" ? "border-r border-border" : ""} ${bgClass} ${isContext ? "opacity-80" : ""} group/line cursor-default`}
      style={LINE_CONTAINMENT}
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
          <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 group-hover/diffpair:text-foreground text-caption">
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
            <HighlightedLineContent tokens={tokens} line={line} ranges={ranges} />
          </pre>
        </>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  );
}

// ── Expanded context lines (unified) ───────────────────────────────────────

interface ContextLineProps {
  line: DiffLine;
  tokens?: ThemedToken[];
  wrapClass: string;
}

function ContextLine({ line, tokens, wrapClass }: ContextLineProps) {
  return (
    <div className="flex opacity-80">
      <span className="w-5 shrink-0" />
      <span className="w-9 shrink-0 text-right pr-1 select-none text-muted-foreground/30 text-caption">
        {line.old_lineno ?? ""}
      </span>
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
        {line.new_lineno ?? ""}
      </span>
      <span className="w-5 shrink-0 text-center select-none text-muted-foreground/50" />
      <pre className={`flex-1 px-2 ${wrapClass}`}>
        {tokens ? (
          <HighlightedLineContent tokens={tokens} line={line} />
        ) : (
          <span className="text-muted-foreground">{line.content || " "}</span>
        )}
      </pre>
    </div>
  );
}

// ── Expanded context lines (side-by-side) ──────────────────────────────────

interface SideBySideContextBlockProps {
  lines: DiffLine[];
  wrapClass: string;
  fileTokens?: ThemedToken[][] | null;
}

function SideBySideContextBlock({ lines, wrapClass, fileTokens }: SideBySideContextBlockProps) {
  return (
    <div>
      {lines.map((line, i) => {
        const tokens = line.new_lineno != null ? fileTokens?.[line.new_lineno - 1] : undefined;
        return (
          <div key={i} className="flex opacity-80">
            <div className="flex flex-1 min-w-0 overflow-hidden border-r border-border">
              <span className="w-5 shrink-0" />
              <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
                {line.old_lineno ?? ""}
              </span>
              <span className="w-4 shrink-0 text-center select-none text-muted-foreground/50" />
              <pre className={`flex-1 px-1 ${wrapClass}`}>
                {tokens ? (
                  <HighlightedLineContent tokens={tokens} line={line} />
                ) : (
                  <span className="text-muted-foreground">{line.content || " "}</span>
                )}
              </pre>
            </div>
            <div className="flex flex-1 min-w-0 overflow-hidden">
              <span className="w-5 shrink-0" />
              <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
                {line.new_lineno ?? ""}
              </span>
              <span className="w-4 shrink-0 text-center select-none text-muted-foreground/50" />
              <pre className={`flex-1 px-1 ${wrapClass}`}>
                {tokens ? (
                  <HighlightedLineContent tokens={tokens} line={line} />
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

// ── Expand separator ───────────────────────────────────────────────────────

interface ExpandSeparatorProps {
  remainingCount: number;
  onExpandAll: () => void;
}

function ExpandSeparator({ remainingCount, onExpandAll }: ExpandSeparatorProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 bg-secondary/60 text-muted-foreground border-y border-border/50 select-none">
      <span className="w-5 shrink-0" />
      <button
        onClick={onExpandAll}
        title="Expand all hidden lines"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-caption hover:bg-accent hover:text-foreground transition-colors"
      >
        <UnfoldVertical className="w-3 h-3" />
        <span>{remainingCount} hidden lines</span>
      </button>
    </div>
  );
}

import { useEffect, useState, useMemo, useRef, memo } from "react";
import type { FileDiff, DiffHunk, DiffLine } from "@/types/git";
import { highlightLines, detectLang, yieldToMacrotask } from "@/lib/shiki";
import { useRepoStore } from "@/stores/repo-store";
import { useThemeStore } from "@/stores/theme-store";
import { DiffMinimap } from "@/components/staging/diff-minimap";
import { UnfoldVertical } from "lucide-react";
import type { ExpandableContext } from "@/hooks/use-expandable-context";
import type { ThemedToken } from "shiki";
import { alignBlock, computeHunkIntraLineRanges, type CharRange } from "@/lib/intra-line-diff";
import { HighlightedLineContent } from "@/components/staging/highlighted-line-content";
import { LINE_CONTAINMENT, SCROLL_CONTAINER_STYLE } from "@/lib/diff-styles";

interface DiffViewerReadonlyProps {
  diff: FileDiff;
  filePath: string;
  expandCtx: ExpandableContext;
}

/**
 * Read-only diff viewer with Shiki syntax highlighting.
 * Supports unified and side-by-side layouts, line wrapping toggle, and change minimap.
 */
export function DiffViewerReadonly({ diff, filePath, expandCtx }: DiffViewerReadonlyProps) {
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());
  const [fileTokens, setFileTokens] = useState<ThemedToken[][] | null>(null);
  const [oldFileTokens, setOldFileTokens] = useState<ThemedToken[][] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const shikiThemeId = useThemeStore((s) => s.codeTheme.shikiTheme.name);

  const lang = useMemo(() => detectLang(filePath), [filePath]);
  const hasDeletions = useMemo(
    () => diff.hunks.some((h) => h.lines.some((l) => l.origin === "-")),
    [diff],
  );
  // Character-level diff per paired -/+ line, for dim/highlight rendering.
  // Computed once per diff (cheap — Myers diff is microseconds per line pair).
  const intraLineRangesByHunk = useMemo(
    () => diff.hunks.map(computeHunkIntraLineRanges),
    [diff],
  );

  // Highlight hunks progressively — render each as it finishes.
  // Yields to the macrotask queue between hunks so click/render/paint stay responsive
  // while a large diff is being tokenized.
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
        } catch {
          // Fallback: no highlighting for this hunk
        }
        await yieldToMacrotask();
      }
    }

    highlight();
    return () => {
      cancelled = true;
      setTokensByHunk(new Map());
    };
  }, [diff, lang, shikiThemeId]);

  // Highlight full file for expanded context lines. Deferred behind a macrotask
  // so the click → render → paint cycle gets priority; the heavy synchronous
  // tokenization shouldn't run while the user is still waiting for the spinner.
  useEffect(() => {
    if (!expandCtx.fileLines || !lang || expandCtx.fileLines.length > 5000) {
      return () => { setFileTokens(null); };
    }
    let cancelled = false;
    const fileLines = expandCtx.fileLines;
    (async () => {
      await yieldToMacrotask();
      if (cancelled) return;
      try {
        const tokens = await highlightLines(fileLines.join("\n"), lang, shikiThemeId);
        if (!cancelled) setFileTokens(tokens);
      } catch { /* fallback: no highlighting */ }
    })();
    return () => { cancelled = true; setFileTokens(null); };
  }, [expandCtx.fileLines, lang, shikiThemeId]);

  // Eagerly fetch file content for full-context syntax highlighting.
  // Old-file fetch is skipped when the diff has no deletions — saves one
  // Tauri IPC call + one full-file Shiki pass per file view.
  const fetchFileLines = expandCtx.fetchFileLines;
  const fetchOldFileLines = expandCtx.fetchOldFileLines;
  useEffect(() => {
    if (!lang) return;
    fetchFileLines();
    if (hasDeletions) fetchOldFileLines();
  }, [lang, hasDeletions, fetchFileLines, fetchOldFileLines]);

  // Highlight old file (for deletion line tokens). Same deferral as new-file.
  useEffect(() => {
    if (!expandCtx.oldFileLines || !lang || expandCtx.oldFileLines.length > 5000) {
      return () => { setOldFileTokens(null); };
    }
    let cancelled = false;
    const oldFileLines = expandCtx.oldFileLines;
    (async () => {
      await yieldToMacrotask();
      if (cancelled) return;
      try {
        const tokens = await highlightLines(oldFileLines.join("\n"), lang, shikiThemeId);
        if (!cancelled) setOldFileTokens(tokens);
      } catch { /* fallback: no highlighting */ }
    })();
    return () => { cancelled = true; setOldFileTokens(null); };
  }, [expandCtx.oldFileLines, lang, shikiThemeId]);

  const wrapClass = diffWrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre";

  return (
    <div className="flex flex-1 min-h-0">
      <div ref={scrollRef} className="overflow-auto flex-1 text-xs font-mono leading-5" style={SCROLL_CONTAINER_STYLE}>
        {diff.hunks.map((hunk, hi) => {
          const hunkTokens = tokensByHunk.get(hi);
          const gapRender = expandCtx.getGapRender(hi);
          const intraLineRanges = intraLineRangesByHunk[hi];

          return (
            <div key={hi}>
              {/* Expandable gap before this hunk */}
              {gapRender && (
                <>
                  {gapRender.topLines.length > 0 &&
                    (diffViewMode === "side-by-side" ? (
                      <SideBySideContextBlock lines={gapRender.topLines} wrapClass={wrapClass} fileTokens={fileTokens} />
                    ) : (
                      gapRender.topLines.map((line, i) => (
                        <UnifiedDiffLine key={`gt-${hi}-${i}`} line={line} tokens={fileTokens?.[line.new_lineno! - 1]} wrapClass={wrapClass} />
                      ))
                    ))}
                  {gapRender.remainingCount > 0 && (
                    <DiffExpandSeparator
                      remainingCount={gapRender.remainingCount}
                      onExpandAll={gapRender.onExpandAll}
                    />
                  )}
                  {gapRender.bottomLines.length > 0 &&
                    (diffViewMode === "side-by-side" ? (
                      <SideBySideContextBlock lines={gapRender.bottomLines} wrapClass={wrapClass} fileTokens={fileTokens} />
                    ) : (
                      gapRender.bottomLines.map((line, i) => (
                        <UnifiedDiffLine key={`gb-${hi}-${i}`} line={line} tokens={fileTokens?.[line.new_lineno! - 1]} wrapClass={wrapClass} />
                      ))
                    ))}
                </>
              )}

              {/* Hunk header (hidden when gap is fully expanded) */}
              {(!gapRender || gapRender.remainingCount > 0) && (
                <div className="sticky top-0 z-10 bg-secondary px-3 py-1 text-muted-foreground backdrop-blur-sm">
                  {hunk.header}
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
                  <SideBySideHunk hunk={hunk} hunkTokens={hunkTokens} wrapClass={wrapClass} fileTokens={fileTokens} oldFileTokens={oldFileTokens} intraLineRanges={intraLineRanges} />
                ) : (
                  hunk.lines.map((line, li) => (
                    <UnifiedDiffLine
                      key={li}
                      line={line}
                      tokens={resolveLineTokens(line, li, hunkTokens, fileTokens, oldFileTokens)}
                      ranges={intraLineRanges.get(li)}
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

// ── Unified (single-pane) line ──────────────────────────────────────────────

interface UnifiedDiffLineProps {
  line: DiffLine;
  tokens?: ThemedToken[];
  ranges?: CharRange[];
  wrapClass: string;
}

const UnifiedDiffLine = memo(UnifiedDiffLineImpl);

function UnifiedDiffLineImpl({ line, tokens, ranges, wrapClass }: UnifiedDiffLineProps) {
  const isContext = line.origin === " ";
  const bgClass =
    line.origin === "+"
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
    <div className={`flex ${bgClass} ${isContext ? "opacity-80" : ""} group`} style={LINE_CONTAINMENT}>
      <span className="w-10 shrink-0 text-right pr-1 select-none text-muted-foreground/30 text-[10px]">
        {line.old_lineno ?? ""}
      </span>
      <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {line.new_lineno ?? ""}
      </span>
      <span className={`w-5 shrink-0 text-center select-none ${originClass}`}>
        {line.origin === " " ? "" : line.origin}
      </span>
      <pre className={`flex-1 px-2 ${wrapClass}`}>
        {tokens ? (
          <HighlightedLineContent tokens={tokens} line={line} ranges={ranges} />
        ) : (
          <span className={line.origin === "+" ? "text-green-400" : line.origin === "-" ? "text-red-400" : "text-muted-foreground"}>
            {line.content || " "}
          </span>
        )}
      </pre>
    </div>
  );
}

// ── Side-by-side hunk ───────────────────────────────────────────────────────

interface SideBySideHunkProps {
  hunk: DiffHunk;
  hunkTokens?: ThemedToken[][];
  wrapClass: string;
  fileTokens?: ThemedToken[][] | null;
  oldFileTokens?: ThemedToken[][] | null;
  intraLineRanges: Map<number, CharRange[]>;
}

/**
 * Renders a hunk in side-by-side layout by pairing deletions on the left
 * with additions on the right. Context lines appear on both sides.
 */
function SideBySideHunk({ hunk, hunkTokens, wrapClass, fileTokens, oldFileTokens, intraLineRanges }: SideBySideHunkProps) {
  const pairs = useMemo(() => buildSideBySidePairs(hunk, hunkTokens), [hunk, hunkTokens]);

  return (
    <div>
      {pairs.map((pair, i) => {
        // Left (old) side: prefer old-file tokens mapped by old_lineno; fall back to new-file tokens for context lines, then per-hunk.
        const leftTokens = oldFileTokens && pair.left?.old_lineno != null
          ? oldFileTokens[pair.left.old_lineno - 1]
          : fileTokens && pair.left?.new_lineno != null
            ? fileTokens[pair.left.new_lineno - 1]
            : pair.leftTokens;
        // Right (new) side: prefer new-file tokens mapped by new_lineno; fall back to per-hunk.
        const rightTokens = fileTokens && pair.right?.new_lineno != null
          ? fileTokens[pair.right.new_lineno - 1]
          : pair.rightTokens;
        const leftRanges = pair.leftIdx != null ? intraLineRanges.get(pair.leftIdx) : undefined;
        const rightRanges = pair.rightIdx != null ? intraLineRanges.get(pair.rightIdx) : undefined;

        return (
          <div key={i} className="flex group/diffpair" style={LINE_CONTAINMENT}>
            {/* Left (old) */}
            <div className={`flex flex-1 min-w-0 overflow-hidden border-r border-border ${
              pair.left
                ? pair.left.origin === "-" ? "bg-[var(--diff-removed-bg)]" : pair.left.origin === " " ? "opacity-80" : ""
                : pair.right?.origin === "+" ? "bg-secondary/30" : ""
            }`}>
              {pair.left ? (
                <>
                  <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 group-hover/diffpair:text-foreground text-[10px]">
                    {pair.left.old_lineno ?? ""}
                  </span>
                  <span className={`w-5 shrink-0 text-center select-none ${
                    pair.left.origin === "-" ? "text-red-400" : "text-muted-foreground/50"
                  }`}>
                    {pair.left.origin === " " ? "" : pair.left.origin}
                  </span>
                  <pre className={`flex-1 px-2 ${wrapClass}`}>
                    {leftTokens ? (
                      <HighlightedLineContent tokens={leftTokens} line={pair.left} ranges={leftRanges} />
                    ) : (
                      <span className={pair.left.origin === "-" ? "text-red-400" : "text-muted-foreground"}>
                        {pair.left.content || " "}
                      </span>
                    )}
                  </pre>
                </>
              ) : (
                <span className="flex-1" />
              )}
            </div>

            {/* Right (new) */}
            <div className={`flex flex-1 min-w-0 overflow-hidden ${
              pair.right
                ? pair.right.origin === "+" ? "bg-[var(--diff-added-bg)]" : pair.right.origin === " " ? "opacity-80" : ""
                : pair.left?.origin === "-" ? "bg-secondary/30" : ""
            }`}>
              {pair.right ? (
                <>
                  <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 group-hover/diffpair:text-foreground text-[10px]">
                    {pair.right.new_lineno ?? ""}
                  </span>
                  <span className={`w-5 shrink-0 text-center select-none ${
                    pair.right.origin === "+" ? "text-green-400" : "text-muted-foreground/50"
                  }`}>
                    {pair.right.origin === " " ? "" : pair.right.origin}
                  </span>
                  <pre className={`flex-1 px-2 ${wrapClass}`}>
                    {rightTokens ? (
                      <HighlightedLineContent tokens={rightTokens} line={pair.right} ranges={rightRanges} />
                    ) : (
                      <span className={pair.right.origin === "+" ? "text-green-400" : "text-muted-foreground"}>
                        {pair.right.content || " "}
                      </span>
                    )}
                  </pre>
                </>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface SideBySidePair {
  left: DiffLine | null;
  right: DiffLine | null;
  leftIdx: number | null;
  rightIdx: number | null;
  leftTokens?: ThemedToken[];
  rightTokens?: ThemedToken[];
}

/**
 * Build side-by-side pairs from a hunk with token mapping.
 * - Context lines (" ") appear on both sides
 * - Consecutive "-" and "+" blocks are paired row-by-row
 * - Unmatched lines get an empty opposite side
 */
function buildSideBySidePairs(hunk: DiffHunk, hunkTokens?: ThemedToken[][]): SideBySidePair[] {
  const pairs: SideBySidePair[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.origin === " ") {
      pairs.push({ left: line, right: line, leftIdx: i, rightIdx: i, leftTokens: hunkTokens?.[i], rightTokens: hunkTokens?.[i] });
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
          pairs.push({ left: lines[dels[di]], right: null, leftIdx: dels[di], rightIdx: null, leftTokens: hunkTokens?.[dels[di]] });
          di++;
        }
        while (adds[ai] !== matchAdd) {
          pairs.push({ left: null, right: lines[adds[ai]], leftIdx: null, rightIdx: adds[ai], rightTokens: hunkTokens?.[adds[ai]] });
          ai++;
        }
        pairs.push({
          left: lines[dels[di]], right: lines[adds[ai]],
          leftIdx: dels[di], rightIdx: adds[ai],
          leftTokens: hunkTokens?.[dels[di]], rightTokens: hunkTokens?.[adds[ai]],
        });
        di++;
        ai++;
      }
      while (di < dels.length) {
        pairs.push({ left: lines[dels[di]], right: null, leftIdx: dels[di], rightIdx: null, leftTokens: hunkTokens?.[dels[di]] });
        di++;
      }
      while (ai < adds.length) {
        pairs.push({ left: null, right: lines[adds[ai]], leftIdx: null, rightIdx: adds[ai], rightTokens: hunkTokens?.[adds[ai]] });
        ai++;
      }
    } else if (line.origin === "+") {
      pairs.push({ left: null, right: line, leftIdx: null, rightIdx: i, rightTokens: hunkTokens?.[i] });
      i++;
    } else {
      i++;
    }
  }

  return pairs;
}

// ── Expand separator ───────────────────────────────────────────────────────

interface DiffExpandSeparatorProps {
  remainingCount: number;
  onExpandAll: () => void;
}

function DiffExpandSeparator({ remainingCount, onExpandAll }: DiffExpandSeparatorProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 bg-secondary/60 text-muted-foreground border-y border-border/50 select-none">
      <button
        onClick={onExpandAll}
        title="Expand all hidden lines"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-foreground transition-colors"
      >
        <UnfoldVertical className="w-3 h-3" />
        <span>{remainingCount} hidden lines</span>
      </button>
    </div>
  );
}

// ── Side-by-side context block (for expanded lines) ────────────────────────

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
              <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                {line.old_lineno ?? ""}
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
            <div className="flex flex-1 min-w-0 overflow-hidden">
              <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
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
          </div>
        );
      })}
    </div>
  );
}


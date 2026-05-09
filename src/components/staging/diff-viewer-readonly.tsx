import { useEffect, useState, useMemo, useRef } from "react";
import type { FileDiff, DiffHunk, DiffLine } from "@/types/git";
import { highlightLines, detectLang } from "@/lib/shiki";
import { useRepoStore } from "@/stores/repo-store";
import { useThemeStore } from "@/stores/theme-store";
import { DiffMinimap } from "@/components/staging/diff-minimap";
import { ChevronDown, ChevronUp, UnfoldVertical } from "lucide-react";
import type { ExpandableContext } from "@/hooks/use-expandable-context";
import type { ThemedToken } from "shiki";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const diffWrapLines = useRepoStore((s) => s.diffWrapLines);
  const shikiThemeId = useThemeStore((s) => s.codeTheme.shikiTheme.name);

  const lang = useMemo(() => detectLang(filePath), [filePath]);

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
        } catch {
          // Fallback: no highlighting for this hunk
        }
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
    if (!expandCtx.fileLines || !lang || expandCtx.fileLines.length > 10000) {
      return () => { setFileTokens(null); };
    }
    let cancelled = false;
    const code = expandCtx.fileLines.join("\n");
    highlightLines(code, lang, shikiThemeId).then((tokens) => {
      if (!cancelled) setFileTokens(tokens);
    }).catch(() => {});
    return () => { cancelled = true; setFileTokens(null); };
  }, [expandCtx.fileLines, lang, shikiThemeId]);

  const wrapClass = diffWrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre";

  return (
    <div className="flex flex-1 min-h-0">
      <div ref={scrollRef} className="overflow-auto flex-1 text-xs font-mono leading-5">
        {diff.hunks.map((hunk, hi) => {
          const hunkTokens = tokensByHunk.get(hi);
          const gapRender = expandCtx.getGapRender(hi);

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
                      onExpandDown={gapRender.onExpandDown}
                      onExpandUp={gapRender.onExpandUp}
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
                  <SideBySideHunk hunk={hunk} hunkTokens={hunkTokens} wrapClass={wrapClass} />
                ) : (
                  hunk.lines.map((line, li) => (
                    <UnifiedDiffLine
                      key={li}
                      line={line}
                      tokens={hunkTokens?.[li]}
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

// ── Unified (single-pane) line ──────────────────────────────────────────────

interface UnifiedDiffLineProps {
  line: DiffLine;
  tokens?: ThemedToken[];
  wrapClass: string;
}

function UnifiedDiffLine({ line, tokens, wrapClass }: UnifiedDiffLineProps) {
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
    <div className={`flex ${bgClass} group`}>
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
          <HighlightedContent tokens={tokens} line={line} />
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
}

/**
 * Renders a hunk in side-by-side layout by pairing deletions on the left
 * with additions on the right. Context lines appear on both sides.
 */
function SideBySideHunk({ hunk, hunkTokens, wrapClass }: SideBySideHunkProps) {
  const pairs = useMemo(() => buildSideBySidePairs(hunk, hunkTokens), [hunk, hunkTokens]);

  return (
    <div>
      {pairs.map((pair, i) => (
        <div key={i} className="flex">
          {/* Left (old) */}
          <div className={`flex flex-1 min-w-0 overflow-hidden border-r border-border ${
            pair.left
              ? pair.left.origin === "-" ? "bg-[var(--diff-removed-bg)]" : ""
              : pair.right?.origin === "+" ? "bg-secondary/30" : ""
          }`}>
            {pair.left ? (
              <>
                <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                  {pair.left.old_lineno ?? ""}
                </span>
                <span className={`w-5 shrink-0 text-center select-none ${
                  pair.left.origin === "-" ? "text-red-400" : "text-muted-foreground/50"
                }`}>
                  {pair.left.origin === " " ? "" : pair.left.origin}
                </span>
                <pre className={`flex-1 px-2 ${wrapClass}`}>
                  {pair.leftTokens ? (
                    <HighlightedContent tokens={pair.leftTokens} line={pair.left} />
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
              ? pair.right.origin === "+" ? "bg-[var(--diff-added-bg)]" : ""
              : pair.left?.origin === "-" ? "bg-secondary/30" : ""
          }`}>
            {pair.right ? (
              <>
                <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                  {pair.right.new_lineno ?? ""}
                </span>
                <span className={`w-5 shrink-0 text-center select-none ${
                  pair.right.origin === "+" ? "text-green-400" : "text-muted-foreground/50"
                }`}>
                  {pair.right.origin === " " ? "" : pair.right.origin}
                </span>
                <pre className={`flex-1 px-2 ${wrapClass}`}>
                  {pair.rightTokens ? (
                    <HighlightedContent tokens={pair.rightTokens} line={pair.right} />
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
      ))}
    </div>
  );
}

interface SideBySidePair {
  left: DiffLine | null;
  right: DiffLine | null;
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
      pairs.push({ left: line, right: line, leftTokens: hunkTokens?.[i], rightTokens: hunkTokens?.[i] });
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
          leftTokens: j < dels.length ? hunkTokens?.[dels[j]] : undefined,
          rightTokens: j < adds.length ? hunkTokens?.[adds[j]] : undefined,
        });
      }
    } else if (line.origin === "+") {
      pairs.push({ left: null, right: line, rightTokens: hunkTokens?.[i] });
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
  onExpandDown: () => void;
  onExpandUp: () => void;
}

function DiffExpandSeparator({ remainingCount, onExpandDown, onExpandUp }: DiffExpandSeparatorProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5 bg-secondary/60 text-muted-foreground border-y border-border/50 select-none">
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
          <div key={i} className="flex">
            <div className="flex flex-1 min-w-0 overflow-hidden border-r border-border">
              <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                {line.old_lineno ?? ""}
              </span>
              <span className="w-5 shrink-0 text-center select-none text-muted-foreground/50" />
              <pre className={`flex-1 px-2 ${wrapClass}`}>
                {tokens ? (
                  <HighlightedContent tokens={tokens} line={line} />
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
                  <HighlightedContent tokens={tokens} line={line} />
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

// ── Shared highlighting ─────────────────────────────────────────────────────

interface HighlightedContentProps {
  tokens: ThemedToken[];
  line: DiffLine;
}

function HighlightedContent({ tokens, line }: HighlightedContentProps) {
  if (!tokens || tokens.length === 0) {
    const fallbackClass =
      line.origin === "+"
        ? "text-green-400"
        : line.origin === "-"
          ? "text-red-400"
          : "text-muted-foreground";
    return <span className={fallbackClass}>{line.content || " "}</span>;
  }

  const opacityMod = line.origin === " " ? 1 : 0.95;

  return (
    <>
      {tokens.map((token, i) => (
        <span
          key={i}
          style={{
            color: token.color,
            opacity: opacityMod,
          }}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

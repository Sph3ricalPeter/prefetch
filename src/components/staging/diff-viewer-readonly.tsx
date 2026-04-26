import { useEffect, useState, useMemo } from "react";
import type { FileDiff, DiffLine } from "@/types/git";
import { highlightLines, detectLang } from "@/lib/shiki";
import type { ThemedToken } from "shiki";

interface DiffViewerReadonlyProps {
  diff: FileDiff;
  filePath: string;
}

/**
 * Read-only diff viewer with Shiki syntax highlighting.
 * Used for commit diffs, stash diffs, and staged file diffs.
 */
export function DiffViewerReadonly({ diff, filePath }: DiffViewerReadonlyProps) {
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());

  const lang = useMemo(() => detectLang(filePath), [filePath]);

  // Highlight all hunks
  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      const result = new Map<number, ThemedToken[][]>();

      for (let hi = 0; hi < diff.hunks.length; hi++) {
        const hunk = diff.hunks[hi];
        // Build the full code text for this hunk (content only, no origin chars)
        const code = hunk.lines.map((l) => l.content).join("\n");
        try {
          const tokens = await highlightLines(code, lang);
          if (!cancelled) {
            result.set(hi, tokens);
          }
        } catch {
          // Fallback: no highlighting for this hunk
        }
      }

      if (!cancelled) {
        setTokensByHunk(result);
      }
    }

    highlight();
    return () => { cancelled = true; };
  }, [diff, lang]);

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
      {diff.hunks.map((hunk, hi) => {
        const hunkTokens = tokensByHunk.get(hi);

        return (
          <div
            key={hi}
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: `auto ${hunk.lines.length * 20}px`,
            }}
          >
            {/* Hunk header */}
            <div className="sticky top-0 z-10 bg-secondary px-3 py-1 text-muted-foreground backdrop-blur-sm">
              {hunk.header}
            </div>

            {/* Lines */}
            {hunk.lines.map((line, li) => (
              <DiffLineRow
                key={li}
                line={line}
                tokens={hunkTokens?.[li]}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface DiffLineRowProps {
  line: DiffLine;
  tokens?: ThemedToken[];
}

function DiffLineRow({ line, tokens }: DiffLineRowProps) {
  const bgClass =
    line.origin === "+"
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
    <div className={`flex ${bgClass} group`}>
      {/* Old line number */}
      <span className="w-10 shrink-0 text-right pr-1 select-none text-muted-foreground/30 text-[10px]">
        {line.old_lineno ?? ""}
      </span>
      {/* New line number */}
      <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {line.new_lineno ?? ""}
      </span>
      {/* Origin column */}
      <span className={`w-5 shrink-0 text-center select-none ${originClass}`}>
        {line.origin === " " ? "" : line.origin}
      </span>
      {/* Content with syntax highlighting */}
      <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
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

  // Apply a subtle tint overlay for additions/deletions while keeping syntax colors
  const opacityMod = line.origin === " " ? 1 : 0.85;

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

import { memo } from "react";
import type { ThemedToken } from "shiki";
import type { DiffLine } from "@/types/git";
import type { CharRange } from "@/lib/intra-line-diff";

interface Props {
  tokens?: ThemedToken[];
  line: DiffLine;
  ranges?: CharRange[];
}

/**
 * Renders a single diff line's content with Shiki syntax tokens, optionally
 * overlaid with an intra-line diff (`ranges`). When ranges are present,
 * unchanged characters dim down and the actually-changed characters get a
 * brighter background — so indentation-only or typo-fix edits jump out instead
 * of getting lost in a sea of green/red.
 *
 * Memoized: this is the hottest leaf in the diff viewer (one instance per line)
 * and its props are all stable references — token arrays change only when their
 * hunk re-highlights, ranges only when the diff itself changes.
 */
export const HighlightedLineContent = memo(HighlightedLineContentImpl);

function HighlightedLineContentImpl({ tokens, line, ranges }: Props) {
  if (!tokens || tokens.length === 0) {
    const fallbackClass =
      line.origin === "+"
        ? "text-green-400"
        : line.origin === "-"
          ? "text-red-400"
          : "text-muted-foreground";
    return <span className={fallbackClass}>{line.content || " "}</span>;
  }

  const baseOpacity = line.origin === " " ? 1 : 0.95;

  if (!ranges || ranges.length === 0) {
    return (
      <>
        {tokens.map((token, i) => (
          <span key={i} style={{ color: token.color, opacity: baseOpacity }}>
            {token.content}
          </span>
        ))}
      </>
    );
  }

  const isAdded = line.origin === "+";
  const dimOpacity = 0.45;
  const changedBg = isAdded ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)";

  const spans: React.ReactNode[] = [];
  let tokenPos = 0;
  let rangeIdx = 0;
  let key = 0;
  for (const token of tokens) {
    let chunkStart = 0;
    while (chunkStart < token.content.length) {
      while (rangeIdx < ranges.length && ranges[rangeIdx].end <= tokenPos + chunkStart) {
        rangeIdx++;
      }
      if (rangeIdx >= ranges.length) {
        spans.push(
          <span key={key++} style={{ color: token.color, opacity: dimOpacity }}>
            {token.content.substring(chunkStart)}
          </span>,
        );
        break;
      }
      const range = ranges[rangeIdx];
      const chunkEnd = Math.min(token.content.length, range.end - tokenPos);
      spans.push(
        <span
          key={key++}
          style={{
            color: token.color,
            opacity: range.changed ? baseOpacity : dimOpacity,
            backgroundColor: range.changed ? changedBg : undefined,
          }}
        >
          {token.content.substring(chunkStart, chunkEnd)}
        </span>,
      );
      chunkStart = chunkEnd;
    }
    tokenPos += token.content.length;
  }
  return <>{spans}</>;
}

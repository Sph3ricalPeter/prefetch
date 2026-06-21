import { Fragment } from "react";
import { useRepoStore } from "@/stores/repo-store";

interface HighlightedTextProps {
  /** The full text to render. */
  text: string;
}

/**
 * Renders `text` with every case-insensitive occurrence of the global filter
 * query wrapped in a subtle amber background — the DOM equivalent of the
 * diff/CI-log (CSS Custom Highlight API) and commit-graph (canvas) search
 * highlights, so matches look the same everywhere. Reads the query from the
 * store itself, so it's a drop-in replacement for a `{text}` expression.
 */
export function HighlightedText({ text }: HighlightedTextProps) {
  const q = useRepoStore((s) => s.filterQuery).trim().toLowerCase();
  if (!q) return <>{text}</>;

  const lower = text.toLowerCase();
  if (!lower.includes(q)) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (let idx = lower.indexOf(q); idx !== -1; idx = lower.indexOf(q, from)) {
    if (idx > from) parts.push(<Fragment key={key++}>{text.slice(from, idx)}</Fragment>);
    parts.push(
      <span key={key++} className="rounded-xs bg-yellow-400/30">
        {text.slice(idx, idx + q.length)}
      </span>,
    );
    from = idx + q.length;
  }
  if (from < text.length) parts.push(<Fragment key={key++}>{text.slice(from)}</Fragment>);

  return <>{parts}</>;
}

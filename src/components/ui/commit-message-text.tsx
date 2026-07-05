// Render a commit subject with every conventional-commit prefix tinted in its
// type color and preceded by its type icon — including prefixes that appear
// mid-subject (e.g. a squashed "fix(A): …, feat(B): …" subject). Shared by the
// detail panel and the graph hover tooltip so both stay in sync; the canvas
// graph draws the same segments via parseCommitSegments + COMMIT_TYPE_ICON_NODES.
import { parseCommitSegments, COMMIT_TYPE_META } from "@/lib/commit-type";
import { COMMIT_TYPE_ICONS } from "@/lib/commit-type-icons";
import { cn } from "@/lib/utils";

interface CommitMessageTextProps {
  message: string;
  /** Classes for the wrapping <p> (font size, color, weight). */
  className?: string;
  /** Size classes for each inline type icon (default h-3 w-3). */
  iconClassName?: string;
}

export function CommitMessageText({
  message,
  className,
  iconClassName,
}: CommitMessageTextProps) {
  const segments = parseCommitSegments(message);
  return (
    <p className={className}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <span key={i}>{seg.text}</span>;
        }
        const meta = COMMIT_TYPE_META[seg.type];
        const TypeIcon = COMMIT_TYPE_ICONS[seg.type];
        return (
          <span
            key={i}
            className="font-medium whitespace-nowrap"
            style={{ color: meta.color }}
          >
            <TypeIcon
              className={cn(
                "mr-1 inline-block shrink-0 align-middle",
                iconClassName ?? "h-3 w-3",
              )}
              style={{ color: meta.color }}
              aria-hidden
            />
            {seg.prefix}
          </span>
        );
      })}
    </p>
  );
}

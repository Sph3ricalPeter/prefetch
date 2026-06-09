import { cn } from "@/lib/utils";

/**
 * Renders a sidebar/section count next to a header label.
 * - No active filtering (`filtered === total`): shows just the total, e.g. `8`.
 * - Filter active (`filtered !== total`): shows `filtered (total)`, e.g. `3 (8)`.
 */
export function SectionCount({
  filtered,
  total,
  className,
}: {
  filtered: number;
  total: number;
  className?: string;
}) {
  const text = filtered === total ? `${total}` : `${filtered} (${total})`;
  return (
    <span
      className={cn("ml-1 normal-case tracking-normal text-faint", className)}
    >
      {text}
    </span>
  );
}

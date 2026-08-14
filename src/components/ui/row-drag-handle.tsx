/** Horizontal drag bar that sits between two stacked cards (8px tall, with a
 *  centered pill). Used for the unstaged/staged split and the commit box. */
export function RowDragHandle({
  onMouseDown,
  label,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      className="group relative h-2 shrink-0 cursor-row-resize"
    >
      <div className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/60" />
    </div>
  );
}

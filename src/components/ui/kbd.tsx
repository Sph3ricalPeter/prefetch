import { cn } from "@/lib/utils";

interface KbdProps {
  /** Shortcut combo, e.g. "Ctrl+F" or "Shift+Enter". Rendered uppercased. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Keyboard-shortcut badge — the single, consistent way to surface a shortcut
 * hint anywhere in the app (filter input, commit box, tooltips, …). Renders a
 * small uppercased pill in the monospace font (the `<kbd>` element picks up
 * `font-mono` from index.css). Pass the combo as text: `<Kbd>Ctrl+F</Kbd>`.
 *
 * Uses `text-caption`, the size DESIGN.md reserves for uppercase tracked badges.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded bg-muted px-1 py-px text-caption font-medium uppercase tracking-wide text-dim select-none",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

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
 * Uses `text-label` — one step up from the caption size so the shortcut stays
 * legible. Scales with the app font-scale setting like the rest of the scale.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-label font-medium uppercase tracking-wide text-dim select-none",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

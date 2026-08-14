import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared shell for every settings tab: a page title, then groups of related
 * settings rendered as cards of divided rows (label + description on the left,
 * control on the right). Mirrors the commit detail card in the right column so
 * both columns read as the same surface.
 */

/** Page title + blurb at the top of a settings tab. */
export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h2 className="text-heading font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** A titled card grouping related settings. Children should be SettingsRows —
 *  `divide-y` draws the separators, so each row is one direct child. */
export function SettingsGroup({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="space-y-1.5">
      {title && (
        <h3 className="px-0.5 text-label font-medium text-muted-foreground">
          {title}
        </h3>
      )}
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-border bg-card divide-y divide-border",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One setting inside a card. The control sits to the right of the label by
 * default; pass `stack` to drop it onto its own full-width line instead — for
 * wide controls (segmented groups, theme grids) that would crowd the label.
 */
export function SettingsRow({
  label,
  description,
  children,
  stack = false,
  asLabel = false,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stack?: boolean;
  /** Render the row as a `<label>` so clicking anywhere toggles the control
   *  inside it. Use for checkbox rows. */
  asLabel?: boolean;
  className?: string;
}) {
  const Tag = asLabel ? "label" : "div";
  return (
    <Tag
      className={cn(
        "px-3 py-2.5",
        stack ? "space-y-2" : "flex items-center gap-4",
        asLabel && "cursor-pointer select-none",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {description && (
          <p className="mt-0.5 text-label text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className={stack ? undefined : "shrink-0"}>{children}</div>}
    </Tag>
  );
}

/** Segmented button group — the standard control for a small set of choices. */
export function SettingsChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { label: string; value: T; example?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs transition-colors",
            value === opt.value
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {opt.label}
          {opt.example && (
            <span className="ml-1.5 text-muted-foreground">{opt.example}</span>
          )}
        </button>
      ))}
    </div>
  );
}

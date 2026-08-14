import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Collapsible section header used across the sidebar (branches, CI, stash,
 * tags, LFS), the staging file list (unstaged/staged/conflicts) and the commit
 * detail panel. Renders the chevron toggle, an uppercase label, an optional
 * faint count and optional right-aligned controls.
 *
 * The header row only — callers own the collapsible body and its wrapper, since
 * those vary (plain div, padded list, bordered card).
 */
export function SectionHeader({
  label,
  isOpen,
  onToggle,
  count,
  badge,
  stats,
  action,
  className,
  labelClassName,
}: {
  label: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  /** Faint count after the label. Pass `undefined` to hide it entirely. */
  count?: number;
  /** Inline content between label and count (e.g. a status dot/icon), inside the toggle. */
  badge?: ReactNode;
  /** Inline content after the count (e.g. a diffstat), outside the toggle. */
  stats?: ReactNode;
  /** Right-aligned controls (refresh, add, "Stage All"), outside the toggle. */
  action?: ReactNode;
  /** Override the row padding (defaults to `px-2 py-1.5`). */
  className?: string;
  /** Override the label color (e.g. red for conflicts). */
  labelClassName?: string;
}) {
  return (
    <div className={cn("flex items-center px-2 py-1.5", className)}>
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1 text-caption font-semibold transition-colors",
          labelClassName ?? "text-muted-foreground hover:text-foreground",
        )}
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {label}
        {badge}
        {count !== undefined && (
          <span className="ml-1 text-faint">{count}</span>
        )}
      </button>
      {stats && <div className="ml-1.5 min-w-0">{stats}</div>}
      {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
    </div>
  );
}

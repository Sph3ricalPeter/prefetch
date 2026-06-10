import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Archive,
  ArrowUpFromLine,
  Trash2,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function StashList() {
  const stashes = useRepoStore((s) => s.stashes);
  const filter = useRepoStore((s) => s.filterQuery);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const selectStash = useRepoStore((s) => s.selectStash);
  const applyStash = useRepoStore((s) => s.applyStash);
  const popStash = useRepoStore((s) => s.popStash);
  const dropStash = useRepoStore((s) => s.dropStash);
  const isLoading = useRepoStore((s) => s.isLoading);
  const isOpen = useRepoStore((s) => s.sidebarSections.stashes);
  const setSidebarSection = useRepoStore((s) => s.setSidebarSection);
  const [stashContextMenu, setStashContextMenu] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [confirmDropStash, setConfirmDropStash] = useState<number | null>(null);

  // Filter dims non-matching rows rather than hiding them.
  const q = filter.trim().toLowerCase();
  const isDimmed = (message: string) =>
    q !== "" && !message.toLowerCase().includes(q);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={() => setSidebarSection("stashes", !isOpen)}
          className="flex items-center gap-1 text-label font-semibold text-muted-foreground uppercase tracking-[0.06em] hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Stash
          {stashes.length > 0 && (
            <span className="ml-1 normal-case tracking-normal text-faint">
              {stashes.length}
            </span>
          )}
        </button>
      </div>

      {/* Stash entries */}
      {isOpen && stashes.length > 0 && (
        <div>
          {stashes.map((stash) => (
            <div
              key={stash.index}
              onClick={() => selectStash(stash.index)}
              onContextMenu={(e) => {
                e.preventDefault();
                setStashContextMenu({ index: stash.index, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer transition-colors",
                selectedStashIndex === stash.index
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
                isDimmed(stash.message) && FILTER_DIM_CLASS,
              )}
            >
              <Archive className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1">{stash.message}</span>

              {/* Pop button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      popStash(stash.index);
                    }}
                    disabled={isLoading}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-all disabled:opacity-40"
                  >
                    <ArrowUpFromLine className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Pop (apply & remove)</TooltipContent>
              </Tooltip>

              {/* Drop button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDropStash(stash.index);
                    }}
                    disabled={isLoading}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive-foreground transition-all disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Drop (discard)</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      {/* Stash context menu */}
      {stashContextMenu && (
        <ContextMenu
          x={stashContextMenu.x}
          y={stashContextMenu.y}
          items={buildStashContextMenuItems(
            stashContextMenu.index,
            applyStash,
            popStash,
            (idx) => setConfirmDropStash(idx),
          )}
          onClose={() => setStashContextMenu(null)}
        />
      )}

      {/* Drop stash confirmation */}
      {confirmDropStash != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Drop stash?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will permanently discard stash@&#123;{confirmDropStash}&#125;. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDropStash(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  dropStash(confirmDropStash);
                  setConfirmDropStash(null);
                }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Drop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildStashContextMenuItems(
  index: number,
  applyStash: (index: number) => void,
  popStash: (index: number) => void,
  dropStash: (index: number) => void,
): ContextMenuItem[] {
  return [
    {
      label: "Apply (keep in stash list)",
      onClick: () => applyStash(index),
    },
    {
      label: "Pop (apply & remove)",
      onClick: () => popStash(index),
    },
    {
      label: "Drop (discard)",
      onClick: () => dropStash(index),
      destructive: true,
    },
  ];
}

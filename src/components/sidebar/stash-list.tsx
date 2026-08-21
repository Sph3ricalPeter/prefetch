import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { usePausedOperation } from "@/hooks/use-paused-operation";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { ConfirmDialog } from "@/components/ui/modal";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";
import { ACTION_ICONS } from "@/lib/action-icons";

export function StashList() {
  const stashes = useRepoStore((s) => s.stashes);
  const filter = useRepoStore((s) => s.filterQuery);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const selectStash = useRepoStore((s) => s.selectStash);
  const applyStash = useRepoStore((s) => s.applyStash);
  const popStash = useRepoStore((s) => s.popStash);
  const dropStash = useRepoStore((s) => s.dropStash);
  const pausedOperation = usePausedOperation();
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
      <SectionHeader
        label="Stash"
        count={stashes.length > 0 ? stashes.length : undefined}
        isOpen={isOpen}
        onToggle={() => setSidebarSection("stashes", !isOpen)}
      />

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
                "group flex items-center gap-1.5 rounded-md px-2 py-1 my-1 text-xs cursor-pointer transition-colors",
                selectedStashIndex === stash.index
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
                isDimmed(stash.message) && FILTER_DIM_CLASS,
              )}
            >
              <Archive className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1"><HighlightedText text={stash.message} /></span>

              {/* Pop button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    size="sm"
                    reveal="fade"
                    onClick={(e) => {
                      e.stopPropagation();
                      popStash(stash.index);
                    }}
                    disabled={isLoading || pausedOperation !== null}
                    className="shrink-0 hover:bg-accent"
                  >
                    <ArchiveRestore className="h-3 w-3" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>Pop (apply & remove)</TooltipContent>
              </Tooltip>

              {/* Drop button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    size="sm"
                    variant="subtle"
                    reveal="fade"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDropStash(stash.index);
                    }}
                    disabled={isLoading}
                    className="shrink-0 hover:bg-destructive/20 hover:text-destructive-foreground"
                  >
                    <Trash2 className="h-3 w-3" />
                  </IconButton>
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
        <ConfirmDialog
          open
          onClose={() => setConfirmDropStash(null)}
          title="Drop stash?"
          description={`This will permanently discard stash@{${confirmDropStash}}. This cannot be undone.`}
          confirmLabel="Drop"
          destructive
          onConfirm={() => {
            dropStash(confirmDropStash);
            setConfirmDropStash(null);
          }}
        />
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
      writesRepo: true,
      icon: ACTION_ICONS["Apply Stash"],
    },
    {
      label: "Pop (apply & remove)",
      onClick: () => popStash(index),
      writesRepo: true,
      icon: ACTION_ICONS["Pop Stash"],
    },
    {
      label: "Drop (discard)",
      onClick: () => dropStash(index),
      destructive: true,
      icon: ACTION_ICONS["Drop Stash"],
    },
  ];
}

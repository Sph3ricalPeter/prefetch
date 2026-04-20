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

export function StashList({ filter = "" }: { filter?: string }) {
  const stashes = useRepoStore((s) => s.stashes);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const selectStash = useRepoStore((s) => s.selectStash);
  const popStash = useRepoStore((s) => s.popStash);
  const dropStash = useRepoStore((s) => s.dropStash);
  const isLoading = useRepoStore((s) => s.isLoading);
  const [isOpen, setIsOpen] = useState(true);

  const filtered = filter
    ? stashes.filter((s) =>
        s.message.toLowerCase().includes(filter.toLowerCase()),
      )
    : stashes;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Stash
          {filtered.length > 0 && (
            <span className="ml-1 normal-case tracking-normal text-muted-foreground/50">
              {filtered.length}
            </span>
          )}
        </button>
      </div>

      {/* Stash entries */}
      {isOpen && filtered.length > 0 && (
        <div>
          {filtered.map((stash) => (
            <div
              key={stash.index}
              onClick={() => selectStash(stash.index)}
              className={`group flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer transition-colors ${
                selectedStashIndex === stash.index
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
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
                      dropStash(stash.index);
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
    </div>
  );
}

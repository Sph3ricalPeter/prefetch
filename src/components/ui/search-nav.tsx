import { ChevronUp, ChevronDown } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import type { InViewSearch } from "@/hooks/use-in-view-search";

/**
 * Match counter + next/prev controls for the in-view search, shown in the diff
 * toolbar and the CI-log header while the global filter has a query. Styled to
 * match the segmented pill controls in those toolbars.
 */
export function SearchNav({ matchCount, activeIndex, next, prev }: InViewSearch) {
  const empty = matchCount === 0;
  const label = empty ? "0/0" : `${activeIndex + 1}/${matchCount}`;

  return (
    <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
      <span className="px-1.5 text-xs tabular-nums text-muted-foreground select-none">
        {label}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={prev}
            disabled={empty}
            className="flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          Previous match <Kbd>Shift+Enter</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={next}
            disabled={empty}
            className="flex items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          Next match <Kbd>Enter</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

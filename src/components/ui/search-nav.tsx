import { ChevronUp, ChevronDown } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
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
          <IconButton
            size="sm"
            variant="subtle"
            onClick={prev}
            disabled={empty}
            className="hover:bg-background"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          Previous match <Kbd>Shift+Enter</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            variant="subtle"
            onClick={next}
            disabled={empty}
            className="hover:bg-background"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          Next match <Kbd>Enter</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

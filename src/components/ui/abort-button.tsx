import { X } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface AbortButtonProps {
  disabled?: boolean;
  className?: string;
}

/** Aborts the in-progress operation (rebase/merge/cherry-pick/revert).
 *  Shared by the conflict banner, conflict editor toolbar, and commit box. */
export function AbortButton({ disabled, className }: AbortButtonProps) {
  const abortOperation = useRepoStore((s) => s.abortOperation);
  const conflictState = useRepoStore((s) => s.conflictState);
  // `get_conflict_state` reports an idle repo as `operation: ""`, so `??` never
  // fires — and there is nothing to abort anyway. Render nothing.
  if (!conflictState?.in_progress) return null;
  const operation = conflictState.operation || "operation";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={abortOperation}
          disabled={disabled}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed",
            className,
          )}
        >
          <X className="w-3.5 h-3.5" />
          Abort
        </button>
      </TooltipTrigger>
      <TooltipContent>Abort {operation} and restore previous state</TooltipContent>
    </Tooltip>
  );
}

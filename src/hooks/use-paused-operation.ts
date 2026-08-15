import { useRepoStore } from "@/stores/repo-store";

/**
 * Name of the rebase / merge / cherry-pick / revert currently paused in the
 * repo, or null when the working tree is free.
 *
 * Drives the dim-and-disable affordance across the app (see
 * `OPERATION_DIM_CLASS`). It is not the safety boundary — `blockedByOperation`
 * in the repo store refuses these actions regardless of what the UI renders, so
 * a surface that hasn't been dimmed yet still fails safe with a toast.
 */
export function usePausedOperation(): string | null {
  return useRepoStore((s) => (s.conflictState?.in_progress ? s.conflictState.operation : null));
}

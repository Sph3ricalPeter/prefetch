import type { FileStatus } from "@/types/git";
import { cn } from "@/lib/utils";

/**
 * Summed +additions / -deletions for a set of files. Both sides always render
 * (a `+0` matches how the individual file rows read); the whole thing is
 * omitted only when no file carries line counts at all — binary-only changes
 * or a diff that hasn't been scanned yet. Used by the detail column's topbar
 * and every changed-files card header.
 */
export function DiffStat({
  files,
  className,
}: {
  files: FileStatus[];
  className?: string;
}) {
  if (!files.some((f) => f.additions != null || f.deletions != null)) return null;
  const add = files.reduce((s, f) => s + (f.additions ?? 0), 0);
  const del = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-normal normal-case tracking-normal",
        className,
      )}
    >
      <span className="text-green-400">+{add}</span>
      <span className="text-red-400">-{del}</span>
    </span>
  );
}

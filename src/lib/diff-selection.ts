import type { FileDiff } from "@/types/git";

/**
 * Ordered list of selectable ("+"/"-") line keys (`"${hunkIndex}:${lineIndex}"`)
 * across a diff. Used to compute contiguous ranges for drag/shift selection.
 */
export function buildChangeableKeys(diff: FileDiff): string[] {
  const keys: string[] = [];
  for (let hi = 0; hi < diff.hunks.length; hi++) {
    const lines = diff.hunks[hi].lines;
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].origin === "+" || lines[li].origin === "-") {
        keys.push(`${hi}:${li}`);
      }
    }
  }
  return keys;
}

/**
 * Build a CC/ripgrep-style location reference from a set of selected diff-line
 * keys, e.g. `src/foo.ts:10-25` or, for a past commit, `src/foo.ts:10-25 (commit a1b2c3d)`.
 *
 * Line numbers are taken from the new (post-change) file where available so the
 * reference points at the current file; pure-deletion selections fall back to
 * old-file line numbers. Returns null if nothing resolvable is selected.
 */
export function buildSelectionRef(
  filePath: string,
  diff: FileDiff,
  selectedLines: Set<string>,
  commitSha?: string | null,
): string | null {
  if (selectedLines.size === 0) return null;

  const newNos: number[] = [];
  const oldNos: number[] = [];
  for (const key of selectedLines) {
    const [hi, li] = key.split(":").map(Number);
    const line = diff.hunks[hi]?.lines[li];
    if (!line) continue;
    if (line.new_lineno != null) newNos.push(line.new_lineno);
    else if (line.old_lineno != null) oldNos.push(line.old_lineno);
  }

  const nos = newNos.length > 0 ? newNos : oldNos;
  if (nos.length === 0) return null;

  const min = Math.min(...nos);
  const max = Math.max(...nos);
  const range = min === max ? `${min}` : `${min}-${max}`;
  const base = `${filePath}:${range}`;
  return commitSha ? `${base} (commit ${commitSha.slice(0, 7)})` : base;
}

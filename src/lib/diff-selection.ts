import type { DiffHunk, FileDiff } from "@/types/git";

/**
 * Canonical key for a single diff line: `"${hunkIndex}:${lineIndex}"`.
 *
 * This is the one place the line-key format is defined. The patch generator
 * ([generatePatch](./patch.ts)) and the selection hook
 * ([useDiffLineSelection](../hooks/use-diff-line-selection.ts)) build and parse
 * keys through here so a change to the encoding stays local.
 */
export function lineKey(hunkIndex: number, lineIndex: number): string {
  return `${hunkIndex}:${lineIndex}`;
}

/** Parse a line key back into its hunk and line indices. */
export function parseLineKey(key: string): { hunk: number; line: number } {
  const [hunk, line] = key.split(":").map(Number);
  return { hunk, line };
}

/** Keys of the selectable ("+"/"-") lines within a single hunk, in order. */
export function changeableKeysInHunk(hunk: DiffHunk, hunkIndex: number): string[] {
  const keys: string[] = [];
  for (let li = 0; li < hunk.lines.length; li++) {
    const origin = hunk.lines[li].origin;
    if (origin === "+" || origin === "-") keys.push(lineKey(hunkIndex, li));
  }
  return keys;
}

/**
 * Ordered list of selectable ("+"/"-") line keys across a diff. Used to compute
 * contiguous ranges for drag/shift selection.
 */
export function buildChangeableKeys(diff: FileDiff): string[] {
  return diff.hunks.flatMap((hunk, hi) => changeableKeysInHunk(hunk, hi));
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
    const { hunk: hi, line: li } = parseLineKey(key);
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

/**
 * Build the concatenated raw text of the selected diff lines, in document order.
 *
 * Contiguous runs of selected change lines are joined with single newlines;
 * disconnected runs — selections with an unselected change line between them, or
 * spanning a hunk boundary — are separated by one blank line so the copied text
 * reflects that the sections aren't adjacent in the file. Each line's `content`
 * is the raw text without the +/- origin marker, matching the single-line
 * "Copy line content" action. Returns null if nothing is selected.
 */
export function buildSelectionContent(diff: FileDiff, selectedLines: Set<string>): string | null {
  if (selectedLines.size === 0) return null;

  const changeableKeys = buildChangeableKeys(diff);
  const blocks: string[][] = [];
  let prevIdx = -2;
  let prevHunk = -1;

  changeableKeys.forEach((key, idx) => {
    if (!selectedLines.has(key)) return;
    const { hunk: hi, line: li } = parseLineKey(key);
    const line = diff.hunks[hi]?.lines[li];
    if (!line) return;
    // New block when this line isn't the immediate next changeable line, or it
    // jumps to a different hunk.
    const contiguous = idx === prevIdx + 1 && hi === prevHunk;
    if (!contiguous) blocks.push([]);
    blocks[blocks.length - 1].push(line.content);
    prevIdx = idx;
    prevHunk = hi;
  });

  if (blocks.length === 0) return null;
  return blocks.map((b) => b.join("\n")).join("\n\n");
}

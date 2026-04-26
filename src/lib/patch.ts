import type { FileDiff, DiffHunk } from "@/types/git";

/**
 * Generate a unified diff patch from selected lines for `git apply --cached`.
 *
 * @param diff The full file diff
 * @param selectedLines Set of keys like "hunkIdx:lineIdx" identifying selected lines
 * @param mode "stage" to stage selected lines, "unstage" to unstage them
 * @returns A valid unified diff patch string
 */
export function generatePatch(
  diff: FileDiff,
  selectedLines: Set<string>,
): string {
  const parts: string[] = [];

  // Diff header
  const aPath = diff.path;
  const bPath = diff.path;
  parts.push(`diff --git a/${aPath} b/${bPath}`);
  parts.push(`--- a/${aPath}`);
  parts.push(`+++ b/${bPath}`);

  for (let hi = 0; hi < diff.hunks.length; hi++) {
    const hunk = diff.hunks[hi];
    const patchLines = buildPatchHunk(hunk, hi, selectedLines);
    if (patchLines) {
      parts.push(patchLines);
    }
  }

  // Must end with newline for git apply
  return parts.join("\n") + "\n";
}

/**
 * Build a single hunk's patch text for the selected lines.
 * Returns null if no selected changes exist in this hunk.
 */
function buildPatchHunk(
  hunk: DiffHunk,
  hunkIndex: number,
  selectedLines: Set<string>,
): string | null {
  // Check if any changeable lines in this hunk are selected
  const hasSelection = hunk.lines.some(
    (line, li) =>
      (line.origin === "+" || line.origin === "-") &&
      selectedLines.has(`${hunkIndex}:${li}`),
  );

  if (!hasSelection) return null;

  const outputLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;

  for (let li = 0; li < hunk.lines.length; li++) {
    const line = hunk.lines[li];
    const key = `${hunkIndex}:${li}`;
    const isSelected = selectedLines.has(key);

    if (line.origin === " ") {
      // Context line — always include
      outputLines.push(` ${line.content}`);
      oldCount++;
      newCount++;
    } else if (line.origin === "+") {
      if (isSelected) {
        // Selected addition — include it
        outputLines.push(`+${line.content}`);
        newCount++;
      }
      // Unselected additions are omitted (stay in working tree)
    } else if (line.origin === "-") {
      if (isSelected) {
        // Selected deletion — include it
        outputLines.push(`-${line.content}`);
        oldCount++;
      } else {
        // Unselected deletion — convert to context (it's already in HEAD)
        outputLines.push(` ${line.content}`);
        oldCount++;
        newCount++;
      }
    }
  }

  // Build hunk header with corrected counts
  const header = `@@ -${hunk.old_start},${oldCount} +${hunk.new_start},${newCount} @@`;
  return [header, ...outputLines].join("\n");
}

/**
 * Generate a patch that stages/unstages an entire hunk.
 */
export function generateHunkPatch(diff: FileDiff, hunkIndex: number): string {
  const hunk = diff.hunks[hunkIndex];
  if (!hunk) return "";

  // Select all changeable lines in this hunk
  const allLines = new Set<string>();
  hunk.lines.forEach((line, li) => {
    if (line.origin === "+" || line.origin === "-") {
      allLines.add(`${hunkIndex}:${li}`);
    }
  });

  return generatePatch(diff, allLines);
}

/**
 * Generate a patch for unstaging: reverses the perspective.
 * When unstaging, we apply --reverse, so the patch format is the same
 * as staging but git apply handles the reversal.
 */
export function generateUnstageHunkPatch(
  diff: FileDiff,
  hunkIndex: number,
): string {
  return generateHunkPatch(diff, hunkIndex);
}

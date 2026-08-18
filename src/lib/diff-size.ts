import type { ConflictContents, FileDiff } from "@/types/git";

/**
 * Size limits for the diff and conflict renderers.
 *
 * Every other guard in the app counts lines, which misses the files that
 * actually hang it: a Unity `.asset` is 953 lines and 4 MB, one of those lines
 * a 2 MB base64 blob. Laying out a single 2 MB line freezes the app for
 * minutes, so measure characters — total volume and worst single line.
 */
const RENDER_CHAR_LIMIT = 500_000;
const RENDER_LINE_CHAR_LIMIT = 20_000;

function hasLongLine(text: string): boolean {
  let start = 0;
  for (;;) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return text.length - start > RENDER_LINE_CHAR_LIMIT;
    if (nl - start > RENDER_LINE_CHAR_LIMIT) return true;
    start = nl + 1;
  }
}

/** True when a diff is too heavy to render without asking the user first. */
export function isHeavyDiff(diff: FileDiff): boolean {
  let total = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.content.length > RENDER_LINE_CHAR_LIMIT) return true;
      total += line.content.length;
    }
  }
  return total > RENDER_CHAR_LIMIT;
}

/** Same guard for the three-way conflict editor, which renders ours + theirs + output. */
export function isHeavyConflict(contents: ConflictContents): boolean {
  const texts = [contents.ours, contents.theirs, contents.base ?? ""];
  const total = texts.reduce((n, t) => n + t.length, 0);
  return total > RENDER_CHAR_LIMIT || texts.some(hasLongLine);
}

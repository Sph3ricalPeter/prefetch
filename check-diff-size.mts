import assert from "node:assert/strict";
import { isHeavyDiff } from "./src/lib/diff-size.ts";

const hunk = (n: number, len: number) => ({
  header: "@@", old_start: 1, old_lines: n, new_start: 1, new_lines: n,
  lines: Array.from({ length: n }, (_, i) => ({
    origin: "+", content: "x".repeat(len), old_lineno: null, new_lineno: i + 1,
  })),
});
const diff = (hunks: unknown[]) =>
  ({ path: "a.prefab", hunks, is_binary: false, is_truncated: false, total_lines: 0 }) as never;

// A Unity prefab shape: short lines, lots of them. 14k rows x 35 chars = 490k
// chars, under the char cap — this is the case the row cap exists for.
assert.equal(isHeavyDiff(diff([hunk(14_000, 35)])), true, "14k short rows must be heavy");

// Row cap must count across hunks, not per hunk — prefab diffs are many small ones.
assert.equal(
  isHeavyDiff(diff(Array.from({ length: 300 }, () => hunk(40, 35)))),
  true,
  "300 x 40 rows (12k) must be heavy",
);

// Just under both caps stays renderable.
assert.equal(isHeavyDiff(diff([hunk(9_000, 35)])), false, "9k short rows must be fine");

// Char and long-line caps still fire independently of row count.
assert.equal(isHeavyDiff(diff([hunk(600, 1_000)])), true, "600k chars must be heavy");
assert.equal(isHeavyDiff(diff([hunk(1, 25_000)])), true, "one 25k-char line must be heavy");

console.log("diff-size guards ok");

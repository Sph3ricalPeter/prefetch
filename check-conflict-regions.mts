import assert from "node:assert/strict";
import { computeDiffRegions, buildOutputFromSelections } from "./src/lib/conflict-regions.ts";

const L = (...lines: string[]) => lines.join("\n") + "\n";

/** Returns the auto-merged text, or null when a real conflict remains. */
function merge(base: string, ours: string, theirs: string): string | null {
  const regions = computeDiffRegions(ours, theirs, base);
  // Line numbers must point back at the region's lines in each side.
  const o = ours.split("\n");
  const t = theirs.split("\n");
  for (const r of regions) {
    assert.deepEqual(o.slice(r.aStartLine - 1, r.aStartLine - 1 + r.aLines.length), r.aLines);
    if (r.type !== "unchanged") {
      assert.deepEqual(t.slice(r.bStartLine - 1, r.bStartLine - 1 + r.bLines.length), r.bLines);
    }
  }
  return regions.some((r) => r.type === "changed") ? null : buildOutputFromSelections(regions, new Map());
}

// One-sided deletions must stick, not be resurrected from the other side.
assert.equal(merge(L("a", "b", "c"), L("a", "c"), L("a", "b", "c")), L("a", "c"));
assert.equal(merge(L("a", "b", "c"), L("a", "b", "c"), L("a", "c")), L("a", "c"));
assert.equal(
  merge(L("a", "b", "c", "d", "e"), L("a", "c", "d", "e"), L("a", "b", "c", "d", "X", "e")),
  L("a", "c", "d", "X", "e"),
);

// Delete vs edit of the same line is a conflict, as in git.
assert.equal(merge(L("a", "b", "c"), L("a", "c"), L("a", "B", "c")), null);
assert.equal(merge(L("a", "b", "c"), L("a", "B", "c"), L("a", "c")), null);

// Changes touching in base are a conflict, as in git.
assert.equal(merge(L("x", "y", "z", "w"), L("w"), L("x", "y", "z", "W")), null);
assert.equal(merge(L("a", "c"), L("a", "X", "c"), L("a", "Y", "c")), null);

// Identical change on both sides is kept once.
assert.equal(merge(L("a", "b", "c"), L("a", "B", "c", "d"), L("a", "B", "c")), L("a", "B", "c", "d"));
assert.equal(merge(L("a", "b", "c", "d", "e"), L("a", "c", "d", "E"), L("a", "c", "d", "e")), L("a", "c", "d", "E"));

// A block moved by one side and an edit by the other: no duplicate, nothing lost.
assert.equal(
  merge(
    L("fn a() {", "  1", "}", "", "fn b() {", "  2", "}", "", "fn c() {", "  3", "}"),
    L("fn a() {", "  1", "}", "", "fn b() {", "  2 edited", "}", "", "fn c() {", "  3", "}"),
    L("fn b() {", "  2", "}", "", "fn c() {", "  3", "}", "", "fn a() {", "  1", "}"),
  ),
  L("fn b() {", "  2 edited", "}", "", "fn c() {", "  3", "}", "", "fn a() {", "  1", "}"),
);

// Conflicts are trimmed of lines both sides share.
const regions = computeDiffRegions(
  L("import a", "import b", "import c", "", "code"),
  L("import a", "import b", "import d", "", "code"),
  L("import a", "", "code"),
);
const conflict = regions.find((r) => r.type === "changed");
assert.deepEqual(conflict?.aLines, ["import c"]);
assert.deepEqual(conflict?.bLines, ["import d"]);

// Identical lines inside a conflict are split out, leaving two small conflicts.
const split = computeDiffRegions(L("A", "B", "C1"), L("A2", "B", "C2"), L("a", "b", "c"));
assert.deepEqual(
  split.map((r) => [r.type, r.aLines, r.bLines]),
  [["changed", ["A"], ["A2"]], ["unchanged", ["B"], ["B"]], ["changed", ["C1"], ["C2"]], ["unchanged", [""], [""]]],
);
assert.deepEqual(split[0].baseLines, ["a", "b", "c"]);

console.log("check-conflict-regions: ok");

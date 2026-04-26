import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";

/**
 * A region of text that is either unchanged between ours/theirs or changed.
 */
export interface DiffRegion {
  type: "unchanged" | "changed";
  /** Lines from document A (ours) */
  aLines: string[];
  /** Lines from document B (theirs) */
  bLines: string[];
  /** 1-based starting line number in document A */
  aStartLine: number;
  /** 1-based starting line number in document B */
  bStartLine: number;
}

/**
 * Per-chunk selection state: which lines from ours/theirs to include in output.
 * Both sides can be selected simultaneously — order controls concat direction.
 */
export interface ChunkSelection {
  oursLines: Set<number>;
  theirsLines: Set<number>;
  /** Which side was selected first determines concat order in output. */
  order: "ours-first" | "theirs-first";
}

/** Identifies the source of each line in the assembled output. */
export type LineSource = "unchanged" | "ours" | "theirs";

/** Reverse mapping from an output line back to its origin in a diff region. */
export interface OutputLineMapping {
  regionIndex: number;
  side: "ours" | "theirs";
  lineIndex: number;
}

/**
 * Compute diff regions between ours and theirs content.
 * Uses @codemirror/merge's Chunk.build for efficient line-level diff.
 *
 * When `base` (common ancestor) is provided, unchanged lines adjacent
 * to a changed region that are "new" relative to the base are absorbed
 * into the changed region.  This prevents orphaned context lines (e.g.
 * empty lines both sides added around a change) from lingering in the
 * output when both sides are unchecked.
 */
export function computeDiffRegions(
  ours: string,
  theirs: string,
  base?: string,
): DiffRegion[] {
  const oursLines = ours.split("\n");
  const theirsLines = theirs.split("\n");

  // Fast path: identical content
  if (ours === theirs) {
    return [
      {
        type: "unchanged",
        aLines: oursLines,
        bLines: theirsLines,
        aStartLine: 1,
        bStartLine: 1,
      },
    ];
  }

  const oursText = Text.of(oursLines);
  const theirsText = Text.of(theirsLines);
  const chunks = Chunk.build(oursText, theirsText);

  let regions: DiffRegion[] = [];
  let aIdx = 0;
  let bIdx = 0;

  for (const chunk of chunks) {
    const hasA = chunk.fromA < chunk.toA;
    const hasB = chunk.fromB < chunk.toB;

    // Always derive start from chunk.fromA/fromB so that unchanged
    // regions are created correctly even for pure insertions/deletions
    // where one side's range is empty.
    const aStart = oursText.lineAt(chunk.fromA).number - 1;
    const aEnd = hasA ? oursText.lineAt(chunk.endA).number : aStart;
    const bStart = theirsText.lineAt(chunk.fromB).number - 1;
    const bEnd = hasB ? theirsText.lineAt(chunk.endB).number : bStart;

    if (aIdx < aStart) {
      regions.push({
        type: "unchanged",
        aLines: oursLines.slice(aIdx, aStart),
        bLines: theirsLines.slice(bIdx, bStart),
        aStartLine: aIdx + 1,
        bStartLine: bIdx + 1,
      });
    }

    regions.push({
      type: "changed",
      aLines: oursLines.slice(aStart, aEnd),
      bLines: theirsLines.slice(bStart, bEnd),
      aStartLine: aStart + 1,
      bStartLine: bStart + 1,
    });

    aIdx = aEnd;
    bIdx = bEnd;
  }

  if (aIdx < oursLines.length || bIdx < theirsLines.length) {
    regions.push({
      type: "unchanged",
      aLines: oursLines.slice(aIdx),
      bLines: theirsLines.slice(bIdx),
      aStartLine: aIdx + 1,
      bStartLine: bIdx + 1,
    });
  }

  // ── Base-relative boundary extension ────────────────────────
  // When both sides independently added the same "context" lines
  // around a change (e.g. empty lines), those lines appear unchanged
  // between ours and theirs.  By comparing against the base we can
  // detect them and fold them into the changed region so that
  // unchecking both sides gives the clean base content.
  if (base !== undefined) {
    const baseText = Text.of(base.split("\n"));
    const baseOursChunks = Chunk.build(baseText, oursText);

    // Collect 0-indexed ours line numbers that are "new" relative to base
    const newInOurs = new Set<number>();
    for (const c of baseOursChunks) {
      if (c.fromB < c.toB) {
        const startLine = oursText.lineAt(c.fromB).number - 1;
        const endLine = oursText.lineAt(c.endB).number - 1;
        for (let ln = startLine; ln <= endLine; ln++) {
          newInOurs.add(ln);
        }
      }
    }

    for (let i = 0; i < regions.length; i++) {
      if (regions[i].type !== "changed") continue;

      // Absorb trailing "new" lines from the preceding unchanged region
      if (i > 0 && regions[i - 1].type === "unchanged") {
        const prev = regions[i - 1];
        let moveCount = 0;
        for (let j = prev.aLines.length - 1; j >= 0; j--) {
          if (newInOurs.has(prev.aStartLine - 1 + j)) {
            moveCount++;
          } else {
            break;
          }
        }
        if (moveCount > 0) {
          const movedA = prev.aLines.splice(-moveCount);
          const movedB = prev.bLines.splice(-moveCount);
          regions[i].aLines.unshift(...movedA);
          regions[i].bLines.unshift(...movedB);
          regions[i].aStartLine -= moveCount;
          regions[i].bStartLine -= moveCount;
        }
      }

      // Absorb leading "new" lines from the following unchanged region
      if (i + 1 < regions.length && regions[i + 1].type === "unchanged") {
        const next = regions[i + 1];
        let moveCount = 0;
        for (let j = 0; j < next.aLines.length; j++) {
          if (newInOurs.has(next.aStartLine - 1 + j)) {
            moveCount++;
          } else {
            break;
          }
        }
        if (moveCount > 0) {
          const movedA = next.aLines.splice(0, moveCount);
          const movedB = next.bLines.splice(0, moveCount);
          regions[i].aLines.push(...movedA);
          regions[i].bLines.push(...movedB);
          next.aStartLine += moveCount;
          next.bStartLine += moveCount;
        }
      }
    }

    // Remove unchanged regions that became empty after absorption
    regions = regions.filter(
      (r) => r.type !== "unchanged" || r.aLines.length > 0,
    );
  }

  return regions;
}

// ── helpers for emitting lines in order ──────────────────────

function emitOursLines(
  region: DiffRegion,
  sel: ChunkSelection,
  regionIndex: number,
  out: string[],
  sources: LineSource[] | null,
  mappings: (OutputLineMapping | null)[] | null,
) {
  for (let j = 0; j < region.aLines.length; j++) {
    if (sel.oursLines.has(j)) {
      out.push(region.aLines[j]);
      sources?.push("ours");
      mappings?.push({ regionIndex, side: "ours", lineIndex: j });
    }
  }
}

function emitTheirsLines(
  region: DiffRegion,
  sel: ChunkSelection,
  regionIndex: number,
  out: string[],
  sources: LineSource[] | null,
  mappings: (OutputLineMapping | null)[] | null,
) {
  for (let j = 0; j < region.bLines.length; j++) {
    if (sel.theirsLines.has(j)) {
      out.push(region.bLines[j]);
      sources?.push("theirs");
      mappings?.push({ regionIndex, side: "theirs", lineIndex: j });
    }
  }
}

/**
 * Build output text from regions and per-chunk selections.
 * Respects the `order` field so the side selected first appears first.
 */
export function buildOutputFromSelections(
  regions: DiffRegion[],
  selections: Map<number, ChunkSelection>,
): string {
  return buildOutputWithSources(regions, selections).text;
}

/**
 * Build output text AND a per-line source map for coloring the output pane.
 * Also returns a reverse mapping from each output line to its origin.
 */
export function buildOutputWithSources(
  regions: DiffRegion[],
  selections: Map<number, ChunkSelection>,
): { text: string; sources: LineSource[]; mappings: (OutputLineMapping | null)[] } {
  const output: string[] = [];
  const sources: LineSource[] = [];
  const mappings: (OutputLineMapping | null)[] = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region.type === "unchanged") {
      for (const line of region.aLines) {
        output.push(line);
        sources.push("unchanged");
        mappings.push(null);
      }
    } else {
      const sel = selections.get(i);
      if (!sel) {
        // Default: include all ours lines
        for (let j = 0; j < region.aLines.length; j++) {
          output.push(region.aLines[j]);
          sources.push("ours");
          mappings.push({ regionIndex: i, side: "ours", lineIndex: j });
        }
      } else if (sel.order === "ours-first") {
        emitOursLines(region, sel, i, output, sources, mappings);
        emitTheirsLines(region, sel, i, output, sources, mappings);
      } else {
        emitTheirsLines(region, sel, i, output, sources, mappings);
        emitOursLines(region, sel, i, output, sources, mappings);
      }
    }
  }

  return { text: output.join("\n"), sources, mappings };
}

/** Create a selection with all ours lines selected. */
export function selectAllOurs(region: DiffRegion): ChunkSelection {
  return {
    oursLines: new Set(region.aLines.map((_, i) => i)),
    theirsLines: new Set(),
    order: "ours-first",
  };
}

/** Create a selection with all theirs lines selected. */
export function selectAllTheirs(region: DiffRegion): ChunkSelection {
  return {
    oursLines: new Set(),
    theirsLines: new Set(region.bLines.map((_, i) => i)),
    order: "theirs-first",
  };
}

/** Create a selection with both sides selected (ours first). */
export function selectBoth(region: DiffRegion): ChunkSelection {
  return {
    oursLines: new Set(region.aLines.map((_, i) => i)),
    theirsLines: new Set(region.bLines.map((_, i) => i)),
    order: "ours-first",
  };
}

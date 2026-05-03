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
  /**
   * For auto-resolved regions (one-sided changes reclassified as unchanged):
   * which side's content to use in the output. When unset, aLines is used
   * (standard unchanged behavior).
   */
  autoSide?: "ours" | "theirs";
  /** Common ancestor lines for this changed region (diff3-style context). */
  baseLines?: string[];
  /** 1-based starting line number in the base document. */
  baseStartLine?: number;
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
 * When `base` (common ancestor) is provided, uses 3-way classification:
 * changes made by only one side are auto-resolved (not shown as conflicts),
 * only changes where both sides modified the same region are true conflicts.
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

  // ── Refine changed regions ───────────────────────────────────
  regions = refineChangedRegions(regions);

  // ── 3-way classification ─────────────────────────────────────
  // Attach base lines first so classify3Way can compare regions against
  // the ancestor. Run classify3Way BEFORE coalescing so auto-resolved
  // regions aren't absorbed into neighboring conflicts.
  if (base !== undefined) {
    attachBaseLines(regions, base, ours);
    regions = classify3Way(regions);
  }

  regions = coalesceFragments(regions);

  return regions;
}

/**
 * Auto-resolve regions where only one side changed from the ancestor.
 *
 * 1. Pure insertions (0 lines on one side) → auto-resolve to the side
 *    with content.
 * 2. Region-level base comparison: if baseLines matches one side exactly,
 *    only the other side changed → auto-resolve to the changed side.
 *    This is safe because it requires the ENTIRE region to match (unlike
 *    the per-line approach which false-matched on individual lines).
 */
function classify3Way(
  regions: DiffRegion[],
): DiffRegion[] {
  const result: DiffRegion[] = [];
  for (const region of regions) {
    if (region.type !== "changed") {
      result.push(region);
      continue;
    }

    if (region.aLines.length === 0 && region.bLines.length > 0) {
      result.push({ ...region, type: "unchanged", autoSide: "theirs" });
    } else if (region.bLines.length === 0 && region.aLines.length > 0) {
      result.push({ ...region, type: "unchanged", autoSide: "ours" });
    } else if (region.baseLines) {
      const baseContent = region.baseLines.join("\n");
      const oursContent = region.aLines.join("\n");
      const theirsContent = region.bLines.join("\n");

      if (baseContent === oursContent) {
        result.push({ ...region, type: "unchanged", autoSide: "theirs" });
      } else if (baseContent === theirsContent) {
        result.push({ ...region, type: "unchanged", autoSide: "ours" });
      } else {
        result.push(region);
      }
    } else {
      result.push(region);
    }
  }

  return result;
}

/**
 * Attach base (ancestor) lines to each remaining changed region by diffing
 * base vs ours and mapping ours line ranges back to the corresponding base
 * line ranges. Mutates regions in place.
 */
function attachBaseLines(
  regions: DiffRegion[],
  base: string,
  ours: string,
): void {
  const baseLineArr = base.split("\n");
  const oursLineArr = ours.split("\n");
  const baseDoc = Text.of(baseLineArr);
  const oursDoc = Text.of(oursLineArr);
  const chunks = Chunk.build(baseDoc, oursDoc);

  interface Segment {
    baseStart: number; // 0-based inclusive
    baseEnd: number; // 0-based exclusive
    oursStart: number;
    oursEnd: number;
    changed: boolean;
  }

  const segments: Segment[] = [];
  let bIdx = 0;
  let oIdx = 0;

  for (const chunk of chunks) {
    const hasBase = chunk.fromA < chunk.toA;
    const hasOurs = chunk.fromB < chunk.toB;
    const bStart = baseDoc.lineAt(chunk.fromA).number - 1;
    const bEnd = hasBase ? baseDoc.lineAt(chunk.endA).number : bStart;
    const oStart = oursDoc.lineAt(chunk.fromB).number - 1;
    const oEnd = hasOurs ? oursDoc.lineAt(chunk.endB).number : oStart;

    if (bIdx < bStart) {
      segments.push({
        baseStart: bIdx, baseEnd: bStart,
        oursStart: oIdx, oursEnd: oStart,
        changed: false,
      });
    }
    segments.push({
      baseStart: bStart, baseEnd: bEnd,
      oursStart: oStart, oursEnd: oEnd,
      changed: true,
    });
    bIdx = bEnd;
    oIdx = oEnd;
  }

  if (bIdx < baseLineArr.length || oIdx < oursLineArr.length) {
    segments.push({
      baseStart: bIdx, baseEnd: baseLineArr.length,
      oursStart: oIdx, oursEnd: oursLineArr.length,
      changed: false,
    });
  }

  for (const region of regions) {
    if (region.type !== "changed") continue;

    const qStart = region.aStartLine - 1;
    const qEnd = qStart + region.aLines.length;

    let minBase = Infinity;
    let maxBase = -Infinity;

    for (const seg of segments) {
      if (seg.oursEnd <= qStart || seg.oursStart >= qEnd) continue;

      if (!seg.changed) {
        const offset = Math.max(0, qStart - seg.oursStart);
        const end = Math.min(seg.oursEnd, qEnd) - seg.oursStart;
        minBase = Math.min(minBase, seg.baseStart + offset);
        maxBase = Math.max(maxBase, seg.baseStart + end);
      } else {
        minBase = Math.min(minBase, seg.baseStart);
        maxBase = Math.max(maxBase, seg.baseEnd);
      }
    }

    if (minBase !== Infinity) {
      region.baseLines = baseLineArr.slice(minBase, maxBase);
      region.baseStartLine = minBase + 1;
    }
  }
}


/**
 * Split oversized changed regions by finding identical lines within them.
 * Runs an inner diff on each changed region's aLines vs bLines and extracts
 * matching lines as unchanged sub-regions. Then coalesces fragments where
 * one side has 0 lines back into the nearest real conflict group.
 */
function refineChangedRegions(regions: DiffRegion[]): DiffRegion[] {
  const result: DiffRegion[] = [];

  for (const region of regions) {
    if (region.type !== "changed" || region.aLines.length === 0 || region.bLines.length === 0) {
      result.push(region);
      continue;
    }

    const aText = Text.of(region.aLines);
    const bText = Text.of(region.bLines);
    const innerChunks = Chunk.build(aText, bText);

    if (innerChunks.length === 0) {
      result.push({
        type: "unchanged",
        aLines: region.aLines,
        bLines: region.bLines,
        aStartLine: region.aStartLine,
        bStartLine: region.bStartLine,
      });
      continue;
    }

    const subRegions: DiffRegion[] = [];
    let aIdx = 0;
    let bIdx = 0;

    for (const chunk of innerChunks) {
      const hasA = chunk.fromA < chunk.toA;
      const hasB = chunk.fromB < chunk.toB;
      const aStart = aText.lineAt(chunk.fromA).number - 1;
      const aEnd = hasA ? aText.lineAt(chunk.endA).number : aStart;
      const bStart = bText.lineAt(chunk.fromB).number - 1;
      const bEnd = hasB ? bText.lineAt(chunk.endB).number : bStart;

      if (aIdx < aStart) {
        subRegions.push({
          type: "unchanged",
          aLines: region.aLines.slice(aIdx, aStart),
          bLines: region.bLines.slice(bIdx, bStart),
          aStartLine: region.aStartLine + aIdx,
          bStartLine: region.bStartLine + bIdx,
        });
      }

      subRegions.push({
        type: "changed",
        aLines: region.aLines.slice(aStart, aEnd),
        bLines: region.bLines.slice(bStart, bEnd),
        aStartLine: region.aStartLine + aStart,
        bStartLine: region.bStartLine + bStart,
      });

      aIdx = aEnd;
      bIdx = bEnd;
    }

    if (aIdx < region.aLines.length || bIdx < region.bLines.length) {
      subRegions.push({
        type: "unchanged",
        aLines: region.aLines.slice(aIdx),
        bLines: region.bLines.slice(bIdx),
        aStartLine: region.aStartLine + aIdx,
        bStartLine: region.bStartLine + bIdx,
      });
    }

    result.push(...coalesceFragments(subRegions));
  }

  return result;
}

/**
 * Merge changed sub-regions that have 0 lines on one side (pure
 * insertion/deletion) into the nearest changed region that has content
 * on both sides, absorbing any small unchanged gaps in between.
 * Only keeps an unchanged separator when both adjacent changed regions
 * have content on both sides.
 */
function coalesceFragments(subRegions: DiffRegion[]): DiffRegion[] {
  const regions = [...subRegions];
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      if (r.type !== "changed") continue;
      if (r.aLines.length > 0 && r.bLines.length > 0) continue;

      // Try merging forward: absorb unchanged gap + next changed
      if (
        i + 2 < regions.length &&
        regions[i + 1].type === "unchanged" &&
        regions[i + 2].type === "changed"
      ) {
        const gap = regions[i + 1];
        const next = regions[i + 2];
        r.aLines.push(...gap.aLines, ...next.aLines);
        r.bLines.push(...gap.bLines, ...next.bLines);
        regions.splice(i + 1, 2);
        merged = true;
        break;
      }

      // Try merging backward: absorb into prev changed + unchanged gap
      if (
        i >= 2 &&
        regions[i - 1].type === "unchanged" &&
        regions[i - 2].type === "changed"
      ) {
        const gap = regions[i - 1];
        const prev = regions[i - 2];
        prev.aLines.push(...gap.aLines, ...r.aLines);
        prev.bLines.push(...gap.bLines, ...r.bLines);
        regions.splice(i - 1, 2);
        merged = true;
        break;
      }

      // Adjacent changed without gap
      if (i + 1 < regions.length && regions[i + 1].type === "changed") {
        r.aLines.push(...regions[i + 1].aLines);
        r.bLines.push(...regions[i + 1].bLines);
        regions.splice(i + 1, 1);
        merged = true;
        break;
      }
      if (i > 0 && regions[i - 1].type === "changed") {
        regions[i - 1].aLines.push(...r.aLines);
        regions[i - 1].bLines.push(...r.bLines);
        regions.splice(i, 1);
        merged = true;
        break;
      }
    }
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
      // For auto-resolved regions, use the correct side's content
      const lines = region.autoSide === "theirs" ? region.bLines : region.aLines;
      for (const line of lines) {
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EditorView,
  keymap,
  Decoration,
  type DecorationSet,
  lineNumbers,
  gutter,
  GutterMarker,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  StateField,
  StateEffect,
  type Range,
} from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { prefetchDarkTheme } from "@/lib/codemirror-theme";
import { getLanguageExtension } from "@/lib/codemirror-lang";
import { highlightLines, detectLang } from "@/lib/shiki";
import {
  computeDiffRegions,
  buildOutputWithSources,
  selectAllOurs,
  selectAllTheirs,
  type ChunkSelection,
  type DiffRegion,
  type LineSource,
  type OutputLineMapping,
} from "@/lib/conflict-regions";
import { useRepoStore } from "@/stores/repo-store";
import { Check, GitCompare, Minus, Plus, RotateCcw, Save } from "lucide-react";
import type { ThemedToken } from "shiki";

// ── CodeMirror annotations + compartments ───────────────────

/** Marks a transaction as programmatic so the updateListener doesn't set manuallyEdited. */
const isSyncAnnotation = Annotation.define<boolean>();

/** Toggles the `cm-manually-edited` class on the editor element. */
const manualEditedCompartment = new Compartment();

// ── CodeMirror line-source decorations ───────────────────────

const setLineSourcesEffect = StateEffect.define<LineSource[]>();

/** Adds decorations for specific lines without resetting the entire set. */
const addLineDecosEffect = StateEffect.define<
  { lineNo: number; cls: string }[]
>();

function buildDecorationsFromSources(
  sources: LineSource[],
  doc: { lines: number; line: (n: number) => { from: number } },
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  for (let i = 0; i < Math.min(sources.length, doc.lines); i++) {
    const line = doc.line(i + 1);
    const cls =
      sources[i] === "ours"
        ? "cm-output-ours"
        : sources[i] === "theirs"
          ? "cm-output-theirs"
          : "cm-output-unchanged";
    decorations.push(Decoration.line({ class: cls }).range(line.from));
  }
  return Decoration.set(decorations);
}

// ── Reference doc (last programmatic output) ──────────────────
// Stores the content and source of each line from the most recent sync.
// Used by the manual-edit detection to decide whether a "new" line
// (e.g. re-added after deletion) actually matches the reference and
// should keep its original decoration instead of being marked "edited".

interface ReferenceLineEntry {
  text: string;
  source: LineSource;
}

const referenceDocField = StateField.define<ReferenceLineEntry[]>({
  create() {
    return [];
  },
  update(value, tr) {
    // Rebuild on any sync change (programmatic insert/remove or full replace)
    // OR when setLineSourcesEffect is dispatched (initial setup, full sync).
    const isSync = tr.annotation(isSyncAnnotation);
    let hasSourcesEffect = false;
    for (const effect of tr.effects) {
      if (effect.is(setLineSourcesEffect) || effect.is(setGutterSourcesEffect)) {
        hasSourcesEffect = true;
        break;
      }
    }
    if ((tr.docChanged && isSync) || hasSourcesEffect) {
      const doc = tr.state.doc;
      const sources = tr.state.field(gutterSourcesField);
      const ref: ReferenceLineEntry[] = [];
      for (let i = 1; i <= doc.lines; i++) {
        ref.push({
          text: doc.line(i).text,
          source: sources[i - 1] ?? "unchanged",
        });
      }
      return ref;
    }
    return value;
  },
});

const lineSourceField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLineSourcesEffect)) {
        return buildDecorationsFromSources(effect.value, tr.state.doc);
      }
    }
    if (tr.docChanged) {
      const isSync = tr.annotation(isSyncAnnotation);

      // ── Sync (programmatic) changes ────────────────────────────
      // Map existing decorations through changes, then overlay any
      // addLineDecosEffect entries. We must FILTER mapped decorations
      // at positions covered by the effect — Decoration.map() can
      // incorrectly keep them at the insertion point instead of
      // shifting them to the new line.
      if (isSync) {
        const mapped = value.map(tr.changes);
        let hasAddEffect = false;
        for (const effect of tr.effects) {
          if (effect.is(addLineDecosEffect)) {
            hasAddEffect = true;
            break;
          }
        }
        if (!hasAddEffect) return mapped;

        // Collect positions that will get new decorations
        const overrideFroms = new Set<number>();
        for (const effect of tr.effects) {
          if (effect.is(addLineDecosEffect)) {
            for (const { lineNo } of effect.value) {
              if (lineNo >= 1 && lineNo <= tr.state.doc.lines) {
                overrideFroms.add(tr.state.doc.line(lineNo).from);
              }
            }
          }
        }

        // Keep mapped decorations EXCEPT at overridden positions
        const ranges: Range<Decoration>[] = [];
        const cursor = mapped.iter();
        while (cursor.value) {
          if (!overrideFroms.has(cursor.from)) {
            ranges.push(cursor.value.range(cursor.from));
          }
          cursor.next();
        }
        // Add the authoritative decorations for tracked lines
        for (const effect of tr.effects) {
          if (effect.is(addLineDecosEffect)) {
            for (const { lineNo, cls } of effect.value) {
              if (lineNo >= 1 && lineNo <= tr.state.doc.lines) {
                ranges.push(
                  Decoration.line({ class: cls }).range(
                    tr.state.doc.line(lineNo).from,
                  ),
                );
              }
            }
          }
        }
        return Decoration.set(ranges, true);
      }

      // ── Manual edits ──────────────────────────────────────────
      // Compare each old line's content at its mapped position in the
      // new doc.  Lines with identical content keep their decoration;
      // changed or newly-created lines get "cm-output-edited".
      const mapped = value.map(tr.changes);
      const oldDoc = tr.startState.doc;
      const newDoc = tr.state.doc;

      // Map old lines → new positions, check content equality.
      // Use bias -1 for empty lines to match Decoration.map()'s behavior
      // (line decorations use startSide < 0 → bias -1).  This ensures the
      // ORIGINAL empty line is marked unchanged — not the newly inserted
      // one — so that genuinely new empty lines still get editedDeco.
      const unchangedFroms = new Set<number>();
      for (let i = 1; i <= oldDoc.lines; i++) {
        const oldPos = oldDoc.line(i).from;
        const oldText = oldDoc.line(i).text;
        const bias = oldText.length === 0 ? -1 : 1;
        try {
          const newPos = tr.changes.mapPos(oldPos, bias);
          const newLine = newDoc.lineAt(newPos);
          if (newLine.text === oldText) {
            unchangedFroms.add(newLine.from);
          }
        } catch { /* out of range */ }
      }

      const editedDeco = Decoration.line({ class: "cm-output-edited" });
      const kept: Range<Decoration>[] = [];
      const decoratedFroms = new Set<number>();

      const cursor = mapped.iter();
      while (cursor.value) {
        decoratedFroms.add(cursor.from);
        if (unchangedFroms.has(cursor.from)) {
          // Content unchanged — keep original decoration
          kept.push(cursor.value.range(cursor.from));
        } else {
          // Content changed — replace with "edited"
          kept.push(editedDeco.range(cursor.from));
        }
        cursor.next();
      }

      // Any line without a decoration that isn't unchanged → check against
      // the reference doc (last programmatic output) before marking "edited".
      // Only use reference matching when the doc hasn't grown beyond the
      // reference size (no net insertions). This prevents false positional
      // matches when the user inserts new lines.
      //
      // Only restore "unchanged" decorations from the reference — never
      // "ours"/"theirs".  Those are checkbox-owned and should not be
      // inferred from content matching alone (empty lines trivially match
      // any other empty line, leading to false ours/theirs restoration).
      const ref = tr.state.field(referenceDocField);
      const canMatchRef = ref.length > 0 && newDoc.lines <= ref.length;
      for (let i = 1; i <= newDoc.lines; i++) {
        const from = newDoc.line(i).from;
        if (!unchangedFroms.has(from) && !decoratedFroms.has(from)) {
          const refIdx = i - 1;
          if (
            canMatchRef &&
            refIdx < ref.length &&
            ref[refIdx].source === "unchanged" &&
            newDoc.line(i).text === ref[refIdx].text
          ) {
            kept.push(
              Decoration.line({ class: "cm-output-unchanged" }).range(from),
            );
          } else {
            kept.push(editedDeco.range(from));
          }
        }
      }

      return Decoration.set(kept, true);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Empty line indicator ────────────────────────────────────

/** Shows a faint "↵" on empty lines so they're visually distinguishable
 *  from inter-line spacing (matches the indicator in ours/theirs panes). */
class EmptyLineWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "↵";
    span.className = "cm-empty-line-indicator";
    return span;
  }
  eq() {
    return true;
  }
}

const emptyLineWidget = Decoration.widget({
  widget: new EmptyLineWidget(),
  side: 1,
});

function buildEmptyLineDecos(doc: {
  lines: number;
  line: (n: number) => { from: number; text: string };
}): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.length === 0) {
      ranges.push(emptyLineWidget.range(line.from));
    }
  }
  return Decoration.set(ranges);
}

const emptyLineIndicator = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildEmptyLineDecos(view.state.doc);
    }
    update(update: { docChanged: boolean; view: EditorView }) {
      if (update.docChanged) {
        this.decorations = buildEmptyLineDecos(update.view.state.doc);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Gutter: source icons + remove buttons ───────────────────

/** Dispatched by gutter click → picked up by updateListener in React */
const removeOutputLineEffect = StateEffect.define<number>();

/** Stores line sources for the gutter to read */
const setGutterSourcesEffect = StateEffect.define<LineSource[]>();

const gutterSourcesField = StateField.define<LineSource[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGutterSourcesEffect)) return effect.value;
    }
    if (tr.docChanged) {
      // For sync (programmatic) changes: trust the explicit effect dispatch
      if (tr.annotation(isSyncAnnotation)) return value;

      // Content comparison: only reset sources for lines whose text changed.
      // Matches the approach used by trackedLineInfoField and lineSourceField.
      const oldDoc = tr.startState.doc;
      const newDoc = tr.state.doc;

      const newSources: LineSource[] = new Array(newDoc.lines).fill("unchanged");
      for (let i = 0; i < Math.min(value.length, oldDoc.lines); i++) {
        if (value[i] === "unchanged") continue;
        const oldPos = oldDoc.line(i + 1).from;
        // Use bias -1 for empty lines so the gutter source stays on the
        // original line when Enter splits an empty line.
        const oldText = oldDoc.line(i + 1).text;
        const bias = oldText.length === 0 ? -1 : 1;
        try {
          const newPos = tr.changes.mapPos(oldPos, bias);
          const newLine = newDoc.lineAt(newPos);
          if (newLine.text === oldText) {
            newSources[newLine.number - 1] = value[i];
          }
        } catch {
          // position out of range — ignore
        }
      }
      return newSources;
    }
    return value;
  },
});

// ── Tracked line info (maps editor lines → checkbox source) ────

interface TrackedLineInfo {
  regionIndex: number;
  side: "ours" | "theirs";
  lineIndex: number;
}

const setTrackedInfoEffect = StateEffect.define<(TrackedLineInfo | null)[]>();

/**
 * Tracks which editor lines are "owned" by checkboxes.
 * Auto-remaps through edits: edited lines become null (untracked),
 * unmodified lines keep their tracking info at shifted positions.
 */
const trackedLineInfoField = StateField.define<(TrackedLineInfo | null)[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTrackedInfoEffect)) return effect.value;
    }
    if (tr.docChanged) {
      // For sync (programmatic) changes: trust the explicit setTrackedInfoEffect
      if (tr.annotation(isSyncAnnotation)) return value;

      // Content comparison: only null tracked entries whose text actually changed.
      // iterChangedRanges can false-positive on boundary edits (e.g. Enter at
      // end of adjacent line marks the tracked line as modified even though its
      // content is identical).
      const oldDoc = tr.startState.doc;
      const newDoc = tr.state.doc;
      const result: (TrackedLineInfo | null)[] = new Array(newDoc.lines).fill(null);
      for (let i = 0; i < Math.min(value.length, oldDoc.lines); i++) {
        if (!value[i]) continue;
        const oldPos = oldDoc.line(i + 1).from;
        // Use bias -1 for empty lines so that pressing Enter on an empty
        // tracked line keeps the tracked info on the original line instead
        // of shifting it to the newly inserted line below.
        const oldText = oldDoc.line(i + 1).text;
        const bias = oldText.length === 0 ? -1 : 1;
        try {
          const newPos = tr.changes.mapPos(oldPos, bias);
          const newLine = newDoc.lineAt(newPos);
          if (newLine.text === oldText) {
            result[newLine.number - 1] = value[i];
          }
        } catch { /* out of range */ }
      }
      return result;
    }
    return value;
  },
});

/** Build tracked info array from output mappings. */
function buildTrackedInfo(
  mappings: (OutputLineMapping | null)[],
): (TrackedLineInfo | null)[] {
  return mappings.map((m) =>
    m
      ? { regionIndex: m.regionIndex, side: m.side, lineIndex: m.lineIndex }
      : null,
  );
}

// ── Region position tracking ─────────────────────────────────

/**
 * Stores a document position (char offset) for each changed region.
 * Automatically maps positions through manual edits so we always know
 * where to insert lines for a region — even when all its tracked entries
 * have been removed (all checkboxes unchecked).
 */
const setRegionPositionsEffect = StateEffect.define<Map<number, number>>();

const regionPositionsField = StateField.define<Map<number, number>>({
  create() {
    return new Map();
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRegionPositionsEffect)) return effect.value;
    }
    if (tr.docChanged) {
      const newMap = new Map<number, number>();
      for (const [regionIdx, pos] of value) {
        // assoc = -1: position stays at the start of the region when text
        // is inserted right at this position (the region "owns" the position).
        newMap.set(regionIdx, tr.changes.mapPos(pos, -1));
      }
      return newMap;
    }
    return value;
  },
});

/**
 * Compute the document position where each changed region starts in the output.
 * Uses the actual output text to determine line start positions, then walks
 * through regions counting how many lines each contributes.
 *
 * For regions with 0 selected lines, the position is the start of the next
 * content (or text length if at end) — i.e. where their content WOULD appear.
 */
function computeRegionPositions(
  text: string,
  regions: DiffRegion[],
  selections: Map<number, ChunkSelection>,
): Map<number, number> {
  const positions = new Map<number, number>();

  // Build line-start offsets from the text
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  let lineIdx = 0; // 0-based line index into lineStarts

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];

    if (region.type === "changed") {
      positions.set(
        ri,
        lineIdx < lineStarts.length ? lineStarts[lineIdx] : text.length,
      );
    }

    // Count how many output lines this region contributes
    if (region.type === "unchanged") {
      lineIdx += region.aLines.length;
    } else {
      const sel = selections.get(ri);
      const oursCount = sel ? sel.oursLines.size : region.aLines.length;
      const theirsCount = sel ? sel.theirsLines.size : 0;
      lineIdx += oursCount + theirsCount;
    }
  }

  return positions;
}

// ── Surgical edit helpers ──────────────────────────────────────

/**
 * Surgically remove tracked lines from the editor without touching manual edits.
 */
function surgicalRemove(
  view: EditorView,
  regionIndex: number,
  side: "ours" | "theirs",
  lineIndices: number[],
): void {
  const tracked = view.state.field(trackedLineInfoField);
  const sources = view.state.field(gutterSourcesField);
  const idxSet = new Set(lineIndices);

  // Find 0-based tracked-array indices to remove
  const removeIdxs: number[] = [];
  for (let i = 0; i < tracked.length; i++) {
    const info = tracked[i];
    if (
      info &&
      info.regionIndex === regionIndex &&
      info.side === side &&
      idxSet.has(info.lineIndex)
    ) {
      removeIdxs.push(i);
    }
  }
  if (removeIdxs.length === 0) return;

  // Build doc changes (bottom-to-top so positions don't shift).
  // Prefer trailing newline over preceding newline: this preserves the
  // content BEFORE the removed line (including empty lines) so that the
  // regionPositionsField maps through the deletion correctly.
  const changes: { from: number; to: number }[] = [];
  for (const idx of [...removeIdxs].reverse()) {
    const lineNo = idx + 1;
    const line = view.state.doc.line(lineNo);
    let from = line.from;
    let to = line.to;
    if (to < view.state.doc.length) to += 1; // include trailing newline
    else if (lineNo > 1) from -= 1; // last line: include preceding newline
    changes.push({ from, to });
  }

  // Filter out removed entries from tracked + sources, remembering the
  // original (old) line index so we can look up existing decorations.
  const removeSet = new Set(removeIdxs);
  const newTracked: (TrackedLineInfo | null)[] = [];
  const newSources: LineSource[] = [];
  const oldLineNos: number[] = []; // oldLineNos[i] = old 1-based line no for newTracked[i]
  for (let i = 0; i < tracked.length; i++) {
    if (!removeSet.has(i)) {
      newTracked.push(tracked[i]);
      newSources.push(sources[i] ?? "unchanged");
      oldLineNos.push(i + 1);
    }
  }

  // Build a map of old-line-number → decoration class from the current
  // lineSourceField so we can preserve "cm-output-edited" on manual edits.
  const currentDecos = view.state.field(lineSourceField);
  const oldLineClasses = new Map<number, string>();
  const decoIter = currentDecos.iter();
  while (decoIter.value) {
    const lineNum = view.state.doc.lineAt(decoIter.from).number;
    const cls = (decoIter.value.spec as Record<string, string>)?.class;
    if (cls) oldLineClasses.set(lineNum, cls);
    decoIter.next();
  }

  // Build decoration overrides for ALL remaining lines.
  // • Tracked lines get their authoritative ours/theirs class.
  // • Non-tracked lines preserve their existing class (unchanged or edited)
  //   so that manually-edited highlights survive, while leaked decorations
  //   from Decoration.map() are replaced.
  const allLineDecos: { lineNo: number; cls: string }[] = [];
  for (let i = 0; i < newTracked.length; i++) {
    const info = newTracked[i];
    if (info) {
      allLineDecos.push({
        lineNo: i + 1,
        cls: info.side === "ours" ? "cm-output-ours" : "cm-output-theirs",
      });
    } else {
      const existingCls = oldLineClasses.get(oldLineNos[i]) ?? "cm-output-unchanged";
      allLineDecos.push({ lineNo: i + 1, cls: existingCls });
    }
  }

  view.dispatch({
    changes,
    effects: [
      setTrackedInfoEffect.of(newTracked),
      addLineDecosEffect.of(allLineDecos),
      setGutterSourcesEffect.of(newSources),
    ],
    annotations: isSyncAnnotation.of(true),
  });
}

/**
 * Surgically insert checkbox-owned lines into the editor at the correct position,
 * preserving manual edits elsewhere.
 */
function surgicalInsert(
  view: EditorView,
  regionIndex: number,
  side: "ours" | "theirs",
  lineIndices: number[],
  lineTexts: string[],
  order: "ours-first" | "theirs-first",
): void {
  if (lineIndices.length === 0) return;

  const tracked = view.state.field(trackedLineInfoField);
  const sources = view.state.field(gutterSourcesField);
  const firstSide = order === "ours-first" ? "ours" : "theirs";

  // Find insertion position using TWO anchors:
  //   insertAfterIdx  — last tracked-array index we should appear AFTER
  //   insertBeforeIdx — first tracked-array index we should appear BEFORE
  // The "before" anchor is needed for the case where we're the first-side
  // and only second-side entries exist in this region (e.g. re-checking ours
  // when theirs is already present and manual edits shifted lines down).
  let insertAfterIdx = -1;
  let insertBeforeIdx = -1;

  for (let i = 0; i < tracked.length; i++) {
    const info = tracked[i];
    if (!info) continue;

    if (info.regionIndex < regionIndex) {
      insertAfterIdx = i;
    } else if (info.regionIndex === regionIndex) {
      if (info.side === side) {
        // Same side — insert after entries with smaller lineIndex, before larger
        if (info.lineIndex < lineIndices[0]) {
          insertAfterIdx = i;
        } else {
          insertBeforeIdx = i;
          break;
        }
      } else if (side === firstSide) {
        // We're first-side, they're second-side → insert BEFORE them
        insertBeforeIdx = i;
        break;
      } else {
        // We're second-side, they're first-side → insert AFTER them
        insertAfterIdx = i;
      }
    } else {
      // Later region — insert before it
      insertBeforeIdx = i;
      break;
    }
  }

  const insertText = lineTexts.join("\n");
  let insertPos: number;
  let prefix: string;
  let suffix: string;
  let spliceIdx: number;

  if (insertBeforeIdx !== -1) {
    // Insert right before this entry's editor line
    const line = view.state.doc.line(insertBeforeIdx + 1);
    insertPos = line.from;
    prefix = "";
    suffix = "\n";
    spliceIdx = insertBeforeIdx;
  } else if (insertAfterIdx !== -1) {
    // Insert right after this entry's editor line
    const line = view.state.doc.line(insertAfterIdx + 1);
    insertPos = line.to;
    prefix = "\n";
    suffix = "";
    spliceIdx = insertAfterIdx + 1;
  } else {
    // No tracked entries for this region — use stored region position
    const regionPositions = view.state.field(regionPositionsField);
    const storedPos = regionPositions.get(regionIndex);

    if (storedPos !== undefined && storedPos < view.state.doc.length) {
      // We have a remembered position in range.
      // After mapPos through deletions, storedPos may land at a line's `from`
      // (start) or somewhere in the middle/end of a line (its `to`).
      const targetLine = view.state.doc.lineAt(storedPos);
      if (storedPos === targetLine.from) {
        // Exactly at line start — insert before this line
        insertPos = targetLine.from;
        prefix = "";
        suffix = "\n";
        spliceIdx = targetLine.number - 1;
      } else {
        // Mid/end of a line — insert after this line
        insertPos = targetLine.to;
        prefix = "\n";
        suffix = "";
        spliceIdx = targetLine.number; // after this line in the tracked array
      }
    } else if (storedPos !== undefined && storedPos >= view.state.doc.length && view.state.doc.length > 0) {
      // Position is at or past end of document
      insertPos = view.state.doc.length;
      prefix = "\n";
      suffix = "";
      spliceIdx = tracked.length;
    } else {
      // No stored position at all — fallback to end of document
      insertPos = view.state.doc.length;
      prefix = view.state.doc.length > 0 ? "\n" : "";
      suffix = "";
      spliceIdx = tracked.length;
    }
  }

  // Build new tracked / sources with the new entries spliced in
  const newTracked = [...tracked];
  const newInfos: (TrackedLineInfo | null)[] = lineIndices.map((li) => ({
    regionIndex,
    side,
    lineIndex: li,
  }));
  newTracked.splice(spliceIdx, 0, ...newInfos);

  const newSources = [...sources];
  const srcEntries: LineSource[] = lineIndices.map(() => side as LineSource);
  newSources.splice(spliceIdx, 0, ...srcEntries);

  // Build a map of old-line-number → decoration class from the current
  // lineSourceField so we can preserve decorations on non-tracked lines.
  // Decoration.map() can misplace decorations at the insertion point, so
  // we must override ALL lines — not just tracked ones.
  const currentDecos = view.state.field(lineSourceField);
  const oldLineClasses = new Map<number, string>();
  const decoIter = currentDecos.iter();
  while (decoIter.value) {
    const lineNum = view.state.doc.lineAt(decoIter.from).number;
    const cls = (decoIter.value.spec as Record<string, string>)?.class;
    if (cls) oldLineClasses.set(lineNum, cls);
    decoIter.next();
  }

  const allLineDecos: { lineNo: number; cls: string }[] = [];
  const insertCount = lineIndices.length;
  for (let i = 0; i < newTracked.length; i++) {
    const info = newTracked[i];
    if (info) {
      allLineDecos.push({
        lineNo: i + 1,
        cls: info.side === "ours" ? "cm-output-ours" : "cm-output-theirs",
      });
    } else {
      // Non-tracked line — map back to old line number to preserve its class.
      // Lines before the splice point keep their 1-based line number.
      // Lines after the splice point had old line number shifted by insertCount.
      const oldLineNo = i < spliceIdx ? i + 1 : i + 1 - insertCount;
      const existingCls = oldLineClasses.get(oldLineNo) ?? "cm-output-unchanged";
      allLineDecos.push({ lineNo: i + 1, cls: existingCls });
    }
  }

  view.dispatch({
    changes: {
      from: insertPos,
      to: insertPos,
      insert: prefix + insertText + suffix,
    },
    effects: [
      setTrackedInfoEffect.of(newTracked),
      addLineDecosEffect.of(allLineDecos),
      setGutterSourcesEffect.of(newSources),
    ],
    annotations: isSyncAnnotation.of(true),
  });
}

// ── Gutter markers ─────────────────────────────────────────────

class OursMarker extends GutterMarker {
  elementClass = "cm-gutter-ours";
  eq(other: GutterMarker) {
    return other instanceof OursMarker;
  }
}

class TheirsMarker extends GutterMarker {
  elementClass = "cm-gutter-theirs";
  eq(other: GutterMarker) {
    return other instanceof TheirsMarker;
  }
}

class UnchangedMarker extends GutterMarker {
  elementClass = "cm-gutter-unchanged";
  eq(other: GutterMarker) {
    return other instanceof UnchangedMarker;
  }
}

const sourceGutter = gutter({
  class: "cm-source-gutter",
  lineMarker(view, line) {
    const sources = view.state.field(gutterSourcesField);
    const lineNo = view.state.doc.lineAt(line.from).number;
    const src = sources[lineNo - 1];
    if (src === "ours") return new OursMarker();
    if (src === "theirs") return new TheirsMarker();
    return new UnchangedMarker();
  },
  domEventHandlers: {
    click(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      // Only handle clicks on tracked (ours/theirs) lines
      const tracked = view.state.field(trackedLineInfoField);
      if (!tracked[lineNo - 1]) return false;
      view.dispatch({ effects: removeOutputLineEffect.of(lineNo) });
      return true;
    },
  },
});

// ── Source icons ────────────────────────────────────────────

function OursIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      className="shrink-0"
      style={{ display: "block" }}
    >
      <path
        d="M4 2.5L8 6l-4 3.5"
        stroke="rgba(59, 130, 246, 0.8)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TheirsIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      className="shrink-0"
      style={{ display: "block" }}
    >
      <path
        d="M8 2.5L4 6l4 3.5"
        stroke="rgba(168, 85, 247, 0.8)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────

interface ConflictEditorProps {
  filePath: string;
}

/** Wrapper that resets state when the file changes by re-keying. */
export function ConflictEditor({ filePath }: ConflictEditorProps) {
  return <ConflictEditorInner key={filePath} filePath={filePath} />;
}

function ConflictEditorInner({ filePath }: ConflictEditorProps) {
  const conflictContents = useRepoStore((s) => s.conflictContents);
  const resolveConflictManual = useRepoStore((s) => s.resolveConflictManual);
  const loadConflictContents = useRepoStore((s) => s.loadConflictContents);
  const rebaseProgress = useRepoStore((s) => s.rebaseProgress);
  const conflictState = useRepoStore((s) => s.conflictState);

  const [saving, setSaving] = useState(false);
  const [selections, setSelections] = useState<Map<number, ChunkSelection>>(
    new Map(),
  );
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // ── Resizable split state ──────────────────────────────────
  const [hSplit, setHSplit] = useState(50); // ours/theirs horizontal %
  const [vSplit, setVSplit] = useState(60); // reference/output vertical %
  const refPanesRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConflictContents(filePath);
  }, [filePath, loadConflictContents]);

  // ── Diff regions ───────────────────────────────────────────

  const regions = useMemo(() => {
    if (!conflictContents) return [];
    return computeDiffRegions(
      conflictContents.ours,
      conflictContents.theirs,
      conflictContents.base ?? undefined,
    );
  }, [conflictContents]);

  const changedChunkIndices = useMemo(
    () =>
      regions
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.type === "changed")
        .map(({ i }) => i),
    [regions],
  );

  // ── Output assembly ────────────────────────────────────────

  const {
    text: outputText,
    sources: outputSources,
    mappings: outputMappings,
  } = useMemo(
    () => buildOutputWithSources(regions, selections),
    [regions, selections],
  );

  // Ref bridges for CodeMirror callbacks → React state (updated in effects, read in event handlers)
  const regionsRef = useRef(regions);
  const toggleLineRef = useRef<
    (regionIndex: number, side: "ours" | "theirs", lineIndex: number) => void
  >(() => {});

  // ── Syntax highlighting ────────────────────────────────────

  const lang = useMemo(() => detectLang(filePath), [filePath]);
  const [oursTokens, setOursTokens] = useState<ThemedToken[][] | null>(null);
  const [theirsTokens, setTheirsTokens] = useState<ThemedToken[][] | null>(
    null,
  );

  useEffect(() => {
    if (!conflictContents) return;
    let cancelled = false;
    async function highlight() {
      try {
        const [ot, tt] = await Promise.all([
          highlightLines(conflictContents!.ours, lang),
          highlightLines(conflictContents!.theirs, lang),
        ]);
        if (!cancelled) {
          setOursTokens(ot);
          setTheirsTokens(tt);
        }
      } catch {
        /* fallback */
      }
    }
    highlight();
    return () => {
      cancelled = true;
    };
  }, [conflictContents, lang]);

  // ── CodeMirror language ext ────────────────────────────────

  const [langExt, setLangExt] = useState<Extension | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLanguageExtension(filePath).then((ext) => {
      if (!cancelled) setLangExt(ext);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // ── Output editor lifecycle ────────────────────────────────

  useEffect(() => {
    if (!outputRef.current || !conflictContents) return;

    const exts: Extension[] = [
      prefetchDarkTheme,
      keymap.of(defaultKeymap),
      EditorView.lineWrapping,
      referenceDocField,
      lineSourceField,
      gutterSourcesField,
      trackedLineInfoField,
      regionPositionsField,
      emptyLineIndicator,
      sourceGutter,
      lineNumbers(),
      manualEditedCompartment.of(EditorView.editorAttributes.of({})),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const isSync = u.transactions.some(
            (tr) => tr.annotation(isSyncAnnotation),
          );
          if (!isSync) {
            setManuallyEdited(true);

            // Detect tracked lines that were edited → uncheck their checkboxes.
            // The trackedLineInfoField already nulled out edited lines — compare
            // old vs new to find which entries were lost.
            const oldTracked = u.startState.field(trackedLineInfoField);
            const newTracked = u.state.field(trackedLineInfoField);

            const oldKeys = new Set<string>();
            for (const info of oldTracked) {
              if (info) oldKeys.add(`${info.regionIndex}:${info.side}:${info.lineIndex}`);
            }
            const newKeys = new Set<string>();
            for (const info of newTracked) {
              if (info) newKeys.add(`${info.regionIndex}:${info.side}:${info.lineIndex}`);
            }

            const lost: TrackedLineInfo[] = [];
            for (const key of oldKeys) {
              if (!newKeys.has(key)) {
                const [ri, side, li] = key.split(":");
                lost.push({
                  regionIndex: parseInt(ri),
                  side: side as "ours" | "theirs",
                  lineIndex: parseInt(li),
                });
              }
            }

            if (lost.length > 0) {
              setSelections((prev) => {
                const next = new Map(prev);
                const curRegions = regionsRef.current;
                for (const { regionIndex, side, lineIndex } of lost) {
                  const cur = next.get(regionIndex);
                  if (cur) {
                    const target =
                      side === "ours"
                        ? new Set(cur.oursLines)
                        : new Set(cur.theirsLines);
                    target.delete(lineIndex);
                    next.set(regionIndex, {
                      ...cur,
                      [side === "ours" ? "oursLines" : "theirsLines"]: target,
                    });
                  } else if (side === "ours") {
                    // Default (no explicit selection) = all ours selected.
                    const region = curRegions[regionIndex];
                    if (region) {
                      const allOurs = new Set(
                        region.aLines.map((_: string, i: number) => i),
                      );
                      allOurs.delete(lineIndex);
                      next.set(regionIndex, {
                        oursLines: allOurs,
                        theirsLines: new Set<number>(),
                        order: "ours-first",
                      });
                    }
                  }
                }
                return next;
              });
            }
          }
        }
        // Handle gutter remove-line clicks (uses tracked info for line→checkbox mapping)
        for (const tr of u.transactions) {
          for (const effect of tr.effects) {
            if (effect.is(removeOutputLineEffect)) {
              const tracked = u.state.field(trackedLineInfoField);
              const info = tracked[effect.value - 1];
              if (info) {
                toggleLineRef.current(
                  info.regionIndex,
                  info.side,
                  info.lineIndex,
                );
              }
            }
          }
        }
      }),
    ];
    if (langExt) exts.push(langExt);

    const view = new EditorView({
      state: EditorState.create({ doc: outputText, extensions: exts }),
      parent: outputRef.current,
    });
    editorViewRef.current = view;

    // Apply initial decorations, gutter sources, tracked info, and region positions
    view.dispatch({
      effects: [
        setLineSourcesEffect.of(outputSources),
        setGutterSourcesEffect.of(outputSources),
        setTrackedInfoEffect.of(buildTrackedInfo(outputMappings)),
        setRegionPositionsEffect.of(
          computeRegionPositions(outputText, regions, selections),
        ),
      ],
      annotations: isSyncAnnotation.of(true),
    });

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictContents, filePath, langExt]);

  // Full sync: replace entire output when NOT manually edited and selections change
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || manuallyEdited) return;
    const trackedInfo = buildTrackedInfo(outputMappings);
    const current = view.state.doc.toString();
    if (current !== outputText) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: outputText },
        effects: [
          setLineSourcesEffect.of(outputSources),
          setGutterSourcesEffect.of(outputSources),
          setTrackedInfoEffect.of(trackedInfo),
          setRegionPositionsEffect.of(
            computeRegionPositions(outputText, regions, selections),
          ),
        ],
        annotations: isSyncAnnotation.of(true),
      });
    } else {
      view.dispatch({
        effects: [
          setLineSourcesEffect.of(outputSources),
          setGutterSourcesEffect.of(outputSources),
          setTrackedInfoEffect.of(trackedInfo),
          setRegionPositionsEffect.of(
            computeRegionPositions(outputText, regions, selections),
          ),
        ],
        annotations: isSyncAnnotation.of(true),
      });
    }
  }, [outputText, outputSources, outputMappings, manuallyEdited, regions, selections]);

  // ── Selection handlers ─────────────────────────────────────

  /**
   * Toggle a chunk's ours checkbox.
   * Non-exclusive: both ours and theirs can be selected.
   * Order is determined by which side was selected first.
   *
   * When manually edited: surgically insert/remove lines, preserving manual edits.
   * When NOT manually edited: update selections → sync effect does full replacement.
   */
  const toggleChunkOurs = useCallback(
    (regionIndex: number) => {
      const region = regions[regionIndex];
      if (!region || region.type !== "changed") return;

      const cur = selections.get(regionIndex);
      const hasOurs = cur
        ? cur.oursLines.size === region.aLines.length
        : true;

      // Compute the new selection for this region
      const newSel: ChunkSelection = hasOurs
        ? {
            oursLines: new Set<number>(),
            theirsLines: cur?.theirsLines ?? new Set<number>(),
            order: cur?.order ?? "ours-first",
          }
        : {
            oursLines: new Set(region.aLines.map((_, i) => i)),
            theirsLines: cur?.theirsLines ?? new Set<number>(),
            order:
              cur && cur.theirsLines.size > 0
                ? (cur.order ?? "theirs-first")
                : "ours-first",
          };

      setSelections((prev) => {
        const next = new Map(prev);
        next.set(regionIndex, newSel);
        return next;
      });

      const view = editorViewRef.current;
      if (manuallyEdited && view) {
        const allIndices = region.aLines.map((_: string, i: number) => i);
        if (hasOurs) {
          surgicalRemove(view, regionIndex, "ours", allIndices);
        } else {
          surgicalInsert(
            view, regionIndex, "ours",
            allIndices, [...region.aLines], newSel.order,
          );
        }
      } else {
        setManuallyEdited(false);
      }
    },
    [regions, selections, manuallyEdited],
  );

  const toggleChunkTheirs = useCallback(
    (regionIndex: number) => {
      const region = regions[regionIndex];
      if (!region || region.type !== "changed") return;

      const cur = selections.get(regionIndex);
      const hasTheirs = cur
        ? cur.theirsLines.size === region.bLines.length
        : false;

      const newSel: ChunkSelection = hasTheirs
        ? {
            oursLines:
              cur?.oursLines ?? new Set(region.aLines.map((_, i) => i)),
            theirsLines: new Set<number>(),
            order: cur?.order ?? "ours-first",
          }
        : {
            oursLines:
              cur?.oursLines ?? new Set(region.aLines.map((_, i) => i)),
            theirsLines: new Set(region.bLines.map((_, i) => i)),
            order:
              (cur ? cur.oursLines.size > 0 : true)
                ? (cur?.order ?? "ours-first")
                : "theirs-first",
          };

      setSelections((prev) => {
        const next = new Map(prev);
        next.set(regionIndex, newSel);
        return next;
      });

      const view = editorViewRef.current;
      if (manuallyEdited && view) {
        const allIndices = region.bLines.map((_: string, i: number) => i);
        if (hasTheirs) {
          surgicalRemove(view, regionIndex, "theirs", allIndices);
        } else {
          surgicalInsert(
            view, regionIndex, "theirs",
            allIndices, [...region.bLines], newSel.order,
          );
        }
      } else {
        setManuallyEdited(false);
      }
    },
    [regions, selections, manuallyEdited],
  );

  const toggleLine = useCallback(
    (regionIndex: number, side: "ours" | "theirs", lineIndex: number) => {
      const region = regions[regionIndex];
      if (!region || region.type !== "changed") return;

      const cur = selections.get(regionIndex) ?? {
        oursLines: new Set(region.aLines.map((_, i) => i)),
        theirsLines: new Set<number>(),
        order: "ours-first" as const,
      };
      const target =
        side === "ours"
          ? new Set(cur.oursLines)
          : new Set(cur.theirsLines);
      const wasSelected = target.has(lineIndex);
      if (wasSelected) {
        target.delete(lineIndex);
      } else {
        target.add(lineIndex);
      }

      let { order } = cur;
      if (side === "theirs" && wasSelected) {
        // removing a theirs line doesn't change order
      } else if (side === "theirs" && cur.theirsLines.size === 0) {
        order = cur.oursLines.size > 0 ? "ours-first" : "theirs-first";
      } else if (side === "ours" && cur.oursLines.size === 0) {
        order = cur.theirsLines.size > 0 ? "theirs-first" : "ours-first";
      }

      const newSel: ChunkSelection = {
        oursLines: side === "ours" ? target : new Set(cur.oursLines),
        theirsLines: side === "theirs" ? target : new Set(cur.theirsLines),
        order,
      };

      setSelections((prev) => {
        const next = new Map(prev);
        next.set(regionIndex, newSel);
        return next;
      });

      const view = editorViewRef.current;
      if (manuallyEdited && view) {
        const lineText =
          side === "ours"
            ? region.aLines[lineIndex]
            : region.bLines[lineIndex];
        if (wasSelected) {
          surgicalRemove(view, regionIndex, side, [lineIndex]);
        } else {
          surgicalInsert(
            view, regionIndex, side,
            [lineIndex], [lineText], newSel.order,
          );
        }
      } else {
        setManuallyEdited(false);
      }
    },
    [regions, selections, manuallyEdited],
  );

  // Keep refs in sync with latest values (set in effect, read in event handlers)
  useEffect(() => {
    toggleLineRef.current = toggleLine;
  }, [toggleLine]);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  // Toggle cm-manually-edited class on the editor element via compartment
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: manualEditedCompartment.reconfigure(
        manuallyEdited
          ? EditorView.editorAttributes.of({ class: "cm-manually-edited" })
          : EditorView.editorAttributes.of({}),
      ),
      annotations: isSyncAnnotation.of(true),
    });
  }, [manuallyEdited]);

  // Master checkbox state — derived from current selections, not stored
  const masterSide = useMemo((): "ours" | "theirs" | null => {
    if (changedChunkIndices.length === 0) return null;
    const allOurs = changedChunkIndices.every((idx) => {
      const sel = selections.get(idx);
      const region = regions[idx];
      return (
        (!sel && region.aLines.length > 0) ||
        (sel &&
          sel.oursLines.size === region.aLines.length &&
          sel.theirsLines.size === 0)
      );
    });
    if (allOurs) return "ours";
    const allTheirs = changedChunkIndices.every((idx) => {
      const sel = selections.get(idx);
      const region = regions[idx];
      return (
        sel &&
        sel.theirsLines.size === region.bLines.length &&
        sel.oursLines.size === 0
      );
    });
    if (allTheirs) return "theirs";
    return null;
  }, [selections, changedChunkIndices, regions]);

  const handleMasterOurs = useCallback(() => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllOurs(regions[idx]));
    }
    setSelections(next);
    setManuallyEdited(false);
  }, [regions, changedChunkIndices]);

  const handleMasterTheirs = useCallback(() => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllTheirs(regions[idx]));
    }
    setSelections(next);
    setManuallyEdited(false);
  }, [regions, changedChunkIndices]);

  // Accept Ours/Theirs buttons: select all + save immediately
  const handleAcceptOurs = useCallback(async () => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllOurs(regions[idx]));
    }
    const { text } = buildOutputWithSources(regions, next);
    setSaving(true);
    try {
      await resolveConflictManual(filePath, text);
    } finally {
      setSaving(false);
    }
  }, [regions, changedChunkIndices, filePath, resolveConflictManual]);

  const handleAcceptTheirs = useCallback(async () => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllTheirs(regions[idx]));
    }
    const { text } = buildOutputWithSources(regions, next);
    setSaving(true);
    try {
      await resolveConflictManual(filePath, text);
    } finally {
      setSaving(false);
    }
  }, [regions, changedChunkIndices, filePath, resolveConflictManual]);

  const resetSelections = useCallback(() => {
    setSelections(new Map());
    setManuallyEdited(false);
  }, []);

  // ── Resize drag handlers ────────────────────────────────────

  const onHDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = refPanesRef.current;
    if (!container) return;
    const startX = e.clientX;
    const totalWidth = container.getBoundingClientRect().width;
    const oursEl = container.firstElementChild as HTMLElement | null;
    const startPct = oursEl
      ? (oursEl.getBoundingClientRect().width / totalWidth) * 100
      : 50;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const pct = startPct + (delta / totalWidth) * 100;
      setHSplit(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const onVDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = contentRef.current;
    if (!container) return;
    const startY = e.clientY;
    const totalHeight = container.getBoundingClientRect().height;
    const refEl = refPanesRef.current;
    const startPct = refEl
      ? (refEl.getBoundingClientRect().height / totalHeight) * 100
      : 60;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const pct = startPct + (delta / totalHeight) * 100;
      setVSplit(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorViewRef.current) return;
    setSaving(true);
    try {
      const content = editorViewRef.current.state.doc.toString();
      await resolveConflictManual(filePath, content);
    } finally {
      setSaving(false);
    }
  }, [filePath, resolveConflictManual]);

  // ── Precompute line offsets ────────────────────────────────

  const regionLineInfo = useMemo(() => {
    const result: { oursStart: number; theirsStart: number }[] = [];
    let aLine = 0;
    let bLine = 0;
    for (const region of regions) {
      result.push({ oursStart: aLine, theirsStart: bLine });
      aLine += region.aLines.length;
      bLine += region.bLines.length;
    }
    return result;
  }, [regions]);

  // ── Render ─────────────────────────────────────────────────

  if (!conflictContents) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading conflict contents...
      </div>
    );
  }

  const oursLabel = conflictContents.ours_branch || "current";
  const theirsLabel = conflictContents.theirs_branch || "incoming";
  const oursHash = conflictContents.ours_commit_id;
  const theirsHash = conflictContents.theirs_commit_id;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <GitCompare className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {changedChunkIndices.length} conflict
          {changedChunkIndices.length !== 1 ? "s" : ""}
        </span>
        {rebaseProgress && conflictState?.operation === "rebase" && (
          <span className="text-xs text-muted-foreground/60">
            · Step {rebaseProgress.step}/{rebaseProgress.total}
            {rebaseProgress.commit_id && (
              <span className="font-mono ml-1">{rebaseProgress.commit_id}</span>
            )}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {manuallyEdited && (
            <button
              onClick={resetSelections}
              className="flex items-center gap-1 rounded-md bg-zinc-500/20 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-500/30"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? "Saving..." : "Save Resolution"}
          </button>
        </div>
      </div>

      {/* Resizable content area */}
      <div ref={contentRef} className="flex flex-col min-h-0 flex-1">
        {/* Reference panes */}
        <div ref={refPanesRef} className="flex min-h-0" style={{ flex: vSplit }}>
          {/* Ours pane */}
          <div className="flex flex-col overflow-hidden" style={{ flex: hSplit }}>
            {/* Header with master checkbox + icon + accept-all button */}
            <div className="shrink-0 px-3 py-1.5 border-b border-border bg-blue-500/5 flex items-center gap-1.5">
              {/* Master checkbox */}
              <button
                onClick={handleMasterOurs}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                  masterSide === "ours"
                    ? "bg-blue-500 text-white"
                    : "border border-muted-foreground/30 hover:border-blue-400/50"
                }`}
                title="Accept all from ours"
              >
                {masterSide === "ours" && <Check className="w-2.5 h-2.5" />}
              </button>
              <OursIcon />
              <div className="flex-1 min-w-0 flex items-center">
                <span className="text-xs font-medium text-blue-400">
                  Ours ({oursLabel})
                </span>
                {oursHash && (
                  <span className="text-[10px] text-muted-foreground/50 ml-1.5 font-mono">
                    {oursHash}
                  </span>
                )}
              </div>
              <button
                onClick={handleAcceptOurs}
                disabled={saving}
                className="shrink-0 flex items-center gap-1.5 rounded-md bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                Accept Ours
              </button>
            </div>
            <div className="overflow-auto flex-1 text-xs font-mono leading-5">
              {regions.map((region, ri) => {
                const lineStart = regionLineInfo[ri].oursStart;
                if (region.type === "unchanged") {
                  return (
                    <UnchangedBlock
                      key={ri}
                      lines={region.aLines}
                      tokens={oursTokens}
                      startTokenLine={lineStart}
                      startLineNo={region.aStartLine}
                    />
                  );
                }
                const sel = selections.get(ri);
                const isChecked = sel
                  ? sel.oursLines.size === region.aLines.length
                  : true;
                return (
                  <ChangedBlock
                    key={ri}
                    lines={region.aLines}
                    tokens={oursTokens}
                    startTokenLine={lineStart}
                    startLineNo={region.aStartLine}
                    side="ours"
                    isChunkSelected={isChecked}
                    selectedLines={
                      sel?.oursLines ??
                      new Set(region.aLines.map((_, i) => i))
                    }
                    onToggleChunk={() => toggleChunkOurs(ri)}
                    onToggleLine={(li) => toggleLine(ri, "ours", li)}
                  />
                );
              })}
            </div>
          </div>

          {/* Vertical resize handle (between ours/theirs) */}
          <div
            onMouseDown={onHDragStart}
            className="relative w-px shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:cursor-col-resize"
          />

          {/* Theirs pane */}
          <div className="flex flex-col overflow-hidden" style={{ flex: 100 - hSplit }}>
            <div className="shrink-0 px-3 py-1.5 border-b border-border bg-purple-500/5 flex items-center gap-1.5">
              <button
                onClick={handleMasterTheirs}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                  masterSide === "theirs"
                    ? "bg-purple-500 text-white"
                    : "border border-muted-foreground/30 hover:border-purple-400/50"
                }`}
                title="Accept all from theirs"
              >
                {masterSide === "theirs" && <Check className="w-2.5 h-2.5" />}
              </button>
              <TheirsIcon />
              <div className="flex-1 min-w-0 flex items-center">
                <span className="text-xs font-medium text-purple-400">
                  Theirs ({theirsLabel})
                </span>
                {theirsHash && (
                  <span className="text-[10px] text-muted-foreground/50 ml-1.5 font-mono">
                    {theirsHash}
                  </span>
                )}
              </div>
              <button
                onClick={handleAcceptTheirs}
                disabled={saving}
                className="shrink-0 flex items-center gap-1.5 rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/30 disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                Accept Theirs
              </button>
            </div>
            <div className="overflow-auto flex-1 text-xs font-mono leading-5">
              {regions.map((region, ri) => {
                const lineStart = regionLineInfo[ri].theirsStart;
                if (region.type === "unchanged") {
                  return (
                    <UnchangedBlock
                      key={ri}
                      lines={region.bLines}
                      tokens={theirsTokens}
                      startTokenLine={lineStart}
                      startLineNo={region.bStartLine}
                    />
                  );
                }
                const sel = selections.get(ri);
                const isChecked = sel
                  ? sel.theirsLines.size === region.bLines.length
                  : false;
                return (
                  <ChangedBlock
                    key={ri}
                    lines={region.bLines}
                    tokens={theirsTokens}
                    startTokenLine={lineStart}
                    startLineNo={region.bStartLine}
                    side="theirs"
                    isChunkSelected={isChecked}
                    selectedLines={sel?.theirsLines ?? new Set<number>()}
                    onToggleChunk={() => toggleChunkTheirs(ri)}
                    onToggleLine={(li) => toggleLine(ri, "theirs", li)}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Horizontal resize handle (between reference/output) */}
        <div
          onMouseDown={onVDragStart}
          className="relative h-px shrink-0 cursor-row-resize bg-border hover:bg-accent transition-colors before:absolute before:inset-x-0 before:-top-1.5 before:h-3 before:cursor-row-resize"
        />

        {/* Output pane */}
        <div
          className="flex flex-col min-h-0"
          style={{ flex: 100 - vSplit }}
        >
          <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-green-400 bg-green-500/5 border-b border-border flex items-center gap-2">
            <span>Output</span>
            {manuallyEdited && (
              <span className="text-muted-foreground font-normal">
                (manually edited)
              </span>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-normal">
                <OursIcon size={10} />
                ours
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-normal">
                <TheirsIcon size={10} />
                theirs
              </span>
            </div>
          </div>
          <div ref={outputRef} className="flex-1 min-h-0 overflow-auto" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

interface UnchangedBlockProps {
  lines: string[];
  tokens: ThemedToken[][] | null;
  startTokenLine: number;
  startLineNo: number;
}

function UnchangedBlock({
  lines,
  tokens,
  startTokenLine,
  startLineNo,
}: UnchangedBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = lines.length > 8;

  if (shouldCollapse && !expanded) {
    const topLines = lines.slice(0, 3);
    const bottomLines = lines.slice(-3);
    const hiddenCount = lines.length - 6;
    return (
      <div>
        {topLines.map((line, li) => (
          <UnchangedLine
            key={li}
            content={line}
            lineNo={startLineNo + li}
            tokens={tokens?.[startTokenLine + li]}
          />
        ))}
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-2 py-0.5 text-[10px] text-muted-foreground/50 bg-secondary/50 hover:bg-secondary transition-colors text-center"
        >
          {"⋯ "}
          {hiddenCount} unchanged line{hiddenCount !== 1 ? "s" : ""}
          {" ⋯"}
        </button>
        {bottomLines.map((line, li) => {
          const actualIdx = lines.length - 3 + li;
          return (
            <UnchangedLine
              key={`b-${li}`}
              content={line}
              lineNo={startLineNo + actualIdx}
              tokens={tokens?.[startTokenLine + actualIdx]}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${lines.length * 20}px`,
      }}
    >
      {lines.map((line, li) => (
        <UnchangedLine
          key={li}
          content={line}
          lineNo={startLineNo + li}
          tokens={tokens?.[startTokenLine + li]}
        />
      ))}
    </div>
  );
}

function UnchangedLine({
  content,
  lineNo,
  tokens,
}: {
  content: string;
  lineNo: number;
  tokens?: ThemedToken[];
}) {
  return (
    <div className="flex opacity-50">
      <span className="w-5 shrink-0" />
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {lineNo}
      </span>
      <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
        {tokens && tokens.length > 0 ? (
          tokens.map((token, i) => (
            <span key={i} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">{content || <span className="text-muted-foreground/20">{"↵"}</span>}</span>
        )}
      </pre>
    </div>
  );
}

interface ChangedBlockProps {
  lines: string[];
  tokens: ThemedToken[][] | null;
  startTokenLine: number;
  startLineNo: number;
  side: "ours" | "theirs";
  isChunkSelected: boolean;
  selectedLines: Set<number>;
  onToggleChunk: () => void;
  onToggleLine: (lineIndex: number) => void;
}

function ChangedBlock({
  lines,
  tokens,
  startTokenLine,
  startLineNo,
  side,
  isChunkSelected,
  selectedLines,
  onToggleChunk,
  onToggleLine,
}: ChangedBlockProps) {
  const borderClass =
    side === "ours" ? "border-l-blue-500/50" : "border-l-purple-500/50";

  return (
    <div className={`border-l-2 ${borderClass}`}>
      {/* Chunk header with checkbox */}
      <div
        className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer transition-colors ${
          side === "ours"
            ? "bg-blue-500/[0.08] hover:bg-blue-500/15"
            : "bg-purple-500/[0.08] hover:bg-purple-500/15"
        }`}
        onClick={onToggleChunk}
      >
        <span
          className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
            isChunkSelected
              ? side === "ours"
                ? "bg-blue-500 text-white"
                : "bg-purple-500 text-white"
              : "border border-muted-foreground/30"
          }`}
        >
          {isChunkSelected && <Check className="w-2.5 h-2.5" />}
        </span>
        <span
          className={`text-[10px] font-medium ${
            side === "ours" ? "text-blue-400/70" : "text-purple-400/70"
          }`}
        >
          {side === "ours" ? "Ours" : "Theirs"} &middot; {lines.length} line
          {lines.length !== 1 ? "s" : ""}
        </span>
      </div>

      {lines.map((line, li) => {
        const isSelected = selectedLines.has(li);
        return (
          <div
            key={li}
            className={`flex group/cline cursor-pointer transition-colors ${
              isSelected
                ? side === "ours"
                  ? "bg-blue-500/10"
                  : "bg-purple-500/10"
                : "bg-zinc-800/30 opacity-50 hover:opacity-75"
            }`}
            onClick={() => onToggleLine(li)}
          >
            <span className="w-5 shrink-0 flex items-center justify-center select-none">
              <span
                className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center opacity-0 group-hover/cline:opacity-100 transition-opacity ${
                  side === "ours" ? "text-blue-400" : "text-purple-400"
                }`}
              >
                {isSelected ? (
                  <Minus className="w-2.5 h-2.5" />
                ) : (
                  <Plus className="w-2.5 h-2.5" />
                )}
              </span>
            </span>
            <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
              {startLineNo + li}
            </span>
            <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
              {tokens?.[startTokenLine + li]?.length ? (
                tokens[startTokenLine + li].map(
                  (token: ThemedToken, i: number) => (
                    <span key={i} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ),
                )
              ) : (
                <span className="text-muted-foreground">
                  {line || <span className="text-muted-foreground/20">{"↵"}</span>}
                </span>
              )}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

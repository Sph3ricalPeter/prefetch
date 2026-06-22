import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FileDiff } from "@/types/git";
import { getDataAttrFromEvent } from "@/lib/utils";
import { buildChangeableKeys, changeableKeysInHunk } from "@/lib/diff-selection";

/**
 * Line-selection state machine shared by the interactive and read-only diff
 * viewers. Tracks a set of selected change-line keys (`"${hunkIndex}:${lineIndex}"`)
 * and wires click / shift-click / click-and-drag selection over a scroll
 * container whose lines carry a `data-line-key` attribute.
 *
 * The container element must call the returned mouse handlers and the host is
 * responsible for rendering `isSelected` styling and reading `selectedLines`.
 */
export function useDiffLineSelection(diff: FileDiff, scrollRef: RefObject<HTMLDivElement | null>) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());

  // Ordered list of all changeable line keys for range calculations.
  const changeableKeys = useMemo(() => buildChangeableKeys(diff), [diff]);

  const getRange = useCallback((from: string, to: string): string[] => {
    const fromIdx = changeableKeys.indexOf(from);
    const toIdx = changeableKeys.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return [];
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    return changeableKeys.slice(start, end + 1);
  }, [changeableKeys]);

  // Drag state: tracked via ref to avoid re-renders during drag.
  const dragRef = useRef<{
    active: boolean;
    addMode: boolean; // true = selecting, false = deselecting
    startKey: string;
    lastKey: string;
    baseSelection: Set<string>; // selection state before drag started
  } | null>(null);
  const anchorRef = useRef<string | null>(null);

  const getLineKeyFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent) => getDataAttrFromEvent(e, "data-line-key", scrollRef.current),
    [scrollRef],
  );

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    const key = getLineKeyFromEvent(e);
    if (e.button !== 0) return;
    if (!key || !changeableKeys.includes(key)) return;

    // Prevent text selection during drag
    e.preventDefault();

    if (e.shiftKey && anchorRef.current) {
      // Shift+click: select range from anchor to clicked line
      const range = getRange(anchorRef.current, key);
      setSelectedLines((prev) => {
        const next = new Set(prev);
        for (const k of range) next.add(k);
        return next;
      });
      return;
    }

    // Start drag — add mode is based on whether we're selecting or deselecting
    const willSelect = !selectedLines.has(key);
    anchorRef.current = key;
    dragRef.current = {
      active: true,
      addMode: willSelect,
      startKey: key,
      lastKey: key,
      baseSelection: new Set(selectedLines),
    };

    // Toggle the clicked line
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(key); else next.delete(key);
      return next;
    });
  }, [getLineKeyFromEvent, changeableKeys, getRange, selectedLines]);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current?.active) return;
    const key = getLineKeyFromEvent(e);
    if (!key || !changeableKeys.includes(key) || key === dragRef.current.lastKey) return;

    dragRef.current.lastKey = key;
    const range = getRange(dragRef.current.startKey, key);
    setSelectedLines(() => {
      const next = new Set(dragRef.current!.baseSelection);
      for (const k of range) {
        if (dragRef.current!.addMode) next.add(k); else next.delete(k);
      }
      return next;
    });
  }, [getLineKeyFromEvent, changeableKeys, getRange]);

  // Global mouseup to end drag
  useEffect(() => {
    const handleMouseUp = () => {
      if (dragRef.current?.active) dragRef.current.active = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const toggleHunk = useCallback((hunkIdx: number) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      const hunk = diff.hunks[hunkIdx];
      if (!hunk) return prev;

      const hunkKeys = changeableKeysInHunk(hunk, hunkIdx);
      const allSelected = hunkKeys.every((key) => next.has(key));

      if (allSelected) {
        for (const key of hunkKeys) next.delete(key);
      } else {
        for (const key of hunkKeys) next.add(key);
      }

      return next;
    });
  }, [diff]);

  const clearSelection = useCallback(() => setSelectedLines(new Set()), []);

  return {
    selectedLines,
    setSelectedLines,
    clearSelection,
    changeableKeys,
    toggleHunk,
    handleContainerMouseDown,
    handleContainerMouseMove,
  };
}

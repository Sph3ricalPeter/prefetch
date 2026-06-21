import { useEffect, useRef, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  CircleX,
  AlignLeft,
  ListTree,
  FoldVertical,
  UnfoldVertical,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/ui/icon-button";
import { useRepoStore } from "@/stores/repo-store";
import { openUrl } from "@/lib/commands";
import { getUiState, setUiState } from "@/lib/database";
import { formatDuration } from "@/lib/ci-utils";
import { parseCiLog, type LogLine, type GroupStatus } from "@/lib/ci-log-parse";
import { cn } from "@/lib/utils";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { useInViewSearch } from "@/hooks/use-in-view-search";
import { SearchNav } from "@/components/ui/search-nav";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { stripAnsi } from "@/lib/text-search";

/**
 * Convert basic ANSI escape codes to styled HTML spans.
 * Handles SGR sequences (color/bold/dim) and silently consumes other CSI
 * sequences (e.g. GitLab's `\x1b[0K` erase-line), which would otherwise corrupt
 * the surrounding text.
 */
function ansiToHtml(text: string): string {
  const colorMap: Record<number, string> = {
    30: "#6e7681", 31: "#f85149", 32: "#3fb950", 33: "#d29922",
    34: "#58a6ff", 35: "#bc8cff", 36: "#39d2c0", 37: "#c9d1d9",
    90: "#8b949e", 91: "#ff7b72", 92: "#56d364", 93: "#e3b341",
    94: "#79c0ff", 95: "#d2a8ff", 96: "#56d4dd", 97: "#f0f6fc",
  };

  let result = "";
  let i = 0;
  let open = false;

  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      // Find the CSI final byte (0x40–0x7E); params/intermediates precede it.
      let j = i + 2;
      while (j < text.length && !(text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e)) j++;
      if (j >= text.length) { i++; continue; } // incomplete sequence

      if (text[j] === "m") {
        const codes = text.slice(i + 2, j).split(";").map(Number);
        for (const code of codes) {
          if (code === 0) {
            if (open) { result += "</span>"; open = false; }
          } else if (code === 1) {
            if (open) result += "</span>";
            result += '<span style="font-weight:bold">';
            open = true;
          } else if (code === 2) {
            if (open) result += "</span>";
            result += '<span style="opacity:0.6">';
            open = true;
          } else if (colorMap[code]) {
            if (open) result += "</span>";
            result += `<span style="color:${colorMap[code]}">`;
            open = true;
          }
        }
      }
      // Non-SGR sequences (K, H, J, …) carry no styling — drop them.
      i = j + 1;
    } else {
      const char = text[i];
      if (char === "<") result += "&lt;";
      else if (char === ">") result += "&gt;";
      else if (char === "&") result += "&amp;";
      else if (char === "\r") { /* swallow stray carriage returns */ }
      else result += char;
      i++;
    }
  }
  if (open) result += "</span>";
  return result;
}

function lineToHtml(line: LogLine): string {
  const inner = ansiToHtml(line.content);
  switch (line.kind) {
    case "error":
      return `<span style="color:#f85149">${inner}</span>`;
    case "warning":
      return `<span style="color:#d29922">${inner}</span>`;
    case "command":
      return `<span style="color:#58a6ff">${inner}</span>`;
    default:
      return inner;
  }
}

/** Split a raw log into per-line HTML + lowercased plain text (for matching). */
function rawToRenderLines(text: string): RenderLine[] {
  return text.split(/\r?\n/).map((l) => ({
    html: ansiToHtml(l),
    plain: stripAnsi(l).toLowerCase(),
  }));
}

/** Convert parsed LogLines to per-line HTML + lowercased plain text. */
function toRenderLines(lines: LogLine[]): RenderLine[] {
  return lines.map((line) => ({
    html: lineToHtml(line),
    plain: stripAnsi(line.content).toLowerCase(),
  }));
}

interface RenderLine {
  html: string;
  /** Lowercased, ANSI-stripped text used to test the filter query. */
  plain: string;
}

function GroupStatusIcon({ status }: { status: GroupStatus }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (status) {
    case "success":
      return <CircleCheck className={`${cls} text-green-400`} />;
    case "warning":
      return <CircleAlert className={`${cls} text-orange-400`} />;
    case "failure":
      return <CircleX className={`${cls} text-red-400`} />;
    default:
      return null;
  }
}

/** Wrapper around a block of per-line log rows (mono font, padding).
 *  `select-text` re-enables native text selection here — the app shell sets
 *  `select-none` globally for a native feel, so logs would otherwise be
 *  unselectable. Logs are read-only flowing text, so plain browser selection +
 *  copy is the expected UX (unlike the diff's custom line-selection model). */
const LINES_WRAP =
  "font-mono text-xs leading-relaxed text-foreground px-3 py-2 select-text";

/** One log line — its own element so it can be individually dimmed by the filter. */
function LogLineRow({ html, dimmed }: { html: string; dimmed: boolean }) {
  return (
    <div
      className={cn("whitespace-pre-wrap break-all", dimmed && FILTER_DIM_CLASS)}
      // Zero-width space keeps blank lines at full line-height.
      dangerouslySetInnerHTML={{ __html: html.length ? html : "​" }}
    />
  );
}

export function CiLogViewer() {
  const ciJobLog = useRepoStore((s) => s.ciJobLog);
  const selectedJobId = useRepoStore((s) => s.ciSelectedJobId);
  const jobsMap = useRepoStore((s) => s.ciJobsMap);
  const pipelines = useRepoStore((s) => s.ciPipelines);
  const selectedPipelineId = useRepoStore((s) => s.ciSelectedPipelineId);
  const forgeKind = useRepoStore((s) => s.forgeStatus?.kind ?? null);
  const clearCiJobLog = useRepoStore((s) => s.clearCiJobLog);
  const containerRef = useRef<HTMLDivElement>(null);

  const jobs = selectedPipelineId != null ? (jobsMap[selectedPipelineId] ?? []) : [];
  const selectedJob = jobs.find((j) => j.id === selectedJobId);
  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  const filterQuery = useRepoStore((s) => s.filterQuery);
  const q = filterQuery.trim().toLowerCase();
  const parsed = useMemo(() => parseCiLog(ciJobLog ?? "", forgeKind), [ciJobLog, forgeKind]);

  // Per-line render data (HTML + plain text for matching), memoized so toggling
  // groups / typing in the filter doesn't re-convert every line.
  const rawLines = useMemo(() => rawToRenderLines(ciJobLog ?? ""), [ciJobLog]);
  const segLines = useMemo(
    () => parsed.segments.map((seg) => toRenderLines(seg.type === "loose" ? seg.lines : seg.group.lines)),
    [parsed],
  );

  // View-mode preference (persisted). Falls back to raw when no groups exist.
  const [viewMode, setViewMode] = useState<"raw" | "structured">("structured");
  useEffect(() => {
    let cancelled = false;
    getUiState("ci_log_view_mode")
      .then((v) => {
        if (!cancelled && (v === "raw" || v === "structured")) setViewMode(v);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const changeViewMode = (mode: "raw" | "structured") => {
    setViewMode(mode);
    setUiState("ci_log_view_mode", mode).catch(() => {});
  };
  const effectiveMode = parsed.hasGroups ? viewMode : "raw";

  // Group expand/collapse state, seeded from each group's default.
  const groupIds = useMemo(
    () => parsed.segments.flatMap((s) => (s.type === "group" ? [s.group.id] : [])),
    [parsed],
  );
  const defaultExpanded = useMemo(() => {
    const init = new Set<string>();
    for (const seg of parsed.segments) {
      if (seg.type === "group" && seg.group.defaultExpanded) init.add(seg.group.id);
    }
    return init;
  }, [parsed]);
  // Reset to defaults whenever the parsed log changes (new job / view) — done
  // during render rather than in an effect to avoid a stale-state flash.
  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);
  const [prevParsed, setPrevParsed] = useState(parsed);
  if (prevParsed !== parsed) {
    setPrevParsed(parsed);
    setExpanded(defaultExpanded);
  }

  const allExpanded = groupIds.length > 0 && groupIds.every((id) => expanded.has(id));
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(groupIds));
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // While a filter is active, force-expand any group that contains a match so
  // its lines are rendered (and thus highlightable / navigable).
  const expandedEffective = useMemo(() => {
    if (!q) return expanded;
    const next = new Set(expanded);
    parsed.segments.forEach((seg, i) => {
      if (seg.type === "group" && segLines[i].some((l) => l.plain.includes(q))) {
        next.add(seg.group.id);
      }
    });
    return next;
  }, [q, expanded, parsed, segLines]);

  // Copy the full log (ANSI stripped) to the clipboard. Complements native
  // text selection for grabbing the whole log without a manual drag.
  const copyLog = () => {
    if (ciJobLog == null) return;
    navigator.clipboard.writeText(stripAnsi(ciJobLog)).then(
      () => toast.success("Copied log"),
      () => toast.error("Failed to copy to clipboard"),
    );
  };

  // Copy a single structured section's lines (ANSI stripped).
  const copySection = (lines: LogLine[]) => {
    const text = lines.map((l) => stripAnsi(l.content)).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied section"),
      () => toast.error("Failed to copy to clipboard"),
    );
  };

  // Right-click menu over the log: "Copy" the current text selection (when
  // any), plus "Copy log" for the whole thing. Plain function (not useCallback)
  // to stay out of the React Compiler's manual-memo way.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // WebView2 recalculates the native text selection on right-click (snapping the
  // start to the line head and dropping the last line) *after* this handler runs
  // and regardless of preventDefault — and it re-applies that even if we restore
  // the selection via the Selection API, so the native highlight can't be kept.
  // Instead we snapshot the selection's text + client rects on the right-button
  // mousedown (while it's intact); then, while the menu is open, we hide the
  // native ::selection highlight and paint our own overlay at those rects. The
  // snapshot text also backs the "Copy" item so it always grabs the full text.
  const savedSelectionRef = useRef<{ text: string; rects: DOMRect[] } | null>(null);
  const [selOverlay, setSelOverlay] = useState<DOMRect[] | null>(null);
  const handleLogMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 2) return;
    const sel = window.getSelection();
    savedSelectionRef.current =
      sel && !sel.isCollapsed && sel.rangeCount > 0
        ? { text: sel.toString(), rects: Array.from(sel.getRangeAt(0).getClientRects()) }
        : null;
  };
  const closeContextMenu = () => {
    setContextMenu(null);
    setSelOverlay(null);
    // Drop the engine-recalculated native selection so it doesn't flash once the
    // overlay and ::selection suppression are removed.
    window.getSelection()?.removeAllRanges();
  };
  const handleLogContextMenu = (e: React.MouseEvent) => {
    const saved = savedSelectionRef.current;
    const selectedText = saved?.text ?? window.getSelection()?.toString() ?? "";
    const items: ContextMenuItem[] = [];
    if (selectedText.trim() !== "") {
      items.push({
        label: "Copy",
        onClick: () =>
          navigator.clipboard.writeText(selectedText).then(
            () => toast.success("Copied"),
            () => toast.error("Failed to copy to clipboard"),
          ),
        icon: Copy,
      });
    }
    if (ciJobLog != null) {
      items.push({ label: "Copy log", onClick: copyLog, icon: Copy });
    }
    if (items.length === 0) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
    setSelOverlay(saved && saved.rects.length > 0 ? saved.rects : null);
  };

  // In-view search. The hook watches the container with a MutationObserver, so
  // it re-highlights as a running job's log streams new lines or groups expand
  // (the previous content-key approach went stale on same-shape log growth).
  const search = useInViewSearch(containerRef, filterQuery);
  const searchSlot = q !== "" ? <SearchNav {...search} /> : null;

  // Auto-scroll to bottom on first load — only meaningful for the flat raw view,
  // and suppressed while searching so it doesn't fight the scroll-to-match.
  useEffect(() => {
    if (effectiveMode === "raw" && ciJobLog && q === "" && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [ciJobLog, effectiveMode, q]);

  // Escape-to-close is handled by the global Escape stack (App.tsx), which
  // closes the filter first, then the middle-pane context (this log included).

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-2 shrink-0">
        <IconButton onClick={clearCiJobLog}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>

        <span className="text-xs font-medium text-foreground truncate">
          {selectedJob?.name ?? `Job #${selectedJobId}`}
        </span>

        {selectedJob && (
          <span className="text-label text-faint">
            {selectedJob.status}
            {selectedJob.duration_secs != null && ` · ${formatDuration(selectedJob.duration_secs)}`}
          </span>
        )}

        {parsed.hasGroups && <span className="w-px h-4 bg-border shrink-0" />}

        {/* Raw / Structured toggle — left-aligned, like the diff toolbar */}
        {parsed.hasGroups && (
          <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
            <button
              onClick={() => changeViewMode("structured")}
              title="Grouped, collapsible steps"
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                viewMode === "structured"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListTree className="h-3.5 w-3.5" />
              <span>Structured</span>
            </button>
            <button
              onClick={() => changeViewMode("raw")}
              title="Raw log output"
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                viewMode === "raw"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlignLeft className="h-3.5 w-3.5" />
              <span>Raw</span>
            </button>
          </div>
        )}

        {/* Expand / collapse all — structured view only; matches the diff toolbar's pill */}
        {effectiveMode === "structured" && groupIds.length > 0 && (
          <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
            <button
              onClick={toggleAll}
              title={allExpanded ? "Collapse all groups" : "Expand all groups"}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                allExpanded
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {allExpanded ? <FoldVertical className="h-3.5 w-3.5" /> : <UnfoldVertical className="h-3.5 w-3.5" />}
              <span>{allExpanded ? "Fold" : "Expand"}</span>
            </button>
          </div>
        )}

        {/* Match counter + next/prev — right-aligned while a filter is active */}
        {searchSlot && <div className="ml-auto">{searchSlot}</div>}

        {/* Copy whole log — first of the right-aligned actions when no search slot */}
        {ciJobLog != null && (
          <IconButton
            onClick={copyLog}
            title="Copy log"
            className={`${searchSlot ? "" : "ml-auto"} shrink-0`}
          >
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
        )}

        {/* Open pipeline in browser — far right, like the diff toolbar's right slot */}
        {selectedPipeline?.url && (
          <IconButton
            onClick={() => openUrl(selectedPipeline.url)}
            title="Open pipeline in browser"
            className={`${searchSlot || ciJobLog != null ? "" : "ml-auto"} shrink-0`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {/* Log content */}
      {ciJobLog == null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
        </div>
      ) : effectiveMode === "raw" ? (
        <div
          ref={containerRef}
          onMouseDown={handleLogMouseDown}
          onContextMenu={handleLogContextMenu}
          onScroll={selOverlay ? closeContextMenu : undefined}
          className={cn("flex-1 overflow-auto", selOverlay && "[&_*::selection]:bg-transparent")}
        >
          <div className={LINES_WRAP}>
            {rawLines.map((l, i) => (
              <LogLineRow key={i} html={l.html} dimmed={q !== "" && !l.plain.includes(q)} />
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          onMouseDown={handleLogMouseDown}
          onContextMenu={handleLogContextMenu}
          onScroll={selOverlay ? closeContextMenu : undefined}
          className={cn("flex-1 overflow-auto", selOverlay && "[&_*::selection]:bg-transparent")}
        >
          {parsed.segments.map((seg, i) =>
            seg.type === "loose" ? (
              <div key={seg.id} className={LINES_WRAP}>
                {segLines[i].map((l, j) => (
                  <LogLineRow key={j} html={l.html} dimmed={q !== "" && !l.plain.includes(q)} />
                ))}
              </div>
            ) : (
              (() => {
                const isOpen = expandedEffective.has(seg.group.id);
                const groupDimmed = q !== "" && !segLines[i].some((l) => l.plain.includes(q));
                return (
                  <div key={seg.group.id} className="border-b border-border/40">
                    <div
                      className={cn(
                        "group/cisection sticky top-0 z-10 flex w-full items-center gap-2 bg-background px-2 py-1.5 hover:bg-secondary/50 transition-colors",
                        groupDimmed && FILTER_DIM_CLASS,
                      )}
                    >
                      <button
                        onClick={() => toggleGroup(seg.group.id)}
                        className="flex flex-1 min-w-0 items-center gap-2 text-left"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                        <GroupStatusIcon status={seg.group.status} />
                        <span
                          className="text-xs text-foreground truncate"
                          dangerouslySetInnerHTML={{ __html: ansiToHtml(seg.group.title) }}
                        />
                      </button>
                      {seg.group.durationSecs != null && (
                        <span className="text-label text-faint shrink-0">
                          {formatDuration(seg.group.durationSecs)}
                        </span>
                      )}
                      <IconButton
                        size="sm"
                        onClick={() => copySection(seg.group.lines)}
                        title="Copy section"
                        className="text-muted-foreground/70 opacity-0 focus-visible:opacity-100 group-hover/cisection:opacity-100 shrink-0"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    {isOpen && (
                      <div className={cn(LINES_WRAP, "border-t border-border/40 bg-secondary/20")}>
                        {segLines[i].map((l, j) => (
                          <LogLineRow key={j} html={l.html} dimmed={q !== "" && !l.plain.includes(q)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()
            ),
          )}
        </div>
      )}

      {/* Selection overlay: stands in for the native ::selection highlight (which
          WebView2 mangles on right-click) while the context menu is open. */}
      {selOverlay?.map((r, i) => (
        <div
          key={i}
          className="pointer-events-none fixed z-40 bg-blue-500/40"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

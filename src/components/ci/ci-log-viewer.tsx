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
} from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { openUrl } from "@/lib/commands";
import { getUiState, setUiState } from "@/lib/database";
import { formatDuration } from "@/lib/ci-utils";
import { parseCiLog, type LogLine, type GroupStatus } from "@/lib/ci-log-parse";
import { cn } from "@/lib/utils";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { useInViewSearch } from "@/hooks/use-in-view-search";
import { SearchNav } from "@/components/ui/search-nav";
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

/** Wrapper around a block of per-line log rows (mono font, padding). */
const LINES_WRAP = "font-mono text-xs leading-relaxed text-foreground px-3 py-2";

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
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0">
        <button
          onClick={clearCiJobLog}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

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
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
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
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
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
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
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

        {/* Open pipeline in browser — far right, like the diff toolbar's right slot */}
        {selectedPipeline?.url && (
          <button
            onClick={() => openUrl(selectedPipeline.url)}
            className={`${searchSlot ? "" : "ml-auto"} rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Log content */}
      {ciJobLog == null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
        </div>
      ) : effectiveMode === "raw" ? (
        <div ref={containerRef} className="flex-1 overflow-auto">
          <div className={LINES_WRAP}>
            {rawLines.map((l, i) => (
              <LogLineRow key={i} html={l.html} dimmed={q !== "" && !l.plain.includes(q)} />
            ))}
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-auto">
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
                    <button
                      onClick={() => toggleGroup(seg.group.id)}
                      className={cn(
                        "sticky top-0 z-10 flex w-full items-center gap-2 bg-background px-2 py-1.5 text-left hover:bg-secondary/50 transition-colors",
                        groupDimmed && FILTER_DIM_CLASS,
                      )}
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
                      {seg.group.durationSecs != null && (
                        <span className="ml-auto text-label text-faint shrink-0">
                          {formatDuration(seg.group.durationSecs)}
                        </span>
                      )}
                    </button>
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
    </div>
  );
}

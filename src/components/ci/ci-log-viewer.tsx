import { useEffect, useRef, useMemo } from "react";
import { ArrowLeft, Loader2, ExternalLink } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { openUrl } from "@/lib/commands";
import { formatDuration } from "@/lib/ci-utils";

/**
 * Convert basic ANSI escape codes to styled HTML spans.
 * Supports: 8 standard colors (30-37), bright (90-97), bold (1), dim (2), reset (0).
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
      const end = text.indexOf("m", i + 2);
      if (end === -1) { i++; continue; }

      const codes = text.slice(i + 2, end).split(";").map(Number);
      i = end + 1;

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
    } else {
      const char = text[i];
      if (char === "<") result += "&lt;";
      else if (char === ">") result += "&gt;";
      else if (char === "&") result += "&amp;";
      else result += char;
      i++;
    }
  }
  if (open) result += "</span>";
  return result;
}

export function CiLogViewer() {
  const ciJobLog = useRepoStore((s) => s.ciJobLog);
  const selectedJobId = useRepoStore((s) => s.ciSelectedJobId);
  const jobsMap = useRepoStore((s) => s.ciJobsMap);
  const pipelines = useRepoStore((s) => s.ciPipelines);
  const selectedPipelineId = useRepoStore((s) => s.ciSelectedPipelineId);
  const clearCiJobLog = useRepoStore((s) => s.clearCiJobLog);
  const containerRef = useRef<HTMLDivElement>(null);

  const jobs = selectedPipelineId != null ? (jobsMap[selectedPipelineId] ?? []) : [];
  const selectedJob = jobs.find((j) => j.id === selectedJobId);
  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  const htmlContent = useMemo(
    () => (ciJobLog ? ansiToHtml(ciJobLog) : null),
    [ciJobLog],
  );

  // Auto-scroll to bottom on first load
  useEffect(() => {
    if (htmlContent && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [htmlContent]);

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearCiJobLog();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [clearCiJobLog]);

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

        {selectedPipeline?.url && (
          <button
            onClick={() => openUrl(selectedPipeline.url)}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
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
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-3"
        >
          <pre
            className="font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all"
            dangerouslySetInnerHTML={{ __html: htmlContent ?? "" }}
          />
        </div>
      )}
    </div>
  );
}

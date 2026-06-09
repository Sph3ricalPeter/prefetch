import { useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Check,
  X,
  Ban,
  CircleDot,
  CircleCheck,
  CircleX,
  CircleAlert,
  CircleDashed,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Workflow,
  GitPullRequest,
  CalendarClock,
  Play,
  Zap,
  Code,
  Timer,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { SectionCount } from "@/components/ui/section-count";
import { openUrl } from "@/lib/commands";
import { formatDuration, effectivePipelineStatus } from "@/lib/ci-utils";
import type { PipelineStatus, Pipeline, CiJob } from "@/types/git";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clean up ugly forge ref names into something readable.
 *  GitLab MR:  refs/merge-requests/176/head  →  !176
 *  GitHub PR:  refs/pull/42/head             →  #42
 *  Otherwise:  return as-is (e.g. "dev", "main") */
function cleanBranchName(raw: string): string {
  const glMr = raw.match(/^refs\/merge-requests\/(\d+)\//);
  if (glMr) return `!${glMr[1]}`;
  const ghPr = raw.match(/^refs\/pull\/(\d+)\//);
  if (ghPr) return `#${ghPr[1]}`;
  return raw;
}

function PipelineStatusIcon({ status, className = "h-3 w-3" }: { status: PipelineStatus; className?: string }) {
  switch (status) {
    case "success":
      return <Workflow className={`${className} text-green-400`} />;
    case "warning":
      return <Workflow className={`${className} text-orange-400`} />;
    case "failure":
      return <Workflow className={`${className} text-red-400`} />;
    case "in_progress":
      return <Loader2 className={`${className} text-yellow-400 animate-spin`} />;
    case "queued":
      return <Workflow className={`${className} text-muted-foreground`} />;
    case "cancelled":
      return <Workflow className={`${className} text-muted-foreground`} />;
    default:
      return <Workflow className={`${className} text-muted-foreground`} />;
  }
}

function JobStatusIcon({ status, className = "h-3 w-3" }: { status: PipelineStatus; className?: string }) {
  switch (status) {
    case "success":
      return <CircleCheck className={`${className} text-green-400`} />;
    case "warning":
      return <CircleAlert className={`${className} text-orange-400`} />;
    case "failure":
      return <CircleX className={`${className} text-red-400`} />;
    case "in_progress":
      return <Loader2 className={`${className} text-yellow-400 animate-spin`} />;
    case "queued":
      return <CircleDashed className={`${className} text-muted-foreground`} />;
    case "cancelled":
      return <Ban className={`${className} text-muted-foreground`} />;
    default:
      return <CircleDot className={`${className} text-muted-foreground`} />;
  }
}


function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Source icon + tooltip for pipeline trigger type. */
function SourceIcon({ source }: { source: string | null }) {
  if (!source) return null;
  const cls = "h-3 w-3 shrink-0";
  let icon: React.ReactNode;
  let label: string;
  switch (source) {
    // Common — both forges
    case "push": return null; // default trigger — no icon needed
    case "schedule":
      icon = <CalendarClock className={`${cls} text-emerald-400`} />;
      label = "Scheduled";
      break;
    // GitLab sources
    case "merge_request_event":
      icon = <GitPullRequest className={`${cls} text-blue-400`} />;
      label = "Merge request";
      break;
    case "web":
      icon = <Play className={`${cls} text-purple-400`} />;
      label = "Manual";
      break;
    case "trigger":
      icon = <Zap className={`${cls} text-yellow-400`} />;
      label = "Trigger";
      break;
    case "api":
      icon = <Code className={`${cls} text-muted-foreground`} />;
      label = "API";
      break;
    // GitHub event types
    case "pull_request":
    case "pull_request_target":
      icon = <GitPullRequest className={`${cls} text-blue-400`} />;
      label = "Pull request";
      break;
    case "workflow_dispatch":
      icon = <Play className={`${cls} text-purple-400`} />;
      label = "Manual";
      break;
    case "repository_dispatch":
      icon = <Zap className={`${cls} text-yellow-400`} />;
      label = "Dispatch";
      break;
    default:
      return null; // unknown source — don't clutter
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Renders the pipeline id, name/branch, and source icon.
 *  GitHub pipelines have a workflow name → show "name · branch".
 *  GitLab pipelines don't → show "#id branch" + source icon. */
function PipelineLabel({ pipeline, branch }: { pipeline: Pipeline; branch: string }) {
  if (pipeline.name) {
    // GitHub: workflow name is the primary label, branch secondary
    return (
      <>
        <span className="text-foreground truncate min-w-0 flex-1">{pipeline.name}</span>
        <span className="text-muted-foreground shrink-0">·</span>
        <span className="shrink-0 text-muted-foreground">{branch}</span>
        <SourceIcon source={pipeline.source} />
      </>
    );
  }
  // GitLab (no workflow name): #id + branch + source
  return (
    <>
      <span className="text-foreground shrink-0">#{pipeline.id}</span>
      <span className="truncate flex-1 text-muted-foreground">{branch}</span>
      <SourceIcon source={pipeline.source} />
    </>
  );
}


function HeaderStatusIcon({ status }: { status: PipelineStatus }) {
  const cls = "h-2.5 w-2.5 shrink-0";
  switch (status) {
    case "success":
      return <Check className={`${cls} text-green-400`} />;
    case "warning":
      return <AlertTriangle className={`${cls} text-orange-400`} />;
    case "failure":
      return <X className={`${cls} text-red-400`} />;
    case "in_progress":
      return <Loader2 className={`${cls} text-yellow-400 animate-spin`} />;
    case "queued":
      return <Clock className={`${cls} text-muted-foreground`} />;
    case "cancelled":
      return <Ban className={`${cls} text-muted-foreground`} />;
    default:
      return <CircleDot className={`${cls} text-muted-foreground`} />;
  }
}

// ── CiList ───────────────────────────────────────────────────────────────────

export function CiList() {
  const isOpen = useRepoStore((s) => s.sidebarSections.ci);
  const setSidebarSection = useRepoStore((s) => s.setSidebarSection);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const allPipelines = useRepoStore((s) => s.ciPipelines);
  const filter = useRepoStore((s) => s.filterQuery);
  const jobsMap = useRepoStore((s) => s.ciJobsMap);
  const selectedPipelineId = useRepoStore((s) => s.ciSelectedPipelineId);
  const selectedJobId = useRepoStore((s) => s.ciSelectedJobId);
  const ciLoading = useRepoStore((s) => s.ciLoading);
  const loadCiPipelines = useRepoStore((s) => s.loadCiPipelines);
  const toggleCiPipeline = useRepoStore((s) => s.toggleCiPipeline);
  const loadCiJobLog = useRepoStore((s) => s.loadCiJobLog);

  // Load pipelines when section opens
  useEffect(() => {
    if (isOpen && forgeStatus?.has_token) {
      loadCiPipelines();
    }
  }, [isOpen, forgeStatus?.has_token, loadCiPipelines]);

  // Filter by workflow name, branch (raw + cleaned), or pipeline id
  const pipelines = useMemo(() => {
    if (!filter) return allPipelines;
    const q = filter.toLowerCase();
    return allPipelines.filter((p) =>
      [p.name ?? "", p.branch, cleanBranchName(p.branch), `#${p.id}`].some((f) =>
        f.toLowerCase().includes(q),
      ),
    );
  }, [allPipelines, filter]);

  const hasForge = forgeStatus?.has_token;
  // Status icon reflects the latest pipeline overall, independent of filtering
  const latestJobs = allPipelines[0] ? (jobsMap[allPipelines[0].id] ?? []) : [];
  const latestStatus = allPipelines[0]
    ? effectivePipelineStatus(allPipelines[0], latestJobs)
    : undefined;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={() => setSidebarSection("ci", !isOpen)}
          className="flex items-center gap-1 text-label font-semibold text-muted-foreground uppercase tracking-[0.06em] hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          CI
          {latestStatus && <HeaderStatusIcon status={latestStatus} />}
          {allPipelines.length > 0 && (
            <SectionCount
              filtered={pipelines.length}
              total={allPipelines.length}
              className="font-normal"
            />
          )}
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => loadCiPipelines()}
              disabled={ciLoading || !isOpen || !hasForge}
              className={`ml-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40 ${
                isOpen && hasForge ? "" : "invisible"
              }`}
            >
              <RefreshCw className={`h-3 w-3 ${ciLoading ? "animate-spin" : ""}`} />
            </button>
          </TooltipTrigger>
          {isOpen && hasForge && <TooltipContent>Refresh pipelines</TooltipContent>}
        </Tooltip>
      </div>

      {/* Content */}
      {isOpen && (
        <div>
          {!hasForge && (
            <p className="px-3 py-1 text-xs text-faint">Connect a forge to see CI pipelines</p>
          )}

          {hasForge && allPipelines.length === 0 && !ciLoading && (
            <p className="px-3 py-1 text-xs text-faint">No pipelines found</p>
          )}

          {hasForge &&
            allPipelines.length > 0 &&
            pipelines.length === 0 &&
            !ciLoading && (
              <p className="px-3 py-1 text-xs text-faint">No matching pipelines</p>
            )}

          {hasForge && ciLoading && allPipelines.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-1 text-xs text-faint">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          )}

          {pipelines.map((pipeline) => (
            <PipelineEntry
              key={pipeline.id}
              pipeline={pipeline}
              isExpanded={pipeline.id === selectedPipelineId}
              jobs={jobsMap[pipeline.id] ?? []}
              selectedJobId={selectedJobId}
              onToggle={() => toggleCiPipeline(pipeline.id)}
              onJobClick={(jobId) => loadCiJobLog(jobId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── PipelineEntry ────────────────────────────────────────────────────────────

function PipelineEntry({
  pipeline,
  isExpanded,
  jobs,
  selectedJobId,
  onToggle,
  onJobClick,
}: {
  pipeline: Pipeline;
  isExpanded: boolean;
  jobs: CiJob[];
  selectedJobId: number | null;
  onToggle: () => void;
  onJobClick: (jobId: number) => void;
}) {
  const status = effectivePipelineStatus(pipeline, jobs);
  const branch = cleanBranchName(pipeline.branch);

  return (
    <div>
      <button
        onClick={onToggle}
        title={pipeline.branch !== branch ? pipeline.branch : undefined}
        className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs transition-colors ${
          isExpanded
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        }`}
      >
        {isExpanded ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0" />
        )}
        <PipelineStatusIcon status={status} />
        <PipelineLabel pipeline={pipeline} branch={branch} />
        {pipeline.duration_secs != null && (
          <span className="flex items-center gap-0.5 shrink-0 text-muted-foreground">
            <Timer className="h-3 w-3" />
            <span className="text-label">{formatDuration(pipeline.duration_secs)}</span>
          </span>
        )}
        <span className="text-faint text-label shrink-0">
          {formatTimeAgo(pipeline.created_at)}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                openUrl(pipeline.url);
              }}
              className="shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Open in browser</TooltipContent>
        </Tooltip>
      </button>

      {isExpanded && jobs.length > 0 && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[1.85rem] top-2 bottom-2 w-px bg-border" />

          {jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => onJobClick(job.id)}
              className={`relative flex w-full items-center gap-1.5 pl-7 pr-3 py-0.5 text-left text-xs transition-colors ${
                job.id === selectedJobId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {/* Icon sits on top of the timeline line */}
              <span className="relative z-10 shrink-0 bg-background rounded-full">
                <JobStatusIcon status={job.status} />
              </span>
              <span className="truncate flex-1">{job.name}</span>
              {job.duration_secs != null && (
                <span className="flex items-center gap-0.5 shrink-0 text-faint">
                  <Timer className="h-3 w-3" />
                  <span className="text-label">{formatDuration(job.duration_secs)}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

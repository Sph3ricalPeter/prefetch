import type { PipelineStatus, Pipeline, CiJob } from "@/types/git";

export function formatDuration(secs: number | null): string {
  if (secs == null) return "";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function effectivePipelineStatus(pipeline: Pipeline, jobs: CiJob[]): PipelineStatus {
  if (jobs.length === 0) return pipeline.status;
  if (jobs.some((j) => j.status === "failure")) return "failure";
  if (jobs.some((j) => j.status === "warning")) return "warning";
  if (jobs.some((j) => j.status === "in_progress")) return "in_progress";
  if (jobs.some((j) => j.status === "queued")) return "queued";
  return pipeline.status;
}

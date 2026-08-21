import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, X, type LucideIcon } from "lucide-react";
import { IconButton } from "./icon-button";
import { CopyButton } from "./copy-button";

export interface StepInfo {
  label: string;
  status: "pending" | "running" | "done" | "failed";
  durationMs?: number;
}

export interface MultiStepState {
  title: string;
  steps: StepInfo[];
  error?: string;
  /** The action's icon, shown once the run settles; the spinner owns the slot
   *  until then. Resolved by MultiStepAction so this stays a dumb renderer —
   *  same shape as ContextMenuItem's `icon`. */
  icon?: LucideIcon;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MultiStepToast({
  state,
  onDismiss,
}: {
  state: MultiStepState;
  onDismiss?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  const runningStep = state.steps.find((s) => s.status === "running");
  const completedCount = state.steps.filter((s) => s.status === "done").length;
  const total = state.steps.length;
  const failed = state.steps.some((s) => s.status === "failed");
  const allDone = completedCount === total && !failed;
  const progress = total > 0 ? (completedCount / total) * 100 : 0;

  const runningLabel = runningStep?.label;
  useEffect(() => {
    if (!runningLabel) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [runningLabel]);

  return (
    <div className="w-full rounded-md border border-foreground/15 bg-card p-3 shadow-xl text-foreground">
      <div className="flex items-center gap-2 mb-2">
        {(allDone || failed) && state.icon ? (
          <state.icon
            className={`h-4 w-4 shrink-0 ${failed ? "text-destructive" : "text-green-500"}`}
          />
        ) : allDone ? (
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        ) : failed ? (
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-medium truncate">{state.title}</span>
        <span className="ml-auto text-caption text-muted-foreground shrink-0">
          {completedCount}/{total}
        </span>
        {failed && onDismiss && (
          <IconButton size="sm" variant="subtle" title="Dismiss" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-secondary mb-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${allDone ? 100 : progress}%` }}
        />
      </div>

      {/* Step list */}
      <div className="space-y-1">
        {state.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-label">
            {step.status === "done" ? (
              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
            ) : step.status === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            ) : step.status === "failed" ? (
              <XCircle className="h-3 w-3 text-destructive shrink-0" />
            ) : (
              <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />
            )}
            <span className={step.status === "running" ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
            {step.status === "running" && elapsed > 0 && (
              <span className="ml-auto text-muted-foreground">{formatElapsed(elapsed)}</span>
            )}
            {step.status === "done" && step.durationMs != null && (
              <span className="ml-auto text-muted-foreground">{formatElapsed(step.durationMs)}</span>
            )}
          </div>
        ))}
      </div>

      {state.error && (
        <div className="mt-2 flex items-start gap-1">
          <p className="text-label text-destructive line-clamp-4 whitespace-pre-wrap break-words">
            {state.error}
          </p>
          <CopyButton
            text={`${state.title}

${state.error}`}
            title="Copy full error"
            className="ml-auto shrink-0"
          />
        </div>
      )}
    </div>
  );
}

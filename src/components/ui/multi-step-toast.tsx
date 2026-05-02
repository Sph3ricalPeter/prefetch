import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export interface StepInfo {
  label: string;
  status: "pending" | "running" | "done" | "failed";
  durationMs?: number;
}

export interface MultiStepState {
  title: string;
  steps: StepInfo[];
  error?: string;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MultiStepToast({ state }: { state: MultiStepState }) {
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
    <div className="w-[320px] rounded-lg border border-border bg-card p-3 shadow-lg text-foreground">
      <div className="flex items-center gap-2 mb-2">
        {allDone ? (
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
          <div key={i} className="flex items-center gap-2 text-caption">
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
        <p className="mt-2 text-caption text-destructive truncate">{state.error}</p>
      )}
    </div>
  );
}

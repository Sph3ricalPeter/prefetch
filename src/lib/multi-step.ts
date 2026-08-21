import { toast } from "sonner";
import { createElement } from "react";
import { MultiStepToast, type MultiStepState } from "@/components/ui/multi-step-toast";
import { actionIcon, type ActionName } from "@/lib/action-icons";

export class MultiStepAction {
  private state: MultiStepState;
  private toastId: string | number;
  private stepStart = 0;

  constructor(title: string, stepLabels: string[], action?: ActionName) {
    this.state = {
      title,
      icon: action ? actionIcon(action) : undefined,
      steps: stepLabels.map((label) => ({ label, status: "pending" })),
    };
    this.toastId = toast.custom(() => createElement(MultiStepToast, { state: { ...this.state } }), {
      duration: Infinity,
    });
  }

  startStep(index: number): void {
    this.state.steps[index] = { ...this.state.steps[index], status: "running" };
    this.stepStart = Date.now();
    this.render();
  }

  completeStep(index: number): void {
    this.state.steps[index] = {
      ...this.state.steps[index],
      status: "done",
      durationMs: Date.now() - this.stepStart,
    };
    this.render();
  }

  failStep(index: number, error: string): void {
    this.state.steps[index] = { ...this.state.steps[index], status: "failed" };
    this.state.error = error;
    this.render();
  }

  finish(autoDismissMs = 3000): void {
    this.render(autoDismissMs);
  }

  runningStepIndex(): number {
    return this.state.steps.findIndex((s) => s.status === "running");
  }

  dismiss(): void {
    toast.dismiss(this.toastId);
  }

  private render(duration?: number): void {
    const snapshot = {
      ...this.state,
      steps: this.state.steps.map((s) => ({ ...s })),
    };
    toast.custom(
      () =>
        createElement(MultiStepToast, { state: snapshot, onDismiss: () => this.dismiss() }),
      { id: this.toastId, duration: duration ?? Infinity },
    );
  }
}

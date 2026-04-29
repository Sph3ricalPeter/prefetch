import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { useUpdaterStore } from "@/stores/updater-store";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/**
 * Inline titlebar indicator that surfaces update state to the user.
 *
 * Hidden when idle/checking (nothing to act on). Appears when an update
 * is available and walks the user through download → restart.
 *
 * Designed to sit in the titlebar right section, before the window controls.
 */
export function UpdateIndicator() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.availableVersion);
  const progress = useUpdaterStore((s) => s.downloadProgress);
  const error = useUpdaterStore((s) => s.error);
  const startDownload = useUpdaterStore((s) => s.startDownload);
  const applyAndRestart = useUpdaterStore((s) => s.applyAndRestart);
  const dismissError = useUpdaterStore((s) => s.dismissError);

  // Nothing to show
  if (status === "idle" || status === "checking") return null;

  const handleClick = () => {
    switch (status) {
      case "available":
        startDownload();
        break;
      case "ready":
        applyAndRestart();
        break;
      case "error":
        dismissError();
        break;
    }
  };

  const isClickable =
    status === "available" || status === "ready" || status === "error";

  const tooltipText =
    status === "available"
      ? "Download update"
      : status === "downloading"
        ? `Downloading update… ${progress}%`
        : status === "ready"
          ? "Restart to apply update"
          : status === "restarting"
            ? "Restarting…"
            : `Update failed: ${error ?? "unknown error"} — click to dismiss`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={!isClickable}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
            status === "ready"
              ? "border-primary/50 bg-primary/10 text-foreground hover:bg-primary/20"
              : status === "error"
                ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
                : status === "available"
                  ? "border-border text-foreground hover:bg-secondary"
                  : "border-border text-muted-foreground"
          }`}
        >
          {status === "available" && (
            <>
              <Download className="h-3 w-3" />
              <span>Update v{version}</span>
            </>
          )}

          {status === "downloading" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{progress}%</span>
            </>
          )}

          {status === "ready" && (
            <>
              <RefreshCw className="h-3 w-3" />
              <span>Restart</span>
            </>
          )}

          {status === "restarting" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Restarting…</span>
            </>
          )}

          {status === "error" && (
            <>
              <X className="h-3 w-3" />
              <span>Update failed</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { useUpdaterStore } from "@/stores/updater-store";

/**
 * Persistent bottom-right pill that surfaces update state to the user.
 *
 * Hidden when idle/checking (nothing to act on). Appears when an update
 * is available and walks the user through download → restart.
 */
export function UpdateIndicator() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.availableVersion);
  const progress = useUpdaterStore((s) => s.downloadProgress);
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

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isClickable}
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg transition-colors ${
        status === "ready"
          ? "border-primary bg-primary/10 text-foreground hover:bg-primary/20"
          : status === "error"
            ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
            : status === "available"
              ? "border-border bg-popover text-foreground hover:bg-secondary"
              : "border-border bg-popover text-muted-foreground"
      }`}
    >
      {status === "available" && (
        <>
          <Download className="h-3.5 w-3.5" />
          <span>Update v{version}</span>
        </>
      )}

      {status === "downloading" && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Downloading {progress}%</span>
        </>
      )}

      {status === "ready" && (
        <>
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Restart to update</span>
        </>
      )}

      {status === "restarting" && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Restarting…</span>
        </>
      )}

      {status === "error" && (
        <>
          <X className="h-3.5 w-3.5" />
          <span>Update failed</span>
        </>
      )}
    </button>
  );
}

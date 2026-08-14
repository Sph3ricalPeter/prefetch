import { AlertTriangle, Download, Loader2, RefreshCw } from "lucide-react";
import { useUpdaterStore } from "@/stores/updater-store";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/**
 * Icon-only titlebar indicator for the updater. Always visible, so the check
 * is one click away even when the app is up to date.
 *
 * Idle → plain download (click re-checks) · checking/downloading/restarting →
 * spinner · available → green download (click downloads, tooltip lists the
 * release notes) · ready → green restart · error → yellow warning (click
 * retries). The tooltip carries the wording for the current state.
 */
export function UpdateIndicator() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.availableVersion);
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes);
  const progress = useUpdaterStore((s) => s.downloadProgress);
  const error = useUpdaterStore((s) => s.error);
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
  const startDownload = useUpdaterStore((s) => s.startDownload);
  const applyAndRestart = useUpdaterStore((s) => s.applyAndRestart);

  const busy =
    status === "checking" ||
    status === "downloading" ||
    status === "restarting";

  const handleClick = () => {
    if (status === "available") startDownload();
    else if (status === "ready") applyAndRestart();
    else checkForUpdate();
  };

  const label =
    status === "checking"
      ? "Fetching updates…"
      : status === "available"
        ? `Update v${version} available — click to download`
        : status === "downloading"
          ? `Downloading update… ${progress}%`
          : status === "ready"
            ? `v${version} downloaded — click to restart and apply`
            : status === "restarting"
              ? "Restarting…"
              : status === "error"
                ? "Failed to fetch version — click to retry"
                : "Up to date — click to check for updates";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          aria-label={label}
          className={`flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed ${
            status === "available" || status === "ready"
              ? "text-green-400 hover:text-green-300"
              : status === "error"
                ? "text-yellow-400 hover:text-yellow-300"
                : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : status === "ready" ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : status === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{label}</p>
        {status === "error" && error && (
          <p className="mt-1 text-muted-foreground">{error}</p>
        )}
        {status === "available" && releaseNotes && (
          <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-line border-t border-border pt-1.5 text-muted-foreground">
            {releaseNotes}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

import { useState, useEffect } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteUiState, getUiState, setUiState } from "@/lib/database";
import { useUpdaterStore } from "@/stores/updater-store";
import { useRepoStore } from "@/stores/repo-store";
import { setFetchInterval as setFetchIntervalCmd } from "@/lib/commands";
import { DATE_FORMATS } from "@/lib/date-format";

/** UI-state keys that hold visual / layout preferences (themes, fonts, panel
 *  widths, diff display modes, graph column visibility + date format). Reset
 *  by the "Reset layout & appearance" button. Behavioral keys (auto-fetch,
 *  conflict auto-resolve, profile selection, recents) are deliberately not
 *  touched. */
const VISUAL_LAYOUT_KEYS = [
  "app_theme",
  "code_theme",
  "font_family",
  "mono_font",
  "font_scale",
  "sidebar_width",
  "detail_width",
  "diff_view_mode",
  "image_diff_view_mode",
  "diff_wrap_lines",
  "file_view_mode",
  "graph_column_visibility",
  "graph_date_format",
];
/** Per-repo graph layout entries are stored as `graph_layout:<repoPath>` — wipe
 *  every variant by prefix. */
const VISUAL_LAYOUT_PREFIXES = ["graph_layout:"];

const FETCH_INTERVALS = [
  { label: "1 minute", value: "60" },
  { label: "5 minutes", value: "300" },
  { label: "10 minutes", value: "600" },
  { label: "30 minutes", value: "1800" },
  { label: "Disabled", value: "0" },
];

const VIEW_MODES = [
  { label: "Flat list", value: "flat" },
  { label: "Tree view", value: "tree" },
];

export function GeneralSection() {
  const [fetchInterval, setFetchInterval] = useState("300");
  const [fileViewMode, setFileViewMode] = useState("flat");
  const dateFormat = useRepoStore((s) => s.graphDateFormat);
  const setGraphDateFormat = useRepoStore((s) => s.setGraphDateFormat);
  const [autoReopen, setAutoReopen] = useState(false);
  const [conflictAutoResolve, setConflictAutoResolve] = useState(false);

  useEffect(() => {
    getUiState("auto_fetch_interval").then((v) => {
      if (v) {
        setFetchInterval(v);
        setFetchIntervalCmd(parseInt(v, 10)).catch(() => {});
      }
    }).catch(() => {});
    getUiState("file_view_mode").then((v) => {
      if (v) setFileViewMode(v);
    }).catch(() => {});
    getUiState("auto_reopen_last_repo").then((v) => {
      if (v === "true") setAutoReopen(true);
    }).catch(() => {});
    getUiState("conflict_auto_resolve").then((v) => {
      if (v === "true") setConflictAutoResolve(true);
    }).catch(() => {});
  }, []);

  const handleFetchIntervalChange = (value: string) => {
    setFetchInterval(value);
    setUiState("auto_fetch_interval", value).catch(() => {});
    setFetchIntervalCmd(parseInt(value, 10)).catch(() => {});
  };

  const handleViewModeChange = (value: string) => {
    setFileViewMode(value);
    setUiState("file_view_mode", value).catch(() => {});
  };

  const handleDateFormatChange = (value: string) => {
    if (value === "relative" || value === "short" || value === "long" || value === "iso") {
      setGraphDateFormat(value);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">General</h2>
        <p className="text-xs text-muted-foreground">
          Application-wide preferences.
        </p>
      </div>

      {/* Auto-fetch interval */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          Auto-fetch interval
        </label>
        <p className="text-xs text-muted-foreground">
          How often to automatically fetch from remotes in the background.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FETCH_INTERVALS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleFetchIntervalChange(opt.value)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                fetchInterval === opt.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reopen last repo */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          Startup
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={autoReopen}
            onCheckedChange={(v) => {
              const checked = v === true;
              setAutoReopen(checked);
              setUiState("auto_reopen_last_repo", checked ? "true" : "false").catch(() => {});
            }}
          />
          <span className="text-xs text-foreground select-none">
            Reopen last repository on startup
          </span>
        </label>
      </div>

      {/* Conflict auto-resolve */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          Conflicts
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={conflictAutoResolve}
            onCheckedChange={(v) => {
              const checked = v === true;
              setConflictAutoResolve(checked);
              setUiState("conflict_auto_resolve", checked ? "true" : "false").catch(() => {});
            }}
            className="mt-0.5"
          />
          <div className="select-none">
            <span className="text-xs text-foreground flex items-center gap-1.5">
              Auto-resolve files with no real conflicts
              <span className="text-caption font-semibold uppercase tracking-wider text-amber-500 border border-amber-500/30 rounded px-1 py-px leading-none">
                Experimental
              </span>
            </span>
            <p className="text-label text-muted-foreground mt-0.5">
              During rebase, automatically save files where all changes were made by only one side.
            </p>
          </div>
        </label>
      </div>

      {/* Updates */}
      <UpdatesSection />

      {/* Default file view */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          Default file view
        </label>
        <p className="text-xs text-muted-foreground">
          How changed files are displayed in the staging area.
        </p>
        <div className="flex gap-1.5">
          {VIEW_MODES.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleViewModeChange(opt.value)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                fileViewMode === opt.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date format */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-foreground">
          Date format
        </label>
        <p className="text-xs text-muted-foreground">
          How dates are displayed in the commit graph.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DATE_FORMATS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => handleDateFormatChange(opt.id)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                dateFormat === opt.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {opt.label}
              <span className="ml-1.5 text-muted-foreground">{opt.example}</span>
            </button>
          ))}
        </div>
      </div>

      <ResetLayoutSection />
    </div>
  );
}

function ResetLayoutSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await deleteUiState({
        keys: VISUAL_LAYOUT_KEYS,
        prefixes: VISUAL_LAYOUT_PREFIXES,
      });
      // Reload the webview so every store re-initialises from defaults.
      window.location.reload();
    } catch {
      setResetting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-foreground">
        Reset layout &amp; appearance
      </label>
      <p className="text-xs text-muted-foreground">
        Clears column widths, panel sizes, theme, fonts, and diff view
        preferences. Repos, profiles, and behavior settings are kept.
      </p>
      {confirmOpen ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-destructive/20 disabled:opacity-60"
          >
            {resetting && <Loader2 className="h-3 w-3 animate-spin" />}
            Confirm reset &amp; reload
          </button>
          <button
            onClick={() => setConfirmOpen(false)}
            disabled={resetting}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Reset to defaults
        </button>
      )}
    </div>
  );
}

function UpdatesSection() {
  const status = useUpdaterStore((s) => s.status);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);
  const availableVersion = useUpdaterStore((s) => s.availableVersion);
  const downloadProgress = useUpdaterStore((s) => s.downloadProgress);
  const error = useUpdaterStore((s) => s.error);
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
  const startDownload = useUpdaterStore((s) => s.startDownload);
  const applyAndRestart = useUpdaterStore((s) => s.applyAndRestart);

  const isChecking = status === "checking";
  const isBusy =
    status === "downloading" || status === "restarting" || status === "checking";

  // Derive button label and action based on updater state
  let buttonLabel: string;
  let buttonAction: () => void;
  let buttonHighlighted = false;

  if (isChecking) {
    buttonLabel = "Checking…";
    buttonAction = () => {};
  } else if (status === "available") {
    buttonLabel = `Update to v${availableVersion}`;
    buttonAction = startDownload;
    buttonHighlighted = true;
  } else if (status === "downloading") {
    buttonLabel = `Downloading… ${downloadProgress}%`;
    buttonAction = () => {};
  } else if (status === "ready") {
    buttonLabel = "Restart to Apply";
    buttonAction = applyAndRestart;
    buttonHighlighted = true;
  } else if (status === "restarting") {
    buttonLabel = "Restarting…";
    buttonAction = () => {};
  } else {
    buttonLabel = "Check for Updates";
    buttonAction = checkForUpdate;
  }

  let statusText: string | null;
  switch (status) {
    case "idle":
      statusText = availableVersion
        ? `Update available: v${availableVersion}`
        : "You’re up to date";
      break;
    case "available":
      statusText = `v${availableVersion} is ready to download`;
      break;
    case "ready":
      statusText = "Download complete — restart when ready";
      break;
    case "error":
      statusText = error ?? "Update check failed";
      break;
    default:
      statusText = null;
      break;
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-foreground">
        Updates
      </label>
      <p className="text-xs text-muted-foreground">
        Current version: v{currentVersion ?? "…"}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={buttonAction}
          disabled={isBusy && !buttonHighlighted}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
            isBusy && !buttonHighlighted
              ? "border-border text-muted-foreground opacity-60"
              : buttonHighlighted
                ? "border-primary/50 bg-primary/10 text-foreground hover:bg-primary/20"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          {isChecking && <Loader2 className="h-3 w-3 animate-spin" />}
          {buttonLabel}
        </button>
        {statusText && (
          <span
            className={`text-xs ${
              status === "error"
                ? "text-destructive"
                : status === "available" || status === "ready"
                  ? "text-primary"
                  : "text-muted-foreground"
            }`}
          >
            {statusText}
          </span>
        )}
      </div>
    </div>
  );
}

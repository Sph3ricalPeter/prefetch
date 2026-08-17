import { useState, useEffect } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteUiState, getUiState, setUiState } from "@/lib/database";
import { useUpdaterStore } from "@/stores/updater-store";
import { useRepoStore } from "@/stores/repo-store";
import { setFetchInterval as setFetchIntervalCmd } from "@/lib/commands";
import { DATE_FORMATS, type DateFormatId } from "@/lib/date-format";
import {
  SettingsHeader,
  SettingsGroup,
  SettingsRow,
  SettingsChoice,
} from "./settings-card";

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
  "diff_expand_context",
  "file_view_mode",
  "graph_column_visibility",
  "graph_date_format",
  "graph_density",
  "graph_dot_nodes",
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

/** DATE_FORMATS keyed as `value` for the shared segmented control. */
const DATE_FORMAT_OPTIONS = DATE_FORMATS.map((f) => ({
  label: f.label,
  value: f.id,
  example: f.example,
}));

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

  const handleDateFormatChange = (value: DateFormatId) => {
    setGraphDateFormat(value);
  };

  return (
    <div className="space-y-6">
      <SettingsHeader title="General" description="Application-wide preferences." />

      <SettingsGroup title="Behavior">
        <SettingsRow
          label="Background fetch interval"
          description="How often to fetch from remotes in the background. Opening a repository always fetches once, whatever this is set to."
        >
          <SettingsChoice
            options={FETCH_INTERVALS}
            value={fetchInterval}
            onChange={handleFetchIntervalChange}
          />
        </SettingsRow>

        <SettingsRow
          label="Reopen last repository on startup"
          description="Restores the repository you had open when the app launches."
          asLabel
        >
          <Checkbox
            checked={autoReopen}
            onCheckedChange={(v) => {
              const checked = v === true;
              setAutoReopen(checked);
              setUiState("auto_reopen_last_repo", checked ? "true" : "false").catch(() => {});
            }}
          />
        </SettingsRow>

        <SettingsRow
          label={
            <span className="flex items-center gap-1.5">
              Auto-resolve files with no real conflicts
              <span className="text-caption font-semibold uppercase tracking-wider text-amber-500 border border-amber-500/30 rounded-md px-1 py-px leading-none">
                Experimental
              </span>
            </span>
          }
          description="During rebase, automatically save files where all changes were made by only one side."
          asLabel
        >
          <Checkbox
            checked={conflictAutoResolve}
            onCheckedChange={(v) => {
              const checked = v === true;
              setConflictAutoResolve(checked);
              setUiState("conflict_auto_resolve", checked ? "true" : "false").catch(() => {});
            }}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Repository views">
        <SettingsRow
          label="Default file view"
          description="How changed files are displayed in the staging area."
        >
          <SettingsChoice
            options={VIEW_MODES}
            value={fileViewMode}
            onChange={handleViewModeChange}
          />
        </SettingsRow>

        <SettingsRow
          label="Date format"
          description="How dates are displayed in the commit graph."
          stack
        >
          <SettingsChoice
            options={DATE_FORMAT_OPTIONS}
            value={dateFormat}
            onChange={handleDateFormatChange}
          />
        </SettingsRow>
      </SettingsGroup>

      <UpdatesSection />

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
    <SettingsGroup title="Maintenance">
      <SettingsRow
        label="Reset layout &amp; appearance"
        description="Clears column widths, panel sizes, theme, fonts, and diff view preferences. Repos, profiles, and behavior settings are kept."
      >
        {confirmOpen ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-destructive/20 disabled:opacity-60"
            >
              {resetting && <Loader2 className="h-3 w-3 animate-spin" />}
              Confirm &amp; reload
            </button>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={resetting}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to defaults
          </button>
        )}
      </SettingsRow>
    </SettingsGroup>
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
    <SettingsGroup title="Updates">
      <SettingsRow
        label="Application updates"
        description={`Current version: v${currentVersion ?? "…"}`}
      >
        <div className="flex items-center gap-3">
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
          <button
            onClick={buttonAction}
            disabled={isBusy && !buttonHighlighted}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
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
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

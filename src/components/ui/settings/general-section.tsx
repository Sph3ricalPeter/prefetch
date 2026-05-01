import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { getUiState, setUiState } from "@/lib/database";
import { useUpdaterStore } from "@/stores/updater-store";
import { setFetchInterval as setFetchIntervalCmd } from "@/lib/commands";

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
  const [autoReopen, setAutoReopen] = useState(false);

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

  let statusText: string;
  switch (status) {
    case "idle":
      statusText = availableVersion
        ? `Update available: v${availableVersion}`
        : "You’re up to date";
      break;
    case "checking":
      statusText = "Checking for updates…";
      break;
    case "available":
      statusText = `v${availableVersion} is ready to download`;
      break;
    case "downloading":
      statusText = `Downloading… ${downloadProgress}%`;
      break;
    case "ready":
      statusText = "Download complete — restart when ready";
      break;
    case "restarting":
      statusText = "Restarting…";
      break;
    case "error":
      statusText = error ?? "Update check failed";
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
      </div>
    </div>
  );
}

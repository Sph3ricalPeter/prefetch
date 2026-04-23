import { useState, useEffect } from "react";
import { getUiState, setUiState } from "@/lib/database";

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

  useEffect(() => {
    getUiState("auto_fetch_interval").then((v) => {
      if (v) setFetchInterval(v);
    }).catch(() => {});
    getUiState("file_view_mode").then((v) => {
      if (v) setFileViewMode(v);
    }).catch(() => {});
  }, []);

  const handleFetchIntervalChange = (value: string) => {
    setFetchInterval(value);
    setUiState("auto_fetch_interval", value).catch(() => {});
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

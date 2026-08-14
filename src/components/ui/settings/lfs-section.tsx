import { useState, type KeyboardEvent } from "react";
import {
  X,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Database,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useRepoStore } from "@/stores/repo-store";
import { openUrl } from "@/lib/commands";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SettingsHeader, SettingsGroup, SettingsRow } from "./settings-card";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function LfsSection() {
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const isLoading = useRepoStore((s) => s.isLoading);
  const trackLfsPattern = useRepoStore((s) => s.trackLfsPattern);
  const untrackLfsPattern = useRepoStore((s) => s.untrackLfsPattern);
  const pruneLfsObjects = useRepoStore((s) => s.pruneLfsObjects);

  const [newPattern, setNewPattern] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAddPattern = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    await trackLfsPattern(pattern);
    setNewPattern("");
    setIsAdding(false);
  };

  const handlePatternKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddPattern();
    } else if (e.key === "Escape") {
      setIsAdding(false);
      setNewPattern("");
    }
  };

  return (
    <div className="space-y-6">
      <SettingsHeader
        title="Large File Storage (LFS)"
        description="Track and manage large binary files with Git LFS."
      />

      {!lfsInfo ? (
        <SettingsGroup>
          <SettingsRow
            label="No repository open"
            description="Open a repository to see its LFS status."
          />
        </SettingsGroup>
      ) : !lfsInfo.installed ? (
        <SettingsGroup>
          <SettingsRow
            label={
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                git-lfs not found
              </span>
            }
            description="Install git-lfs to manage large files in this repository."
          >
            <button
              type="button"
              onClick={() => openUrl("https://git-lfs.com")}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Install git-lfs
            </button>
          </SettingsRow>
        </SettingsGroup>
      ) : !lfsInfo.initialized ? (
        <SettingsGroup>
          <SettingsRow
            label="LFS not in use"
            description="This repository does not use LFS. It is configured automatically when you add tracked patterns."
          />
        </SettingsGroup>
      ) : (
        <>
          <SettingsGroup title="Status">
            <SettingsRow
              label={
                <span className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  LFS active
                </span>
              }
              description={`${lfsInfo.file_count} file${lfsInfo.file_count !== 1 ? "s" : ""}, ${formatBytes(lfsInfo.total_size)} — commit, push, and pull work normally.`}
            >
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="Tracked patterns">
            <SettingsRow
              label="Patterns"
              description="File globs stored in .gitattributes and handled by LFS."
              stack
            >
              {lfsInfo.tracked_patterns.length === 0 ? (
                <p className="text-xs text-faint italic">No patterns</p>
              ) : (
                <div className="space-y-1">
                  {lfsInfo.tracked_patterns.map((p) => (
                    <div
                      key={p.pattern}
                      className="group flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <span className="flex-1 font-mono">{p.pattern}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <IconButton
                            size="sm"
                            variant="subtle"
                            reveal="fade"
                            onClick={() => untrackLfsPattern(p.pattern)}
                            disabled={isLoading}
                            className="shrink-0 hover:bg-destructive/20 hover:text-destructive-foreground"
                          >
                            <X className="h-3 w-3" />
                          </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Untrack &quot;{p.pattern}&quot;</TooltipContent>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}

              {isAdding ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    type="text"
                    placeholder="*.psd"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    onKeyDown={handlePatternKeyDown}
                    className="flex-1 rounded-md bg-background border border-border px-2 py-0.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={handleAddPattern}
                    disabled={!newPattern.trim() || isLoading}
                    className="rounded-md bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                  <IconButton
                    size="sm"
                    variant="subtle"
                    onClick={() => {
                      setIsAdding(false);
                      setNewPattern("");
                    }}
                  >
                    <X className="h-3 w-3" />
                  </IconButton>
                </div>
              ) : (
                <button
                  onClick={() => setIsAdding(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Track pattern
                </button>
              )}
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="Maintenance">
            <SettingsRow
              label="Prune unreferenced objects"
              description="Runs git lfs prune to remove old LFS objects and reclaim disk space."
            >
              <button
                onClick={pruneLfsObjects}
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3 w-3" />
                Prune
              </button>
            </SettingsRow>
          </SettingsGroup>
        </>
      )}
    </div>
  );
}

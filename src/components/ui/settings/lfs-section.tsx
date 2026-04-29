import { useState, type KeyboardEvent } from "react";
import {
  X,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Database,
} from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { openUrl } from "@/lib/commands";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">
          Large File Storage (LFS)
        </h2>
        <p className="text-xs text-muted-foreground">
          Track and manage large binary files with Git LFS.
        </p>
      </div>

      {!lfsInfo ? (
        <div className="rounded-md border border-border bg-secondary px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Open a repository to see LFS status.
          </p>
        </div>
      ) : !lfsInfo.installed ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            git-lfs not found.{" "}
            <button
              type="button"
              onClick={() => openUrl("https://git-lfs.com")}
              className="underline"
            >
              Install git-lfs
            </button>{" "}
            to manage large files.
          </span>
        </div>
      ) : !lfsInfo.initialized ? (
        <div className="rounded-md border border-border bg-secondary px-4 py-3">
          <p className="text-xs text-muted-foreground">
            This repository does not use LFS. LFS will be automatically
            configured when you add tracked patterns.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status card */}
          <div className="flex items-center gap-3 rounded-md border border-border px-4 py-3">
            <Database className="h-5 w-5 text-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">LFS Active</p>
              <p className="text-label text-muted-foreground">
                {lfsInfo.file_count} file{lfsInfo.file_count !== 1 ? "s" : ""},{" "}
                {formatBytes(lfsInfo.total_size)}
              </p>
            </div>
            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          </div>

          <p className="text-xs text-muted-foreground">
            LFS files are handled automatically — commit, push, and pull
            work normally. No separate LFS operations needed.
          </p>

          {/* Tracked patterns */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-foreground">
              Tracked patterns
            </h3>
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
                        <button
                          onClick={() => untrackLfsPattern(p.pattern)}
                          disabled={isLoading}
                          className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive-foreground transition-all disabled:opacity-40"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Untrack &quot;{p.pattern}&quot;</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add pattern */}
          {isAdding ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="text"
                placeholder="*.psd"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={handlePatternKeyDown}
                className="flex-1 rounded bg-background border border-border px-2 py-0.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleAddPattern}
                disabled={!newPattern.trim() || isLoading}
                className="rounded-md bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewPattern("");
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
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

          {/* Prune */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={pruneLfsObjects}
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3 w-3" />
                Prune unreferenced objects
              </button>
            </TooltipTrigger>
            <TooltipContent>
              git lfs prune — remove old LFS objects to reclaim disk space
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

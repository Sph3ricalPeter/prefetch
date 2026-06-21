import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import {
  Database,
  AlertTriangle,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { SectionHeader } from "@/components/ui/section-header";
import { openUrl } from "@/lib/commands";

/** Format a byte count into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function LfsPanel() {
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const isLoading = useRepoStore((s) => s.isLoading);
  const initializeLfs = useRepoStore((s) => s.initializeLfs);
  const trackLfsPattern = useRepoStore((s) => s.trackLfsPattern);
  const untrackLfsPattern = useRepoStore((s) => s.untrackLfsPattern);
  const pruneLfsObjects = useRepoStore((s) => s.pruneLfsObjects);

  const [isOpen, setIsOpen] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const fullLoadedRef = useRef(false);

  // Load full LFS details on first expand (tracked patterns, file counts).
  // This is deferred because spawning git lfs Go binaries takes 2-5s on Windows.
  useEffect(() => {
    if (isOpen && lfsInfo?.initialized && !fullLoadedRef.current) {
      fullLoadedRef.current = true;
      useRepoStore.getState().loadLfsInfo(true);
    }
  }, [isOpen, lfsInfo?.initialized]);

  // Don't render if LFS info hasn't loaded yet
  if (!lfsInfo) return null;

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
    <div>
      {/* Section header */}
      <SectionHeader
        label="LFS"
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        className="px-3"
        badge={
          <span
            className={`ml-1 h-1.5 w-1.5 rounded-full ${
              lfsInfo.initialized
                ? "bg-green-500"
                : lfsInfo.installed
                  ? "bg-yellow-500"
                  : "bg-faint"
            }`}
          />
        }
        count={
          lfsInfo.initialized && lfsInfo.file_count > 0
            ? lfsInfo.file_count
            : undefined
        }
      />

      {isOpen && (
        <div className="px-3 pb-2 space-y-2">
          {/* Case 1: git-lfs not installed */}
          {!lfsInfo.installed && (
            <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
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
          )}

          {/* Case 2: installed but not initialised in this repo */}
          {lfsInfo.installed && !lfsInfo.initialized && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                LFS is not initialised in this repository.
              </p>
              <button
                onClick={initializeLfs}
                disabled={isLoading}
                className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                <Database className="h-3 w-3" />
                Initialize LFS
              </button>
            </div>
          )}

          {/* Case 3: initialised */}
          {lfsInfo.initialized && (
            <div className="space-y-2">
              {/* Version + size summary */}
              <p className="text-xs text-muted-foreground">
                {lfsInfo.file_count} file{lfsInfo.file_count !== 1 ? "s" : ""},{" "}
                {formatBytes(lfsInfo.total_size)}
              </p>

              {/* Tracked patterns */}
              <div className="space-y-0.5">
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
                      <TooltipContent>Untrack "{p.pattern}"</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
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
                    className="flex-1 rounded-md bg-background border border-border px-2 py-0.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={handleAddPattern}
                    disabled={!newPattern.trim() || isLoading}
                    className="rounded-md px-1.5 py-0.5 text-xs bg-accent hover:bg-accent/80 disabled:opacity-40 transition-colors"
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

              {/* Prune action */}
              <div className="flex items-center gap-1 pt-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={pruneLfsObjects}
                      disabled={isLoading}
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Prune
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    git lfs prune — remove unreferenced objects
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

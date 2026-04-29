import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import {
  Minus,
  Square,
  X,
  Copy,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  FolderOpen,
  FolderGit2,
  GitBranch,
  Undo2,
  Archive,
  ArchiveRestore,
  GitBranchPlus,
  MoreHorizontal,
} from "lucide-react";

/** Detect macOS — synchronous, safe to call at module level */
const IS_MAC = (() => {
  try { return platform() === "macos"; } catch { return false; }
})();
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { UpdateIndicator } from "@/components/update-indicator";

/** Lazily resolve the Tauri window handle — safe to import outside Tauri context */
let _appWindow: TauriWindow | null = null;
function getAppWindow(): TauriWindow | null {
  if (!_appWindow) {
    try {
      _appWindow = getCurrentWindow();
    } catch {
      // Outside Tauri (e.g. plain browser dev) — no window API
    }
  }
  return _appWindow;
}

export function Titlebar({ settingsOpen = false }: { settingsOpen?: boolean }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const win = getAppWindow();
    if (!win) return;

    // Check initial maximize state
    win.isMaximized().then(setIsMaximized).catch(() => {});

    // Listen for resize events to track maximize state
    let unlisten: (() => void) | undefined;
    win.onResized(async () => {
      const maximized = await win.isMaximized();
      setIsMaximized(maximized);
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  return (
    <div
      className="relative flex h-10 shrink-0 items-center border-b border-border bg-background select-none"
      data-tauri-drag-region
    >
      {/* Left: Brand — extra left padding on macOS for native traffic lights */}
      <div
        className="flex items-center gap-2.5 pr-4"
        style={{ paddingLeft: IS_MAC ? 78 : 14 }}
        data-tauri-drag-region
      >
        <PrefetchLogo className="h-4 w-4 shrink-0" />
        <span
          className="text-xs font-semibold tracking-tight text-foreground"
          data-tauri-drag-region
        >
          Prefetch
        </span>
        <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-caption font-medium uppercase tracking-wider text-brand">
          Alpha{appVersion ? ` v${appVersion}` : ""}{import.meta.env.DEV ? " DEV" : ""}
        </span>
      </div>

      {/* Repo switcher — left-aligned after brand, hidden in settings */}
      <div className="flex items-center min-w-0" data-tauri-drag-region>
        {!settingsOpen && <TitlebarRepoSwitcher />}
      </div>

      {/* Spacer — pushes window controls to the right */}
      <div className="flex-1 min-w-2" data-tauri-drag-region />

      {/* Center: Action buttons — absolutely centered in the titlebar so they
         stay at the true midpoint regardless of left/right content widths */}
      {!settingsOpen && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <TitlebarActionsGroup />
          </div>
        </div>
      )}

      {/* Right: Update indicator + Window controls */}
      <div className={`flex items-center gap-0.5 ${IS_MAC ? "pr-2.5" : "pr-0"}`}>
        <UpdateIndicator />
        {/* Window controls — Windows/Linux only (macOS uses native traffic lights) */}
        {!IS_MAC && (
          <>
            <div className="mx-1.5 h-4 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => getAppWindow()?.minimize()}
                  className="flex h-10 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Minimize</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => getAppWindow()?.toggleMaximize()}
                  className="flex h-10 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {isMaximized ? (
                    <Copy className="h-3 w-3" />
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{isMaximized ? "Restore" : "Maximize"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => getAppWindow()?.close()}
                  className="flex h-10 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500/20 hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

/** Repo switcher in the titlebar — shows current repo + branch + commit count */
function TitlebarRepoSwitcher() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const repoName = useRepoStore((s) => s.repoName);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const recentRepos = useRepoStore((s) => s.recentRepos);
  const openRepository = useRepoStore((s) => s.openRepository);
  const removeFromRecentRepos = useRepoStore((s) => s.removeFromRecentRepos);
  const profiles = useProfileStore((s) => s.profiles);
  const commits = useRepoStore((s) => s.commits); // Change 5: commit count

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleOpenRepo = useCallback(async () => {
    setIsOpen(false);
    const selected = await open({
      directory: true,
      title: "Open Git Repository",
    });
    if (selected) {
      await openRepository(selected);
    }
  }, [openRepository]);

  if (!repoPath) {
    return (
      <button
        onClick={handleOpenRepo}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span>Open Repository</span>
      </button>
    );
  }

  const otherRepos = recentRepos.filter((r) => r.path !== repoPath);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <span className="font-medium text-foreground">{repoName}</span>
        {currentBranch && (
          <>
            <span className="text-faint">/</span>
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {currentBranch}
            </span>
          </>
        )}
        {commits.length > 0 && (
          <>
            <span className="text-faint">&middot;</span>
            <span className="text-faint">
              {commits.length.toLocaleString()}
            </span>
          </>
        )}
        <ChevronDown className="h-3 w-3 text-faint" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-md border border-border bg-popover shadow-lg">
          <button
            onClick={handleOpenRepo}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Repository...
          </button>

          {otherRepos.length > 0 && (
            <>
              <div className="border-t border-border" />
              <p className="px-3 pt-2 pb-1 text-label text-faint uppercase tracking-wider font-medium">
                Recent
              </p>
              {otherRepos.map((repo) => {
                const profileName = repo.profile_id
                  ? profiles.find((p) => p.id === repo.profile_id)?.name
                  : null;
                return (
                  <div
                    key={repo.path}
                    className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary transition-colors"
                    onClick={() => {
                      setIsOpen(false);
                      openRepository(repo.path);
                    }}
                  >
                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs text-foreground truncate">{repo.name}</span>
                      <span className="text-label text-faint truncate">{repo.path}</span>
                    </div>
                    {profileName && (
                      <span className="shrink-0 rounded-sm bg-brand/10 px-1.5 py-0.5 text-caption font-medium text-brand-dim">
                        {profileName}
                      </span>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromRecentRepos(repo.path);
                          }}
                          className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Remove from recent</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Change 5: Responsive wrapper — shows inline buttons or collapsed dropdown */
function TitlebarActionsGroup() {
  // All hooks MUST be called before any early returns (React Rules of Hooks)
  const repoPath = useRepoStore((s) => s.repoPath);
  const isLoading = useRepoStore((s) => s.isLoading);
  const undoInfo = useRepoStore((s) => s.undoInfo);
  const undoAction = useRepoStore((s) => s.undo);
  const pushStash = useRepoStore((s) => s.pushStash);
  const popStash = useRepoStore((s) => s.popStash);
  const stashes = useRepoStore((s) => s.stashes);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const createBranch = useRepoStore((s) => s.createBranch);
  const fetchAction = useRepoStore((s) => s.fetch);
  const pullAction = useRepoStore((s) => s.pull);
  const pushAction = useRepoStore((s) => s.push);

  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Observe the full titlebar width to decide collapse.
    // Brand ~130px, repo switcher ~200px, window controls ~130px (0 on macOS),
    // action buttons need ~560px → collapse below ~960px total.
    const titlebar = container.closest("[data-tauri-drag-region]") as HTMLElement;
    if (!titlebar) return;
    const observer = new ResizeObserver(() => {
      const threshold = IS_MAC ? 830 : 960;
      setCollapsed(titlebar.clientWidth < threshold);
    });
    observer.observe(titlebar);
    return () => observer.disconnect();
  }, []);

  if (!repoPath) return null;

  if (collapsed) {
    return (
      <div ref={containerRef}>
        <CollapsedActionsDropdown />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex items-center gap-0.5">
      {/* Undo */}
      {undoInfo?.can_undo && (
        <>
          <TitlebarActionButton
            icon={<Undo2 className="h-3.5 w-3.5" />}
            label="Undo"
            tooltip={undoInfo.description}
            onClick={undoAction}
            disabled={isLoading}
          />
          <div className="mx-1.5 h-4 w-px bg-border" />
        </>
      )}

      {/* Stash / Pop */}
      <TitlebarActionButton
        icon={<Archive className="h-3.5 w-3.5" />}
        label="Stash"
        onClick={() => pushStash()}
        disabled={isLoading || fileStatuses.length === 0}
      />
      <TitlebarActionButton
        icon={<ArchiveRestore className="h-3.5 w-3.5" />}
        label="Pop"
        onClick={() => popStash(0)}
        disabled={isLoading || stashes.length === 0}
      />

      <div className="mx-1.5 h-4 w-px bg-border" />

      {/* Fetch / Pull / Push */}
      <TitlebarActionButton
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        label="Fetch"
        onClick={fetchAction}
        disabled={isLoading}
      />
      <TitlebarActionButton
        icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
        label="Pull"
        onClick={pullAction}
        disabled={isLoading}
      />
      <TitlebarActionButton
        icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
        label="Push"
        onClick={pushAction}
        disabled={isLoading}
      />

      <div className="mx-1.5 h-4 w-px bg-border" />

      {/* Branch */}
      {showBranchInput ? (
        <input
          type="text"
          placeholder="branch name..."
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newBranchName.trim()) {
              createBranch(newBranchName.trim());
              setNewBranchName("");
              setShowBranchInput(false);
            } else if (e.key === "Escape") {
              setShowBranchInput(false);
              setNewBranchName("");
            }
          }}
          onBlur={() => { setShowBranchInput(false); setNewBranchName(""); }}
          autoFocus
          className="w-32 rounded-md bg-background border border-border px-2 py-1 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <TitlebarActionButton
          icon={<GitBranchPlus className="h-3.5 w-3.5" />}
          label="Branch"
          onClick={() => setShowBranchInput(true)}
          disabled={isLoading}
        />
      )}
    </div>
  );
}

/** Change 5: Collapsed dropdown for all actions when window is narrow */
function CollapsedActionsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isLoading = useRepoStore((s) => s.isLoading);
  const undoInfo = useRepoStore((s) => s.undoInfo);
  const undoAction = useRepoStore((s) => s.undo);
  const pushStash = useRepoStore((s) => s.pushStash);
  const popStash = useRepoStore((s) => s.popStash);
  const stashes = useRepoStore((s) => s.stashes);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const createBranch = useRepoStore((s) => s.createBranch);
  const fetchAction = useRepoStore((s) => s.fetch);
  const pullAction = useRepoStore((s) => s.pull);
  const pushAction = useRepoStore((s) => s.push);

  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-44 rounded-md border border-border bg-popover shadow-lg py-1">
          {/* Undo */}
          {undoInfo?.can_undo && (
            <>
              <DropdownActionItem
                icon={<Undo2 className="h-3.5 w-3.5" />}
                label="Undo"
                sublabel={undoInfo.description}
                disabled={isLoading}
                onClick={() => { undoAction(); setIsOpen(false); }}
              />
              <div className="mx-2 my-1 border-t border-border" />
            </>
          )}

          {/* Stash / Pop */}
          <DropdownActionItem
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Stash"
            disabled={isLoading || fileStatuses.length === 0}
            onClick={() => { pushStash(); setIsOpen(false); }}
          />
          <DropdownActionItem
            icon={<ArchiveRestore className="h-3.5 w-3.5" />}
            label="Pop"
            disabled={isLoading || stashes.length === 0}
            onClick={() => { popStash(0); setIsOpen(false); }}
          />
          <div className="mx-2 my-1 border-t border-border" />

          {/* Fetch / Pull / Push */}
          <DropdownActionItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Fetch"
            disabled={isLoading}
            onClick={() => { fetchAction(); setIsOpen(false); }}
          />
          <DropdownActionItem
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            label="Pull"
            disabled={isLoading}
            onClick={() => { pullAction(); setIsOpen(false); }}
          />
          <DropdownActionItem
            icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
            label="Push"
            disabled={isLoading}
            onClick={() => { pushAction(); setIsOpen(false); }}
          />
          <div className="mx-2 my-1 border-t border-border" />

          {/* Branch */}
          {showBranchInput ? (
            <div className="px-3 py-1">
              <input
                type="text"
                placeholder="branch name..."
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newBranchName.trim()) {
                    createBranch(newBranchName.trim());
                    setNewBranchName("");
                    setShowBranchInput(false);
                    setIsOpen(false);
                  } else if (e.key === "Escape") {
                    setShowBranchInput(false);
                    setNewBranchName("");
                  }
                }}
                onBlur={() => { setShowBranchInput(false); setNewBranchName(""); }}
                autoFocus
                className="w-full rounded-md bg-background border border-border px-2 py-1 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ) : (
            <DropdownActionItem
              icon={<GitBranchPlus className="h-3.5 w-3.5" />}
              label="Branch"
              disabled={isLoading}
              onClick={() => setShowBranchInput(true)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Single item inside the collapsed actions dropdown */
function DropdownActionItem({
  icon,
  label,
  sublabel,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      <span>{label}</span>
      {sublabel && (
        <span className="ml-auto text-faint truncate max-w-24">{sublabel}</span>
      )}
    </button>
  );
}

/** Titlebar button with shadcn Tooltip instead of native title */
function TitlebarActionButton({
  icon,
  label,
  tooltip,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {icon}
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** Prefetch logo — "Pf" mark on dark rounded square */
function PrefetchLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      className={className}
    >
      <rect width="48" height="48" rx="10" fill="#18181B" />
      <text
        x="24"
        y="31.5"
        textAnchor="middle"
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="26"
        letterSpacing="-0.5"
        fill="#FFFFFF"
      >
        Pf
      </text>
    </svg>
  );
}

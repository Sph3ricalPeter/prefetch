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
  Download,
  Check,
  ExternalLink,
  Settings,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { DropdownPanel } from "@/components/ui/dropdown-panel";
import { usePausedOperation } from "@/hooks/use-paused-operation";

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
import { ForgeIcon } from "@/components/ui/forge-icons";
import { ProfileSwitcher } from "@/components/ui/profile-switcher";
import type { SettingsTarget } from "@/components/ui/settings-page";
import type { ForgeKind } from "@/types/git";

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

export function Titlebar({ settingsOpen = false, onOpenClone, onOpenSettings }: { settingsOpen?: boolean; onOpenClone?: () => void; onOpenSettings?: (target?: SettingsTarget) => void }) {
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
    <>
    <div
      className="relative flex h-10 shrink-0 items-center bg-shell select-none"
      data-tauri-drag-region
    >
      {/* Left: Brand — extra left padding on macOS for native traffic lights */}
      <div
        className="flex items-center gap-2.5 pr-4"
        style={{ paddingLeft: IS_MAC ? 78 : 14 }}
        data-tauri-drag-region
      >
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <PrefetchLogo className="h-4 w-4 shrink-0" />
          {!IS_MAC && (
            <span
              className="text-xs font-semibold tracking-tight text-foreground"
              data-tauri-drag-region
            >
              Prefetch
            </span>
          )}
        </div>
        <span className="rounded-md bg-brand/15 px-1.5 py-0.5 text-caption font-medium tracking-wider text-brand">
          α{appVersion ? ` v${appVersion}` : ""}{import.meta.env.DEV ? " DEV" : ""}
        </span>
      </div>

      {/* Repo switcher — left-aligned after brand */}
      <div className="flex items-center min-w-0" data-tauri-drag-region>
        <TitlebarRepoSwitcher onOpenClone={onOpenClone} />
      </div>

      {/* Spacer — pushes window controls to the right */}
      <div className="flex-1 min-w-2" data-tauri-drag-region data-titlebar-spacer />

      {/* Action buttons — renders in one of three modes:
           1. Centered (absolute) when there's room
           2. Right-aligned (in flow) when centered would overlap left content
           3. Collapsed dropdown when right-aligned doesn't fit either

           Hidden in settings: these centre on the window, while the settings
           content centres inside the card, so the two axes visibly disagree.
           Aligning them would mean shrinking the settings column by roughly the
           sidebar's width, which is the worse trade. The repo switcher stays —
           it's left-aligned, so it has no axis to clash with. */}
      {!settingsOpen && <TitlebarActionsGroup />}

      {/* Right: Profile switcher + Update indicator + Window controls */}
      <div className={`flex items-center gap-0.5 ${IS_MAC ? "pr-2.5" : "pr-0"}`}>
        <div className="mr-1">
          <ProfileSwitcher onManageProfiles={() => onOpenSettings?.({ tab: "profiles" })} />
        </div>
        <UpdateIndicator />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              aria-label="Settings"
              className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
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
    </>
  );
}

/** Repo switcher in the titlebar — shows current repo + branch + commit count */
function TitlebarRepoSwitcher({ onOpenClone }: { onOpenClone?: () => void }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const repoName = useRepoStore((s) => s.repoName);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const headCommitId = useRepoStore((s) => s.headCommitId);
  const recentRepos = useRepoStore((s) => s.recentRepos);
  const openRepository = useRepoStore((s) => s.openRepository);
  const removeFromRecentRepos = useRepoStore((s) => s.removeFromRecentRepos);
  const openInEditor = useRepoStore((s) => s.openInEditor);
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const profiles = useProfileStore((s) => s.profiles);

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
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleOpenRepo}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Open</span>
        </button>
        <button
          onClick={() => { onOpenClone?.(); }}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Clone</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-w-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-7 min-w-0 max-w-80 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {forgeStatus?.kind ? (
          <ForgeIcon kind={forgeStatus.kind} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium text-foreground">{repoName}</span>
        {currentBranch ? (
          <>
            <span className="shrink-0 text-faint">/</span>
            <span className="flex shrink-0 items-center gap-1">
              <GitBranch className="h-3 w-3" />
              <span className="truncate max-w-32">{currentBranch}</span>
            </span>
          </>
        ) : headCommitId ? (
          <>
            <span className="shrink-0 text-faint">/</span>
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              ~HEAD
              <span className="font-mono text-faint">{headCommitId.slice(0, 7)}</span>
            </span>
          </>
        ) : null}
        <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
      </button>

      {isOpen && (
        <DropdownPanel className="w-72">
          <button
            onClick={handleOpenRepo}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Repository...
          </button>
          <button
            onClick={() => { setIsOpen(false); onOpenClone?.(); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Clone Repository...
          </button>
          <button
            onClick={() => { setIsOpen(false); openInEditor("."); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in File Explorer
          </button>

          {recentRepos.length > 0 && (
            <>
              <div className="border-t border-border" />
              <p className="px-3 pt-2 pb-1 text-label text-faint uppercase tracking-wider font-medium">
                Recent
              </p>
              {recentRepos.map((repo) => {
                const isCurrent = repo.path === repoPath;
                const repoProfile = repo.profile_id
                  ? profiles.find((p) => p.id === repo.profile_id)
                  : null;
                return (
                  <div
                    key={repo.path}
                    className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary transition-colors"
                    style={repoProfile ? { borderLeftWidth: 3, borderLeftColor: repoProfile.color } : undefined}
                    onClick={() => {
                      if (isCurrent) return;
                      setIsOpen(false);
                      openRepository(repo.path);
                    }}
                  >
                    {repo.forge_kind ? (
                      <ForgeIcon kind={repo.forge_kind as ForgeKind} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs text-foreground truncate">{repo.name}</span>
                      <span className="text-label text-faint truncate">{repo.path}</span>
                    </div>
                    {isCurrent ? (
                      <Check className="h-3 w-3 shrink-0 text-primary" />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <IconButton
                            size="sm"
                            variant="subtle"
                            reveal="fade"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromRecentRepos(repo.path);
                            }}
                            className="shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Remove from recent</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}

/** Three layout modes for the action buttons:
 *  - "center": absolutely centered in the titlebar (default, wide windows)
 *  - "right":  pushed right in the normal flow (when centered would overlap left content)
 *  - "dropdown": collapsed into a ⋯ dropdown (when right-aligned doesn't fit either)  */
type ActionLayout = "center" | "right" | "dropdown";

function TitlebarActionsGroup() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const isLoading = useRepoStore((s) => s.isLoading);
  const activeOperation = usePausedOperation();
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

  const buttonsRef = useRef<HTMLDivElement>(null);
  const buttonsWidthRef = useRef(0);
  const [layout, setLayout] = useState<ActionLayout>("center");
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  useEffect(() => {
    const buttons = buttonsRef.current;
    if (!buttons) return;
    const titlebar = buttons.closest("[data-tauri-drag-region]") as HTMLElement | null;
    if (!titlebar) return;

    const check = () => {
      const titlebarW = titlebar.clientWidth;

      // Measure left content (brand + repo switcher) and right content (window controls).
      // Left content = all children before the spacer (flex-1).
      // Right content = last child (window controls div).
      let leftEdge = 0;
      let rightWidth = 0;
      const children = titlebar.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        // Detect the spacer by computed flex-grow (works regardless of class name format)
        if (getComputedStyle(child).flexGrow === "1") {
          leftEdge = child.getBoundingClientRect().left - titlebar.getBoundingClientRect().left;
          break;
        }
      }
      // Right controls = last child's width
      const lastChild = children[children.length - 1] as HTMLElement;
      rightWidth = lastChild.getBoundingClientRect().width;

      // Record the inline buttons' natural width when they're visible
      if (layout !== "dropdown") {
        const inner = buttons.querySelector("[data-action-buttons]") as HTMLElement | null;
        if (inner) buttonsWidthRef.current = inner.scrollWidth;
      }
      const bw = buttonsWidthRef.current > 0 ? buttonsWidthRef.current : 500;

      // Would centered buttons overlap left content?
      // Centered left edge = (titlebarW - bw) / 2
      const centeredLeft = (titlebarW - bw) / 2;
      const centeredFits = centeredLeft >= leftEdge + 8; // 8px gap

      // Would right-aligned buttons fit?
      // Available = titlebarW - leftEdge - rightWidth - gaps
      const availableRight = titlebarW - leftEdge - rightWidth - 32;
      const rightFits = bw <= availableRight;

      if (centeredFits) {
        setLayout("center");
      } else if (rightFits) {
        setLayout("right");
      } else {
        setLayout("dropdown");
      }
    };

    const observer = new ResizeObserver(check);
    observer.observe(titlebar);
    check();
    return () => observer.disconnect();
  }, [layout, repoPath]);

  if (!repoPath) return null;

  // A paused rebase/merge/cherry-pick/revert blocks everything that moves HEAD
  // or rewrites the tree. Fetch stays live — it only updates remote-tracking
  // refs, which is useful while deciding how to finish the operation.
  const blocked = activeOperation !== null;

  const actionButtons = (
    <div data-action-buttons className="flex items-center gap-0.5">
      {/* Undo */}
      {undoInfo?.can_undo && (
        <>
          <TitlebarActionButton
            icon={<Undo2 className="h-3.5 w-3.5" />}
            label="Undo"
            tooltip={undoInfo.description}
            onClick={undoAction}
            disabled={isLoading || blocked}
          />
          <div className="mx-1.5 h-4 w-px bg-border" />
        </>
      )}

      {/* Stash / Pop */}
      <TitlebarActionButton
        icon={<Archive className="h-3.5 w-3.5" />}
        label="Stash"
        onClick={() => pushStash()}
        disabled={isLoading || blocked || fileStatuses.length === 0}
      />
      <TitlebarActionButton
        icon={<ArchiveRestore className="h-3.5 w-3.5" />}
        label="Pop"
        onClick={() => popStash(0)}
        disabled={isLoading || blocked || stashes.length === 0}
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
        disabled={isLoading || blocked}
      />
      <TitlebarActionButton
        icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
        label="Push"
        onClick={pushAction}
        disabled={isLoading || blocked}
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
          disabled={isLoading || blocked}
        />
      )}
    </div>
  );

  if (layout === "center") {
    // Absolutely centered in the titlebar — the original design
    return (
      <div ref={buttonsRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto">
          {actionButtons}
        </div>
      </div>
    );
  }

  if (layout === "right") {
    // Pushed right in the normal flex flow (spacer pushes us here)
    return (
      <div ref={buttonsRef} className="shrink-0 mr-2">
        {actionButtons}
      </div>
    );
  }

  // Dropdown mode
  return (
    <div ref={buttonsRef} className="shrink-0 mr-2">
      <CollapsedActionsDropdown />
    </div>
  );
}

/** Change 5: Collapsed dropdown for all actions when window is narrow */
function CollapsedActionsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isLoading = useRepoStore((s) => s.isLoading);
  const activeOperation = usePausedOperation();
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

  const blocked = activeOperation !== null;
  const blockedTip = activeOperation ? `${activeOperation} in progress` : undefined;

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
            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>

      {isOpen && (
        <DropdownPanel align="right" className="min-w-44">
          {/* Undo */}
          {undoInfo?.can_undo && (
            <>
              <DropdownActionItem
                icon={<Undo2 className="h-3.5 w-3.5" />}
                label="Undo"
                sublabel={blockedTip ?? undoInfo.description}
                disabled={isLoading || blocked}
                onClick={() => { undoAction(); setIsOpen(false); }}
              />
              <div className="mx-2 my-1 border-t border-border" />
            </>
          )}

          {/* Stash / Pop */}
          <DropdownActionItem
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Stash"
            sublabel={blockedTip}
            disabled={isLoading || blocked || fileStatuses.length === 0}
            onClick={() => { pushStash(); setIsOpen(false); }}
          />
          <DropdownActionItem
            icon={<ArchiveRestore className="h-3.5 w-3.5" />}
            label="Pop"
            sublabel={blockedTip}
            disabled={isLoading || blocked || stashes.length === 0}
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
            sublabel={blockedTip}
            disabled={isLoading || blocked}
            onClick={() => { pullAction(); setIsOpen(false); }}
          />
          <DropdownActionItem
            icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
            label="Push"
            sublabel={blockedTip}
            disabled={isLoading || blocked}
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
              sublabel={blockedTip}
              disabled={isLoading || blocked}
              onClick={() => setShowBranchInput(true)}
            />
          )}
        </DropdownPanel>
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
          className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {icon}
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** Prefetch logo — chrome cube mark. Matches assets/icon.svg (app icon) minus the tile. */
function PrefetchLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="247 250 530 530"
      fill="none"
      className={className}
    >
      <defs>
        <linearGradient id="pf-top" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#eef2f6" />
          <stop offset="1" stopColor="#b9c1c9" />
        </linearGradient>
        <linearGradient id="pf-left" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#6e757d" />
          <stop offset="0.42" stopColor="#2b2f35" />
          <stop offset="0.5" stopColor="#15181c" />
          <stop offset="0.58" stopColor="#454c54" />
          <stop offset="1" stopColor="#242830" />
        </linearGradient>
        <linearGradient id="pf-right" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#d5dbe1" />
          <stop offset="0.38" stopColor="#8d959d" />
          <stop offset="0.47" stopColor="#454b52" />
          <stop offset="0.54" stopColor="#a2aab2" />
          <stop offset="0.76" stopColor="#eef2f6" />
          <stop offset="1" stopColor="#7f868e" />
        </linearGradient>
      </defs>
      <path d="M512 262 L734 390 L512 518 L290 390 Z" fill="url(#pf-top)" />
      <path d="M290 390 L512 518 L512 768 L290 640 Z" fill="url(#pf-left)" />
      <path d="M734 390 L512 518 L512 768 L734 640 Z" fill="url(#pf-right)" />
      <path
        d="M290 390 L512 262 L734 390"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="10"
        strokeLinejoin="round"
      />
    </svg>
  );
}

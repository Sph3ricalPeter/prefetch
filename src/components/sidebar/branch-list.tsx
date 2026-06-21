import { useState, useEffect, useMemo } from "react";
import { GitBranch, GitPullRequest, GitCommitHorizontal, GitMerge, Check, Monitor, Cloud, FastForward, ArrowDownToLine, ArrowUpFromLine, Link, Pencil, Copy, Trash2 } from "lucide-react";
import type { BranchInfo, PipelineStatus, PrInfo } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { effectivePipelineStatus } from "@/lib/ci-utils";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { ConfirmDialog } from "@/components/ui/modal";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";
import { iconButtonVariants } from "@/components/ui/icon-button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function BranchList() {
  const branches = useRepoStore((s) => s.branches);
  const filter = useRepoStore((s) => s.filterQuery);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const headCommitId = useRepoStore((s) => s.headCommitId);
  const checkout = useRepoStore((s) => s.checkout);
  const rebaseOnto = useRepoStore((s) => s.rebaseOnto);
  const mergeInto = useRepoStore((s) => s.mergeInto);
  const deleteBranch = useRepoStore((s) => s.deleteBranch);
  const isLoading = useRepoStore((s) => s.isLoading);
  const prCache = useRepoStore((s) => s.prCache);
  const loadPrForBranch = useRepoStore((s) => s.loadPrForBranch);
  const openPr = useRepoStore((s) => s.openPr);
  const pull = useRepoStore((s) => s.pull);
  const push = useRepoStore((s) => s.push);
  const renameBranch = useRepoStore((s) => s.renameBranch);
  const deleteRemoteBranch = useRepoStore((s) => s.deleteRemoteBranch);
  const setUpstream = useRepoStore((s) => s.setUpstream);
  const ciPipelines = useRepoStore((s) => s.ciPipelines);
  const ciJobsMap = useRepoStore((s) => s.ciJobsMap);
  const isOpen = useRepoStore((s) => s.sidebarSections.branches);
  const setSidebarSection = useRepoStore((s) => s.setSidebarSection);
  const [branchContextMenu, setBranchContextMenu] = useState<{
    branch: BranchInfo;
    x: number;
    y: number;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ branch: string; hasRemote: boolean } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameRemote, setRenameRemote] = useState(false);
  const [upstreamDialog, setUpstreamDialog] = useState<{ branch: string } | null>(null);
  const [upstreamInput, setUpstreamInput] = useState("");
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<{
    branchName: string;
    deleteLocal: boolean;
    deleteRemote: boolean;
    remoteName: string;
  } | null>(null);

  // Filter dims non-matching rows rather than hiding them (see store filterQuery).
  const q = filter.trim().toLowerCase();
  const isDimmed = (b: BranchInfo) =>
    q !== "" && !b.name.toLowerCase().includes(q);

  // Only show local branches — remote tracking is indicated via icons
  const localBranches = useMemo(
    () => branches.filter((b) => !b.is_remote),
    [branches],
  );

  // Build a map: branch name → latest CI pipeline effective status
  const branchCiStatus = useMemo(() => {
    const map = new Map<string, PipelineStatus>();
    for (const p of ciPipelines) {
      // Direct branch match
      let branchName = p.branch;

      // GitLab MR ref: refs/merge-requests/N/head → find PR by number
      const glMr = p.branch.match(/^refs\/merge-requests\/(\d+)\//);
      if (glMr) {
        // Find which local branch has this MR number
        const mrNum = parseInt(glMr[1], 10);
        const entry = Object.entries(prCache).find(
          ([, pr]) => pr?.number === mrNum,
        );
        if (entry) branchName = entry[0];
        else continue; // can't map this MR pipeline to a branch
      }

      // GitHub PR ref: refs/pull/N/head → find PR by number
      const ghPr = p.branch.match(/^refs\/pull\/(\d+)\//);
      if (ghPr) {
        const prNum = parseInt(ghPr[1], 10);
        const entry = Object.entries(prCache).find(
          ([, pr]) => pr?.number === prNum,
        );
        if (entry) branchName = entry[0];
        else continue;
      }

      // Only keep the first (latest) pipeline per branch
      if (map.has(branchName)) continue;

      map.set(branchName, effectivePipelineStatus(p, ciJobsMap[p.id] ?? []));
    }
    return map;
  }, [ciPipelines, ciJobsMap, prCache]);

  // Lazily load PR info for visible local branches
  useEffect(() => {
    if (!isOpen) return;
    localBranches.forEach((b) => {
      if (!(b.name in prCache)) {
        loadPrForBranch(b.name);
      }
    });
  }, [isOpen, localBranches, prCache, loadPrForBranch]);

  const handleCheckout = async (name: string) => {
    if (name === currentBranch || isLoading) return;
    await checkout(name);
  };

  return (
    <div className="flex flex-col">
      <div>
        {/* Detached HEAD indicator */}
        {!currentBranch && headCommitId && (
          <div className="flex items-center gap-2 rounded-md px-2 py-1 text-xs bg-accent/60">
            <GitCommitHorizontal className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">~HEAD</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-label text-faint font-mono">
                  {headCommitId.slice(0, 7)}
                </span>
              </TooltipTrigger>
              <TooltipContent>Detached HEAD at {headCommitId.slice(0, 7)}</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Unified branch list */}
        <BranchSection
          label="Branches"
          count={localBranches.length}
          isOpen={isOpen}
          onToggle={() => setSidebarSection("branches", !isOpen)}
        >
          {localBranches.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              isCurrent={branch.name === currentBranch}
              pr={prCache[branch.name]}
              ciStatus={branchCiStatus.get(branch.name)}
              dimmed={isDimmed(branch)}
              disabled={isLoading}
              onClick={() => handleCheckout(branch.name)}
              onPrClick={
                prCache[branch.name]
                  ? () => openPr(prCache[branch.name]!.url)
                  : undefined
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setBranchContextMenu({ branch, x: e.clientX, y: e.clientY });
              }}
            />
          ))}
        </BranchSection>
      </div>

      {/* Branch context menu */}
      {branchContextMenu && (
        <ContextMenu
          x={branchContextMenu.x}
          y={branchContextMenu.y}
          items={buildBranchContextMenuItems(
            branchContextMenu.branch,
            currentBranch,
            rebaseOnto,
            mergeInto,
            (name, deleteLocal, deleteRemote, remoteName) => {
              setConfirmDeleteBranch({ branchName: name, deleteLocal, deleteRemote, remoteName });
            },
            checkout,
            pull,
            push,
            (name, hasRemote) => { setRenameInput(name); setRenameRemote(hasRemote); setRenameDialog({ branch: name, hasRemote }); },
            (name) => { setUpstreamInput(""); setUpstreamDialog({ branch: name }); },
          )}
          onClose={() => setBranchContextMenu(null)}
        />
      )}

      {/* Rename branch dialog */}
      {renameDialog && (
        <ConfirmDialog
          open
          onClose={() => setRenameDialog(null)}
          title="Rename branch"
          description={`Renaming '${renameDialog.branch}'`}
          confirmLabel="Rename"
          confirmDisabled={!renameInput.trim() || renameInput.trim() === renameDialog.branch}
          onConfirm={() => {
            if (renameInput.trim() && renameInput.trim() !== renameDialog.branch) {
              renameBranch(renameDialog.branch, renameInput.trim(), renameRemote);
              setRenameDialog(null);
            }
          }}
        >
          <input
            autoFocus
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameInput.trim() && renameInput.trim() !== renameDialog.branch) {
                renameBranch(renameDialog.branch, renameInput.trim(), renameRemote);
                setRenameDialog(null);
              }
            }}
            placeholder="New name"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />
          {renameDialog.hasRemote && (
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={renameRemote}
                onChange={(e) => setRenameRemote(e.target.checked)}
                className="rounded-md border-border"
              />
              <span className="text-xs text-muted-foreground">
                Rename on remote too (pushes new name, deletes old)
              </span>
            </label>
          )}
        </ConfirmDialog>
      )}

      {/* Set upstream dialog */}
      {upstreamDialog && (
        <ConfirmDialog
          open
          onClose={() => setUpstreamDialog(null)}
          title="Set upstream"
          description={`Set tracking branch for '${upstreamDialog.branch}'`}
          confirmLabel="Set"
          confirmDisabled={!upstreamInput.trim()}
          onConfirm={() => {
            if (upstreamInput.trim()) {
              setUpstream(upstreamInput.trim());
              setUpstreamDialog(null);
            }
          }}
        >
          <input
            autoFocus
            value={upstreamInput}
            onChange={(e) => setUpstreamInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && upstreamInput.trim()) {
                setUpstream(upstreamInput.trim());
                setUpstreamDialog(null);
              }
            }}
            placeholder="e.g. origin/main"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
          />
        </ConfirmDialog>
      )}

      {/* Delete branch confirmation */}
      {confirmDeleteBranch && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDeleteBranch(null)}
          title="Delete branch?"
          description={
            confirmDeleteBranch.deleteLocal && confirmDeleteBranch.deleteRemote
              ? `This will delete "${confirmDeleteBranch.branchName}" locally and from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
              : confirmDeleteBranch.deleteRemote
                ? `This will delete "${confirmDeleteBranch.branchName}" from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                : `This will delete "${confirmDeleteBranch.branchName}" locally. This cannot be undone.`
          }
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const { branchName, deleteLocal, deleteRemote: delRemote, remoteName } = confirmDeleteBranch;
            setConfirmDeleteBranch(null);
            if (deleteLocal) await deleteBranch(branchName);
            if (delRemote) await deleteRemoteBranch(remoteName, branchName);
          }}
        />
      )}
    </div>
  );
}

function buildBranchContextMenuItems(
  branch: BranchInfo,
  currentBranch: string | null,
  rebaseOnto: (target: string) => void,
  mergeInto: (target: string) => void,
  confirmDeleteBranch: (name: string, deleteLocal: boolean, deleteRemote: boolean, remoteName: string) => void,
  checkout: (name: string) => void,
  pull: () => void,
  push: () => void,
  renameBranch: (name: string, hasRemote: boolean) => void,
  setUpstream: (name: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const isCurrent = branch.name === currentBranch;
  const hasRemote = branch.upstream_name != null;

  // Navigation (not for current branch)
  if (!isCurrent) {
    items.push({
      label: `Checkout ${branch.name}`,
      onClick: () => checkout(branch.name),
      icon: Check,
    });
    items.push({ separator: true });
  }

  // Merge & rebase (only for non-current branches)
  if (!isCurrent && currentBranch) {
    items.push({
      label: `Merge ${branch.name} into ${currentBranch}`,
      onClick: () => mergeInto(branch.name),
      icon: GitMerge,
    });
    items.push({
      label: branch.can_fast_forward
        ? `Fast-forward ${currentBranch} to ${branch.name}`
        : `Rebase ${currentBranch} onto ${branch.name}`,
      onClick: () => rebaseOnto(branch.name),
      icon: FastForward,
    });
    items.push({ separator: true });
  }

  // Remote ops
  items.push({
    label: "Pull",
    onClick: () => pull(),
    icon: ArrowDownToLine,
  });
  items.push({
    label: "Push",
    onClick: () => push(),
    icon: ArrowUpFromLine,
  });
  if (!hasRemote) {
    items.push({
      label: "Set upstream…",
      onClick: () => setUpstream(branch.name),
      icon: Link,
    });
  }

  items.push({ separator: true });

  // Manage
  items.push({
    label: "Rename branch…",
    onClick: () => renameBranch(branch.name, hasRemote),
    icon: Pencil,
  });
  items.push({
    label: "Copy branch name",
    onClick: () => navigator.clipboard.writeText(branch.name),
    icon: Copy,
  });

  // Delete (not for current branch)
  if (!isCurrent) {
    items.push({ separator: true });

    // Parse remote name from upstream (e.g. "origin/main" → "origin")
    const remoteName = hasRemote
      ? branch.upstream_name!.split("/")[0]
      : "origin";

    items.push({
      label: "Delete local…",
      onClick: () => confirmDeleteBranch(branch.name, true, false, remoteName),
      destructive: true,
      icon: Trash2,
    });
    if (hasRemote) {
      items.push({
        label: `Delete from ${remoteName}…`,
        onClick: () => confirmDeleteBranch(branch.name, false, true, remoteName),
        destructive: true,
        icon: Trash2,
      });
      items.push({
        label: "Delete local + remote…",
        onClick: () => confirmDeleteBranch(branch.name, true, true, remoteName),
        destructive: true,
        icon: Trash2,
      });
    }
  }

  return items;
}

function BranchSection({
  label,
  count,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionHeader
        label={label}
        count={count}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen && <div>{children}</div>}
    </div>
  );
}

/** MR icon color based on CI pipeline status */
function prIconColor(ciStatus?: PipelineStatus): string {
  switch (ciStatus) {
    case "success": return "text-green-400";
    case "failure": return "text-red-400";
    case "warning": return "text-orange-400";
    case "in_progress": return "text-yellow-400";
    default: return "text-muted-foreground";
  }
}

function BranchRow({
  branch,
  isCurrent,
  pr,
  ciStatus,
  dimmed,
  disabled,
  onClick,
  onPrClick,
  onContextMenu,
}: {
  branch: BranchInfo;
  isCurrent: boolean;
  /** undefined = not yet checked; null = no open PR; PrInfo = has open PR */
  pr?: PrInfo | null;
  ciStatus?: PipelineStatus;
  dimmed?: boolean;
  disabled: boolean;
  onClick: () => void;
  onPrClick?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const displayName = branch.name;

  return (
    <button
      onDoubleClick={onClick}
      onContextMenu={onContextMenu}
      disabled={disabled && !isCurrent}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 my-1 text-left text-xs transition-colors disabled:cursor-default",
        isCurrent
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        dimmed && FILTER_DIM_CLASS,
      )}
    >
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate"><HighlightedText text={displayName} /></span>

      {/* Local/remote indicators */}
      <span className="flex items-center gap-0.5 shrink-0 text-faint">
        <Tooltip>
          <TooltipTrigger asChild>
            <Monitor className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent>Local</TooltipContent>
        </Tooltip>
        {branch.upstream_name != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Cloud className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent>{branch.upstream_name}</TooltipContent>
          </Tooltip>
        )}
      </span>

      {/* Ahead/behind badges */}
      {((branch.ahead != null && branch.ahead > 0) ||
        (branch.behind != null && branch.behind > 0)) && (
        <span className="flex items-center gap-0.5 text-label text-faint shrink-0">
          {branch.ahead ? <span>↑{branch.ahead}</span> : null}
          {branch.behind ? <span>↓{branch.behind}</span> : null}
        </span>
      )}

      {/* PR badge — colored by CI status */}
      {pr && onPrClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onPrClick();
              }}
              className={cn(
                iconButtonVariants({ size: "sm" }),
                "ml-auto shrink-0 hover:bg-accent",
                prIconColor(ciStatus),
              )}
            >
              <GitPullRequest className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            #{pr.number} — {pr.title}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Current branch indicator — checkmark */}
      {isCurrent && !pr && (
        <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />
      )}
      {isCurrent && pr && (
        <Check className="h-3 w-3 shrink-0 text-primary" />
      )}
    </button>
  );
}

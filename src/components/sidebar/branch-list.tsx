import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, GitBranch, GitPullRequest, GitCommitHorizontal } from "lucide-react";
import type { BranchInfo, PrInfo } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function BranchList({ filter = "" }: { filter?: string }) {
  const branches = useRepoStore((s) => s.branches);
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
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [branchContextMenu, setBranchContextMenu] = useState<{
    branch: BranchInfo;
    x: number;
    y: number;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ branch: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [upstreamDialog, setUpstreamDialog] = useState<{ branch: string } | null>(null);
  const [upstreamInput, setUpstreamInput] = useState("");
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<{
    branchName: string;
    deleteLocal: boolean;
    deleteRemote: boolean;
    remoteName: string;
  } | null>(null);

  const filtered = filter
    ? branches.filter((b) =>
        b.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : branches;

  const localBranches = filtered.filter((b) => !b.is_remote);
  const remoteBranches = filtered.filter((b) => b.is_remote);

  // Lazily load PR info for visible local branches
  useEffect(() => {
    if (!localOpen) return;
    localBranches.forEach((b) => {
      if (!(b.name in prCache)) {
        loadPrForBranch(b.name);
      }
    });
  }, [localOpen, localBranches, prCache, loadPrForBranch]);

  const handleCheckout = async (name: string) => {
    if (name === currentBranch || isLoading) return;
    await checkout(name);
  };

  return (
    <div className="flex flex-col">
      <div>
        {/* Detached HEAD indicator */}
        {!currentBranch && headCommitId && (
          <div className="flex items-center gap-2 px-3 py-1 text-xs bg-accent/60">
            <GitCommitHorizontal className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">~HEAD</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-caption text-faint font-mono">
                  {headCommitId.slice(0, 7)}
                </span>
              </TooltipTrigger>
              <TooltipContent>Detached HEAD at {headCommitId.slice(0, 7)}</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Local branches */}
        <BranchSection
          label="Local"
          count={localBranches.length}
          isOpen={localOpen}
          onToggle={() => setLocalOpen(!localOpen)}
        >
          {localBranches.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              isCurrent={branch.name === currentBranch}
              pr={prCache[branch.name]}
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

        {/* Remote branches */}
        <BranchSection
          label="Remote"
          count={remoteBranches.length}
          isOpen={remoteOpen}
          onToggle={() => setRemoteOpen(!remoteOpen)}
        >
          {remoteBranches.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              isCurrent={false}
              disabled={isLoading}
              onClick={() => handleCheckout(branch.name)}
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
            (name) => { setRenameInput(name); setRenameDialog({ branch: name }); },
            (name) => { setUpstreamInput(""); setUpstreamDialog({ branch: name }); },
          )}
          onClose={() => setBranchContextMenu(null)}
        />
      )}

      {/* Rename branch dialog */}
      {renameDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Rename branch</p>
            <p className="text-xs text-muted-foreground mb-3">
              Renaming &apos;{renameDialog.branch}&apos;
            </p>
            <input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameInput.trim() && renameInput.trim() !== renameDialog.branch) {
                  renameBranch(renameDialog.branch, renameInput.trim());
                  setRenameDialog(null);
                } else if (e.key === "Escape") {
                  setRenameDialog(null);
                }
              }}
              placeholder="New name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameDialog(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (renameInput.trim() && renameInput.trim() !== renameDialog.branch) {
                    renameBranch(renameDialog.branch, renameInput.trim());
                    setRenameDialog(null);
                  }
                }}
                disabled={!renameInput.trim() || renameInput.trim() === renameDialog.branch}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set upstream dialog */}
      {upstreamDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Set upstream</p>
            <p className="text-xs text-muted-foreground mb-3">
              Set tracking branch for &apos;{upstreamDialog.branch}&apos;
            </p>
            <input
              autoFocus
              value={upstreamInput}
              onChange={(e) => setUpstreamInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && upstreamInput.trim()) {
                  setUpstream(upstreamInput.trim());
                  setUpstreamDialog(null);
                } else if (e.key === "Escape") {
                  setUpstreamDialog(null);
                }
              }}
              placeholder="e.g. origin/main"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setUpstreamDialog(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (upstreamInput.trim()) {
                    setUpstream(upstreamInput.trim());
                    setUpstreamDialog(null);
                  }
                }}
                disabled={!upstreamInput.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete branch confirmation */}
      {confirmDeleteBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Delete branch?</p>
            <p className="text-xs text-muted-foreground mb-4">
              {confirmDeleteBranch.deleteLocal && confirmDeleteBranch.deleteRemote
                ? `This will delete "${confirmDeleteBranch.branchName}" locally and from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                : confirmDeleteBranch.deleteRemote
                  ? `This will delete "${confirmDeleteBranch.branchName}" from ${confirmDeleteBranch.remoteName}. This cannot be undone.`
                  : `This will delete "${confirmDeleteBranch.branchName}" locally. This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteBranch(null)}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { branchName, deleteLocal, deleteRemote: delRemote, remoteName } = confirmDeleteBranch;
                  if (deleteLocal) deleteBranch(branchName);
                  if (delRemote) deleteRemoteBranch(remoteName, branchName);
                  setConfirmDeleteBranch(null);
                }}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
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
  renameBranch: (name: string) => void,
  setUpstream: (name: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const isCurrent = branch.name === currentBranch;

  if (branch.is_remote) {
    // ── Remote branch menu ──
    items.push({
      label: `Checkout ${branch.name}`,
      onClick: () => checkout(branch.name),
    });

    items.push({ separator: true });

    items.push({
      label: "Copy branch name",
      onClick: () => navigator.clipboard.writeText(branch.name),
    });

    items.push({ separator: true });

    // Parse remote/branch from e.g. "origin/feature"
    const slashIdx = branch.name.indexOf("/");
    if (slashIdx > 0) {
      const remote = branch.name.slice(0, slashIdx);
      const remoteBranch = branch.name.slice(slashIdx + 1);
      items.push({
        label: `Delete from ${remote}…`,
        onClick: () => confirmDeleteBranch(remoteBranch, false, true, remote),
        destructive: true,
      });
    }

    return items;
  }

  // ── Local branch menu ──

  // Navigation (not for current branch)
  if (!isCurrent) {
    items.push({
      label: `Checkout ${branch.name}`,
      onClick: () => checkout(branch.name),
    });
    items.push({ separator: true });
  }

  // Merge & rebase (only for non-current local branches)
  if (!isCurrent && currentBranch) {
    items.push({
      label: `Merge ${branch.name} into ${currentBranch}`,
      onClick: () => mergeInto(branch.name),
    });
    items.push({
      label: branch.can_fast_forward
        ? `Fast-forward ${currentBranch} to ${branch.name}`
        : `Rebase ${currentBranch} onto ${branch.name}`,
      onClick: () => rebaseOnto(branch.name),
    });
    items.push({ separator: true });
  }

  // Remote ops
  items.push({
    label: "Pull",
    onClick: () => pull(),
  });
  items.push({
    label: "Push",
    onClick: () => push(),
  });
  items.push({
    label: "Set upstream…",
    onClick: () => setUpstream(branch.name),
  });

  items.push({ separator: true });

  // Manage
  items.push({
    label: "Rename branch…",
    onClick: () => renameBranch(branch.name),
  });
  items.push({
    label: "Copy branch name",
    onClick: () => navigator.clipboard.writeText(branch.name),
  });

  // Delete (not for current branch)
  if (!isCurrent) {
    items.push({ separator: true });

    const hasRemote = branch.ahead != null || branch.behind != null;
    items.push({
      label: hasRemote ? `Delete ${branch.name} (local + remote)…` : `Delete ${branch.name}…`,
      onClick: () => confirmDeleteBranch(branch.name, true, hasRemote, "origin"),
      destructive: true,
    });
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
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-label font-semibold text-muted-foreground uppercase tracking-[0.06em] hover:text-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {label}
        <span className="ml-auto text-faint normal-case tracking-normal">
          {count}
        </span>
      </button>
      {isOpen && <div>{children}</div>}
    </div>
  );
}

function BranchRow({
  branch,
  isCurrent,
  pr,
  disabled,
  onClick,
  onPrClick,
  onContextMenu,
}: {
  branch: BranchInfo;
  isCurrent: boolean;
  /** undefined = not yet checked; null = no open PR; PrInfo = has open PR */
  pr?: PrInfo | null;
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
      className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors ${
        isCurrent
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      } ${branch.is_remote ? "text-dim" : ""} disabled:cursor-default`}
    >
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate">{displayName}</span>

      {/* Ahead/behind badges */}
      {((branch.ahead != null && branch.ahead > 0) ||
        (branch.behind != null && branch.behind > 0)) && (
        <span className="flex items-center gap-0.5 text-caption text-faint shrink-0">
          {branch.ahead ? <span>↑{branch.ahead}</span> : null}
          {branch.behind ? <span>↓{branch.behind}</span> : null}
        </span>
      )}

      {/* PR badge — only shown when there's an open PR */}
      {pr && onPrClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onPrClick();
              }}
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <GitPullRequest className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            #{pr.number} — {pr.title}
          </TooltipContent>
        </Tooltip>
      )}

      {isCurrent && !pr && (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      )}
      {isCurrent && pr && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

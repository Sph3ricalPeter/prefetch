import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, GitBranch, GitPullRequest } from "lucide-react";
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
  const checkout = useRepoStore((s) => s.checkout);
  const rebaseOnto = useRepoStore((s) => s.rebaseOnto);
  const isLoading = useRepoStore((s) => s.isLoading);
  const prCache = useRepoStore((s) => s.prCache);
  const loadPrForBranch = useRepoStore((s) => s.loadPrForBranch);
  const openPr = useRepoStore((s) => s.openPr);
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [branchContextMenu, setBranchContextMenu] = useState<{
    branch: BranchInfo;
    x: number;
    y: number;
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
            checkout,
          )}
          onClose={() => setBranchContextMenu(null)}
        />
      )}
    </div>
  );
}

function buildBranchContextMenuItems(
  branch: BranchInfo,
  currentBranch: string | null,
  rebaseOnto: (target: string) => void,
  checkout: (name: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  // Checkout option (if not already current)
  if (branch.name !== currentBranch) {
    items.push({
      label: `Checkout ${branch.name}`,
      onClick: () => checkout(branch.name),
    });
  }

  // Rebase option (only for local branches that aren't current)
  if (!branch.is_remote && branch.name !== currentBranch && currentBranch) {
    items.push({
      label: `Rebase ${currentBranch} onto ${branch.name}`,
      onClick: () => rebaseOnto(branch.name),
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
        className="flex w-full items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {label}
        <span className="ml-auto text-muted-foreground/50 normal-case tracking-normal">
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
      } ${branch.is_remote ? "opacity-70" : ""} disabled:cursor-default`}
    >
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate">{displayName}</span>

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

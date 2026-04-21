import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type { BranchInfo } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";

export function BranchList({ filter = "" }: { filter?: string }) {
  const branches = useRepoStore((s) => s.branches);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const checkout = useRepoStore((s) => s.checkout);
  const rebaseOnto = useRepoStore((s) => s.rebaseOnto);
  const isLoading = useRepoStore((s) => s.isLoading);
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
              disabled={isLoading}
              onClick={() => handleCheckout(branch.name)}
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
  disabled,
  onClick,
  onContextMenu,
}: {
  branch: BranchInfo;
  isCurrent: boolean;
  disabled: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  // Strip "origin/" prefix for display on remote branches
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
      {isCurrent && (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

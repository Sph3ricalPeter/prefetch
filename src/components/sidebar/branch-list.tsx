import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type { BranchInfo } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";

export function BranchList() {
  const branches = useRepoStore((s) => s.branches);
  const currentBranch = useRepoStore((s) => s.currentBranch);
  const checkout = useRepoStore((s) => s.checkout);
  const isLoading = useRepoStore((s) => s.isLoading);
  const [filter, setFilter] = useState("");
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(false);

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
    <div className="flex h-full flex-col">
      {/* Search filter */}
      <div className="px-3 pb-2">
        <input
          type="text"
          placeholder="Filter branches..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Branch sections */}
      <div className="flex-1 overflow-y-auto">
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
            />
          ))}
        </BranchSection>
      </div>
    </div>
  );
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
}: {
  branch: BranchInfo;
  isCurrent: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  // Strip "origin/" prefix for display on remote branches
  const displayName = branch.is_remote
    ? branch.name.replace(/^origin\//, "")
    : branch.name;

  return (
    <button
      onClick={onClick}
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

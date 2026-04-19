import { useRepoStore } from "@/stores/repo-store";
import { BranchList } from "@/components/sidebar/branch-list";

export function SidebarPanel() {
  const { branches, repoPath } = useRepoStore();

  return (
    <div className="flex h-full flex-col bg-sidebar-background">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Branches
        </h2>
        {branches.length > 0 && (
          <span className="text-xs text-muted-foreground/50">
            {branches.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 pt-2">
        {repoPath ? (
          <BranchList />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground">No repo open</p>
          </div>
        )}
      </div>
    </div>
  );
}

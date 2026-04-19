import { useRepoStore } from "@/stores/repo-store";
import { BranchList } from "@/components/sidebar/branch-list";
import { StashList } from "@/components/sidebar/stash-list";
import { TagList } from "@/components/sidebar/tag-list";

export function SidebarPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-sidebar-background">
        <p className="text-xs text-muted-foreground">No repo open</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-sidebar-background overflow-y-auto">
      {/* Branches */}
      <div className="pt-2">
        <BranchList />
      </div>

      {/* Divider */}
      <div className="mx-3 my-1 border-t border-border" />

      {/* Stash */}
      <StashList />

      {/* Divider */}
      <div className="mx-3 my-1 border-t border-border" />

      {/* Tags */}
      <TagList />
    </div>
  );
}

import { useState } from "react";
import { useRepoStore } from "@/stores/repo-store";
import { BranchList } from "@/components/sidebar/branch-list";
import { StashList } from "@/components/sidebar/stash-list";
import { TagList } from "@/components/sidebar/tag-list";

export function SidebarPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const [filter, setFilter] = useState("");

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-sidebar-background">
        <p className="text-xs text-muted-foreground">No repo open</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-sidebar-background">
      {/* Filter input */}
      <div className="px-3 pt-2 pb-2">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded bg-background border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Branches */}
        <BranchList filter={filter} />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* Stash */}
        <StashList filter={filter} />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* Tags */}
        <TagList filter={filter} />
      </div>
    </div>
  );
}

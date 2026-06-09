import { useEffect, useState } from "react";
import { useRepoStore } from "@/stores/repo-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { FILTER_DEBOUNCE_MS } from "@/lib/constants";
import { BranchList } from "@/components/sidebar/branch-list";
import { CiList } from "@/components/sidebar/ci-list";
import { StashList } from "@/components/sidebar/stash-list";
import { TagList } from "@/components/sidebar/tag-list";

export function SidebarPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const setFilterQuery = useRepoStore((s) => s.setFilterQuery);

  // Local state drives the input for instant typing feedback; the debounced
  // value is pushed to the store, where the sidebar lists, commit graph, and
  // file lists read it from.
  const [input, setInput] = useState("");
  const debounced = useDebouncedValue(input, FILTER_DEBOUNCE_MS);

  useEffect(() => {
    setFilterQuery(debounced);
  }, [debounced, setFilterQuery]);

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
      <div className="px-3 pt-2 pb-1.5">
        <input
          type="text"
          placeholder="Filter..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full rounded-md bg-background border border-border px-2.5 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Branches */}
        <BranchList />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* CI Pipelines */}
        <CiList />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* Stash */}
        <StashList />

        {/* Divider */}
        <div className="mx-3 my-1 border-t border-border" />

        {/* Tags */}
        <TagList />
      </div>
    </div>
  );
}

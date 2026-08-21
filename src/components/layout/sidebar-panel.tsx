import { useEffect } from "react";
import { useRepoStore } from "@/stores/repo-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { FILTER_DEBOUNCE_MS } from "@/lib/constants";
import { Kbd } from "@/components/ui/kbd";
import { BranchList } from "@/components/sidebar/branch-list";
import { CiList } from "@/components/sidebar/ci-list";
import { StashList } from "@/components/sidebar/stash-list";
import { TagList } from "@/components/sidebar/tag-list";
import { WorktreeList } from "@/components/sidebar/worktree-list";

export function SidebarPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const input = useRepoStore((s) => s.filterInput);
  const setInput = useRepoStore((s) => s.setFilterInput);
  const setFilterQuery = useRepoStore((s) => s.setFilterQuery);

  // The input value lives in the store (so the global Escape handler can clear
  // it regardless of focus); the debounced copy is pushed to filterQuery, which
  // the sidebar lists, commit graph, and file lists read from.
  const debounced = useDebouncedValue(input, FILTER_DEBOUNCE_MS);

  useEffect(() => {
    setFilterQuery(debounced);
  }, [debounced, setFilterQuery]);

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-shell">
        <p className="text-xs text-muted-foreground">No repo open</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-shell">
      {/* Filter input */}
      <div className="pr-2 pt-0 pb-2">
        <div className="relative">
          <input
            id="global-filter-input"
            type="text"
            placeholder="Filter..."
            // Suppress the WebView's autocomplete/autofill history dropdown and
            // spellcheck squiggle — this is an in-app filter, not a form field.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter / Shift+Enter drive next/prev match in the active diff or
              // CI-log view (see useInViewSearch). Escape is handled globally
              // (see EscapeStack in App.tsx) so it works even when the input
              // isn't focused.
              if (e.key === "Enter") {
                e.preventDefault();
                window.dispatchEvent(
                  new CustomEvent("prefetch:search-nav", {
                    detail: { dir: e.shiftKey ? "prev" : "next" },
                  }),
                );
              }
            }}
            className="w-full rounded-md bg-background border border-border pl-2.5 pr-12 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
          {/* Shortcut hint — drops out once the user starts typing. */}
          {input === "" && (
            <Kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              Ctrl+F
            </Kbd>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pr-2">
        {/* Branches */}
        <BranchList />

        {/* Worktrees — renders nothing until a linked worktree exists */}
        <WorktreeList />

        {/* Divider */}
        <div className="my-1 border-t border-border" />

        {/* CI Pipelines */}
        <CiList />

        {/* Divider */}
        <div className="my-1 border-t border-border" />

        {/* Stash */}
        <StashList />

        {/* Divider */}
        <div className="my-1 border-t border-border" />

        {/* Tags */}
        <TagList />
      </div>
    </div>
  );
}

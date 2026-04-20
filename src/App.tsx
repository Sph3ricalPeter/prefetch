import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppLayout } from "@/components/layout/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";

/**
 * Listens for `repo_changed` events from the Rust file watcher / background fetcher.
 * Handles git-internal changes (checkout, fetch, stage, branch/tag ops).
 */
function RepoEventListener() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const loadStatus = useRepoStore((s) => s.loadStatus);
  const reloadAll = useRepoStore((s) => s.reloadAll);

  useEffect(() => {
    if (!repoPath) return;

    const unlistenPromise = listen<string>("repo_changed", (event) => {
      const changeType = event.payload;
      switch (changeType) {
        case "Status":
          // Staging area changed — lightweight refresh
          loadStatus();
          break;
        case "Refs":
        case "Head":
          // Branches/tags/HEAD changed — full reload
          reloadAll();
          break;
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [repoPath, loadStatus, reloadAll]);

  return null;
}

/**
 * Polls working tree status every 5 seconds.
 *
 * The file watcher handles .git/ changes (stage, checkout, fetch) instantly,
 * but working tree edits (saving a file) don't touch .git/ — they need polling.
 * This is the standard approach used by most git GUIs.
 */
function WorkingTreePoller() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const loadStatus = useRepoStore((s) => s.loadStatus);

  useEffect(() => {
    if (!repoPath) return;

    const interval = setInterval(() => {
      loadStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [repoPath, loadStatus]);

  return null;
}

function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <AppLayout />
      <RepoEventListener />
      <WorkingTreePoller />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppLayout } from "@/components/layout/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { initDatabase } from "@/lib/database";
import { UpdateChecker } from "@/components/updater";

/**
 * Initializes SQLite database on startup, loads recent repos,
 * and auto-opens the last repo if available.
 *
 * Retries up to 3 times with 1s delay — the Tauri IPC bridge may not
 * be ready immediately during dev server startup / HMR reloads.
 */
function DatabaseInit() {
  const loadRecentRepos = useRepoStore((s) => s.loadRecentRepos);

  useEffect(() => {
    let retries = 0;
    const tryInit = async () => {
      try {
        await initDatabase();
        await loadRecentRepos();
        // Future: add a setting to auto-open last repo on launch
        // For now, always show the landing page with recent repos
      } catch {
        if (retries < 3) {
          retries++;
          setTimeout(tryInit, 1000);
        }
      }
    };
    tryInit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

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
      <DatabaseInit />
      <RepoEventListener />
      <WorkingTreePoller />
      <UpdateChecker />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppLayout } from "@/components/layout/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { useThemeStore } from "@/stores/theme-store";
import { initDatabase } from "@/lib/database";
import { UpdateChecker } from "@/components/update-checker";

/**
 * Initializes SQLite database on startup, loads recent repos,
 * and auto-opens the last repo if available.
 *
 * Retries up to 3 times with 1s delay — the Tauri IPC bridge may not
 * be ready immediately during dev server startup / HMR reloads.
 */
function DatabaseInit() {
  const loadRecentRepos = useRepoStore((s) => s.loadRecentRepos);
  const loadFileViewMode = useRepoStore((s) => s.loadFileViewMode);
  const loadDiffPreferences = useRepoStore((s) => s.loadDiffPreferences);
  const loadProfiles = useProfileStore((s) => s.loadProfiles);
  const restoreActiveProfile = useProfileStore((s) => s.restoreActiveProfile);
  const loadThemePreferences = useThemeStore((s) => s.loadThemePreferences);

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const tryInit = async () => {
      try {
        await initDatabase();
        if (cancelled) return;
        await Promise.all([
          loadRecentRepos(),
          loadFileViewMode(),
          loadDiffPreferences(),
          loadThemePreferences(),
          loadProfiles().then(() => restoreActiveProfile()),
        ]);
      } catch {
        if (!cancelled && retries < 3) {
          retries++;
          setTimeout(tryInit, 1000);
        }
      }
    };
    tryInit();
    return () => { cancelled = true; };
  }, [loadRecentRepos, loadFileViewMode, loadDiffPreferences, loadThemePreferences, loadProfiles, restoreActiveProfile]);

  return null;
}

/**
 * Listens for `repo_changed` events from the Rust file watcher / background fetcher.
 * Handles git-internal changes (checkout, fetch, stage, branch/tag ops).
 */
function RepoEventListener() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const loadStatus = useRepoStore((s) => s.loadStatus);
  const reloadRefs = useRepoStore((s) => s.reloadRefs);
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
          // Branch/tag refs changed (fetch, push) — only commits + branches
          // need refreshing. Working tree is unaffected.
          reloadRefs();
          break;
        case "Head":
          // HEAD changed (checkout) — full reload including status
          reloadAll();
          break;
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [repoPath, loadStatus, reloadRefs, reloadAll]);

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

/**
 * Blocks the default browser right-click context menu everywhere except
 * text inputs (where the user needs cut/copy/paste).
 */
function ContextMenuBlocker() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      // Allow contenteditable elements (e.g. CodeMirror)
      if (target.isContentEditable) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return null;
}

/**
 * Blocks devtools keyboard shortcuts (F12, Ctrl+Shift+I/J, Ctrl+U)
 * in production builds only.
 */
function DevToolsBlocker() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J")) ||
        (e.ctrlKey && e.key === "u")
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

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
      <ContextMenuBlocker />
      <DevToolsBlocker />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;

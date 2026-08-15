import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppLayout } from "@/components/layout/app-layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { useThemeStore } from "@/stores/theme-store";
import { initDatabase, getUiState } from "@/lib/database";
import { loadRememberedAvatarUrls } from "@/lib/avatar-cache";
import { setFetchInterval as setFetchIntervalCmd } from "@/lib/commands";
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
  const loadGraphPreferences = useRepoStore((s) => s.loadGraphPreferences);
  const loadSidebarPreferences = useRepoStore((s) => s.loadSidebarPreferences);
  const openRepository = useRepoStore((s) => s.openRepository);
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
          loadGraphPreferences(),
          loadSidebarPreferences(),
          loadThemePreferences(),
          loadRememberedAvatarUrls(),
          loadProfiles().then(() => restoreActiveProfile()),
          // Restore saved auto-fetch interval so the Rust fetcher uses
          // the user's preference from the first tick, not just the default.
          getUiState("auto_fetch_interval").then((v) => {
            if (v !== null) setFetchIntervalCmd(parseInt(v, 10)).catch(() => {});
          }).catch(() => {}),
        ]);

        // After all prefs + profiles are loaded, auto-reopen the last repo
        // if the user enabled the setting.
        if (!cancelled) {
          const autoReopen = await getUiState("auto_reopen_last_repo").catch(() => null);
          if (autoReopen === "true") {
            const lastPath = await getUiState("last_repo_path").catch(() => null);
            if (lastPath) openRepository(lastPath);
          }
        }
      } catch {
        if (!cancelled && retries < 3) {
          retries++;
          setTimeout(tryInit, 1000);
        }
      }
    };
    tryInit();
    return () => { cancelled = true; };
  }, [loadRecentRepos, loadFileViewMode, loadDiffPreferences, loadGraphPreferences, loadSidebarPreferences, loadThemePreferences, loadProfiles, restoreActiveProfile, openRepository]);

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

/**
 * Replaces the WebView2 native find bar (Ctrl/Cmd+F) with a focus on the global
 * filter input, which drives in-view search across the diff and CI-log views.
 * Capture phase + preventDefault suppresses the built-in find popup.
 */
function FilterSearchHotkey() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        const el = document.getElementById("global-filter-input") as HTMLInputElement | null;
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  return null;
}

/**
 * Global Escape "stack" — Escape acts in priority order regardless of focus:
 *   1. Filter box — if the input is focused, defocus it (clearing any query
 *      first) so Escape always exits the filter, even when it's empty. If the
 *      input is *not* focused but a query is active (e.g. clicked into the
 *      diff), clear the query.
 *   2. Open middle-pane context (diff / large-diff guard / CI log) → close it,
 *      returning to the commit graph.
 *   3. Commit graph (base layer) → Escape does nothing.
 *
 * Bails when the event was already handled, when a non-filter input/textarea/
 * contenteditable is focused (dialogs and the conflict editor own their own
 * Escape), or when a modal/confirm overlay is open (it owns Escape).
 */
function EscapeStack() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;

      const active = document.activeElement as HTMLElement | null;
      const isFilterInput = active?.id === "global-filter-input";
      if (
        !isFilterInput &&
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      // A modal/confirm overlay (inset-0 z-50 backdrop) is open — let it own Escape.
      if (document.querySelector('[class*="inset-0"][class*="z-50"]')) return;

      const s = useRepoStore.getState();
      // 1a. Filter box is focused → always defocus, clearing any query first.
      //     Must run even when the filter is empty: otherwise no branch below
      //     matches, blur never fires, and Escape appears dead (focus stuck).
      if (isFilterInput) {
        if (s.filterInput !== "" || s.filterQuery !== "") s.clearFilter();
        active?.blur();
        e.preventDefault();
        return;
      }
      // 1b. Filter query active but input not focused (e.g. clicked into the
      //     diff) → clear it so Escape "exits" the filter.
      if (s.filterInput !== "" || s.filterQuery !== "") {
        s.clearFilter();
        e.preventDefault();
        return;
      }
      // 2. Middle-pane context: diff / large-diff guard / CI log / conflict
      //    editor → back to the graph. clearDiff() nulls the selected file,
      //    which also dismisses the conflict editor (shown for conflicted files).
      const conflictEditorOpen =
        s.selectedFilePath !== null &&
        s.selectedCommitId === null &&
        s.selectedStashIndex === null &&
        s.fileStatuses.some((f) => f.path === s.selectedFilePath && f.is_conflicted);
      if (
        s.activeDiff !== null ||
        s.largeDiffPending !== null ||
        s.ciSelectedJobId !== null ||
        conflictEditorOpen
      ) {
        s.clearDiff();
        // The file row that opened the diff is a <button> and still holds DOM
        // focus. Without this blur, *this* Escape keydown flips it into
        // :focus-visible and Chromium paints a stray focus ring on the row that
        // lingers until the next click. Dropping focus closes the pane cleanly.
        active?.blur();
        e.preventDefault();
        return;
      }
      // 3. Commit graph base layer — nothing to close.
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
      <FilterSearchHotkey />
      <EscapeStack />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;

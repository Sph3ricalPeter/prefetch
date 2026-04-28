import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore } from "@/stores/updater-store";

/**
 * Headless component that initialises the updater on app start.
 *
 * 1. Reads the current app version and stores it.
 * 2. After a short delay (3 s) checks for a new version.
 *
 * The result is surfaced by <UpdateIndicator /> and the Settings page —
 * this component renders nothing.
 */
export function UpdateChecker() {
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
  const setCurrentVersion = useUpdaterStore((s) => s.setCurrentVersion);

  useEffect(() => {
    // Grab the running app version from Tauri
    getVersion()
      .then(setCurrentVersion)
      .catch(() => {});

    // Give the app a moment to finish initialising before checking
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 3000);

    return () => clearTimeout(timer);
  }, [checkForUpdate, setCurrentVersion]);

  return null;
}

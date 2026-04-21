import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

/**
 * Checks for app updates on mount (once, shortly after startup).
 *
 * If an update is available:
 *  - Shows a loading toast while downloading
 *  - Shows a success toast when installed, asking the user to restart
 *
 * Silently swallows errors — update check is best-effort and must never
 * crash the app. This runs only inside the Tauri context (no-op in browser).
 */
export function UpdateChecker() {
  useEffect(() => {
    // Small delay so the rest of the app initialises first
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (!update) return;

        const toastId = toast.loading(
          `Update ${update.version} available — downloading…`
        );

        let totalBytes: number | undefined;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            totalBytes = event.data.contentLength;
          } else if (event.event === "Progress") {
            if (totalBytes) {
              // contentLength comes from Started, chunkLength is cumulative delta
              toast.loading(
                `Downloading update… ${Math.round((event.data.chunkLength / totalBytes) * 100)}%`,
                { id: toastId }
              );
            }
          }
        });

        toast.success("Update installed — restart Prefetch to apply it.", {
          id: toastId,
          duration: 0, // keep until dismissed
        });
      } catch {
        // Update check failed silently (no network, dev build, bad pubkey, etc.)
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return null;
}

import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

/** Safely extract an error message string from an unknown catch value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

interface UpdaterState {
  status: UpdateStatus;
  availableVersion: string | null;
  currentVersion: string | null;
  downloadProgress: number;
  error: string | null;

  /** Internal — holds the Tauri Update resource between check and download. */
  _updateHandle: Update | null;

  /** Check for a new version. Transitions: idle → checking → available|idle|error */
  checkForUpdate: () => Promise<void>;

  /** Download and install the pending update. Transitions: available → downloading → ready|error */
  startDownload: () => Promise<void>;

  /** Relaunch the app to apply the installed update. */
  applyAndRestart: () => Promise<void>;

  /** Dismiss an error and return to idle. */
  dismissError: () => void;

  /** Set the current app version (called once on mount). */
  setCurrentVersion: (version: string) => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  availableVersion: null,
  currentVersion: null,
  downloadProgress: 0,
  error: null,
  _updateHandle: null,

  checkForUpdate: async () => {
    const { status } = get();
    // Don't interrupt an in-progress download or restart
    if (status === "downloading" || status === "restarting") return;

    set({ status: "checking", error: null });

    try {
      const update = await check();
      if (!update) {
        set({ status: "idle", availableVersion: null, _updateHandle: null });
        return;
      }

      set({
        status: "available",
        availableVersion: update.version,
        _updateHandle: update,
      });
    } catch (err) {
      const message = errorMessage(err);
      set({ status: "error", error: message });
      toast.error("Update check failed", {
        description: message,
        duration: 8000,
      });
    }
  },

  startDownload: async () => {
    const { _updateHandle } = get();
    if (!_updateHandle) return;

    set({ status: "downloading", downloadProgress: 0 });

    try {
      let downloaded = 0;
      let totalBytes: number | undefined;

      await _updateHandle.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? undefined;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalBytes) {
            const progress = Math.min(
              100,
              Math.round((downloaded / totalBytes) * 100),
            );
            set({ downloadProgress: progress });
          }
        } else if (event.event === "Finished") {
          set({ downloadProgress: 100 });
        }
      });

      set({ status: "ready", downloadProgress: 100 });
    } catch (err) {
      const message = errorMessage(err);
      set({ status: "error", error: message });
      toast.error("Update download failed", {
        description: message,
        duration: 8000,
      });
    }
  },

  applyAndRestart: async () => {
    set({ status: "restarting" });
    try {
      await relaunch();
    } catch (err) {
      const message = errorMessage(err);
      set({ status: "error", error: message });
      toast.error("Update restart failed", {
        description: message,
        duration: 8000,
      });
    }
  },

  dismissError: () => {
    set({ status: "idle", error: null });
  },

  setCurrentVersion: (version: string) => {
    set({ currentVersion: version });
  },
}));

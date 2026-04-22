import { create } from "zustand";
import { toast } from "sonner";
import type {
  Profile,
  ProfilePath,
  CreateProfileData,
  ActiveProfileConfig,
} from "@/types/profile";
import {
  getProfiles,
  getProfileById,
  createProfile as dbCreateProfile,
  updateProfile as dbUpdateProfile,
  deleteProfile as dbDeleteProfile,
  getProfilePaths,
  addProfilePath as dbAddProfilePath,
  removeProfilePath as dbRemoveProfilePath,
  getRepoProfileId,
  updateRepoProfile,
  setUiState,
  getUiState,
} from "@/lib/database";
import { setActiveProfileCmd } from "@/lib/commands";

interface ProfileState {
  profiles: Profile[];
  activeProfile: Profile | null;

  /** Load all profiles from the database. */
  loadProfiles: () => Promise<void>;

  /** Create a new profile. */
  createProfile: (data: CreateProfileData) => Promise<string>;

  /** Update an existing profile. */
  updateProfile: (
    id: string,
    data: Partial<Omit<Profile, "id" | "created_at" | "updated_at">>,
  ) => Promise<void>;

  /** Delete a profile. */
  deleteProfile: (id: string) => Promise<void>;

  /**
   * Activate a profile (or deactivate all profiles by passing null).
   * Pushes the profile config to the Rust backend and refreshes identity/forge.
   */
  activateProfile: (profile: Profile | null) => Promise<void>;

  /**
   * Auto-switch profile based on the repo path.
   * Uses longest prefix match, falls back to default profile.
   */
  autoSwitchForRepo: (repoPath: string) => Promise<void>;

  /** Restore the last active profile from persisted UI state. */
  restoreActiveProfile: () => Promise<void>;

  // ── Path management ───────────────────────────────────────────────────────

  /** Get all path prefixes for a profile. */
  getPathsForProfile: (profileId: string) => Promise<ProfilePath[]>;

  /** Add a path prefix to a profile. */
  addPathToProfile: (profileId: string, pathPrefix: string) => Promise<void>;

  /** Remove a path prefix by its ID. */
  removePathFromProfile: (pathId: number) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfile: null,

  loadProfiles: async () => {
    try {
      const profiles = await getProfiles();
      set({ profiles });
    } catch (e) {
      console.error("Failed to load profiles:", e);
    }
  },

  createProfile: async (data: CreateProfileData) => {
    try {
      const id = await dbCreateProfile({
        name: data.name,
        user_name: data.user_name,
        user_email: data.user_email,
        ssh_key_path: data.ssh_key_path ?? null,
        is_default: data.is_default ?? false,
      });
      await get().loadProfiles();
      toast.success(`Profile "${data.name}" created`);
      return id;
    } catch (e) {
      toast.error(`Failed to create profile: ${e}`);
      throw e;
    }
  },

  updateProfile: async (id, data) => {
    try {
      await dbUpdateProfile(id, data);
      await get().loadProfiles();

      // If we updated the active profile, refresh it
      const active = get().activeProfile;
      if (active && active.id === id) {
        const updated = await getProfileById(id);
        if (updated) {
          await get().activateProfile(updated);
        }
      }

      toast.success("Profile updated");
    } catch (e) {
      toast.error(`Failed to update profile: ${e}`);
      throw e;
    }
  },

  deleteProfile: async (id) => {
    try {
      const profile = get().profiles.find((p) => p.id === id);
      const wasActive = get().activeProfile?.id === id;

      await dbDeleteProfile(id);
      await get().loadProfiles();

      // If the deleted profile was active, deactivate
      if (wasActive) {
        await get().activateProfile(null);
      }

      toast.success(`Profile "${profile?.name ?? "Unknown"}" deleted`);
    } catch (e) {
      toast.error(`Failed to delete profile: ${e}`);
      throw e;
    }
  },

  activateProfile: async (profile) => {
    set({ activeProfile: profile });

    // Build the config to send to Rust (or null to deactivate)
    const config: ActiveProfileConfig | null = profile
      ? {
          profile_id: profile.id,
          user_name: profile.user_name,
          user_email: profile.user_email,
          ssh_key_path: profile.ssh_key_path,
        }
      : null;

    try {
      await setActiveProfileCmd(config);
    } catch (e) {
      console.error("Failed to push profile to backend:", e);
    }

    // Persist the active profile ID for session restore
    try {
      await setUiState(
        "active_profile_id",
        profile ? profile.id : "",
      );
    } catch {
      // Non-critical
    }

    // Also persist this profile as the association for the currently open repo
    try {
      const { useRepoStore } = await import("@/stores/repo-store");
      const repoPath = useRepoStore.getState().repoPath;
      if (repoPath) {
        await updateRepoProfile(repoPath, profile?.id ?? null);
      }
    } catch {
      // Non-critical
    }
  },

  autoSwitchForRepo: async (repoPath: string) => {
    try {
      const current = get().activeProfile;

      // Restore the profile last used with this repo
      const savedProfileId = await getRepoProfileId(repoPath);
      if (savedProfileId && savedProfileId !== current?.id) {
        const savedProfile = await getProfileById(savedProfileId);
        if (savedProfile) {
          await get().activateProfile(savedProfile);
        }
      } else if (!savedProfileId && current) {
        // Repo has no profile association — deactivate so it uses git config
        await get().activateProfile(null);
      }
    } catch (e) {
      console.error("Profile auto-switch failed:", e);
    }
  },

  restoreActiveProfile: async () => {
    try {
      const savedId = await getUiState("active_profile_id");
      if (savedId) {
        const profile = await getProfileById(savedId);
        if (profile) {
          await get().activateProfile(profile);
        }
      }
    } catch {
      // Non-critical — first launch or DB not ready
    }
  },

  getPathsForProfile: async (profileId: string) => {
    return getProfilePaths(profileId);
  },

  addPathToProfile: async (profileId: string, pathPrefix: string) => {
    await dbAddProfilePath(profileId, pathPrefix);
  },

  removePathFromProfile: async (pathId: number) => {
    await dbRemoveProfilePath(pathId);
  },
}));

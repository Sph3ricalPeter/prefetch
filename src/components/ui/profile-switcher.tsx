import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, User, Settings2, Star } from "lucide-react";
import { toast } from "sonner";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";
import { ProfileAvatar } from "@/components/ui/avatar";
import { DropdownPanel } from "@/components/ui/dropdown-panel";

interface ProfileSwitcherProps {
  onManageProfiles: () => void;
}

export function ProfileSwitcher({ onManageProfiles }: ProfileSwitcherProps) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const activateProfile = useProfileStore((s) => s.activateProfile);
  const loadProfiles = useProfileStore((s) => s.loadProfiles);
  const loadGitIdentity = useRepoStore((s) => s.loadGitIdentity);
  const loadForgeStatus = useRepoStore((s) => s.loadForgeStatus);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Ensure profiles are loaded when the dropdown opens (guards against
  // HMR or race conditions leaving the profiles array empty)
  useEffect(() => {
    if (isOpen && profiles.length === 0) {
      loadProfiles();
    }
  }, [isOpen, profiles.length, loadProfiles]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleSwitch = async (profile: typeof activeProfile) => {
    setIsOpen(false);
    await activateProfile(profile);
    // Refresh identity and forge after switching
    loadGitIdentity().catch(() => {});
    loadForgeStatus().catch(() => {});
    toast.success(
      profile
        ? `Switched to "${profile.name}"`
        : "Profile deactivated — using git config",
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button — styled to match repo switcher */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-7 min-w-0 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {activeProfile ? (
          <>
            <ProfileAvatar name={activeProfile.user_name} email={activeProfile.user_email} size={20} color={activeProfile.color} icon={activeProfile.icon} avatarUrl={activeProfile.avatar_url} />
            <span className="truncate font-medium text-foreground">{activeProfile.name}</span>
          </>
        ) : (
          <>
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">No Profile</span>
          </>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <DropdownPanel align="right" className="w-56">
          {/* No profile option */}
          <button
            onClick={() => handleSwitch(null)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <User className="h-3.5 w-3.5 shrink-0 text-faint" />
            <span className="flex-1 text-left truncate">No Profile</span>
            {!activeProfile && <Check className="h-3 w-3 shrink-0 text-primary" />}
          </button>

          {profiles.length > 0 && (
            <div className="mx-2 my-1 border-t border-border" />
          )}

          {/* Profile list */}
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => handleSwitch(profile)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              style={{ borderLeftWidth: 3, borderLeftColor: profile.color }}
            >
              <ProfileAvatar name={profile.user_name} email={profile.user_email} size={20} color={profile.color} icon={profile.icon} avatarUrl={profile.avatar_url} />
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-foreground">{profile.name}</span>
                  {profile.is_default && (
                    <span className="flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-label font-medium text-muted-foreground shrink-0">
                      default
                      <Star className="h-2.5 w-2.5 fill-muted-foreground" />
                    </span>
                  )}
                </div>
                <span className="block truncate text-label text-dim">
                  {profile.user_email}
                </span>
              </div>
              {activeProfile?.id === profile.id && (
                <Check className="h-3 w-3 shrink-0 text-primary" />
              )}
            </button>
          ))}

          <div className="mx-2 my-1 border-t border-border" />

          {/* Manage profiles */}
          <button
            onClick={() => {
              setIsOpen(false);
              onManageProfiles();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
            <span>Manage Profiles…</span>
          </button>
        </DropdownPanel>
      )}
    </div>
  );
}

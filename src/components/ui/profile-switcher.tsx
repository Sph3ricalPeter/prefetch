import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, User, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";
import { gravatarUrl } from "@/lib/gravatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

/** Tiny avatar — tries gravatar, falls back to initials. */
function MiniAvatar({ name, email, size = 16 }: { name: string; email: string; size?: number }) {
  const src = gravatarUrl(email, size * 2);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setLoadedSrc(src); };
    img.onerror = () => {};
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);

  const px = `${size}px`;

  if (loadedSrc === src) {
    return (
      <img
        src={src}
        alt={name}
        className="shrink-0 rounded-full"
        style={{ width: px, height: px }}
      />
    );
  }

  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-full bg-primary/20 text-primary font-bold"
      style={{ width: px, height: px, fontSize: `${Math.max(size * 0.45, 7)}px` }}
    >
      {getInitials(name)}
    </div>
  );
}

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
      {/* Trigger button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors max-w-[140px]"
          >
            {activeProfile ? (
              <>
                <MiniAvatar name={activeProfile.user_name} email={activeProfile.user_email} size={14} />
                <span className="truncate">{activeProfile.name}</span>
              </>
            ) : (
              <>
                <User className="h-3 w-3 shrink-0 text-faint" />
                <span className="truncate text-dim">No Profile</span>
              </>
            )}
            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-faint" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {activeProfile
            ? `Profile: ${activeProfile.name} (${activeProfile.user_email})`
            : "No profile active — using git config identity"}
        </TooltipContent>
      </Tooltip>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 w-56 rounded-md border border-border bg-popover shadow-lg py-1">
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
            >
              <MiniAvatar name={profile.user_name} email={profile.user_email} size={16} />
              <div className="flex-1 min-w-0 text-left">
                <span className="block truncate text-foreground">{profile.name}</span>
                <span className="block truncate text-caption text-dim">
                  {profile.user_email}
                </span>
              </div>
              {profile.is_default && (
                <span className="rounded bg-accent px-1 py-0.5 text-caption text-dim shrink-0">
                  default
                </span>
              )}
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
        </div>
      )}
    </div>
  );
}

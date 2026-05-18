import { useMemo } from "react";
import {
  getInitials,
  getAvatarColor,
  getContrastColor,
  detectBot,
  getProfileIcon,
  type IconElement,
  type ProfileIconDef,
} from "@/lib/avatar";
import { useAvatarUrl } from "@/hooks/use-avatar-url";
import { useProfileStore } from "@/stores/profile-store";

// ── Shared SVG helpers ─────────────────────────────────────────────────────

function SvgElement({ tag, attrs }: { tag: string; attrs: Record<string, string> }) {
  switch (tag) {
    case "path": return <path {...attrs} />;
    case "rect": return <rect {...attrs} />;
    case "circle": return <circle {...attrs} />;
    case "line": return <line {...attrs} />;
    default: return null;
  }
}

export function IconSvg({ def, size }: { def: ProfileIconDef; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${def.viewBox} ${def.viewBox}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {def.elements.map(([tag, attrs], i) => (
        <SvgElement key={i} tag={tag} attrs={attrs} />
      ))}
    </svg>
  );
}

function BotIconSvg({
  elements,
  viewBox,
  fgColor,
  iconStroke,
  size,
}: {
  elements: readonly IconElement[];
  viewBox: number;
  fgColor: string;
  iconStroke?: boolean;
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={iconStroke ? {
        stroke: fgColor,
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      } : undefined}
    >
      {elements.map(([tag, attrs], i) => {
        const { fill, ...rest } = attrs;
        const props: Record<string, string> = { ...rest };
        if (fill === "currentColor" || !iconStroke) {
          props.fill = fgColor;
        }
        return <SvgElement key={i} tag={tag} attrs={props} />;
      })}
    </svg>
  );
}

// ── AuthorAvatar ───────────────────────────────────────────────────────────
// For commit authors anywhere in the app (graph detail, co-authors, etc.).
// If the author matches the active profile, uses the profile's chosen avatar
// (forge image, custom icon, or initials). Otherwise falls back to gravatar → forge → initials.

export function AuthorAvatar({
  name,
  email,
  size = 20,
}: {
  name: string;
  email: string;
  size?: number;
}) {
  const bot = useMemo(() => detectBot(name, email), [name, email]);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const isProfileMatch = activeProfile && activeProfile.user_email.toLowerCase() === email.toLowerCase();
  const isForgeAvatar = isProfileMatch && activeProfile.icon?.startsWith("forge:");
  const profileIconDef = isProfileMatch && activeProfile.icon && !isForgeAvatar
    ? getProfileIcon(activeProfile.icon)
    : undefined;

  const skipUrl = !!bot || !!isProfileMatch;
  const avatarUrl = useAvatarUrl(email, skipUrl);

  const bg = useMemo(
    () => isProfileMatch ? activeProfile.color : getAvatarColor(email),
    [email, isProfileMatch, activeProfile],
  );
  const fg = useMemo(() => getContrastColor(bg), [bg]);

  if (bot) {
    const iconScale = bot.iconStroke ? 0.6 : 0.55;
    return (
      <div
        className="shrink-0 rounded-full flex items-center justify-center"
        style={{ width: size, height: size, backgroundColor: bot.bgColor }}
      >
        <BotIconSvg
          elements={bot.iconElements}
          viewBox={bot.iconViewBox}
          fgColor={bot.fgColor}
          iconStroke={bot.iconStroke}
          size={Math.round(size * iconScale)}
        />
      </div>
    );
  }

  if (isProfileMatch && isForgeAvatar && activeProfile.avatar_url) {
    return (
      <img
        src={activeProfile.avatar_url}
        alt={name}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }

  if (!isProfileMatch && avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-bold leading-none"
      style={{ width: size, height: size, backgroundColor: bg, color: fg, fontSize: `${Math.max(size * 0.4, 7)}px` }}
    >
      {profileIconDef ? <IconSvg def={profileIconDef} size={Math.round(size * 0.65)} /> : getInitials(name)}
    </div>
  );
}

// ── ProfileAvatar ──────────────────────────────────────────────────────────
// For profile settings, switcher, and modal. Shows the user's explicitly chosen
// avatar: forge image, custom icon, or initials. No automatic gravatar lookup.

export function ProfileAvatar({
  name,
  email,
  size = 40,
  color,
  icon,
  avatarUrl,
}: {
  name: string;
  email: string;
  size?: number;
  color?: string;
  icon?: string | null;
  avatarUrl?: string | null;
}) {
  const isForgeAvatar = icon?.startsWith("forge:");
  const iconDef = icon && !isForgeAvatar ? getProfileIcon(icon) : undefined;

  if (isForgeAvatar && avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }

  const bg = color || getAvatarColor(email);
  const fg = getContrastColor(bg);
  const iconSize = size >= 24 ? Math.round(size * 0.55) : Math.round(size * 0.7);
  const fontSize = `${Math.max(size * 0.4, 7)}px`;

  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-bold leading-none"
      style={{ width: size, height: size, backgroundColor: bg, color: fg, fontSize }}
    >
      {iconDef ? <IconSvg def={iconDef} size={iconSize} /> : (name ? getInitials(name) : "?")}
    </div>
  );
}

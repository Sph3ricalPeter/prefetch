import { getTokenInfo } from "@/lib/commands";
import { getProfileForgeHosts } from "@/lib/database";

/** A forge avatar option offered in the profile editor, keyed by host. */
export interface ForgeAvatarOption {
  url: string;
  kind: string;
  label: string;
}

// Cached per URL: whether the browser can load it directly.
const loadable = new Map<string, boolean>();

/**
 * Probe whether an avatar URL loads directly in the browser. Returns false for
 * auth-gated images that 401 — e.g. custom user avatars on restricted
 * self-hosted GitLab, which a personal access token cannot fetch at any scope
 * (known GitLab limitation, gitlab-org/gitlab#8811). Used to avoid offering a
 * broken avatar option (#72). Cached by URL.
 */
function canLoadAvatar(url: string): Promise<boolean> {
  if (url.startsWith("data:")) return Promise.resolve(true);
  const cached = loadable.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { loadable.set(url, true); resolve(true); };
    img.onerror = () => { loadable.set(url, false); resolve(false); };
    img.src = url;
  });
}

/** Public forges that always offer OAuth, so they're shown even without a repo. */
const DEFAULT_FORGE_HOSTS: { host: string; label: string; kind: string }[] = [
  { host: "github.com", label: "GitHub", kind: "github" },
  { host: "gitlab.com", label: "GitLab", kind: "gitlab" },
  { host: "bitbucket.org", label: "Bitbucket", kind: "bitbucket" },
];

/**
 * Fetch the authenticated-user avatar URL for every host a profile has a token
 * on — the public defaults plus any self-hosted host the profile has opened a
 * repo on (discovered via `getProfileForgeHosts`). Without the self-hosted
 * hosts, a self-hosted GitLab user could never select their own avatar and it
 * would fall back to initials forever (#72).
 */
export async function fetchProfileForgeAvatars(
  profileId: string,
): Promise<Record<string, ForgeAvatarOption>> {
  const hosts = [...DEFAULT_FORGE_HOSTS];
  try {
    for (const ph of await getProfileForgeHosts(profileId)) {
      if (!hosts.some((h) => h.host === ph.host)) {
        hosts.push({ host: ph.host, label: ph.host, kind: ph.kind });
      }
    }
  } catch {
    // No discovered hosts — fall back to the public defaults.
  }

  const results = await Promise.all(
    hosts.map(({ host, label, kind }) =>
      getTokenInfo(profileId, host)
        .then((info) => ({ host, label, kind, avatarUrl: info?.avatar_url ?? null }))
        .catch(() => ({ host, label, kind, avatarUrl: null as string | null })),
    ),
  );

  const map: Record<string, ForgeAvatarOption> = {};
  for (const { host, label, kind, avatarUrl } of results) {
    if (!avatarUrl) continue;
    // Only offer avatars the browser can actually load. Auth-gated images (e.g.
    // custom self-hosted GitLab user avatars) 401 and would otherwise render as
    // a broken/corrupted option (#72).
    if (await canLoadAvatar(avatarUrl)) {
      map[host] = { url: avatarUrl, kind, label };
    }
  }
  return map;
}

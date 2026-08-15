import { getUiState, setUiState } from "@/lib/database";
import { isDerivedGravatarUrl } from "@/lib/gravatar";

// Module-level avatar image cache for the commit graph canvas.
// null = load attempted, pending or failed (fallback to initials).
export const avatarImageCache = new Map<string, HTMLImageElement | null>();

// Loaded images now survive repo switches (see clearAvatarCache), so this is
// the only thing bounding the map — without it a long session across many
// repos retains one decoded bitmap per author seen, forever. Map iterates in
// insertion order, so the first key is the least recently stored.
const MAX_CACHED_IMAGES = 300;

/** Store a loaded avatar image, evicting the oldest once over the cap.
 *  Evicting only costs a reload, and `rememberAvatarUrl` makes that cheap. */
export function cacheAvatarImage(email: string, img: HTMLImageElement): void {
  avatarImageCache.delete(email);
  avatarImageCache.set(email, img);
  while (avatarImageCache.size > MAX_CACHED_IMAGES) {
    const oldest = avatarImageCache.keys().next();
    if (oldest.done) break;
    avatarImageCache.delete(oldest.value);
  }
}

// Tracks emails already tried for forge avatar lookup to avoid duplicate API calls.
export const forgeAvatarAttempted = new Set<string>();

// ── Remembered avatar URLs ─────────────────────────────────────────
// Forge avatar URLs, keyed by email and persisted in ui_state. Without this, a
// repo switch or restart re-probed every author from scratch and any transient
// 404/timeout dropped a working avatar back to initials. A failed lookup never
// evicts a remembered URL — only another valid URL replaces it.
//
// The gravatar URLs *we* build are deliberately NOT remembered: they embed the
// caller's requested `?s=<size>`, so caching one under the email alone lets
// whichever consumer resolves first pin its size on the other (the canvas asks
// for 48, `useAvatarUrl` for 80). They are also pure functions of the email, so
// rebuilding one locally is free — the round-trip worth skipping is the forge
// lookup, and that is what stays here. A gravatar URL the forge itself returned
// (GitLab does this) is a lookup result and is remembered like any other.

const UI_STATE_KEY = "avatar_urls";
const resolvedUrls = new Map<string, string>();

// Bounded for the same reason as the image cache: entries are never otherwise
// removed, and the whole map is serialised into one ui_state row per write.
// Least-recently-used goes first — reads bump recency, so a repo opened daily
// outlives one opened once.
const MAX_REMEMBERED_URLS = 500;

// The prefetch pass resolves every author at once, so writes are debounced into
// one — the whole map is serialised per write, and a 200-author repo would
// otherwise rewrite a growing blob 200 times during startup.
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function rememberAvatarUrl(email: string, url: string): void {
  if (isDerivedGravatarUrl(url)) return;
  if (resolvedUrls.get(email) === url) return;
  resolvedUrls.delete(email);
  resolvedUrls.set(email, url);
  evictOldestUrls();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    setUiState(UI_STATE_KEY, JSON.stringify([...resolvedUrls])).catch(() => {});
  }, 500);
}

export function rememberedAvatarUrl(email: string): string | undefined {
  const url = resolvedUrls.get(email);
  // Re-insert so recency reflects use, not just when it was first resolved.
  // Order only drives eviction, so leaving the persisted row stale until the
  // next write is fine.
  if (url !== undefined) {
    resolvedUrls.delete(email);
    resolvedUrls.set(email, url);
  }
  return url;
}

function evictOldestUrls(): void {
  while (resolvedUrls.size > MAX_REMEMBERED_URLS) {
    const oldest = resolvedUrls.keys().next();
    if (oldest.done) break;
    resolvedUrls.delete(oldest.value);
  }
}

/** Load remembered URLs from ui_state. Call once at startup, before the first
 *  repo opens, so the graph paints known avatars without re-probing. */
export async function loadRememberedAvatarUrls(): Promise<void> {
  try {
    const raw = await getUiState(UI_STATE_KEY);
    if (!raw) return;
    for (const [email, url] of JSON.parse(raw) as [string, string][]) {
      resolvedUrls.set(email, url);
    }
    // A row written before the cap existed can be arbitrarily large.
    evictOldestUrls();
  } catch {
    // Missing or corrupt — start empty and let avatars re-resolve.
  }
}

/** Drop pending/failed entries so forge lookups retry with fresh tokens on the
 *  new repo. Loaded images and remembered URLs survive: switching repos is no
 *  reason to lose an avatar we already have. */
export function clearAvatarCache(): void {
  for (const [key, img] of avatarImageCache) {
    if (!img) avatarImageCache.delete(key);
  }
  forgeAvatarAttempted.clear();
}

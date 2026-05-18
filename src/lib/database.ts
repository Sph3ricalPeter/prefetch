import Database from "@tauri-apps/plugin-sql";
import type { Profile, ProfilePath } from "@/types/profile";
import { pickProfileColor } from "@/lib/avatar";

let db: Database | null = null;

/** Initialize the SQLite database and create tables. */
export async function initDatabase(): Promise<void> {
  db = await Database.load("sqlite:prefetch.db");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS recent_repos (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_opened_at INTEGER NOT NULL,
      profile_id TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ui_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      ssh_key_path TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS profile_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      path_prefix TEXT NOT NULL,
      UNIQUE(profile_id, path_prefix)
    )
  `);

  // Add profile_id column to recent_repos if it doesn't exist yet (migration)
  try {
    await db.execute(
      `ALTER TABLE recent_repos ADD COLUMN profile_id TEXT`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Add forge_kind column to recent_repos (migration)
  try {
    await db.execute(
      `ALTER TABLE recent_repos ADD COLUMN forge_kind TEXT`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Add forge_host / forge_owner / forge_repo columns to recent_repos (migration)
  for (const col of ["forge_host", "forge_owner", "forge_repo"]) {
    try {
      await db.execute(`ALTER TABLE recent_repos ADD COLUMN ${col} TEXT`);
    } catch {
      // Column already exists — ignore
    }
  }

  // Add color column to profiles (migration)
  try {
    await db.execute(
      `ALTER TABLE profiles ADD COLUMN color TEXT NOT NULL DEFAULT '#3b82f6'`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Add icon column to profiles (migration)
  try {
    await db.execute(
      `ALTER TABLE profiles ADD COLUMN icon TEXT DEFAULT NULL`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Add avatar_url column to profiles (migration)
  try {
    await db.execute(
      `ALTER TABLE profiles ADD COLUMN avatar_url TEXT DEFAULT NULL`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Backfill existing profiles that got the default color
  await backfillProfileColors();

  // Migrate old vivid palette → new muted palette
  await migrateProfilePalette();
}

async function backfillProfileColors(): Promise<void> {
  const profiles = await getDb().select<{ id: string; color: string }[]>(
    "SELECT id, color FROM profiles ORDER BY created_at ASC",
  );
  for (let i = 0; i < profiles.length; i++) {
    const expected = pickProfileColor(i);
    if (profiles[i].color === "#3b82f6" && i > 0) {
      await getDb().execute("UPDATE profiles SET color = $1 WHERE id = $2", [
        expected,
        profiles[i].id,
      ]);
    }
  }
}

const OLD_TO_NEW_PALETTE: Record<string, string> = {
  "#3b82f6": "#7c9cbf",
  "#10b981": "#6ba892",
  "#f59e0b": "#c4a054",
  "#8b5cf6": "#9b85c4",
  "#06b6d4": "#5ea8a8",
  "#ec4899": "#c47d94",
  "#f97316": "#c48a5e",
  "#ef4444": "#b87070",
};

async function migrateProfilePalette(): Promise<void> {
  const profiles = await getDb().select<{ id: string; color: string }[]>(
    "SELECT id, color FROM profiles",
  );
  for (const p of profiles) {
    const replacement = OLD_TO_NEW_PALETTE[p.color];
    if (replacement) {
      await getDb().execute("UPDATE profiles SET color = $1 WHERE id = $2", [
        replacement,
        p.id,
      ]);
    }
  }
}

/** Get the database instance. Throws if not initialized. */
function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

// --- Recent Repos ---

export interface RecentRepo {
  path: string;
  name: string;
  last_opened_at: number;
  profile_id: string | null;
  forge_kind: string | null;
  forge_host: string | null;
  forge_owner: string | null;
  forge_repo: string | null;
}

export interface ProfileForgeHost {
  host: string;
  kind: string;
  repos: { owner: string; repo: string; path: string }[];
}

/** Add or update a repo in the recent list. */
export async function addRecentRepo(
  path: string,
  name: string,
  profileId?: string | null,
  forgeKind?: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await getDb().execute(
    `INSERT INTO recent_repos (path, name, last_opened_at, profile_id, forge_kind)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(path) DO UPDATE SET name = $2, last_opened_at = $3, profile_id = $4, forge_kind = COALESCE($5, forge_kind)`,
    [path, name, now, profileId ?? null, forgeKind ?? null],
  );
}

/** Get all recent repos, most recently opened first. Optionally filter by profile. */
export async function getRecentRepos(
  profileId?: string | null,
): Promise<RecentRepo[]> {
  if (profileId) {
    return await getDb().select<RecentRepo[]>(
      `SELECT path, name, last_opened_at, profile_id, forge_kind, forge_host, forge_owner, forge_repo FROM recent_repos
       WHERE profile_id = $1 OR profile_id IS NULL
       ORDER BY last_opened_at DESC LIMIT 20`,
      [profileId],
    );
  }
  return await getDb().select<RecentRepo[]>(
    "SELECT path, name, last_opened_at, profile_id, forge_kind, forge_host, forge_owner, forge_repo FROM recent_repos ORDER BY last_opened_at DESC LIMIT 20",
  );
}

/** Get distinct forge hosts (with their repos) associated with a profile. */
export async function getProfileForgeHosts(
  profileId: string,
): Promise<ProfileForgeHost[]> {
  const rows = await getDb().select<{
    forge_host: string;
    forge_kind: string;
    forge_owner: string | null;
    forge_repo: string | null;
    path: string;
  }[]>(
    `SELECT forge_host, forge_kind, forge_owner, forge_repo, path
     FROM recent_repos
     WHERE profile_id = $1
       AND forge_host IS NOT NULL
       AND forge_kind IS NOT NULL
     ORDER BY last_opened_at DESC`,
    [profileId],
  );
  const byHost = new Map<string, ProfileForgeHost>();
  for (const r of rows) {
    let entry = byHost.get(r.forge_host);
    if (!entry) {
      entry = { host: r.forge_host, kind: r.forge_kind, repos: [] };
      byHost.set(r.forge_host, entry);
    }
    if (r.forge_owner && r.forge_repo) {
      const dup = entry.repos.some(
        (x) => x.owner === r.forge_owner && x.repo === r.forge_repo,
      );
      if (!dup) {
        entry.repos.push({ owner: r.forge_owner, repo: r.forge_repo, path: r.path });
      }
    }
  }
  return [...byHost.values()];
}

/** Get the profile ID last associated with a specific repo path. */
export async function getRepoProfileId(
  repoPath: string,
): Promise<string | null> {
  const rows = await getDb().select<{ profile_id: string | null }[]>(
    "SELECT profile_id FROM recent_repos WHERE path = $1",
    [repoPath],
  );
  return rows.length > 0 ? rows[0].profile_id : null;
}

/** Update the profile association for a repo already in the recent list. */
export async function updateRepoProfile(
  repoPath: string,
  profileId: string | null,
): Promise<void> {
  await getDb().execute(
    "UPDATE recent_repos SET profile_id = $1 WHERE path = $2",
    [profileId, repoPath],
  );
}

/** Update forge metadata (kind + host + owner + repo) for a repo. */
export async function updateRepoForgeInfo(
  repoPath: string,
  forgeKind: string | null,
  forgeHost: string | null,
  forgeOwner: string | null,
  forgeRepo: string | null,
): Promise<void> {
  await getDb().execute(
    `UPDATE recent_repos
     SET forge_kind = $1, forge_host = $2, forge_owner = $3, forge_repo = $4
     WHERE path = $5`,
    [forgeKind, forgeHost, forgeOwner, forgeRepo, repoPath],
  );
}

/** Remove a repo from the recent list. */
export async function removeRecentRepo(path: string): Promise<void> {
  await getDb().execute("DELETE FROM recent_repos WHERE path = $1", [path]);
}

// --- UI State ---

/** Get a persisted UI state value. */
export async function getUiState(key: string): Promise<string | null> {
  const rows = await getDb().select<{ value: string }[]>(
    "SELECT value FROM ui_state WHERE key = $1",
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

/** Set a persisted UI state value. */
export async function setUiState(key: string, value: string): Promise<void> {
  await getDb().execute(
    `INSERT INTO ui_state (key, value)
     VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value],
  );
}

/** Delete UI state by exact keys and by key prefixes (e.g. `graph_layout:`). */
export async function deleteUiState(opts: {
  keys?: string[];
  prefixes?: string[];
}): Promise<void> {
  const db = getDb();
  for (const key of opts.keys ?? []) {
    await db.execute("DELETE FROM ui_state WHERE key = $1", [key]);
  }
  for (const prefix of opts.prefixes ?? []) {
    // SQLite LIKE — escape underscores and percent signs in the prefix to
    // avoid matching unrelated keys.
    const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    await db.execute(
      "DELETE FROM ui_state WHERE key LIKE $1 ESCAPE '\\'",
      [`${escaped}%`],
    );
  }
}

// --- Profiles ---

/**
 * Normalize a file path for consistent comparison.
 * Converts backslashes to forward slashes, lowercases drive letter on Windows,
 * and strips trailing slashes.
 */
export function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/");
  // Lowercase Windows drive letter: C:/ → c:/
  if (/^[A-Z]:\//.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  // Strip trailing slash (unless it's just a drive root like "c:/")
  if (normalized.length > 3 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Generate a UUID v4. */
function uuid(): string {
  return crypto.randomUUID();
}

/** Get all profiles. */
export async function getProfiles(): Promise<Profile[]> {
  const rows = await getDb().select<
    (Omit<Profile, "is_default"> & { is_default: number })[]
  >("SELECT * FROM profiles ORDER BY name ASC");
  return rows.map((r) => ({ ...r, is_default: r.is_default === 1 }));
}

/** Get a profile by ID. */
export async function getProfileById(id: string): Promise<Profile | null> {
  const rows = await getDb().select<
    (Omit<Profile, "is_default"> & { is_default: number })[]
  >("SELECT * FROM profiles WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, is_default: r.is_default === 1 };
}

/** Create a new profile. Returns the generated ID. */
export async function createProfile(data: {
  name: string;
  user_name: string;
  user_email: string;
  ssh_key_path?: string | null;
  color?: string;
  icon?: string | null;
  avatar_url?: string | null;
  is_default?: boolean;
}): Promise<string> {
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);

  // Auto-assign color from palette if not provided
  const existingCount = (
    await getDb().select<{ cnt: number }[]>(
      "SELECT COUNT(*) as cnt FROM profiles",
    )
  )[0].cnt;
  const color = data.color ?? pickProfileColor(existingCount);

  // If this is set as default, unset any existing default first
  if (data.is_default) {
    await getDb().execute(
      "UPDATE profiles SET is_default = 0 WHERE is_default = 1",
    );
  }

  await getDb().execute(
    `INSERT INTO profiles (id, name, user_name, user_email, ssh_key_path, color, icon, avatar_url, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      data.name,
      data.user_name,
      data.user_email,
      data.ssh_key_path ?? null,
      color,
      data.icon ?? null,
      data.avatar_url ?? null,
      data.is_default ? 1 : 0,
      now,
      now,
    ],
  );
  return id;
}

/** Update an existing profile. */
export async function updateProfile(
  id: string,
  data: Partial<{
    name: string;
    user_name: string;
    user_email: string;
    ssh_key_path: string | null;
    color: string;
    icon: string | null;
    avatar_url: string | null;
    is_default: boolean;
  }>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // If setting as default, unset any existing default first
  if (data.is_default) {
    await getDb().execute(
      "UPDATE profiles SET is_default = 0 WHERE is_default = 1 AND id != $1",
      [id],
    );
  }

  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, now];
  let idx = 3;

  if (data.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(data.name);
    idx++;
  }
  if (data.user_name !== undefined) {
    sets.push(`user_name = $${idx}`);
    params.push(data.user_name);
    idx++;
  }
  if (data.user_email !== undefined) {
    sets.push(`user_email = $${idx}`);
    params.push(data.user_email);
    idx++;
  }
  if (data.ssh_key_path !== undefined) {
    sets.push(`ssh_key_path = $${idx}`);
    params.push(data.ssh_key_path);
    idx++;
  }
  if (data.color !== undefined) {
    sets.push(`color = $${idx}`);
    params.push(data.color);
    idx++;
  }
  if (data.icon !== undefined) {
    sets.push(`icon = $${idx}`);
    params.push(data.icon);
    idx++;
  }
  if (data.avatar_url !== undefined) {
    sets.push(`avatar_url = $${idx}`);
    params.push(data.avatar_url);
    idx++;
  }
  if (data.is_default !== undefined) {
    sets.push(`is_default = $${idx}`);
    params.push(data.is_default ? 1 : 0);
    idx++;
  }

  await getDb().execute(
    `UPDATE profiles SET ${sets.join(", ")} WHERE id = $1`,
    params,
  );
}

/** Delete a profile and its associated path entries (CASCADE). */
export async function deleteProfile(id: string): Promise<void> {
  // SQLite foreign key cascades require PRAGMA foreign_keys = ON which may not
  // be enabled, so delete paths explicitly first.
  await getDb().execute("DELETE FROM profile_paths WHERE profile_id = $1", [
    id,
  ]);
  await getDb().execute("DELETE FROM profiles WHERE id = $1", [id]);
  // Unassign any recent repos that were associated with this profile
  await getDb().execute(
    "UPDATE recent_repos SET profile_id = NULL WHERE profile_id = $1",
    [id],
  );
}

/** Get all path prefixes for a profile. */
export async function getProfilePaths(
  profileId: string,
): Promise<ProfilePath[]> {
  return await getDb().select<ProfilePath[]>(
    "SELECT * FROM profile_paths WHERE profile_id = $1 ORDER BY path_prefix ASC",
    [profileId],
  );
}

/** Add a path prefix to a profile. Normalizes the path before storing. */
export async function addProfilePath(
  profileId: string,
  pathPrefix: string,
): Promise<void> {
  const normalized = normalizePath(pathPrefix);
  await getDb().execute(
    `INSERT OR IGNORE INTO profile_paths (profile_id, path_prefix)
     VALUES ($1, $2)`,
    [profileId, normalized],
  );
}

/** Remove a path prefix entry by its ID. */
export async function removeProfilePath(id: number): Promise<void> {
  await getDb().execute("DELETE FROM profile_paths WHERE id = $1", [id]);
}

/**
 * Find the best-matching profile for a repo path using longest prefix match.
 * Only returns a profile if an explicit path prefix matches — does NOT fall
 * back to the default profile, so that per-repo saved associations and manual
 * selections are respected.
 */
export async function matchProfileForRepo(
  repoPath: string,
): Promise<Profile | null> {
  const normalized = normalizePath(repoPath);

  // Longest prefix match: the repo path must start with the stored prefix
  const rows = await getDb().select<
    (Omit<Profile, "is_default"> & { is_default: number })[]
  >(
    `SELECT p.* FROM profiles p
     JOIN profile_paths pp ON pp.profile_id = p.id
     WHERE $1 LIKE (pp.path_prefix || '%')
     ORDER BY LENGTH(pp.path_prefix) DESC
     LIMIT 1`,
    [normalized],
  );

  if (rows.length > 0) {
    const r = rows[0];
    return { ...r, is_default: r.is_default === 1 };
  }

  return null;
}

import Database from "@tauri-apps/plugin-sql";
import type { Profile, ProfilePath } from "@/types/profile";

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
}

/** Add or update a repo in the recent list. */
export async function addRecentRepo(
  path: string,
  name: string,
  profileId?: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await getDb().execute(
    `INSERT INTO recent_repos (path, name, last_opened_at, profile_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(path) DO UPDATE SET name = $2, last_opened_at = $3, profile_id = $4`,
    [path, name, now, profileId ?? null],
  );
}

/** Get all recent repos, most recently opened first. Optionally filter by profile. */
export async function getRecentRepos(
  profileId?: string | null,
): Promise<RecentRepo[]> {
  if (profileId) {
    // Show repos for this profile + unassigned repos
    return await getDb().select<RecentRepo[]>(
      `SELECT path, name, last_opened_at, profile_id FROM recent_repos
       WHERE profile_id = $1 OR profile_id IS NULL
       ORDER BY last_opened_at DESC LIMIT 20`,
      [profileId],
    );
  }
  return await getDb().select<RecentRepo[]>(
    "SELECT path, name, last_opened_at, profile_id FROM recent_repos ORDER BY last_opened_at DESC LIMIT 20",
  );
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
  is_default?: boolean;
}): Promise<string> {
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);

  // If this is set as default, unset any existing default first
  if (data.is_default) {
    await getDb().execute(
      "UPDATE profiles SET is_default = 0 WHERE is_default = 1",
    );
  }

  await getDb().execute(
    `INSERT INTO profiles (id, name, user_name, user_email, ssh_key_path, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      data.name,
      data.user_name,
      data.user_email,
      data.ssh_key_path ?? null,
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

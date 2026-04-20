import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

/** Initialize the SQLite database and create tables. */
export async function initDatabase(): Promise<void> {
  db = await Database.load("sqlite:prefetch.db");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS recent_repos (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_opened_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ui_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
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
}

/** Add or update a repo in the recent list. */
export async function addRecentRepo(
  path: string,
  name: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await getDb().execute(
    `INSERT INTO recent_repos (path, name, last_opened_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(path) DO UPDATE SET name = $2, last_opened_at = $3`,
    [path, name, now],
  );
}

/** Get all recent repos, most recently opened first. */
export async function getRecentRepos(): Promise<RecentRepo[]> {
  return await getDb().select<RecentRepo[]>(
    "SELECT path, name, last_opened_at FROM recent_repos ORDER BY last_opened_at DESC LIMIT 20",
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

import { Platform } from 'react-native';
import { open, type DB } from '@op-engineering/op-sqlite';

/** Values that can be bound to a SQL parameter (matches op-sqlite's Scalar). */
type SQLiteScalar = string | number | boolean | null | ArrayBuffer | ArrayBufferView;

/**
 * expo-sqlite compatible surface. The app's repositories were written against
 * expo-sqlite's async API; this adapter maps it onto @op-engineering/op-sqlite
 * so no repository code has to change.
 */
export interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

/**
 * Splits a SQL string into individual statements. op-sqlite only executes the
 * first prepared statement of a string, and migrations ship as multi-statement
 * blocks, so we split them here (respecting quoted strings).
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (const ch of sql) {
    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (ch === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  statements.push(current);
  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}

function normalizeParams(params: unknown[] = []): SQLiteScalar[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as SQLiteScalar;
  });
}

class OpSQLiteAdapter implements SQLiteDatabase {
  constructor(private readonly handle: DB) {}

  async execAsync(sql: string): Promise<void> {
    for (const statement of splitStatements(sql)) {
      await this.handle.execute(statement);
    }
  }

  async runAsync(sql: string, params: unknown[] = []) {
    const result = await this.handle.execute(sql, normalizeParams(params));
    return { lastInsertRowId: result.insertId ?? 0, changes: result.rowsAffected };
  }

  async getAllAsync<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.handle.execute(sql, normalizeParams(params));
    return result.rows as T[];
  }

  async getFirstAsync<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const result = await this.handle.execute(sql, normalizeParams(params));
    return (result.rows.length > 0 ? result.rows[0] : null) as T | null;
  }
}

let db: SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLiteDatabase> {
  if (Platform.OS === 'web') {
    throw new Error('SQLite is not supported on web. Use API instead.');
  }
  if (db) return db;
  const handle = open({ name: 'ojchat.db' });
  db = new OpSQLiteAdapter(handle);
  await db.execAsync('PRAGMA journal_mode=WAL;');
  await db.execAsync('PRAGMA foreign_keys=ON;');
  await runMigrations(db);
  return db;
}

async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = await db.getAllAsync<{ version: number }>(
    'SELECT version FROM _migrations ORDER BY version',
  );
  const appliedVersions = new Set(applied.map((r) => r.version));

  const migrations = [
    { version: 1, up: migration001 },
    { version: 2, up: migration002 },
    { version: 3, up: migration003 },
    { version: 4, up: migration004 },
    { version: 5, up: migration005 },
  ];

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      await db.execAsync('BEGIN TRANSACTION;');
      try {
        await migration.up(db);
        await db.runAsync('INSERT INTO _migrations (version) VALUES (?);', [migration.version]);
        await db.execAsync('COMMIT;');
      } catch (error) {
        await db.execAsync('ROLLBACK;');
        throw new Error(`Migration ${migration.version} failed`);
      }
    }
  }
}

async function migration001(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      display_name TEXT NOT NULL,
      bio TEXT,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      last_active_at TEXT,
      is_verified INTEGER DEFAULT 0,
      profile_completion INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      min_age INTEGER DEFAULT 18,
      max_age INTEGER DEFAULT 50,
      max_distance INTEGER DEFAULT 50,
      gender_preference TEXT DEFAULT 'all',
      show_me INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS interests (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      category TEXT
    );
    CREATE TABLE IF NOT EXISTS user_interests (
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      interest_id TEXT REFERENCES interests(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, interest_id)
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      local_path TEXT,
      position INTEGER DEFAULT 0,
      is_primary INTEGER DEFAULT 0,
      blur_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function migration002(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      last_message_id TEXT,
      last_message_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      status TEXT DEFAULT 'sent',
      reply_to TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );
  `);
}

async function migration003(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      local_path TEXT,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS match_media (
      match_id TEXT NOT NULL,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      PRIMARY KEY (match_id, media_id)
    );
  `);
}

async function migration004(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS id_mappings (
      local_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      synced_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (local_id, entity_type)
    );
  `);
}

async function migration005(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_conversations (
      id TEXT PRIMARY KEY,
      match_id TEXT,
      other_user_id TEXT NOT NULL,
      other_user_name TEXT,
      other_user_photo TEXT,
      last_message TEXT,
      last_message_at INTEGER,
      unread_count INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT,
      content_type TEXT NOT NULL DEFAULT 'text',
      media_url TEXT,
      media_local_path TEXT,
      reply_to_id TEXT,
      is_deleted INTEGER DEFAULT 0,
      is_sent INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES local_conversations(id)
    );

    CREATE TABLE IF NOT EXISTS local_profile_cache (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_feed_cache (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      score REAL,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS local_sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL,
      retry_count INTEGER DEFAULT 0,
      last_retry_at INTEGER,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS local_encryption_keys (
      id TEXT PRIMARY KEY,
      key_type TEXT NOT NULL,
      key_data TEXT NOT NULL,
      associated_data TEXT,
      created_at INTEGER NOT NULL,
      rotated_at INTEGER,
      expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/**
 * D1 schema. Every statement is idempotent, so the Worker applies it lazily on the
 * first request after a deploy — no CLI migration step is needed.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    auth_salt TEXT NOT NULL,
    auth_hash TEXT NOT NULL,
    public_key TEXT NOT NULL,
    enc_private_key TEXT NOT NULL,
    enc_private_iv TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    last_active TEXT NOT NULL,
    push_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    created_by TEXT NOT NULL,
    last_message_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    unread_count INTEGER NOT NULL DEFAULT 0,
    wrapped_key TEXT NOT NULL,
    wrap_iv TEXT NOT NULL,
    wrapped_by TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    type TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    username TEXT PRIMARY KEY,
    fails INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    reply TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    replied_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

/** Columns added after the first release. SQLite has no "ADD COLUMN IF NOT EXISTS", so errors are ignored. */
const COLUMN_MIGRATIONS: string[] = [
  `ALTER TABLE users ADD COLUMN email TEXT`,
  `ALTER TABLE users ADD COLUMN uid TEXT`,
  `ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`,
];

const INDEX_MIGRATIONS: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users(uid)`,
];

/** A random, unused 5-digit account ID (10000-99999). */
export async function newUid(db: D1Database): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const n = 10000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90000);
    const uid = String(n);
    const used = await db.prepare('SELECT 1 AS x FROM users WHERE uid = ?').bind(uid).first();
    if (!used) return uid;
  }
  throw new Error('no free uid');
}

async function backfillUids(db: D1Database): Promise<void> {
  const { results } = await db.prepare('SELECT id FROM users WHERE uid IS NULL').all<{ id: string }>();
  for (const r of results) {
    const uid = await newUid(db);
    await db.prepare('UPDATE users SET uid = ? WHERE id = ? AND uid IS NULL').bind(uid, r.id).run();
  }
}

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = db
      .batch(SCHEMA.map((sql) => db.prepare(sql)))
      .then(async () => {
        for (const sql of COLUMN_MIGRATIONS) {
          try {
            await db.prepare(sql).run();
          } catch {
            /* column already exists */
          }
        }
        await db.batch(INDEX_MIGRATIONS.map((sql) => db.prepare(sql)));
        await backfillUids(db);
      })
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

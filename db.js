'use strict';
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'biscord.db');

// Node 22.13+ yerleşik SQLite kullanır; eski Node sürümlerinde better-sqlite3'e düşer.
let db;
try {
  process.removeAllListeners('warning');
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_FILE);
} catch (e) {
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_FILE);
  } catch {
    console.error('SQLite bulunamadı. Node.js 22.13+ kullanın ya da "npm install better-sqlite3" çalıştırın.');
    process.exit(1);
  }
}

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  display_name TEXT,
  avatar TEXT,
  banner_color TEXT,
  about TEXT DEFAULT '',
  status TEXT DEFAULT 'online',
  custom_status TEXT DEFAULT '',
  is_bot INTEGER DEFAULT 0,
  bot_owner_id TEXT,
  bot_token_hash TEXT,
  bot_public INTEGER DEFAULT 0,
  bot_commands TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_bot_token ON users(bot_token_hash);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id),
  system_channel_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  permissions INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  hoist INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS member_roles (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES members(server_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT,
  topic TEXT DEFAULT '',
  parent_id TEXT,
  position INTEGER DEFAULT 0,
  last_message_id TEXT,
  last_message_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);

CREATE TABLE IF NOT EXISTS dm_participants (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_user ON dm_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  type INTEGER DEFAULT 0,
  attachments TEXT DEFAULT '[]',
  embeds TEXT DEFAULT '[]',
  mentions TEXT DEFAULT '[]',
  mention_everyone INTEGER DEFAULT 0,
  reply_to TEXT,
  pinned INTEGER DEFAULT 0,
  edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS read_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_message_id TEXT,
  PRIMARY KEY (user_id, channel_id)
);
`);

// ---------------------------------------------------------------- sürüm 2 eklemeleri (mevcut veriler korunur)
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
for (const [col, def] of [
  ['email', 'TEXT'], ['email_verified', 'INTEGER DEFAULT 0'], ['totp_secret', 'TEXT'], ['totp_enabled', 'INTEGER DEFAULT 0'],
  ['email_2fa', 'INTEGER DEFAULT 0'], ['backup_codes', "TEXT DEFAULT '[]'"], ['is_admin', 'INTEGER DEFAULT 0'],
  ['must_change_password', 'INTEGER DEFAULT 0'], ['banned', 'INTEGER DEFAULT 0'], ['ban_reason', 'TEXT'],
  ['muted_until', 'INTEGER'], ['presence', 'TEXT'],
]) addColumn('users', col, def);
for (const [col, def] of [
  ['xp', 'INTEGER DEFAULT 0'], ['coins', 'INTEGER DEFAULT 0'], ['last_xp_at', 'INTEGER DEFAULT 0'], ['last_daily_at', 'INTEGER DEFAULT 0'],
  ['name_color', 'TEXT'], ['title', 'TEXT'], ['title_until', 'INTEGER'], ['glow_until', 'INTEGER'], ['timeout_until', 'INTEGER'],
]) addColumn('members', col, def);
addColumn('servers', 'economy', 'INTEGER DEFAULT 1');
addColumn('servers', 'watch_party', 'INTEGER DEFAULT 1');
addColumn('servers', 'activities', 'INTEGER DEFAULT 1');
addColumn('channels', 'password_hash', 'TEXT');
addColumn('messages', 'components', 'TEXT');

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS email_codes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  email TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, purpose)
);
CREATE TABLE IF NOT EXISTS mfa_tickets (
  ticket_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS soundboard (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
`);

// ---------------------------------------------------------------- sürüm 3 eklemeleri
for (const [col, def] of [['profile_fx', 'TEXT'], ['rare_collection', "TEXT DEFAULT '{}'"]]) addColumn('users', col, def);
for (const [col, def] of [['duck_until', 'INTEGER'], ['censor_until', 'INTEGER'], ['badges', "TEXT DEFAULT '[]'"]]) addColumn('members', col, def);
addColumn('servers', 'mascot', 'TEXT');
addColumn('channels', 'anon', 'INTEGER DEFAULT 0');
addColumn('channels', 'acoustic', "TEXT DEFAULT 'none'");
addColumn('channels', 'scream_db', 'INTEGER DEFAULT 0');
addColumn('messages', 'rarity', 'TEXT');
addColumn('messages', 'expires_at', 'INTEGER');
db.exec(`
CREATE TABLE IF NOT EXISTS doodles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  pixels TEXT NOT NULL,
  trigger TEXT NOT NULL,
  anim TEXT NOT NULL DEFAULT 'jump',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

const q = {
  get: (sql, ...p) => stmt(sql).get(...p),
  all: (sql, ...p) => stmt(sql).all(...p),
  run: (sql, ...p) => stmt(sql).run(...p),
};

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Zaman sıralı benzersiz kimlik (snowflake benzeri)
const EPOCH = 1700000000000n;
let lastTs = 0n, seq = 0n;
function newId() {
  let ts = BigInt(Date.now());
  if (ts === lastTs) {
    seq = (seq + 1n) & 4095n;
    if (seq === 0n) { while (BigInt(Date.now()) <= ts) { /* bekle */ } ts = BigInt(Date.now()); }
  } else seq = 0n;
  lastTs = ts;
  return (((ts - EPOCH) << 22n) | (BigInt(process.pid & 1023) << 12n) | seq).toString();
}

module.exports = { db, q, tx, newId, DATA_DIR };

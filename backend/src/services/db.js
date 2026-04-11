import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'db.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT,
    ig_username TEXT,
    tt_username TEXT,
    avatar_url TEXT,
    type_tag TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS accounts_username ON accounts(username);

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_notes (
    video_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    PRIMARY KEY (video_id, note_id)
  );

  CREATE INDEX IF NOT EXISTS video_notes_by_note ON video_notes(note_id);
  CREATE INDEX IF NOT EXISTS video_notes_by_video ON video_notes(video_id);

  CREATE TABLE IF NOT EXISTS platform_cookies (
    platform TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'main',
    cookies_txt TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (platform, role)
  );

  CREATE TABLE IF NOT EXISTS note_shares (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'read',
    created_at TEXT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS note_shares_by_note ON note_shares(note_id);

  CREATE TABLE IF NOT EXISTS note_history (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    editor_label TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS note_history_by_note ON note_history(note_id);
`);

// Migrate platform_cookies if it still uses the old single-column PK (no role column)
{
  const cols = db.pragma('table_info(platform_cookies)').map((c) => c.name);
  if (!cols.includes('role')) {
    db.exec(`
      CREATE TABLE platform_cookies_new (
        platform TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'main',
        cookies_txt TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, role)
      );
      INSERT OR IGNORE INTO platform_cookies_new (platform, role, cookies_txt, updated_at)
        SELECT platform, 'main', cookies_txt, updated_at FROM platform_cookies;
      DROP TABLE platform_cookies;
      ALTER TABLE platform_cookies_new RENAME TO platform_cookies;
    `);
  }
}

// Migrate accounts: add ig_user_id column if missing
{
  const cols = db.pragma('table_info(accounts)').map((c) => c.name);
  if (!cols.includes('ig_user_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN ig_user_id TEXT`);
  }
}

// --- Accounts ---

export function upsertAccount({ id, username, display_name, ig_username, tt_username, avatar_url, ig_user_id }) {
  const now = new Date().toISOString();
  // Match by username first, then fall back to ig_username / tt_username so that manually-
  // created accounts (which may have a display username ≠ IG handle) still get linked.
  const existing =
    db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) ||
    (ig_username ? db.prepare('SELECT * FROM accounts WHERE ig_username = ?').get(ig_username) : null) ||
    (tt_username ? db.prepare('SELECT * FROM accounts WHERE tt_username = ?').get(tt_username) : null);
  if (existing) {
    db.prepare(`
      UPDATE accounts SET
        display_name = COALESCE(?, display_name),
        ig_username = COALESCE(?, ig_username),
        tt_username = COALESCE(?, tt_username),
        avatar_url = COALESCE(?, avatar_url),
        ig_user_id = COALESCE(?, ig_user_id),
        updated_at = ?
      WHERE username = ?
    `).run(display_name || null, ig_username || null, tt_username || null, avatar_url || null, ig_user_id || null, now, username);
    return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  } else {
    const newId = id || crypto.randomUUID();
    db.prepare(`
      INSERT INTO accounts (id, username, display_name, ig_username, tt_username, avatar_url, ig_user_id, type_tag, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?)
    `).run(newId, username, display_name || null, ig_username || null, tt_username || null, avatar_url || null, ig_user_id || null, now, now);
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(newId);
  }
}

export function listAccounts() {
  return db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC').all();
}

export function getAccount(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function updateAccount(id, fields) {
  const allowed = ['display_name', 'ig_username', 'tt_username', 'ig_user_id', 'type_tag', 'tags'];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(typeof v === 'object' ? JSON.stringify(v) : v);
    }
  }
  if (sets.length === 0) return getAccount(id);
  sets.push('updated_at = ?');
  vals.push(new Date().toISOString());
  vals.push(id);
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getAccount(id);
}

export function deleteAccount(id) {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

// --- Notes ---

export function createNote({ id, title, content }) {
  const now = new Date().toISOString();
  const noteId = id || crypto.randomUUID();
  db.prepare(`
    INSERT INTO notes (id, title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(noteId, title || '', typeof content === 'string' ? content : JSON.stringify(content || {}), now, now);
  return getNoteById(noteId);
}

export function listNotes() {
  return db.prepare('SELECT id, title, created_at, updated_at FROM notes ORDER BY updated_at DESC').all();
}

export function getNoteById(id) {
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
}

export function updateNote(id, fields) {
  const now = new Date().toISOString();
  const note = getNoteById(id);
  if (!note) return null;
  const title = fields.title !== undefined ? fields.title : note.title;
  const content = fields.content !== undefined
    ? (typeof fields.content === 'string' ? fields.content : JSON.stringify(fields.content))
    : note.content;
  db.prepare('UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(title, content, now, id);
  return getNoteById(id);
}

export function deleteNote(id) {
  db.prepare('DELETE FROM video_notes WHERE note_id = ?').run(id);
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}

// --- Video <-> Note backlinks ---

export function syncVideoNoteLinks(noteId, videoIds) {
  const del = db.prepare('DELETE FROM video_notes WHERE note_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO video_notes (video_id, note_id) VALUES (?, ?)');
  const txn = db.transaction((noteId, videoIds) => {
    del.run(noteId);
    for (const vid of videoIds) ins.run(vid, noteId);
  });
  txn(noteId, videoIds);
}

export function getNotesForVideo(videoId) {
  return db.prepare(`
    SELECT n.id, n.title, n.updated_at FROM notes n
    JOIN video_notes vn ON vn.note_id = n.id
    WHERE vn.video_id = ?
  `).all(videoId);
}

export function getVideosForNote(noteId) {
  return db.prepare('SELECT video_id FROM video_notes WHERE note_id = ?').all(noteId).map(r => r.video_id);
}

// --- Video <-> Note helpers ---

export function getVideoIdsInNotes() {
  const rows = db.prepare('SELECT DISTINCT video_id FROM video_notes').all();
  return new Set(rows.map((r) => r.video_id));
}

// --- Note Shares ---

export function createNoteShare(noteId, mode) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO note_shares (id, note_id, mode, created_at) VALUES (?, ?, ?, ?)').run(id, noteId, mode, now);
  return db.prepare('SELECT * FROM note_shares WHERE id = ?').get(id);
}

export function listNoteShares(noteId) {
  return db.prepare('SELECT * FROM note_shares WHERE note_id = ? ORDER BY created_at DESC').all(noteId);
}

export function getNoteShare(shareId) {
  return db.prepare('SELECT * FROM note_shares WHERE id = ?').get(shareId);
}

export function deleteNoteShare(shareId) {
  db.prepare('DELETE FROM note_shares WHERE id = ?').run(shareId);
}

// --- Note History ---

export function createNoteHistoryEntry(noteId, { title, content, editorLabel }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  db.prepare('INSERT INTO note_history (id, note_id, title, content, saved_at, editor_label) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, noteId, title, contentStr, now, editorLabel || null);
  return id;
}

export function listNoteHistory(noteId) {
  return db.prepare('SELECT id, note_id, title, saved_at, editor_label FROM note_history WHERE note_id = ? ORDER BY saved_at DESC').all(noteId);
}

export function getNoteHistoryEntry(historyId) {
  return db.prepare('SELECT * FROM note_history WHERE id = ?').get(historyId);
}

// --- Platform Cookies ---

export function getCookies(platform, role = 'main') {
  return db.prepare('SELECT cookies_txt FROM platform_cookies WHERE platform = ? AND role = ?').get(platform, role);
}

export function setCookies(platform, role = 'main', cookies_txt) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO platform_cookies (platform, role, cookies_txt, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(platform, role) DO UPDATE SET cookies_txt = excluded.cookies_txt, updated_at = excluded.updated_at
  `).run(platform, role, cookies_txt, now);
}

export function deleteCookies(platform, role = 'main') {
  db.prepare('DELETE FROM platform_cookies WHERE platform = ? AND role = ?').run(platform, role);
}

export function listCookiePlatforms() {
  return db.prepare('SELECT platform, role, updated_at FROM platform_cookies').all();
}

export default db;

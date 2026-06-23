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

  CREATE TABLE IF NOT EXISTS meta_connection (
    id TEXT PRIMARY KEY DEFAULT 'default',
    account_id TEXT,
    page_id TEXT,
    page_name TEXT,
    ig_user_id TEXT,
    ig_username TEXT,
    access_token TEXT,
    token_expires_at TEXT,
    connected_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS ig_media (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    manifest_id TEXT,
    permalink TEXT,
    caption TEXT,
    media_type TEXT,
    media_product_type TEXT,
    posted_at TEXT,
    thumbnail_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ig_media_by_account ON ig_media(account_id);
  CREATE INDEX IF NOT EXISTS ig_media_by_manifest ON ig_media(manifest_id);
  CREATE INDEX IF NOT EXISTS ig_media_by_posted_at ON ig_media(posted_at);

  CREATE TABLE IF NOT EXISTS ig_media_insights (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    metrics TEXT NOT NULL,
    FOREIGN KEY (media_id) REFERENCES ig_media(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS ig_media_insights_by_media ON ig_media_insights(media_id, fetched_at);

  CREATE TABLE IF NOT EXISTS ig_account_insights (
    id TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    metrics TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ig_account_insights_by_date ON ig_account_insights(fetched_at);
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

// --- Meta (Instagram Graph API) connection ---

export function upsertMetaConnection(fields) {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT * FROM meta_connection WHERE id = 'default'").get();
  if (existing) {
    const merged = { ...existing, ...fields, updated_at: now };
    db.prepare(`
      UPDATE meta_connection SET
        account_id = ?, page_id = ?, page_name = ?, ig_user_id = ?, ig_username = ?,
        access_token = ?, token_expires_at = ?, updated_at = ?
      WHERE id = 'default'
    `).run(
      merged.account_id ?? null, merged.page_id ?? null, merged.page_name ?? null,
      merged.ig_user_id ?? null, merged.ig_username ?? null,
      merged.access_token ?? null, merged.token_expires_at ?? null, now
    );
  } else {
    db.prepare(`
      INSERT INTO meta_connection (id, account_id, page_id, page_name, ig_user_id, ig_username, access_token, token_expires_at, connected_at, updated_at)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fields.account_id ?? null, fields.page_id ?? null, fields.page_name ?? null,
      fields.ig_user_id ?? null, fields.ig_username ?? null,
      fields.access_token ?? null, fields.token_expires_at ?? null, now, now
    );
  }
  return getMetaConnection();
}

export function getMetaConnection() {
  return db.prepare("SELECT * FROM meta_connection WHERE id = 'default'").get() || null;
}

export function deleteMetaConnection() {
  db.prepare("DELETE FROM meta_connection WHERE id = 'default'").run();
}

// --- IG media + insights ---

export function upsertIgMedia({ id, account_id, manifest_id, permalink, caption, media_type, media_product_type, posted_at, thumbnail_url }) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM ig_media WHERE id = ?').get(id);
  if (existing) {
    db.prepare(`
      UPDATE ig_media SET
        account_id = COALESCE(?, account_id),
        manifest_id = COALESCE(?, manifest_id),
        permalink = COALESCE(?, permalink),
        caption = COALESCE(?, caption),
        media_type = COALESCE(?, media_type),
        media_product_type = COALESCE(?, media_product_type),
        posted_at = COALESCE(?, posted_at),
        thumbnail_url = COALESCE(?, thumbnail_url),
        updated_at = ?
      WHERE id = ?
    `).run(account_id || null, manifest_id || null, permalink || null, caption || null, media_type || null, media_product_type || null, posted_at || null, thumbnail_url || null, now, id);
  } else {
    db.prepare(`
      INSERT INTO ig_media (id, account_id, manifest_id, permalink, caption, media_type, media_product_type, posted_at, thumbnail_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, account_id || null, manifest_id || null, permalink || null, caption || null, media_type || null, media_product_type || null, posted_at || null, thumbnail_url || null, now, now);
  }
  return db.prepare('SELECT * FROM ig_media WHERE id = ?').get(id);
}

export function setIgMediaManifestId(id, manifestId) {
  db.prepare('UPDATE ig_media SET manifest_id = ?, updated_at = ? WHERE id = ?').run(manifestId, new Date().toISOString(), id);
}

export function getIgMediaByManifestId(manifestId) {
  return db.prepare('SELECT * FROM ig_media WHERE manifest_id = ?').get(manifestId);
}

export function insertMediaInsightSnapshot(mediaId, metrics) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO ig_media_insights (id, media_id, fetched_at, metrics) VALUES (?, ?, ?, ?)')
    .run(id, mediaId, now, JSON.stringify(metrics));
  return id;
}

export function getMediaInsightHistory(mediaId) {
  return db.prepare('SELECT fetched_at, metrics FROM ig_media_insights WHERE media_id = ? ORDER BY fetched_at ASC')
    .all(mediaId)
    .map((r) => ({ fetchedAt: r.fetched_at, metrics: JSON.parse(r.metrics) }));
}

const MEDIA_SORT_METRICS = new Set([
  'reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions',
  'follows', 'profile_visits', 'reposts', 'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time', 'reels_skip_rate',
]);

export function listIgMediaWithLatestInsights({ accountId, sortBy, order = 'desc', mediaType, dateFrom, dateTo, limit } = {}) {
  const params = [];
  let sql = `
    SELECT m.*, latest.metrics AS latest_metrics, latest.fetched_at AS latest_fetched_at
    FROM ig_media m
    LEFT JOIN (
      SELECT i1.media_id, i1.metrics, i1.fetched_at
      FROM ig_media_insights i1
      WHERE i1.fetched_at = (SELECT MAX(i2.fetched_at) FROM ig_media_insights i2 WHERE i2.media_id = i1.media_id)
    ) latest ON latest.media_id = m.id
    WHERE 1=1
  `;
  if (accountId) { sql += ' AND m.account_id = ?'; params.push(accountId); }
  if (mediaType) { sql += ' AND m.media_type = ?'; params.push(mediaType); }
  if (dateFrom) { sql += ' AND m.posted_at >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND m.posted_at <= ?'; params.push(dateTo); }

  const dir = order === 'asc' ? 'ASC' : 'DESC';
  if (sortBy && MEDIA_SORT_METRICS.has(sortBy)) {
    sql += ` ORDER BY json_extract(latest.metrics, '$.${sortBy}') ${dir}`;
  } else {
    sql += ` ORDER BY m.posted_at ${dir}`;
  }
  if (limit) { sql += ' LIMIT ?'; params.push(limit); }

  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    latestMetrics: row.latest_metrics ? JSON.parse(row.latest_metrics) : null,
  }));
}

export function getIgMedia(id) {
  return db.prepare('SELECT * FROM ig_media WHERE id = ?').get(id);
}

export function listAllIgMediaIds(accountId) {
  return new Set(db.prepare('SELECT id FROM ig_media WHERE account_id = ?').all(accountId).map((r) => r.id));
}

// --- Account-level insights ---

export function insertAccountInsightSnapshot(metrics) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO ig_account_insights (id, fetched_at, metrics) VALUES (?, ?, ?)').run(id, now, JSON.stringify(metrics));
  return id;
}

export function listAccountInsights({ dateFrom, dateTo } = {}) {
  const params = [];
  let sql = 'SELECT fetched_at, metrics FROM ig_account_insights WHERE 1=1';
  if (dateFrom) { sql += ' AND fetched_at >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND fetched_at <= ?'; params.push(dateTo); }
  sql += ' ORDER BY fetched_at ASC';
  return db.prepare(sql).all(...params).map((r) => ({ fetchedAt: r.fetched_at, metrics: JSON.parse(r.metrics) }));
}

export default db;

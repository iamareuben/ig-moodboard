import Database from 'better-sqlite3';
import { join } from 'path';

const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'db.sqlite');
const db = new Database(DB_PATH, { readonly: true });

const MEDIA_SORT_METRICS = new Set([
  'reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions',
  'follows', 'profile_visits', 'reposts', 'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time', 'reels_skip_rate',
]);

export function listMediaWithLatestInsights({ sortBy, order = 'desc', mediaType, dateFrom, dateTo, limit } = {}) {
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
    id: row.id,
    permalink: row.permalink,
    caption: row.caption,
    mediaType: row.media_type,
    mediaProductType: row.media_product_type,
    postedAt: row.posted_at,
    manifestId: row.manifest_id,
    latestMetrics: row.latest_metrics ? JSON.parse(row.latest_metrics) : null,
  }));
}

export function getMedia(id) {
  return db.prepare('SELECT * FROM ig_media WHERE id = ?').get(id);
}

export function getMediaInsightHistory(mediaId) {
  return db.prepare('SELECT fetched_at, metrics FROM ig_media_insights WHERE media_id = ? ORDER BY fetched_at ASC')
    .all(mediaId)
    .map((r) => ({ fetchedAt: r.fetched_at, metrics: JSON.parse(r.metrics) }));
}

export function listAllMediaWithManifests() {
  return db.prepare('SELECT id, manifest_id, permalink, caption, posted_at FROM ig_media WHERE manifest_id IS NOT NULL').all();
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

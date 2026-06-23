import { Router } from 'express';
import { startMetaSync, getSyncJob, cancelMetaSync } from '../services/metaSync.js';
import { getMetaConnection, listIgMediaWithLatestInsights, listAccountInsights } from '../services/db.js';
import { readManifest } from '../services/storage.js';

const router = Router();

// POST /api/analytics/sync — start a backfill/refresh job
router.post('/sync', (req, res) => {
  const conn = getMetaConnection();
  if (!conn) return res.status(400).json({ error: 'Not connected to Meta' });
  const full = req.body?.full === true;
  const maxAgeDays = req.body?.maxAgeDays ? parseInt(req.body.maxAgeDays, 10) : null;
  const jobId = startMetaSync({ full, maxAgeDays });
  res.json({ jobId });
});

// GET /api/analytics/sync/:jobId — poll job status
router.get('/sync/:jobId', (req, res) => {
  const job = getSyncJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// DELETE /api/analytics/sync/:jobId — cancel a running sync
router.delete('/sync/:jobId', (req, res) => {
  const ok = cancelMetaSync(req.params.jobId);
  if (!ok) return res.status(404).json({ error: 'Job not found' });
  res.json({ ok: true });
});

// GET /api/analytics/posts?sortBy=reach&order=desc&mediaType=&dateFrom=&dateTo=&limit=
router.get('/posts', async (req, res) => {
  const conn = getMetaConnection();
  if (!conn) return res.status(400).json({ error: 'Not connected to Meta' });
  const { sortBy, order, mediaType, dateFrom, dateTo, limit } = req.query;
  const posts = listIgMediaWithLatestInsights({
    accountId: conn.account_id,
    sortBy,
    order,
    mediaType,
    dateFrom,
    dateTo,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  const enriched = await Promise.all(posts.map(async (post) => {
    let manifest = null;
    if (post.manifest_id) {
      try { manifest = await readManifest(post.manifest_id); } catch { /* not downloaded yet */ }
    }
    const hero = manifest?.shots?.find((s) => s.id === manifest.heroShotId) || manifest?.shots?.[0];
    return {
      ...post,
      manifestId: post.manifest_id,
      manifestStatus: manifest?.status || null,
      title: manifest?.title || null,
      heroFrame: hero?.frameFile || null,
      thumbnailUrl: post.thumbnail_url,
    };
  }));

  res.json(enriched);
});

// GET /api/analytics/trend?dateFrom=&dateTo=
router.get('/trend', (req, res) => {
  const { dateFrom, dateTo } = req.query;
  res.json(listAccountInsights({ dateFrom, dateTo }));
});

export default router;

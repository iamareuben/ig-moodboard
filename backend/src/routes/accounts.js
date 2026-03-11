import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  upsertAccount,
} from '../services/db.js';
import { getAccountVideos, getAccountAllVideos } from '../services/downloader.js';
import { listManifests, initVideoDir, writeManifest } from '../services/storage.js';
import { canonicalizeUrl } from '../services/canonicalize.js';
import { downloadAndProcess } from '../services/pipeline.js';

const router = Router();

// In-memory sync job store — resets on server restart, which is fine
const syncJobs = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSync(account, profileUrl, platform, jobId) {
  const job = syncJobs.get(jobId);

  try {
    // Step 1: flat-playlist — get all video URLs (fast, one yt-dlp call)
    job.phase = 'listing';
    const videos = await getAccountAllVideos(profileUrl, account.ig_user_id || null);
    job.total = videos.length;
    job.phase = 'syncing';

    // Load manifests once upfront for dedup
    const manifests = await listManifests();
    const seenCanonicalIds = new Set(manifests.map((m) => m.canonicalId).filter(Boolean));
    const seenNormalizedUrls = new Set(manifests.map((m) => m.normalizedUrl).filter(Boolean));

    for (const video of videos) {
      if (job.cancelled) break;

      const url = video.url;
      const canonical = canonicalizeUrl(url);

      // Dedup check against seen sets
      const isDup =
        (canonical?.canonicalId && seenCanonicalIds.has(canonical.canonicalId)) ||
        (canonical?.normalizedUrl && seenNormalizedUrls.has(canonical.normalizedUrl));

      if (isDup) {
        job.skipped++;
        job.done++;
        continue;
      }

      // Mark as seen so we don't double-queue within this run
      if (canonical?.canonicalId) seenCanonicalIds.add(canonical.canonicalId);
      if (canonical?.normalizedUrl) seenNormalizedUrls.add(canonical.normalizedUrl);

      // Create manifest and fire pipeline
      const id = randomUUID();
      await initVideoDir(id);
      await writeManifest(id, {
        id,
        url,
        platform,
        title: video.title || '',
        downloadedAt: new Date().toISOString(),
        status: 'pending',
        duration: null,
        shots: [],
        heroShotId: null,
        canonicalId: canonical?.canonicalId || null,
        normalizedUrl: canonical?.normalizedUrl || null,
        accountId: account.id,
        accountUsername: account.ig_username || account.tt_username || null,
        accountDisplayName: account.display_name || null,
        // Mobile API gives us collab data at listing time — no need to wait for pipeline
        isCollab: video.isCollab || false,
        collaborators: video.collaborators || [],
        stats: null,
      });
      downloadAndProcess(id, url); // fire and forget

      job.queued++;
      job.done++;

      // Rate-limit: random 3–8 s between submissions to avoid hammering the platform
      await sleep(3000 + Math.random() * 5000);
    }

    job.phase = 'done';
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    console.error(`[sync] ${account.username}:`, err.message);
  }
}

function buildProfileUrl(account, platform) {
  const p = platform || (account.ig_username ? 'instagram' : 'tiktok');
  const username = p === 'instagram' ? account.ig_username : account.tt_username;
  if (!username) return null;
  if (p === 'instagram') return `https://www.instagram.com/${username}/`;
  if (p === 'tiktok') return `https://www.tiktok.com/@${username}`;
  return null;
}

// POST /api/accounts — manually create an account
router.post('/', (req, res) => {
  try {
    const { username, display_name, ig_username, tt_username, type_tag, tags } = req.body;
    if (!username) return res.status(400).json({ error: 'username is required' });
    const acct = upsertAccount({ username, display_name, ig_username, tt_username });
    if (type_tag || tags) {
      updateAccount(acct.id, { type_tag, tags });
    }
    res.status(201).json(getAccount(acct.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const accounts = listAccounts();
    // Attach saved video counts
    const manifests = await listManifests();
    const withCounts = accounts.map((a) => {
      const savedVideos = manifests.filter((m) => m.accountId === a.id && m.status === 'ready').length;
      return { ...a, tags: JSON.parse(a.tags || '[]'), savedVideos };
    });
    res.json(withCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const account = getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Attach saved videos for this account
    const manifests = await listManifests();
    const savedVideos = manifests
      .filter((m) => m.accountId === account.id)
      .map(({ shots, ...rest }) => ({
        ...rest,
        shotCount: shots ? shots.length : 0,
        heroFrame: (() => {
          if (!shots || shots.length === 0) return null;
          const hero = shots.find((s) => s.id === rest.heroShotId) || shots[0];
          return hero ? hero.frameFile : null;
        })(),
      }));

    res.json({ ...account, tags: JSON.parse(account.tags || '[]'), savedVideos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  try {
    const account = getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { display_name, ig_username, tt_username, ig_user_id, type_tag, tags } = req.body;
    const updated = updateAccount(req.params.id, {
      display_name,
      ig_username,
      tt_username,
      ig_user_id: ig_user_id || undefined,
      type_tag,
      tags: tags !== undefined ? JSON.stringify(tags) : undefined,
    });
    res.json({ ...updated, tags: JSON.parse(updated.tags || '[]') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  try {
    deleteAccount(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/:id/sync — start a full profile sync job
router.post('/:id/sync', async (req, res) => {
  try {
    const account = getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const platform = req.body.platform || (account.ig_username ? 'instagram' : 'tiktok');
    const profileUrl = buildProfileUrl(account, platform);
    if (!profileUrl) return res.status(400).json({ error: 'No profile URL for this platform' });

    const jobId = randomUUID();
    syncJobs.set(jobId, {
      status: 'running',
      phase: 'listing',
      platform,
      profileUrl,
      total: 0,
      done: 0,
      queued: 0,
      skipped: 0,
      error: null,
      cancelled: false,
      startedAt: new Date().toISOString(),
    });

    // Run async — respond immediately with jobId
    runSync(account, profileUrl, platform, jobId);

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id/sync/:jobId — poll sync job status
router.get('/:id/sync/:jobId', (req, res) => {
  const job = syncJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// DELETE /api/accounts/:id/sync/:jobId — cancel a running sync
router.delete('/:id/sync/:jobId', (req, res) => {
  const job = syncJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.cancelled = true;
  job.status = 'cancelled';
  res.json({ ok: true });
});

// GET /api/accounts/:id/live?platform=instagram&sort=views
// Fetches live video list via yt-dlp — does NOT save anything
router.get('/:id/live', async (req, res) => {
  try {
    const account = getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const platform = req.query.platform || (account.ig_username ? 'instagram' : 'tiktok');
    const profileUrl = buildProfileUrl(account, platform);
    if (!profileUrl) return res.status(400).json({ error: 'No profile URL available for this account/platform' });

    const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
    const videos = await getAccountVideos(profileUrl, limit, account.ig_user_id || null);

    // Sort by views desc if requested
    const sort = req.query.sort || 'date';
    if (sort === 'views') {
      videos.sort((a, b) => (b.stats.viewCount ?? 0) - (a.stats.viewCount ?? 0));
    }

    res.json({ platform, profileUrl, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import {
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  upsertAccount,
} from '../services/db.js';
import { getAccountVideos } from '../services/downloader.js';
import { listManifests } from '../services/storage.js';

const router = Router();

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

    const { display_name, ig_username, tt_username, type_tag, tags } = req.body;
    const updated = updateAccount(req.params.id, {
      display_name,
      ig_username,
      tt_username,
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
    const videos = await getAccountVideos(profileUrl, limit);

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

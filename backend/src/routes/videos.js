import { Router } from 'express';
import { randomUUID } from 'crypto';
import { access, unlink } from 'fs/promises';
import { constants } from 'fs';
import {
  initVideoDir,
  readManifest,
  writeManifest,
  listManifests,
  videoFile,
  frameFile,
} from '../services/storage.js';
import { extractFrameAtTime } from '../services/shotDetector.js';
import { canonicalizeUrl } from '../services/canonicalize.js';
import { getNotesForVideo } from '../services/db.js';
import { downloadAndProcess } from '../services/pipeline.js';

const router = Router();

function detectPlatform(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'instagram.com') return 'instagram';
    if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 't.tiktok.com' || host === 'vt.tiktok.com') {
      // TikTok photo/slideshow posts (/photo/) are not downloadable as video
      if (/\/photo\//.test(u.pathname)) return null;
      return 'tiktok';
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find an existing video by canonical ID or normalised URL.
 * Returns the manifest if found, null otherwise.
 */
async function findExistingVideo(canonical) {
  if (!canonical) return null;
  const manifests = await listManifests();
  if (canonical.canonicalId) {
    const byId = manifests.find((m) => m.canonicalId === canonical.canonicalId);
    if (byId) return byId;
  }
  if (canonical.normalizedUrl) {
    const byUrl = manifests.find((m) => m.normalizedUrl === canonical.normalizedUrl);
    if (byUrl) return byUrl;
  }
  return null;
}

// POST /api/videos — submit URL (with dedup)
router.post('/', async (req, res) => {
  const { url, noteId } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({ error: 'Unsupported URL — must be an Instagram or TikTok video link (TikTok photo posts are not supported)' });
  }

  // Dedup check
  const canonical = canonicalizeUrl(url);
  if (canonical) {
    const existing = await findExistingVideo(canonical);
    if (existing) {
      return res.status(200).json({ id: existing.id, status: existing.status, existing: true });
    }
  }

  const id = randomUUID();
  await initVideoDir(id);

  const manifest = {
    id,
    url,
    platform,
    title: '',
    downloadedAt: new Date().toISOString(),
    status: 'pending',
    duration: null,
    shots: [],
    heroShotId: null,
    canonicalId: canonical?.canonicalId || null,
    normalizedUrl: canonical?.normalizedUrl || null,
    accountId: null,
    accountUsername: null,
    accountDisplayName: null,
    stats: null,
  };
  await writeManifest(id, manifest);

  // Fire-and-forget
  downloadAndProcess(id, url);

  res.status(201).json({ id, status: 'pending', existing: false });
});

// GET /api/videos — list all
router.get('/', async (req, res) => {
  const manifests = await listManifests();
  const summaries = manifests.map(({ shots, ...rest }) => ({
    ...rest,
    shotCount: shots ? shots.length : 0,
    heroFrame: (() => {
      if (!shots || shots.length === 0) return null;
      const hero = shots.find((s) => s.id === rest.heroShotId) || shots[0];
      return hero ? hero.frameFile : null;
    })(),
  }));
  res.json(summaries);
});

// GET /api/videos/:id — full manifest + backlinks
router.get('/:id', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const backlinks = getNotesForVideo(req.params.id);
    res.json({ ...manifest, backlinks });
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// PATCH /api/videos/:id — update title, heroShotId, tags
router.patch('/:id', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const { title, heroShotId, tags } = req.body;
    if (title !== undefined) manifest.title = title;
    if (tags !== undefined) manifest.tags = tags;
    if (heroShotId !== undefined) {
      manifest.heroShotId = heroShotId;
      manifest.shots = manifest.shots.map((s) => ({
        ...s,
        isHero: s.id === heroShotId,
      }));
    }
    await writeManifest(req.params.id, manifest);
    res.json(manifest);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// POST /api/videos/:id/retry — re-run download + processing pipeline
router.post('/:id/retry', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    // Reset status so UI shows it's working again
    manifest.status = 'pending';
    manifest.error = null;
    await writeManifest(req.params.id, manifest);
    downloadAndProcess(req.params.id, manifest.url);
    res.json({ id: manifest.id, status: 'pending' });
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// POST /api/videos/:id/shots — add shot at timestamp
router.post('/:id/shots', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const { timestamp } = req.body;
    if (timestamp === undefined) return res.status(400).json({ error: 'timestamp is required' });

    const ms = Math.round(parseFloat(timestamp) * 1000);
    const filename = `frame_${ms}ms.jpg`;
    const outputPath = frameFile(req.params.id, ms);
    const vFile = videoFile(req.params.id);

    let exists = false;
    try {
      await access(outputPath, constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      await extractFrameAtTime(vFile, parseFloat(timestamp), outputPath);
    }

    const shot = {
      id: randomUUID(),
      timestamp: parseFloat(timestamp),
      frameFile: `frames/${filename}`,
      isHero: false,
      label: '',
    };

    manifest.shots.push(shot);
    manifest.shots.sort((a, b) => a.timestamp - b.timestamp);
    await writeManifest(req.params.id, manifest);

    res.status(201).json(shot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/videos/:id/shots/:shotId — update label/tags
router.patch('/:id/shots/:shotId', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const shot = manifest.shots.find((s) => s.id === req.params.shotId);
    if (!shot) return res.status(404).json({ error: 'Shot not found' });

    const { label, tags } = req.body;
    if (label !== undefined) shot.label = label;
    if (tags !== undefined) shot.tags = tags;

    await writeManifest(req.params.id, manifest);
    res.json(shot);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// DELETE /api/videos/:id/shots/:shotId — remove shot
router.delete('/:id/shots/:shotId', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const shotIndex = manifest.shots.findIndex((s) => s.id === req.params.shotId);
    if (shotIndex === -1) return res.status(404).json({ error: 'Shot not found' });

    const [shot] = manifest.shots.splice(shotIndex, 1);

    try {
      const fFile = frameFile(req.params.id, Math.round(shot.timestamp * 1000));
      await unlink(fFile);
    } catch {
      // ignore if file doesn't exist
    }

    if (manifest.heroShotId === shot.id && manifest.shots.length > 0) {
      manifest.heroShotId = manifest.shots[0].id;
      manifest.shots[0].isHero = true;
    } else if (manifest.heroShotId === shot.id) {
      manifest.heroShotId = null;
    }

    await writeManifest(req.params.id, manifest);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// GET /api/videos/:id/frame?t=2.34 — on-demand frame extract
router.get('/:id/frame', async (req, res) => {
  try {
    const { t } = req.query;
    if (!t) return res.status(400).json({ error: 't query param is required' });

    const timestamp = parseFloat(t);
    const ms = Math.round(timestamp * 1000);
    const outputPath = frameFile(req.params.id, ms);
    const vFile = videoFile(req.params.id);

    let exists = false;
    try {
      await access(outputPath, constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      await extractFrameAtTime(vFile, timestamp, outputPath);
    }

    res.sendFile(outputPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

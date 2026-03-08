import { Router } from 'express';
import { randomUUID } from 'crypto';
import { access, unlink, rename } from 'fs/promises';
import { constants } from 'fs';
import multer from 'multer';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initVideoDir,
  readManifest,
  writeManifest,
  listManifests,
  videoFile,
  frameFile,
  framesDir,
  VIDEOS_DIR,
} from '../services/storage.js';
import { extractFrameAtTime, detectShots } from '../services/shotDetector.js';
import { getVideoDuration, getVideoMetadata } from '../services/downloader.js';
import { canonicalizeUrl, extractAccountFromUrl } from '../services/canonicalize.js';
import { getNotesForVideo, getVideoIdsInNotes, upsertAccount } from '../services/db.js';
import { downloadAndProcess } from '../services/pipeline.js';
import { transcribeVideo } from '../services/transcriber.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (req, file, cb) => cb(null, `upload-${randomUUID()}.mp4`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4' || file.originalname.toLowerCase().endsWith('.mp4')) {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 files are supported'));
    }
  },
});

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

// POST /api/videos/upload — upload an MP4 file directly
router.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No MP4 file provided' });

  const id = randomUUID();
  await initVideoDir(id);

  const dest = videoFile(id);
  await rename(req.file.path, dest);

  const title = req.file.originalname.replace(/\.mp4$/i, '');

  const manifest = {
    id,
    url: null,
    platform: 'upload',
    title,
    downloadedAt: new Date().toISOString(),
    status: 'processing',
    duration: null,
    shots: [],
    heroShotId: null,
    canonicalId: null,
    normalizedUrl: null,
    accountId: null,
    accountUsername: null,
    accountDisplayName: null,
    stats: null,
  };
  await writeManifest(id, manifest);

  // Fire-and-forget shot detection
  (async () => {
    try {
      const duration = await getVideoDuration(dest);
      const shots = await detectShots(dest, framesDir(id), duration);
      const heroShotId = shots.length > 0 ? shots[0].id : null;
      if (shots.length > 0) shots[0].isHero = true;
      const m = await readManifest(id);
      m.status = 'ready';
      m.duration = duration;
      m.shots = shots;
      m.heroShotId = heroShotId;
      await writeManifest(id, m);
    } catch (err) {
      console.error(`[upload pipeline] ${id}:`, err.message);
      try {
        const m = await readManifest(id);
        m.status = 'error';
        m.error = err.message;
        await writeManifest(id, m);
      } catch { /* ignore */ }
    }
  })();

  res.status(201).json({ id, status: 'processing', existing: false });
});

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

// POST /api/videos/refresh-all-stats — bulk re-fetch metadata for all ready videos
router.post('/refresh-all-stats', async (req, res) => {
  const manifests = await listManifests();
  const targets = manifests.filter((m) => m.status === 'ready' && m.url != null);
  let done = 0;
  let failed = 0;
  for (const m of targets) {
    try {
      const meta = await getVideoMetadata(m.url);
      if (meta) {
        const manifest = await readManifest(m.id);
        if (meta.title) manifest.title = meta.title;
        manifest.stats = meta.stats;
        manifest.statsError = false;
        await writeManifest(m.id, manifest);
        done++;
      } else {
        const manifest = await readManifest(m.id);
        manifest.statsError = true;
        await writeManifest(m.id, manifest);
        failed++;
      }
    } catch {
      failed++;
    }
  }
  res.json({ total: targets.length, done, failed });
});

// GET /api/videos — list all
router.get('/', async (req, res) => {
  const manifests = await listManifests();
  const inNoteSet = getVideoIdsInNotes();
  const summaries = manifests.map(({ shots, ...rest }) => ({
    ...rest,
    shotCount: shots ? shots.length : 0,
    heroFrame: (() => {
      if (!shots || shots.length === 0) return null;
      const hero = shots.find((s) => s.id === rest.heroShotId) || shots[0];
      return hero ? hero.frameFile : null;
    })(),
    inNote: inNoteSet.has(rest.id),
    annotationCount: rest.annotations?.length ?? 0,
  }));
  res.json(summaries);
});

// GET /api/videos/search?q= — search by title, username, annotation content
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const manifests = await listManifests();
  const results = manifests
    .filter((m) => {
      if (!q) return true;
      const title = (m.title || '').toLowerCase();
      const username = (m.accountUsername || '').toLowerCase();
      const annotations = (m.annotations || []).map((a) => a.content.toLowerCase()).join(' ');
      return title.includes(q) || username.includes(q) || annotations.includes(q);
    })
    .map((m) => {
      const hero = m.shots?.find((s) => s.id === m.heroShotId) || m.shots?.[0];
      return {
        id: m.id,
        title: m.title,
        accountUsername: m.accountUsername,
        platform: m.platform,
        url: m.url,
        heroFrame: hero?.frameFile || null,
        annotationCount: m.annotations?.length ?? 0,
      };
    });
  res.json(results);
});

// POST /api/videos/:id/refresh-stats — re-fetch metadata for a single video
router.post('/:id/refresh-stats', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    if (!manifest.url) return res.status(400).json({ error: 'Video has no URL' });
    const meta = await getVideoMetadata(manifest.url);
    if (!meta) {
      manifest.statsError = true;
      await writeManifest(req.params.id, manifest);
      return res.status(502).json({ error: 'Metadata fetch failed' });
    }
    if (meta.title) manifest.title = meta.title;
    manifest.stats = meta.stats;
    manifest.statsError = false;
    // Upsert account if uploader info available
    if (meta.uploaderUsername) {
      const accountInfo = extractAccountFromUrl(manifest.url);
      const platform = accountInfo?.platform || manifest.platform;
      const acct = upsertAccount({
        username: meta.uploaderUsername,
        display_name: meta.uploaderDisplayName,
        ig_username: platform === 'instagram' ? meta.uploaderUsername : undefined,
        tt_username: platform === 'tiktok' ? meta.uploaderUsername : undefined,
        avatar_url: null,
      });
      manifest.accountId = acct.id;
      manifest.accountUsername = meta.uploaderUsername;
      manifest.accountDisplayName = meta.uploaderDisplayName;
    }
    await writeManifest(req.params.id, manifest);
    res.json(manifest);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// GET /api/videos/:id — full manifest + backlinks
router.get('/:id', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const backlinks = getNotesForVideo(req.params.id);
    res.json({ ...manifest, backlinks, annotationCount: manifest.annotations?.length ?? 0 });
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

// POST /api/videos/:id/archive — mark as archived (hidden from library)
router.post('/:id/archive', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    manifest.status = 'archived';
    manifest.error = null;
    await writeManifest(req.params.id, manifest);
    res.json({ id: manifest.id, status: 'archived' });
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

// GET /api/videos/:id/annotations
router.get('/:id/annotations', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    res.json(manifest.annotations ?? []);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// POST /api/videos/:id/annotations
router.post('/:id/annotations', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    if (!manifest.annotations) manifest.annotations = [];
    const annotation = {
      id: randomUUID(),
      content,
      source: 'user',
      createdAt: new Date().toISOString(),
    };
    manifest.annotations.push(annotation);
    await writeManifest(req.params.id, manifest);
    res.status(201).json(annotation);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// DELETE /api/videos/:id/annotations/:annotationId
router.delete('/:id/annotations/:annotationId', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);
    if (!manifest.annotations) return res.status(404).json({ error: 'Annotation not found' });
    const idx = manifest.annotations.findIndex((a) => a.id === req.params.annotationId);
    if (idx === -1) return res.status(404).json({ error: 'Annotation not found' });
    manifest.annotations.splice(idx, 1);
    await writeManifest(req.params.id, manifest);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// POST /api/videos/:id/transcribe — on-demand transcription via faster-whisper
router.post('/:id/transcribe', async (req, res) => {
  try {
    const manifest = await readManifest(req.params.id);

    if (manifest.isCarousel) {
      return res.status(400).json({ error: 'Cannot transcribe a carousel post' });
    }
    if (manifest.status !== 'ready') {
      return res.status(400).json({ error: 'Video is not ready' });
    }

    // Return cached transcript if already done
    if (manifest.transcript) {
      return res.json(manifest.transcript);
    }

    const vFile = videoFile(req.params.id);
    const result = await transcribeVideo(vFile);

    manifest.transcript = { ...result, createdAt: new Date().toISOString() };
    await writeManifest(req.params.id, manifest);

    res.json(manifest.transcript);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

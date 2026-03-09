import { Router } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import {
  getNoteShare,
  getNoteById,
  updateNote,
  createNoteHistoryEntry,
  listNoteHistory,
  getNoteHistoryEntry,
} from '../services/db.js';
import { readManifest, VIDEOS_DIR } from '../services/storage.js';

const router = Router();

function extractVideoIds(contentJson) {
  const ids = new Set();
  function walk(node) {
    if (!node) return;
    if (node.type === 'socialVideoBlock' && node.attrs?.videoId) ids.add(node.attrs.videoId);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  }
  try {
    const parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
    walk(parsed);
  } catch { /* ignore */ }
  return [...ids];
}

/** Validate share + confirm videoId is in the note. Returns { share, note } or throws. */
async function validateShareAndVideo(shareId, videoId) {
  const share = getNoteShare(shareId);
  if (!share) { const e = new Error('Share not found'); e.status = 404; throw e; }
  const note = getNoteById(share.note_id);
  if (!note) { const e = new Error('Note not found'); e.status = 404; throw e; }
  const videoIds = extractVideoIds(note.content);
  if (!videoIds.includes(videoId)) { const e = new Error('Forbidden'); e.status = 403; throw e; }
  return { share, note };
}

/** Load video summaries for a set of IDs (no shots, just summary). */
async function loadVideoSummaries(videoIds) {
  const summaries = {};
  await Promise.all(videoIds.map(async (id) => {
    try {
      const manifest = await readManifest(id);
      const heroShot = manifest.shots?.length
        ? (manifest.shots.find((s) => s.id === manifest.heroShotId) || manifest.shots[0])
        : null;
      summaries[id] = {
        id,
        title: manifest.title || null,
        status: manifest.status || 'unknown',
        platform: manifest.platform || null,
        accountUsername: manifest.accountUsername || null,
        stats: manifest.stats || null,
        heroFrameFile: heroShot?.frameFile || null,
      };
    } catch { /* manifest not found */ }
  }));
  return summaries;
}

// ─── Note endpoints ──────────────────────────────────────────────────────────

// GET /api/share/:shareId — note + preloaded video summaries
router.get('/:shareId', async (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });

    const note = getNoteById(share.note_id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const videoIds = extractVideoIds(note.content);
    const videos = await loadVideoSummaries(videoIds);

    res.json({ share, note, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/share/:shareId — save edits (edit mode only)
router.patch('/:shareId', async (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    if (share.mode !== 'edit') return res.status(403).json({ error: 'This link is read-only' });

    const note = getNoteById(share.note_id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { title, content } = req.body;

    createNoteHistoryEntry(share.note_id, {
      title: note.title,
      content: note.content,
      editorLabel: `shared:${share.id}`,
    });

    const updated = updateNote(share.note_id, { title, content });
    const videoIds = extractVideoIds(updated.content);
    const videos = await loadVideoSummaries(videoIds);

    res.json({ share, note: updated, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── History endpoints ────────────────────────────────────────────────────────

router.get('/:shareId/history', (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    res.json(listNoteHistory(share.note_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:shareId/history/:historyId', (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    const entry = getNoteHistoryEntry(req.params.historyId);
    if (!entry || entry.note_id !== share.note_id) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Public media endpoints ───────────────────────────────────────────────────

// GET /api/share/:shareId/video/:videoId — full manifest (for video pane)
router.get('/:shareId/video/:videoId', async (req, res) => {
  try {
    await validateShareAndVideo(req.params.shareId, req.params.videoId);
    const manifest = await readManifest(req.params.videoId).catch(() => null);
    if (!manifest) return res.status(404).json({ error: 'Not found' });
    res.json(manifest);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/share/:shareId/play/:videoId — video file with range-request support
router.get('/:shareId/play/:videoId', async (req, res) => {
  try {
    await validateShareAndVideo(req.params.shareId, req.params.videoId);
    const filePath = join(VIDEOS_DIR, req.params.videoId, 'video.mp4');
    const { size } = await stat(filePath).catch(() => { throw Object.assign(new Error('Not found'), { status: 404 }); });

    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
      createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    res.status(err.status || 500).end();
  }
});

// GET /api/share/:shareId/media/:videoId/* — serve any frame/image file
router.get('/:shareId/media/:videoId/*', async (req, res) => {
  try {
    await validateShareAndVideo(req.params.shareId, req.params.videoId);
    const relPath = req.params[0];
    if (!relPath || relPath.includes('..')) return res.status(400).end();

    const filePath = join(VIDEOS_DIR, req.params.videoId, relPath);
    await stat(filePath).catch(() => { throw Object.assign(new Error('Not found'), { status: 404 }); });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(err.status || 500).end();
  }
});

export default router;

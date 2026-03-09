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

/** Load video summaries (title, status, stats, heroFrameFile) for a set of IDs. */
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
    } catch { /* manifest not found — skip */ }
  }));
  return summaries;
}

// GET /api/share/:shareId — public, returns note + preloaded video summaries
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

// GET /api/share/:shareId/thumb/:videoId — serve hero thumbnail publicly
router.get('/:shareId/thumb/:videoId', async (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).end();

    const note = getNoteById(share.note_id);
    if (!note) return res.status(404).end();

    // Verify this video is actually referenced in the note
    const videoIds = extractVideoIds(note.content);
    if (!videoIds.includes(req.params.videoId)) return res.status(403).end();

    const manifest = await readManifest(req.params.videoId).catch(() => null);
    if (!manifest) return res.status(404).end();

    const heroShot = manifest.shots?.length
      ? (manifest.shots.find((s) => s.id === manifest.heroShotId) || manifest.shots[0])
      : null;
    if (!heroShot?.frameFile) return res.status(404).end();

    const filePath = join(VIDEOS_DIR, req.params.videoId, heroShot.frameFile);
    try {
      await stat(filePath);
    } catch {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).end();
  }
});

// PATCH /api/share/:shareId — public, update note (edit mode only)
router.patch('/:shareId', async (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    if (share.mode !== 'edit') return res.status(403).json({ error: 'This link is read-only' });

    const note = getNoteById(share.note_id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { title, content } = req.body;

    // Snapshot current state before overwriting
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

// GET /api/share/:shareId/history — list edit history entries
router.get('/:shareId/history', (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });

    const history = listNoteHistory(share.note_id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/share/:shareId/history/:historyId — get a specific snapshot
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

export default router;

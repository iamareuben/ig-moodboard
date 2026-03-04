import { Router } from 'express';
import {
  createNote,
  listNotes,
  getNoteById,
  updateNote,
  deleteNote,
  syncVideoNoteLinks,
  getVideosForNote,
} from '../services/db.js';
import { listManifests } from '../services/storage.js';

const router = Router();

/**
 * Extract video IDs from TipTap JSON content.
 * Looks for nodes of type 'socialVideoBlock' with a videoId attribute.
 */
function extractVideoIds(contentJson) {
  const ids = new Set();
  function walk(node) {
    if (!node) return;
    if (node.type === 'socialVideoBlock' && node.attrs?.videoId) {
      ids.add(node.attrs.videoId);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  }
  try {
    const parsed = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
    walk(parsed);
  } catch {
    // ignore parse errors
  }
  return [...ids];
}

// POST /api/notes
router.post('/', (req, res) => {
  try {
    const { title, content } = req.body;
    const note = createNote({ title: title || 'Untitled', content: content || '{}' });
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notes
router.get('/', (req, res) => {
  try {
    const notes = listNotes();
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notes/:id
router.get('/:id', async (req, res) => {
  try {
    const note = getNoteById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    // Attach linked video summaries
    const videoIds = getVideosForNote(req.params.id);
    let videos = [];
    if (videoIds.length > 0) {
      const all = await listManifests();
      videos = all
        .filter((m) => videoIds.includes(m.id))
        .map(({ shots, ...rest }) => ({
          ...rest,
          shotCount: shots ? shots.length : 0,
          heroFrame: (() => {
            if (!shots || shots.length === 0) return null;
            const hero = shots.find((s) => s.id === rest.heroShotId) || shots[0];
            return hero ? hero.frameFile : null;
          })(),
        }));
    }

    res.json({ ...note, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notes/:id
router.patch('/:id', (req, res) => {
  try {
    const { title, content } = req.body;
    const note = updateNote(req.params.id, { title, content });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    // Sync backlinks
    if (content !== undefined) {
      const videoIds = extractVideoIds(content);
      syncVideoNoteLinks(req.params.id, videoIds);
    }

    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', (req, res) => {
  try {
    deleteNote(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

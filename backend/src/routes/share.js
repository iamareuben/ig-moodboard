import { Router } from 'express';
import {
  getNoteShare,
  getNoteById,
  updateNote,
  createNoteHistoryEntry,
  listNoteHistory,
  getNoteHistoryEntry,
} from '../services/db.js';
import { readManifest } from '../services/storage.js';

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

// GET /api/share/:shareId — public, returns note content
router.get('/:shareId', async (req, res) => {
  try {
    const share = getNoteShare(req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Share not found' });

    const note = getNoteById(share.note_id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    res.json({ share, note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/share/:shareId — public, update note (edit mode only)
router.patch('/:shareId', (req, res) => {
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
    res.json({ share, note: updated });
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

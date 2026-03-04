import express from 'express';
import cors from 'cors';
import { VIDEOS_DIR } from './services/storage.js';
import { listManifests } from './services/storage.js';
import { downloadAndProcess } from './services/pipeline.js';
import videosRouter from './routes/videos.js';
import notesRouter from './routes/notes.js';
import accountsRouter from './routes/accounts.js';
import settingsRouter from './routes/settings.js';

// Initialise DB (side-effect import creates tables)
import './services/db.js';

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

app.use('/media', express.static(VIDEOS_DIR));

app.use('/api/videos', videosRouter);
app.use('/api/notes', notesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/settings', settingsRouter);

app.listen(PORT, async () => {
  console.log(`Backend running on http://localhost:${PORT}`);

  // Auto-retry any videos stuck in pending/processing from a previous session
  try {
    const manifests = await listManifests();
    const stuck = manifests.filter((m) => m.status === 'pending' || m.status === 'processing');
    if (stuck.length > 0) {
      console.log(`[startup] Auto-retrying ${stuck.length} stuck video(s)…`);
      for (const m of stuck) {
        console.log(`  ↻ ${m.id} (${m.status}) — ${m.url}`);
        downloadAndProcess(m.id, m.url);
      }
    }
  } catch (err) {
    console.error('[startup] Auto-retry scan failed:', err.message);
  }
});

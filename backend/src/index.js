import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { VIDEOS_DIR } from './services/storage.js';
import { listManifests } from './services/storage.js';
import { downloadAndProcess } from './services/pipeline.js';
import { initRetryQueue } from './services/retryQueue.js';
import videosRouter from './routes/videos.js';
import notesRouter from './routes/notes.js';
import accountsRouter from './routes/accounts.js';
import settingsRouter from './routes/settings.js';
import importBookmarksRouter from './routes/importBookmarks.js';
import authRouter from './routes/auth.js';
import shareRouter from './routes/share.js';
import { requireAuth } from './middleware/auth.js';

// Initialise DB (side-effect import creates tables)
import './services/db.js';

const app = express();
const PORT = 3001;

app.set('trust proxy', 1);

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin, credentials: true }));
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(express.json({ limit: '10mb' }));

// Health check — public, no auth
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auth routes are public
app.use('/api/auth', authRouter);

// Share routes are public (no auth required)
app.use('/api/share', shareRouter);

// Everything else requires authentication
app.use('/api', requireAuth);
app.use('/media', requireAuth);

app.use('/media', express.static(VIDEOS_DIR));

app.use('/api/videos/import-bookmarks', importBookmarksRouter);
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

  // Schedule exponential-backoff retries for previously-failed downloads.
  await initRetryQueue();
});

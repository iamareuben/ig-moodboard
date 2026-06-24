import { randomUUID } from 'crypto';
import {
  getMetaConnection,
  upsertMetaConnection,
  upsertIgMedia,
  setIgMediaManifestId,
  insertMediaInsightSnapshot,
  insertAccountInsightSnapshot,
  listAllIgMediaIds,
} from './db.js';
import { canonicalizeUrl } from './canonicalize.js';
import { listManifests, initVideoDir, writeManifest } from './storage.js';
import { downloadAndProcess } from './pipeline.js';
import {
  listMedia,
  getMediaInsights,
  getAccountInsights,
  getAccountProfile,
  refreshLongLivedToken,
} from './metaGraph.js';

// In-memory job store, mirrors the pattern in routes/accounts.js
const syncJobs = new Map();

const RECENT_REFRESH_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — insights keep moving for weeks after posting

export function getSyncJob(jobId) {
  return syncJobs.get(jobId);
}

export function startMetaSync({ full = false, maxAgeDays = null } = {}) {
  const jobId = randomUUID();
  const job = {
    status: 'running',
    phase: 'listing',
    total: 0,
    done: 0,
    queued: 0,
    skipped: 0,
    error: null,
    cancelled: false,
    startedAt: new Date().toISOString(),
  };
  syncJobs.set(jobId, job);
  runMetaSync(job, { full, maxAgeDays }).catch((err) => {
    job.status = 'error';
    job.error = err.message;
    console.error('[metaSync] job failed:', err.message);
  });
  return jobId;
}

export async function runMetaSync(job, { full = false, maxAgeDays = null } = {}) {
  const conn = getMetaConnection();
  if (!conn || !conn.access_token) {
    job.status = 'error';
    job.error = 'Not connected to Meta';
    return;
  }

  const knownIds = listAllIgMediaIds(conn.account_id);
  const manifests = await listManifests();
  const manifestByCanonicalId = new Map(manifests.map((m) => [m.canonicalId, m]).filter(([k]) => k));

  // Incremental runs (full=false) are meant to fetch "what's new since last time" — but if
  // there's no known media yet (e.g. first run right after connecting), the "stop at a known
  // id" condition never triggers and the loop would otherwise page through the ENTIRE history
  // unbounded. Default incremental runs to a 60-day lookback unless the caller is explicit.
  // A genuine full historical backfill must pass full=true deliberately.
  const effectiveMaxAgeDays = maxAgeDays ?? (full ? null : 60);
  const relativeCutoffMs = effectiveMaxAgeDays ? Date.now() - effectiveMaxAgeDays * 24 * 60 * 60 * 1000 : null;

  // ANALYTICS_MIN_DATE is a hard, absolute floor — never pull anything posted before this
  // date, even on an explicit full=true backfill. Whichever cutoff is more recent wins.
  const absoluteFloorMs = process.env.ANALYTICS_MIN_DATE ? new Date(process.env.ANALYTICS_MIN_DATE).getTime() : null;
  const candidates = [relativeCutoffMs, absoluteFloorMs].filter((v) => v != null);
  const cutoffMs = candidates.length > 0 ? Math.max(...candidates) : null;

  job.phase = 'listing';
  const allMedia = [];
  let after;
  let hitKnown = false;
  let hitCutoff = false;
  do {
    const { media, nextAfter } = await listMedia(conn.ig_user_id, conn.access_token, after);
    for (const m of media) {
      if (cutoffMs && m.timestamp && new Date(m.timestamp).getTime() < cutoffMs) {
        hitCutoff = true;
        continue; // older than the requested window — skip, and stop paging further back
      }
      allMedia.push(m);
      if (!full && knownIds.has(m.id)) hitKnown = true;
    }
    after = nextAfter;
    // Incremental runs stop paging once we reach media we've already seen — we still
    // process the page we're on (to refresh recent insights) but don't fetch further back.
  } while (after && (full || !hitKnown) && !hitCutoff);

  job.total = allMedia.length;
  job.phase = 'syncing';

  const now = Date.now();
  for (const media of allMedia) {
    if (job.cancelled) break;

    const isNew = !knownIds.has(media.id);
    const postedAt = media.timestamp || null;
    const isRecent = postedAt ? (now - new Date(postedAt).getTime()) < RECENT_REFRESH_WINDOW_MS : false;

    let manifestId = null;
    if (isNew && media.permalink) {
      const canonical = canonicalizeUrl(media.permalink);
      const existingManifest = canonical ? manifestByCanonicalId.get(canonical.canonicalId) : null;
      if (existingManifest) {
        manifestId = existingManifest.id;
      } else {
        manifestId = randomUUID();
        await initVideoDir(manifestId);
        await writeManifest(manifestId, {
          id: manifestId,
          url: media.permalink,
          platform: 'instagram',
          title: (media.caption || '').slice(0, 200),
          downloadedAt: new Date().toISOString(),
          status: 'pending',
          duration: null,
          shots: [],
          heroShotId: null,
          canonicalId: canonical?.canonicalId || null,
          normalizedUrl: canonical?.normalizedUrl || null,
          accountId: conn.account_id,
          accountUsername: conn.ig_username,
          accountDisplayName: conn.ig_username,
          stats: null,
          isAccountPull: true,
          isOwnContent: true,
        });
        downloadAndProcess(manifestId, media.permalink, 0, { autoTranscribe: true }); // fire and forget
      }
    }

    upsertIgMedia({
      id: media.id,
      account_id: conn.account_id,
      manifest_id: manifestId,
      permalink: media.permalink,
      caption: media.caption,
      media_type: media.media_type,
      media_product_type: media.media_product_type,
      posted_at: postedAt,
      thumbnail_url: media.thumbnail_url,
    });
    if (manifestId) setIgMediaManifestId(media.id, manifestId);

    if (isNew || isRecent) {
      const metrics = await getMediaInsights(media.id, media.media_product_type, conn.access_token);
      if (metrics) insertMediaInsightSnapshot(media.id, metrics);
    }

    if (isNew) job.queued++;
    else job.skipped++;
    job.done++;
  }

  // Account-level daily snapshot
  try {
    const since = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000);
    const until = Math.floor(now / 1000);
    const accountMetrics = await getAccountInsights(conn.ig_user_id, conn.access_token, since, until);
    const profile = await getAccountProfile(conn.ig_user_id, conn.access_token);
    insertAccountInsightSnapshot({ ...accountMetrics, followers_count: profile.followers_count ?? null });
  } catch (err) {
    console.warn('[metaSync] account insights snapshot failed:', err.message);
  }

  job.phase = 'done';
  job.status = job.cancelled ? 'cancelled' : 'done';
}

export function cancelMetaSync(jobId) {
  const job = syncJobs.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  return true;
}

async function maybeRefreshToken() {
  const conn = getMetaConnection();
  if (!conn || !conn.access_token || !conn.token_expires_at) return;
  const expiresInMs = new Date(conn.token_expires_at).getTime() - Date.now();
  if (expiresInMs < 7 * 24 * 60 * 60 * 1000) {
    try {
      const { accessToken, expiresAt } = await refreshLongLivedToken(conn.access_token);
      upsertMetaConnection({ ...conn, access_token: accessToken, token_expires_at: expiresAt });
      console.log('[metaSync] refreshed long-lived access token');
    } catch (err) {
      console.error('[metaSync] token refresh failed:', err.message);
    }
  }
}

let refreshTimer = null;

export function scheduleMetaRefresh() {
  const run = async () => {
    const conn = getMetaConnection();
    if (!conn || !conn.access_token) return;
    await maybeRefreshToken();
    const job = { status: 'running', phase: 'listing', total: 0, done: 0, queued: 0, skipped: 0, error: null, cancelled: false, startedAt: new Date().toISOString() };
    try {
      await runMetaSync(job, { full: false });
      console.log(`[metaSync] daily refresh done — ${job.queued} new, ${job.skipped} refreshed`);
    } catch (err) {
      console.error('[metaSync] daily refresh failed:', err.message);
    }
  };

  // Run once shortly after startup, then every 24h.
  setTimeout(run, 60 * 1000);
  refreshTimer = setInterval(run, 24 * 60 * 60 * 1000);
}

export function stopMetaRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
}

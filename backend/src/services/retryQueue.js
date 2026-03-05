import { listManifests, readManifest, writeManifest } from './storage.js';
// NOTE: downloadAndProcess is imported lazily to avoid a circular-dep issue at
// module-evaluation time (pipeline → retryQueue → pipeline).
// By the time scheduleRetry fires, both modules are fully loaded.

const BASE_DELAY_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_RETRIES = 8; // ~21 hours total at 2× backoff

// Errors that mean the content is permanently gone — no point retrying.
const PERMANENT_PATTERNS = [
  /HTTP Error 404/i,
  /404[: ].*not found/i,
  /This post is no longer available/i,
  /not available in your country/i,
  /This content isn't available/i,
  /Video unavailable/i,
  /This media is not available/i,
  /account.*private/i,
  /Private account/i,
  /content.*removed/i,
  /post.*deleted/i,
  /does not exist/i,
  // Photo posts / carousels — no video to download, retrying won't help
  /No video formats found/i,
];

export function isPermanentError(errorMessage) {
  if (!errorMessage) return false;
  return PERMANENT_PATTERNS.some((p) => p.test(errorMessage));
}

function delayMs(retryCount) {
  return BASE_DELAY_MS * Math.pow(2, retryCount);
}

// Track IDs that already have a pending timer so we don't double-schedule.
const pending = new Set();

export async function scheduleRetry(id, url, retryCount) {
  if (pending.has(id)) return;
  if (retryCount >= MAX_RETRIES) {
    console.log(`[retry] ${id}: hit max retries (${MAX_RETRIES}), giving up`);
    return;
  }

  const delay = delayMs(retryCount);
  const nextRetryAt = new Date(Date.now() + delay).toISOString();
  const mins = Math.round(delay / 60000);

  // Persist retry metadata so the UI can show it and restarts honour it.
  try {
    const manifest = await readManifest(id);
    manifest.retryCount = retryCount;
    manifest.nextRetryAt = nextRetryAt;
    await writeManifest(id, manifest);
  } catch { /* ignore */ }

  pending.add(id);
  console.log(`[retry] ${id}: attempt ${retryCount + 1}/${MAX_RETRIES} scheduled in ${mins} min`);

  setTimeout(async () => {
    pending.delete(id);
    console.log(`[retry] ${id}: starting attempt ${retryCount + 1}`);
    // Lazy import avoids circular-dep at eval time.
    const { downloadAndProcess } = await import('./pipeline.js');
    await downloadAndProcess(id, url, retryCount + 1);
  }, delay);
}

/**
 * Called at server startup — reschedules any manifests that previously failed
 * with a retryable error.
 */
export async function initRetryQueue() {
  let manifests;
  try {
    manifests = await listManifests();
  } catch {
    return;
  }

  let count = 0;
  for (const m of manifests) {
    if (m.status !== 'error') continue;
    if (isPermanentError(m.error)) continue;

    const retryCount = m.retryCount ?? 0;
    if (retryCount >= MAX_RETRIES) continue;

    // If nextRetryAt is still in the future, honour it; otherwise run soon.
    let delay = delayMs(retryCount);
    if (m.nextRetryAt) {
      const remaining = new Date(m.nextRetryAt).getTime() - Date.now();
      delay = remaining > 0 ? remaining : 5_000;
    }

    // scheduleRetry re-persists nextRetryAt; override the delay manually.
    if (pending.has(m.id)) continue;
    pending.add(m.id);

    const retryCount_ = retryCount; // capture for closure
    const id = m.id;
    const url = m.url;
    console.log(`[retry] ${id}: resuming after restart (attempt ${retryCount_ + 1}/${MAX_RETRIES}) in ${Math.round(delay / 60000)} min`);

    setTimeout(async () => {
      pending.delete(id);
      console.log(`[retry] ${id}: starting attempt ${retryCount_ + 1}`);
      const { downloadAndProcess } = await import('./pipeline.js');
      await downloadAndProcess(id, url, retryCount_ + 1);
    }, delay);

    count++;
  }

  if (count > 0) {
    console.log(`[retry] ${count} failed video(s) queued for retry`);
  }
}

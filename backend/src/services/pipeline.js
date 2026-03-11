import { readManifest, writeManifest, videoFile, framesDir } from './storage.js';
import { downloadVideo, getVideoDuration, getVideoMetadata, downloadCarousel } from './downloader.js';
import { detectShots } from './shotDetector.js';
import { upsertAccount } from './db.js';
import { extractAccountFromUrl } from './canonicalize.js';
import { scheduleRetry, isPermanentError } from './retryQueue.js';

export async function downloadAndProcess(id, url, retryCount = 0) {
  try {
    const vFile = videoFile(id);
    const fDir = framesDir(id);

    let manifest = await readManifest(id);
    manifest.status = 'processing';
    manifest.error = null;
    await writeManifest(id, manifest);

    // Fetch metadata first (title, stats, account) — fast, no download
    const meta = await getVideoMetadata(url);
    if (meta) {
      manifest = await readManifest(id);
      manifest.title = meta.title || manifest.title || '';
      manifest.stats = meta.stats;
      manifest.statsError = false;
      manifest.isCollab = meta.isCollab ?? false;
      manifest.collaborators = meta.collaborators ?? [];
      if (meta.canonicalId && !manifest.canonicalId) manifest.canonicalId = meta.canonicalId;
      if (meta.webpageUrl && !manifest.normalizedUrl) manifest.normalizedUrl = meta.webpageUrl;

      // Upsert account from metadata, falling back to handle extracted from URL
      const accountInfo = extractAccountFromUrl(url);
      const uploaderUsername = meta.uploaderUsername || accountInfo?.username || null;
      if (uploaderUsername) {
        const platform = accountInfo?.platform || manifest.platform;
        const acct = upsertAccount({
          username: uploaderUsername,
          display_name: meta.uploaderDisplayName,
          ig_username: platform === 'instagram' ? uploaderUsername : undefined,
          tt_username: platform === 'tiktok' ? uploaderUsername : undefined,
          ig_user_id: platform === 'instagram' ? (meta.uploaderUserId || undefined) : undefined,
          avatar_url: null,
        });
        manifest.accountId = acct.id;
        manifest.accountUsername = uploaderUsername;
        manifest.accountDisplayName = meta.uploaderDisplayName;
      }
      await writeManifest(id, manifest);
    } else {
      manifest.statsError = true;
      await writeManifest(id, manifest);
    }

    // Download
    await downloadVideo(url, vFile);

    // Get duration
    const duration = await getVideoDuration(vFile);

    // Detect shots
    const shots = await detectShots(vFile, fDir, duration);

    const heroShotId = shots.length > 0 ? shots[0].id : null;
    if (shots.length > 0) shots[0].isHero = true;

    const finalManifest = await readManifest(id);
    finalManifest.status = 'ready';
    finalManifest.duration = duration;
    finalManifest.shots = shots;
    finalManifest.heroShotId = heroShotId;
    // Clear retry metadata on success
    delete finalManifest.retryCount;
    delete finalManifest.nextRetryAt;
    await writeManifest(id, finalManifest);
  } catch (err) {
    // "No video formats found" or ffprobe failure = carousel/photo — try downloading as images
    const isCarouselCandidate = /No video formats found/i.test(err.message) || /ffprobe exited with code/i.test(err.message);
    if (isCarouselCandidate) {
      console.log(`[pipeline] ${id}: no video formats — attempting carousel image download`);
      try {
        const slides = await downloadCarousel(url, framesDir(id));
        slides[0].isHero = true;
        const manifest = await readManifest(id);
        manifest.status = 'ready';
        manifest.isCarousel = true;
        manifest.duration = null;
        manifest.shots = slides;
        manifest.heroShotId = slides[0].id;
        delete manifest.retryCount;
        delete manifest.nextRetryAt;
        await writeManifest(id, manifest);
        console.log(`[pipeline] ${id}: carousel downloaded — ${slides.length} slides`);
        return;
      } catch (carouselErr) {
        console.log(`[pipeline] ${id}: carousel download also failed (${carouselErr.message.slice(0, 120)}) — marking not_video`);
        try {
          const manifest = await readManifest(id);
          manifest.status = 'not_video';
          manifest.error = null;
          await writeManifest(id, manifest);
        } catch { /* ignore */ }
        return;
      }
    }

    console.error(`[pipeline error] ${id}:`, err.message);
    try {
      const manifest = await readManifest(id);
      manifest.status = 'error';
      manifest.error = err.message;
      await writeManifest(id, manifest);
    } catch {
      // ignore secondary error
    }

    if (!isPermanentError(err.message)) {
      scheduleRetry(id, url, retryCount);
    } else {
      console.log(`[pipeline] ${id}: permanent error, no retry — ${err.message.slice(0, 120)}`);
    }
  }
}

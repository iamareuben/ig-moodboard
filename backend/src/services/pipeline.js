import { readManifest, writeManifest, videoFile, framesDir } from './storage.js';
import { downloadVideo, getVideoDuration, getVideoMetadata } from './downloader.js';
import { detectShots } from './shotDetector.js';
import { upsertAccount } from './db.js';
import { extractAccountFromUrl } from './canonicalize.js';

export async function downloadAndProcess(id, url) {
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
          avatar_url: null,
        });
        manifest.accountId = acct.id;
        manifest.accountUsername = uploaderUsername;
        manifest.accountDisplayName = meta.uploaderDisplayName;
      }
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
    await writeManifest(id, finalManifest);
  } catch (err) {
    console.error(`[pipeline error] ${id}:`, err.message);
    try {
      const manifest = await readManifest(id);
      manifest.status = 'error';
      manifest.error = err.message;
      await writeManifest(id, manifest);
    } catch {
      // ignore secondary error
    }
  }
}

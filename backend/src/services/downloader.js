import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getCookies } from './db.js';

// Parse Netscape cookies.txt → { name: value } map
function parseCookiesTxt(txt) {
  const cookies = {};
  for (const line of txt.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split('\t');
    if (parts.length >= 7 && parts[5]) cookies[parts[5]] = parts[6] ?? '';
  }
  return cookies;
}

// Instagram shortcode → numeric media ID (uses BigInt for large IDs)
function shortcodeToMediaId(shortcode) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let n = BigInt(0);
  for (const c of shortcode) n = n * BigInt(64) + BigInt(chars.indexOf(c));
  return n.toString();
}

const BREW_PATH = '/opt/homebrew/bin:/usr/local/bin';
const spawnEnv = {
  ...process.env,
  PATH: `${BREW_PATH}:${process.env.PATH ?? ''}`,
};

// In-memory cookie status per platform — reset on server restart
const cookieStatus = {};

export function getCookieStatus() {
  return { ...cookieStatus };
}

export function clearCookieStatus(platform) {
  delete cookieStatus[platform];
}

/**
 * Returns true for errors that indicate yt-dlp needs cookies to proceed.
 * Covers the classic HTTP 403 and IG's "rate-limit / login required" exit-code-1 error.
 */
function needsCookies(err) {
  const msg = err.message;
  return (
    msg.includes('HTTP Error 403') ||
    msg.includes('rate-limit reached or login required') ||
    msg.includes('login required') ||
    msg.includes('login page') ||
    msg.includes('unavailable for certain audiences') ||
    msg.includes('may be inappropriate') ||
    msg.includes('blocked') ||
    msg.includes('your IP')
  );
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: spawnEnv });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

function platformForUrl(url) {
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('instagram.com')) return 'instagram';
  return null;
}

/**
 * Try fn() without cookies first (just --impersonate chrome).
 * If that fails with a login/rate-limit error, retry with stored cookies.
 * Note: --impersonate is intentionally dropped for the cookie attempt — mixing
 * a Chrome TLS fingerprint with session cookies from a different browser can
 * cause IG to reject the request.
 */
async function withCookieArgs(url, fn) {
  const platform = platformForUrl(url);
  const impersonateArgs = platform ? ['--impersonate', 'chrome'] : [];

  // First attempt: no cookies, impersonate Chrome
  try {
    const result = await fn(impersonateArgs);
    if (platform) clearCookieStatus(platform);
    return result;
  } catch (err) {
    if (!platform || !needsCookies(err)) throw err;
  }

  // Login/rate-limit — try with stored cookies (no --impersonate, cookies carry the session)
  const row = getCookies(platform);
  if (!row?.cookies_txt) {
    cookieStatus[platform] = 'needed';
    throw new Error(`Login required from ${platform} and no cookies stored. Add cookies in Settings.`);
  }

  const tmpPath = join(tmpdir(), `ytdlp-${platform}-${Date.now()}.txt`);
  writeFileSync(tmpPath, row.cookies_txt, 'utf8');
  try {
    const result = await fn(['--cookies', tmpPath]);
    clearCookieStatus(platform);
    return result;
  } catch (cookieErr) {
    console.error(`[downloader] yt-dlp with cookies failed for ${platform}:`, cookieErr.message);
    // Only report a cookie problem if this still looks like an auth failure.
    // Otherwise (e.g. "No video formats found", rate-limit after auth, etc.)
    // throw the real yt-dlp error so callers can classify it correctly.
    if (needsCookies(cookieErr)) {
      cookieStatus[platform] = 'invalid';
      throw new Error(`Login required from ${platform} even with stored cookies — they may be expired. Update cookies in Settings.`);
    }
    throw cookieErr;
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

/**
 * Download all images in an Instagram carousel (or single photo post) using
 * the Instagram mobile API. Returns shot objects ready for the manifest.
 * Works for media_type 8 (carousel) and media_type 1 (single image).
 */
export async function downloadCarousel(url, framesDir) {
  const shortcodeMatch = url.match(/\/p\/([A-Za-z0-9_-]+)/);
  if (!shortcodeMatch) throw new Error('Cannot extract shortcode from Instagram URL');
  const mediaId = shortcodeToMediaId(shortcodeMatch[1]);

  const row = getCookies('instagram');
  if (!row?.cookies_txt) throw new Error('No Instagram cookies stored — add cookies in Settings');

  const cookies = parseCookiesTxt(row.cookies_txt);
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const igHeaders = {
    Cookie: cookieHeader,
    'X-CSRFToken': cookies.csrftoken || '',
    'X-IG-App-ID': '936619743392459',
    // Mobile UA gets full image_versions2 candidates with high-res images
    'User-Agent': 'Instagram 319.0.0.41 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
  };

  const apiRes = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, { headers: igHeaders });
  if (!apiRes.ok) throw new Error(`Instagram API returned ${apiRes.status} for media ${mediaId}`);

  const data = await apiRes.json();
  const item = data.items?.[0];
  if (!item) throw new Error('No media item in Instagram API response');

  // carousel_media for type 8 (carousel); wrap single image (type 1) in an array
  const slideItems = item.carousel_media?.length > 0
    ? item.carousel_media
    : item.image_versions2?.candidates ? [item] : [];

  if (slideItems.length === 0) throw new Error('No image slides found in Instagram API response');

  const shots = [];
  for (let i = 0; i < slideItems.length; i++) {
    const slide = slideItems[i];
    const candidates = slide.image_versions2?.candidates ?? [];
    if (candidates.length === 0) continue;

    // First candidate = highest resolution
    const best = candidates[0];
    const imgRes = await fetch(best.url);
    if (!imgRes.ok) throw new Error(`Failed to download slide ${i + 1}: HTTP ${imgRes.status}`);

    const filename = `slide_${String(i + 1).padStart(2, '0')}.jpg`;
    await writeFile(join(framesDir, filename), Buffer.from(await imgRes.arrayBuffer()));

    shots.push({
      id: randomUUID(),
      timestamp: i,
      frameFile: `frames/${filename}`,
      width: best.width ?? null,
      height: best.height ?? null,
      isHero: false,
      label: '',
    });
  }

  if (shots.length === 0) throw new Error('No carousel images downloaded');
  return shots;
}

export async function downloadVideo(url, outputPath) {
  await withCookieArgs(url, (cookieArgs) =>
    runProcess('yt-dlp', [
      ...cookieArgs,
      '-f', 'mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', '500m',
      '-o', outputPath,
      url,
    ])
  );
}

export async function getVideoDuration(videoPath) {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    videoPath,
  ]);

  const info = JSON.parse(stdout);
  return parseFloat(info.format.duration);
}

/**
 * Fetch video metadata from yt-dlp without downloading the video.
 * Returns a normalised metadata object.
 */
export async function getVideoMetadata(url) {
  try {
    const { stdout } = await withCookieArgs(url, (cookieArgs) =>
      runProcess('yt-dlp', [
        ...cookieArgs,
        '--dump-json',
        '--skip-download',
        '--no-playlist',
        url,
      ])
    );
    const raw = JSON.parse(stdout);
    return {
      title: raw.title || raw.fulltitle || '',
      description: raw.description || '',
      canonicalId: raw.id ? `${raw.extractor_key?.toLowerCase() || 'unknown'}:${raw.id}` : null,
      webpageUrl: raw.webpage_url || url,
      uploaderUsername: (() => {
        const uid = raw.uploader_id?.replace(/^@/, '');
        // Purely numeric = numeric user ID, not a handle (e.g. Instagram)
        // Fall back to raw.uploader which contains the actual handle for Instagram
        if (uid && /^\d+$/.test(uid)) {
          const fallback = raw.uploader?.replace(/^@/, '');
          return (fallback && !/^\d+$/.test(fallback)) ? fallback : null;
        }
        return uid || null;
      })(),
      uploaderDisplayName: raw.uploader || raw.channel || null,
      thumbnailUrl: raw.thumbnail || null,
      stats: {
        viewCount: raw.view_count ?? null,
        likeCount: raw.like_count ?? null,
        commentCount: raw.comment_count ?? null,
        shareCount: raw.repost_count ?? raw.share_count ?? null,
      },
    };
  } catch (err) {
    console.warn('[metadata] yt-dlp dump-json failed:', err.message);
    return null;
  }
}

/**
 * Fetch an account's public video list using yt-dlp.
 * Returns array of video metadata objects (no download).
 */
export async function getAccountVideos(profileUrl, limit = 20) {
  const { stdout } = await withCookieArgs(profileUrl, (cookieArgs) =>
    runProcess('yt-dlp', [
      ...cookieArgs,
      '--dump-json',
      '--skip-download',
      '--playlist-end', String(limit),
      profileUrl,
    ])
  );
  // yt-dlp dumps one JSON object per line for playlists
  return stdout.trim().split('\n').map((line) => {
    try {
      const raw = JSON.parse(line);
      return {
        id: raw.id,
        title: raw.title || '',
        webpageUrl: raw.webpage_url || raw.url || '',
        thumbnailUrl: raw.thumbnail || null,
        uploaderUsername: raw.uploader_id?.replace(/^@/, '') || null,
        stats: {
          viewCount: raw.view_count ?? null,
          likeCount: raw.like_count ?? null,
          commentCount: raw.comment_count ?? null,
        },
        uploadDate: raw.upload_date || null, // YYYYMMDD
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

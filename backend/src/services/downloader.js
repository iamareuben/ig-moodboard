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

  // Login/rate-limit — try with stored cookies (no --impersonate, cookies carry the session).
  // For Instagram, prefer the dedicated scraper slot to protect the main account.
  const scraperRow = platform === 'instagram' ? getCookies('instagram', 'scraper') : null;
  const row = scraperRow?.cookies_txt ? scraperRow : getCookies(platform, 'main');
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

    // Collaborators: IG collab posts expose an array of objects with a username field
    const rawCollabs = Array.isArray(raw.collaborators) ? raw.collaborators : [];
    const collaborators = rawCollabs
      .map((c) => (typeof c === 'string' ? c : c?.username))
      .filter(Boolean);

    return {
      title: raw.title || raw.fulltitle || '',
      description: raw.description || '',
      canonicalId: raw.id ? `${raw.extractor_key?.toLowerCase() || 'unknown'}:${raw.id}` : null,
      webpageUrl: raw.webpage_url || url,
      uploaderUsername: (() => {
        const uid = raw.uploader_id?.replace(/^@/, '');
        // Purely numeric = numeric user ID (Instagram stores user IDs here, not handles)
        if (uid && /^\d+$/.test(uid)) {
          // Prefer uploader_url which contains the actual profile URL with the real handle
          // e.g. https://www.instagram.com/chunkyfitcookie/
          const urlMatch = raw.uploader_url?.match(/instagram\.com\/([^/?#]+)\/?/);
          if (urlMatch?.[1] && !/^\d+$/.test(urlMatch[1])) return urlMatch[1];
          // Last resort: raw.uploader — but only if it looks like a handle (no spaces)
          const fallback = raw.uploader?.replace(/^@/, '');
          return (fallback && !/^\d+$/.test(fallback) && !/\s/.test(fallback)) ? fallback : null;
        }
        return uid || null;
      })(),
      uploaderDisplayName: raw.uploader || raw.channel || null,
      thumbnailUrl: raw.thumbnail || null,
      isCollab: collaborators.length > 0,
      collaborators,
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
 * Build IG mobile API headers using scraper cookies (falling back to main).
 * Returns { headers, cookies } or throws if no cookies are stored.
 */
function igMobileHeaders() {
  const row = getCookies('instagram', 'scraper') || getCookies('instagram', 'main');
  if (!row?.cookies_txt) throw new Error('No Instagram cookies stored — add cookies in Settings');
  const cookies = parseCookiesTxt(row.cookies_txt);
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    headers: {
      Cookie: cookieHeader,
      'X-CSRFToken': cookies.csrftoken || '',
      'X-IG-App-ID': '936619743392459',
      'User-Agent': 'Instagram 319.0.0.41 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
      'Accept-Language': 'en-US',
    },
  };
}

/**
 * Resolve an Instagram username to a numeric user ID.
 * Tries multiple strategies in order of reliability.
 */
async function getIGUserId(username) {
  // IG handles are alphanumeric + underscores + periods — spaces mean it's a display name
  if (/\s/.test(username)) {
    throw new Error(
      `"${username}" looks like a display name, not an Instagram handle. ` +
      `Edit the account and set the IG Username field to the actual @handle (e.g. chunkyfitcookie).`
    );
  }

  const { headers } = igMobileHeaders();

  // Strategy 1: web_profile_info (mobile API)
  try {
    const r = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers }
    );
    console.log(`[ig:userid] web_profile_info → ${r.status}`);
    if (r.ok) {
      const id = (await r.json())?.data?.user?.id;
      if (id) return id;
    }
  } catch (e) { console.warn('[ig:userid] web_profile_info error:', e.message); }

  await new Promise((r) => setTimeout(r, 1500));

  // Strategy 2: user search endpoint
  try {
    const r = await fetch(
      `https://i.instagram.com/api/v1/users/search/?q=${encodeURIComponent(username)}&count=10`,
      { headers }
    );
    console.log(`[ig:userid] search → ${r.status}`);
    if (r.ok) {
      const user = (await r.json()).users?.find((u) => u.username === username);
      if (user?.pk) return String(user.pk);
    }
  } catch (e) { console.warn('[ig:userid] search error:', e.message); }

  await new Promise((r) => setTimeout(r, 1500));

  // Strategy 3: parse the iOS app-link meta tag from the profile HTML page.
  // Instagram always embeds <meta property="al:ios:url" content="instagram://user?id=USERID">
  // in the profile page — this works even when the API endpoints are rate-limited.
  try {
    const browserHeaders = {
      Cookie: headers.Cookie,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    };
    const r = await fetch(`https://www.instagram.com/${username}/`, { headers: browserHeaders });
    console.log(`[ig:userid] html page → ${r.status}, url: ${r.url}`);
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/instagram:\/\/user\?id=(\d+)/);
      console.log(`[ig:userid] html meta match: ${m?.[1] ?? 'none'} (html length: ${html.length})`);
      if (m?.[1]) return m[1];
    }
  } catch (e) { console.warn('[ig:userid] html error:', e.message); }

  throw new Error(`Could not resolve Instagram user ID for @${username}. The account may be private, deleted, or temporarily rate-limited — try again in a few minutes.`);
}

/**
 * Map a raw IG mobile API media item to a normalised object.
 */
function mapIGItem(item) {
  const code = item.code;
  const collaborators = (item.coauthor_producers || []).map((c) => c.username).filter(Boolean);
  const uploadDate = item.taken_at
    ? new Date(item.taken_at * 1000).toISOString().slice(0, 10).replace(/-/g, '')
    : null;
  return {
    id: item.id,
    url: `https://www.instagram.com/p/${code}/`,
    webpageUrl: `https://www.instagram.com/p/${code}/`,
    title: item.caption?.text?.split('\n')[0]?.slice(0, 120) || '',
    uploadDate,
    thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || null,
    isCollab: collaborators.length > 0,
    collaborators,
    stats: {
      viewCount: item.view_count ?? null,
      likeCount: item.like_count ?? null,
      commentCount: item.comment_count ?? null,
    },
  };
}

/**
 * Fetch ALL media from an Instagram user via the mobile feed API.
 * Returns entries oldest-first.
 */
async function getIGUserAllMedia(username) {
  const { headers } = igMobileHeaders();
  const userId = await getIGUserId(username);

  const items = [];
  let maxId = null;

  while (true) {
    const url = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=50${maxId ? `&max_id=${maxId}` : ''}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Instagram feed fetch failed: HTTP ${res.status}`);
    const data = await res.json();

    for (const item of (data.items || [])) {
      if (!item.code) continue;
      items.push(mapIGItem(item));
    }

    if (!data.more_available || !data.next_max_id) break;
    maxId = data.next_max_id;

    // Polite delay between pages
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
  }

  // API returns newest-first — reverse to get oldest-first
  return items.reverse();
}

/**
 * Fetch a single page of media from an Instagram user (for Live Videos preview).
 */
async function getIGUserFeedPage(username, limit = 20) {
  const { headers } = igMobileHeaders();
  const userId = await getIGUserId(username);
  const res = await fetch(
    `https://i.instagram.com/api/v1/feed/user/${userId}/?count=${limit}`,
    { headers }
  );
  if (!res.ok) throw new Error(`Instagram feed fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || []).filter((item) => item.code).map(mapIGItem);
}

/**
 * Fetch ALL videos from an account profile.
 * Instagram: uses the mobile API (reliable, no yt-dlp needed for listing).
 * TikTok: uses yt-dlp flat-playlist.
 */
export async function getAccountAllVideos(profileUrl) {
  if (profileUrl.includes('instagram.com')) {
    const match = profileUrl.match(/instagram\.com\/([^/?#]+)\/?/);
    const username = match?.[1];
    if (!username) throw new Error('Cannot extract username from Instagram URL');
    return getIGUserAllMedia(username);
  }

  // TikTok — yt-dlp flat-playlist still works fine
  const { stdout } = await withCookieArgs(profileUrl, (cookieArgs) =>
    runProcess('yt-dlp', [
      ...cookieArgs,
      '--flat-playlist',
      '--dump-json',
      '--playlist-reverse',
      profileUrl,
    ])
  );
  return stdout.trim().split('\n').map((line) => {
    try {
      const raw = JSON.parse(line);
      return {
        id: raw.id,
        url: raw.url || raw.webpage_url || '',
        title: raw.title || '',
        uploadDate: raw.upload_date || null,
        thumbnailUrl: raw.thumbnail || null,
        isCollab: false,
        collaborators: [],
      };
    } catch {
      return null;
    }
  }).filter((v) => v && v.url);
}

/**
 * Fetch a limited video list for an account (used by Live Videos preview).
 * Instagram: mobile API. TikTok: yt-dlp.
 */
export async function getAccountVideos(profileUrl, limit = 20) {
  if (profileUrl.includes('instagram.com')) {
    const match = profileUrl.match(/instagram\.com\/([^/?#]+)\/?/);
    const username = match?.[1];
    if (!username) throw new Error('Cannot extract username from Instagram URL');
    return getIGUserFeedPage(username, limit);
  }

  // TikTok — yt-dlp still works fine
  const { stdout } = await withCookieArgs(profileUrl, (cookieArgs) =>
    runProcess('yt-dlp', [
      ...cookieArgs,
      '--dump-json',
      '--skip-download',
      '--playlist-end', String(limit),
      profileUrl,
    ])
  );
  return stdout.trim().split('\n').map((line) => {
    try {
      const raw = JSON.parse(line);
      return {
        id: raw.id,
        title: raw.title || '',
        webpageUrl: raw.webpage_url || raw.url || '',
        thumbnailUrl: raw.thumbnail || null,
        isCollab: false,
        collaborators: [],
        stats: {
          viewCount: raw.view_count ?? null,
          likeCount: raw.like_count ?? null,
          commentCount: raw.comment_count ?? null,
        },
        uploadDate: raw.upload_date || null,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

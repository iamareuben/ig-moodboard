import { Router } from 'express';
import { randomUUID } from 'crypto';
import { listManifests, initVideoDir, writeManifest } from '../services/storage.js';
import { canonicalizeUrl } from '../services/canonicalize.js';
import { downloadAndProcess } from '../services/pipeline.js';
import { getCookies } from '../services/db.js';

const router = Router();

// Parse Netscape cookies.txt → { name: value } map
function parseCookiesTxt(txt) {
  const cookies = {};
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('\t');
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const value = parts[6].trim();
      if (name) cookies[name] = value;
    }
  }
  return cookies;
}

// Fetch all saved post URLs from IG using stored cookies
async function fetchIgSavedUrls(cookiesTxt) {
  const cookies = parseCookiesTxt(cookiesTxt);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const headers = {
    Cookie: cookieHeader,
    'X-CSRFToken': cookies.csrftoken || '',
    'X-IG-App-ID': '936619743392459',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept: '*/*',
    Referer: 'https://www.instagram.com/',
    'X-Requested-With': 'XMLHttpRequest',
  };

  const urls = [];
  let nextMaxId = null;
  const maxPages = 20; // safety cap
  let page = 0;

  while (page < maxPages) {
    const endpoint = new URL('https://www.instagram.com/api/v1/feed/saved/posts/');
    endpoint.searchParams.set('count', '50');
    if (nextMaxId) endpoint.searchParams.set('max_id', nextMaxId);

    const res = await fetch(endpoint.toString(), { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Instagram API returned ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }

    const data = await res.json();
    for (const item of data.items || []) {
      const code = item.media?.code || item.media?.shortcode;
      if (code) urls.push(`https://www.instagram.com/p/${code}/`);
    }

    if (data.more_available && data.next_max_id) {
      nextMaxId = data.next_max_id;
      page++;
    } else {
      break;
    }
  }

  return urls;
}

async function processUrls(urls, manifests, importSource = 'ig_bookmarks') {
  let submitted = 0, existing = 0, skipped = 0;

  for (const url of urls) {
    let platform;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'instagram.com') platform = 'instagram';
      else if (host.includes('tiktok.com') && !/\/photo\//.test(u.pathname)) platform = 'tiktok';
    } catch { /* ignore */ }

    if (!platform) { skipped++; continue; }

    const canonical = canonicalizeUrl(url);
    let existingManifest = null;
    if (canonical?.canonicalId) {
      existingManifest = manifests.find((m) => m.canonicalId === canonical.canonicalId);
    }
    if (!existingManifest && canonical?.normalizedUrl) {
      existingManifest = manifests.find((m) => m.normalizedUrl === canonical.normalizedUrl);
    }

    if (existingManifest) { existing++; continue; }

    const id = randomUUID();
    await initVideoDir(id);
    const manifest = {
      id,
      url,
      platform,
      title: '',
      downloadedAt: new Date().toISOString(),
      status: 'pending',
      duration: null,
      shots: [],
      heroShotId: null,
      canonicalId: canonical?.canonicalId || null,
      normalizedUrl: canonical?.normalizedUrl || null,
      accountId: null,
      accountUsername: null,
      accountDisplayName: null,
      stats: null,
      annotations: [],
      importSource,
    };
    await writeManifest(id, manifest);
    downloadAndProcess(id, url);
    manifests.push(manifest);
    submitted++;
  }

  return { submitted, existing, skipped };
}

// POST /api/videos/import-bookmarks/sync-ig
// Pulls saved posts directly from Instagram using stored cookies
router.post('/sync-ig', async (req, res) => {
  const row = getCookies('instagram');
  if (!row?.cookies_txt) {
    return res.status(400).json({
      error: 'No Instagram cookies stored. Add cookies in Settings first.',
    });
  }

  let igUrls;
  try {
    igUrls = await fetchIgSavedUrls(row.cookies_txt);
  } catch (err) {
    return res.status(400).json({ error: `Failed to fetch IG bookmarks: ${err.message}` });
  }

  const manifests = await listManifests();
  const result = await processUrls(igUrls, manifests, 'ig_bookmarks');

  res.json({ ...result, total: igUrls.length });
});

export default router;

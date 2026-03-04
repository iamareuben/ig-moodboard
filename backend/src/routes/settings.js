import { Router } from 'express';
import { getCookies, setCookies, deleteCookies, listCookiePlatforms } from '../services/db.js';

const router = Router();

const PLATFORM_DOMAINS = {
  tiktok: 'tiktok.com',
  instagram: 'instagram.com',
};

/**
 * Parse a pasted cURL command or raw Cookie header string.
 * Returns the raw cookie string (e.g. "sessionid=xxx; foo=bar") or null.
 */
function parseCurlCookies(input) {
  // Flatten line continuations from "Copy as cURL"
  const normalized = input.replace(/\\\n\s*/g, ' ');
  // Chrome "Copy as cURL" uses -b '...' (--cookie)
  const bFlag = normalized.match(/-b\s+['"]([^'"]+)['"]/);
  if (bFlag) return bFlag[1].trim();
  // Firefox / Safari use -H 'cookie: ...'
  const hFlag = normalized.match(/-H\s+['"](?:cookie|Cookie):\s*([^'"]+)['"]/i);
  if (hFlag) return hFlag[1].trim();
  // Not a curl command — treat as a raw cookie string passthrough
  if (!normalized.trim().startsWith('curl')) return normalized.trim();
  return null;
}


/**
 * Convert a raw cookie string to Netscape cookie file format for yt-dlp.
 * Uses secure=TRUE since TikTok/IG are HTTPS-only.
 */
function toNetscapeCookies(domain, cookieStr) {
  const lines = ['# Netscape HTTP Cookie File'];
  const cookieDomain = `.${domain}`;
  for (const pair of cookieStr.split(/;\s*/)) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (!name) continue;
    // domain  includeSubdomains  path  secure  expiry  name  value
    lines.push(`${cookieDomain}\tTRUE\t/\tTRUE\t2147483647\t${name}\t${value}`);
  }
  return lines.join('\n');
}

// GET /api/settings/cookies — list which platforms have cookies stored
router.get('/cookies', (req, res) => {
  res.json(listCookiePlatforms());
});

// POST /api/settings/cookies/:platform — save cookies from pasted cURL or raw cookie string
router.post('/cookies/:platform', (req, res) => {
  const { platform } = req.params;
  if (!PLATFORM_DOMAINS[platform]) {
    return res.status(400).json({ error: 'Unknown platform. Use "tiktok" or "instagram".' });
  }
  const { curlCommand } = req.body;
  if (!curlCommand?.trim()) {
    return res.status(400).json({ error: 'curlCommand is required' });
  }
  const cookieStr = parseCurlCookies(curlCommand);
  if (!cookieStr) {
    return res.status(400).json({ error: 'No Cookie header found. Make sure you copied a request to the main domain (www.tiktok.com / www.instagram.com), not a CDN or font file.' });
  }
  const cookiesTxt = toNetscapeCookies(PLATFORM_DOMAINS[platform], cookieStr);
  setCookies(platform, cookiesTxt);
  res.json({ ok: true });
});

// DELETE /api/settings/cookies/:platform — remove stored cookies
router.delete('/cookies/:platform', (req, res) => {
  const { platform } = req.params;
  deleteCookies(platform);
  res.json({ ok: true });
});

export default router;

/**
 * Extract a stable canonical ID from an IG or TikTok URL for deduplication.
 * Returns { platform, canonicalId, normalizedUrl } or null if not recognized.
 */
export function canonicalizeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, '');

  // Instagram
  if (host === 'instagram.com') {
    // Reels, posts: /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE
    const match = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (match) {
      const code = match[2];
      return {
        platform: 'instagram',
        canonicalId: `instagram:${code}`,
        normalizedUrl: `https://www.instagram.com/p/${code}/`,
      };
    }
    // Stories: /stories/username/mediaId
    const storyMatch = u.pathname.match(/\/stories\/([^/]+)\/(\d+)/);
    if (storyMatch) {
      return {
        platform: 'instagram',
        canonicalId: `instagram:${storyMatch[2]}`,
        normalizedUrl: `https://www.instagram.com/stories/${storyMatch[1]}/${storyMatch[2]}/`,
      };
    }
    return null;
  }

  // TikTok long URL: https://www.tiktok.com/@user/video/12345
  if (host === 'tiktok.com') {
    const longMatch = u.pathname.match(/\/@[^/]+\/video\/(\d+)/);
    if (longMatch) {
      return {
        platform: 'tiktok',
        canonicalId: `tiktok:${longMatch[1]}`,
        normalizedUrl: `https://www.tiktok.com/video/${longMatch[1]}`,
      };
    }
    // Short: vm.tiktok.com or t.tiktok.com — can't resolve without redirect
    return {
      platform: 'tiktok',
      canonicalId: null, // resolved later from yt-dlp metadata
      normalizedUrl: null,
    };
  }

  // TikTok short domains
  if (host === 'vm.tiktok.com' || host === 't.tiktok.com' || host === 'vt.tiktok.com') {
    return {
      platform: 'tiktok',
      canonicalId: null,
      normalizedUrl: null,
    };
  }

  return null;
}

/**
 * Extract username from an IG or TikTok URL for account lookup.
 * Returns { platform, username } or null.
 */
export function extractAccountFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);

    if (host === 'instagram.com') {
      const skip = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'video', 'accounts'];
      if (parts.length > 0 && !skip.includes(parts[0])) {
        return { platform: 'instagram', username: parts[0].replace(/^@/, '') };
      }
      // For /p/CODE/ there's no username in the path
      return null;
    }

    if (host === 'tiktok.com' || host === 'vm.tiktok.com') {
      if (parts.length > 0 && parts[0].startsWith('@')) {
        return { platform: 'tiktok', username: parts[0].replace(/^@/, '') };
      }
      return null;
    }
  } catch {
    // ignore
  }
  return null;
}

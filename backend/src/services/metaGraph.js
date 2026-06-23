// Thin client for the Instagram Graph API (via Facebook Login for Business).
// API version pinned to v25.0 — bump deliberately if Meta deprecates fields we rely on.
const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;

async function graphRequest(path, params = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph API error (${path}): ${data.error.message} [${data.error.type}/${data.error.code}]`);
  }
  return data;
}

export function getOAuthDialogUrl(redirectUri, state) {
  const url = new URL('https://www.facebook.com/v25.0/dialog/oauth');
  url.searchParams.set('client_id', APP_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management');
  url.searchParams.set('response_type', 'code');
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForToken(code, redirectUri) {
  const data = await graphRequest('/oauth/access_token', {
    client_id: APP_ID,
    client_secret: APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  return data.access_token; // short-lived
}

export async function getLongLivedToken(shortLivedToken) {
  const data = await graphRequest('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: APP_ID,
    client_secret: APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  // expires_in is seconds (~60 days)
  const expiresAt = new Date(Date.now() + (data.expires_in || 60 * 24 * 60 * 60) * 1000).toISOString();
  return { accessToken: data.access_token, expiresAt };
}

// Refreshing a long-lived token resets its 60-day clock — same call as the initial exchange.
export const refreshLongLivedToken = getLongLivedToken;

export async function listPages(userToken) {
  const data = await graphRequest('/me/accounts', { access_token: userToken, fields: 'id,name' });
  return data.data || [];
}

export async function getIgAccountForPage(pageId, token) {
  const data = await graphRequest(`/${pageId}`, {
    access_token: token,
    fields: 'instagram_business_account{id,username}',
  });
  return data.instagram_business_account || null;
}

export async function listMedia(igUserId, token, after) {
  const fields = 'id,permalink,caption,media_type,media_product_type,timestamp,thumbnail_url';
  const data = await graphRequest(`/${igUserId}/media`, {
    access_token: token,
    fields,
    limit: 50,
    after,
  });
  return {
    media: data.data || [],
    nextAfter: data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : null,
  };
}

const METRICS_BY_PRODUCT_TYPE = {
  FEED: ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'follows', 'profile_visits', 'profile_activity', 'reposts'],
  // follows/profile_visits are NOT supported for REELS — confirmed via Meta's own docs and
  // live API testing (every request including them is rejected outright). Account-level
  // follows_and_unfollows + followers_count snapshots are the closest available proxy.
  REELS: ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'reposts', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'],
  STORY: ['reach', 'views', 'profile_visits', 'follows', 'navigation', 'link_clicks', 'replies'],
};

// CAROUSEL_ALBUM has no media-level insights at all per the Graph API docs.
export function metricsForProductType(mediaProductType) {
  return METRICS_BY_PRODUCT_TYPE[mediaProductType] || METRICS_BY_PRODUCT_TYPE.FEED;
}

// Meta rejects the whole batch (error #100) if ANY requested metric is unsupported for a
// given media/product-type/age combo, and names the offending metrics in the error message.
// Rather than hardcode a "safe" list that will drift as Meta changes things, parse the
// rejected metric names out of the error and retry without them — self-correcting per media.
function parseUnsupportedMetrics(message) {
  const match = message.match(/does not support the (.+?) metrics? for this media/i);
  if (!match) return [];
  return match[1].split(',').map((m) => m.trim()).filter(Boolean);
}

export async function getMediaInsights(mediaId, mediaProductType, token) {
  if (mediaProductType === 'CAROUSEL_ALBUM') {
    return null;
  }
  let metrics = metricsForProductType(mediaProductType);
  for (let attempt = 0; attempt < 5 && metrics.length > 0; attempt++) {
    try {
      const data = await graphRequest(`/${mediaId}/insights`, {
        access_token: token,
        metric: metrics.join(','),
      });
      const out = {};
      for (const item of data.data || []) {
        if (item.values?.length) {
          out[item.name] = item.values[0].value;
        } else if (item.total_value) {
          out[item.name] = item.total_value.value;
        }
      }
      return out;
    } catch (err) {
      const bad = parseUnsupportedMetrics(err.message);
      if (bad.length > 0) {
        metrics = metrics.filter((m) => !bad.includes(m));
        continue;
      }
      console.warn(`[metaGraph] insights fetch failed for ${mediaId}: ${err.message}`);
      return null;
    }
  }
  return null;
}

export async function getAccountInsights(igUserId, token, since, until) {
  const data = await graphRequest(`/${igUserId}/insights`, {
    access_token: token,
    metric: 'reach,accounts_engaged',
    period: 'day',
    metric_type: 'total_value',
    since,
    until,
  });
  const out = {};
  for (const item of data.data || []) {
    out[item.name] = item.total_value?.value ?? item.values ?? null;
  }
  return out;
}

export async function getAccountProfile(igUserId, token) {
  return graphRequest(`/${igUserId}`, { access_token: token, fields: 'username,id,followers_count' });
}

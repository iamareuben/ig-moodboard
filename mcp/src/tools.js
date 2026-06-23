import { z } from 'zod';
import {
  listMediaWithLatestInsights,
  getMedia,
  getMediaInsightHistory,
  listAllMediaWithManifests,
  listAccountInsights,
} from './db.js';
import { readManifest } from './storage.js';

const textContent = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

export function registerTools(server) {
  server.registerTool(
    'list_posts',
    {
      description: 'List Instagram posts with their latest analytics snapshot. Sortable by any per-video metric (reach, views, likes, comments, shares, saved, total_interactions, follows, profile_visits, reposts, ig_reels_avg_watch_time, ig_reels_video_view_total_time, reels_skip_rate). NOTE: "follows" and "profile_visits" are only ever populated for FEED/Story posts — Instagram\'s Graph API does not expose per-post follow attribution for Reels at all (confirmed via direct API testing, not a bug here). For Reels, approximate "did this post drive follows" by cross-referencing each post\'s postedAt against get_account_insights\' daily follower_count snapshots — look for follower jumps in the days after a post went out.',
      inputSchema: {
        sortBy: z.string().optional().describe('Metric to sort by, e.g. "reach", "saved", "follows". Defaults to most recent first.'),
        order: z.enum(['asc', 'desc']).optional(),
        mediaType: z.string().optional().describe('Filter by media_type: IMAGE, VIDEO, or CAROUSEL_ALBUM'),
        dateFrom: z.string().optional().describe('ISO date — only posts on/after this date'),
        dateTo: z.string().optional().describe('ISO date — only posts on/before this date'),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => textContent(listMediaWithLatestInsights(args))
  );

  server.registerTool(
    'get_post',
    {
      description: 'Get full detail for a single Instagram post: complete metrics history (every fetch over time), caption, permalink, and — if downloaded — the full transcript and shot list. Use this for per-video hook/performance analysis.',
      inputSchema: {
        id: z.string().describe('The Instagram media id (from list_posts or search_transcripts)'),
      },
    },
    async ({ id }) => {
      const media = getMedia(id);
      if (!media) return textContent({ error: 'Post not found' });
      const history = getMediaInsightHistory(id);
      let transcript = null;
      let shots = null;
      let title = null;
      if (media.manifest_id) {
        try {
          const manifest = await readManifest(media.manifest_id);
          transcript = manifest.transcript || null;
          shots = (manifest.shots || []).map((s) => ({ id: s.id, timestamp: s.timestamp, isHero: s.isHero, label: s.label }));
          title = manifest.title || null;
        } catch { /* not downloaded yet */ }
      }
      return textContent({
        id: media.id,
        permalink: media.permalink,
        caption: media.caption,
        title,
        mediaType: media.media_type,
        mediaProductType: media.media_product_type,
        postedAt: media.posted_at,
        metricsHistory: history,
        transcript,
        shots,
      });
    }
  );

  server.registerTool(
    'search_transcripts',
    {
      description: 'Search transcripts of downloaded Instagram posts for a phrase (case-insensitive substring match). Returns each matching post with the matched snippet and its current metrics — use this to test hypotheses like "do posts that open with a question get more saves?"',
      inputSchema: {
        query: z.string().describe('Phrase or word to search for in transcripts'),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async ({ query, limit = 50 }) => {
      const mediaList = listAllMediaWithManifests();
      const metricsByMedia = new Map(listMediaWithLatestInsights({}).map((m) => [m.id, m.latestMetrics]));
      const q = query.toLowerCase();
      const results = [];
      for (const media of mediaList) {
        if (results.length >= limit) break;
        let manifest;
        try { manifest = await readManifest(media.manifest_id); } catch { continue; }
        const text = manifest.transcript?.text;
        if (!text || !text.toLowerCase().includes(q)) continue;
        const idx = text.toLowerCase().indexOf(q);
        const snippet = text.slice(Math.max(0, idx - 60), idx + q.length + 60).trim();
        results.push({
          id: media.id,
          permalink: media.permalink,
          caption: media.caption,
          postedAt: media.posted_at,
          snippet,
          latestMetrics: metricsByMedia.get(media.id) || null,
        });
      }
      return textContent(results);
    }
  );

  server.registerTool(
    'get_account_insights',
    {
      description: 'Get daily account-level Instagram insight snapshots (reach, accounts_engaged, followers_count) over a date range, for tracking overall growth trends. Since Reels have no per-post follows metric, this is also the primary tool for approximating follow attribution: compare followers_count just before vs. in the days after a given post\'s postedAt (from list_posts/get_post) to estimate whether that post drove growth. This is an approximation, not exact per-post attribution — say so when reporting results.',
      inputSchema: {
        dateFrom: z.string().optional().describe('ISO date'),
        dateTo: z.string().optional().describe('ISO date'),
      },
    },
    async (args) => textContent(listAccountInsights(args))
  );
}

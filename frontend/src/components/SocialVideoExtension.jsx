import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useEffect, useState } from 'react';
import { submitVideo, getVideo, frameFileUrl, retryVideo, refreshVideoStats } from '../api.js';

// Status polling for a single video
function useVideoStatus(videoId) {
  const [video, setVideo] = useState(null);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    async function poll() {
      try {
        const v = await getVideo(videoId);
        if (!cancelled) {
          setVideo(v);
          if (v.status === 'pending' || v.status === 'processing') {
            setTimeout(poll, 3000);
          }
        }
      } catch {
        if (!cancelled) setTimeout(poll, 5000);
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [videoId]);

  async function refetch() {
    if (!videoId) return;
    try {
      const v = await getVideo(videoId);
      setVideo(v);
    } catch {
      // ignore
    }
  }

  return { video, refetch };
}

function SocialVideoBlockView({ node, updateAttributes, extension }) {
  const { url, videoId, platform, status: nodeStatus } = node.attrs;
  const { video, refetch } = useVideoStatus(videoId);
  const [retrying, setRetrying] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);

  const heroFrame = video?.shots?.length > 0
    ? (video.shots.find((s) => s.id === video.heroShotId) || video.shots[0])?.frameFile
    : null;
  const thumbSrc = heroFrame && videoId ? frameFileUrl(videoId, heroFrame) : null;

  const displayStatus = video?.status || nodeStatus || 'loading';
  const platformLabel = platform === 'instagram' ? 'IG' : platform === 'tiktok' ? 'TT' : '?';

  function handleClick(e) {
    e.preventDefault();
    if (videoId && extension.options.onVideoClick) {
      extension.options.onVideoClick(videoId);
    }
  }

  function handleOpenUrl(e) {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleRetry(e) {
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      if (videoId) {
        await retryVideo(videoId);
      } else {
        // No videoId — original submitVideo never resolved; re-submit and patch node
        const { id: newVideoId } = await submitVideo(url);
        updateAttributes({ videoId: newVideoId, status: 'pending' });
      }
    } catch {
      // ignore — polling will pick up new status
    } finally {
      setRetrying(false);
    }
  }

  async function handleRefreshStats(e) {
    e.stopPropagation();
    if (statsRefreshing || !videoId) return;
    setStatsRefreshing(true);
    try {
      await refreshVideoStats(videoId);
      await refetch();
    } catch {
      // ignore
    } finally {
      setStatsRefreshing(false);
    }
  }

  return (
    <NodeViewWrapper>
      <div
        contentEditable={false}
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          border: 'var(--border)',
          background: 'var(--color-white)',
          cursor: videoId ? 'pointer' : 'default',
          userSelect: 'none',
          margin: '4px 0',
          transition: 'background 0.1s',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => { if (videoId) e.currentTarget.style.background = '#f9f9f9'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-white)'; }}
      >
        {/* Thumbnail — flex container stretches to card height; img fills via flex */}
        <div style={{
          width: '60px',
          flexShrink: 0,
          alignSelf: 'stretch',
          overflow: 'hidden',
          display: 'flex',
          background: '#e0e0e0',
        }}>
          {thumbSrc ? (
            <img src={thumbSrc} alt="" style={{
              flex: '1 0 0',
              minWidth: '100%',
              objectFit: 'cover',
              display: 'block',
            }} />
          ) : (
            <div style={{
              flex: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', color: '#999',
            }}>
              {displayStatus === 'loading' || displayStatus === 'pending' || displayStatus === 'processing'
                ? '…'
                : displayStatus === 'error' ? '!' : '▶'}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: 'var(--color-black)',
              color: 'var(--color-white)',
              padding: '1px 5px',
            }}>
              {platformLabel}
            </span>
            <span className={`badge ${displayStatus}`} style={{ fontSize: '7px' }}>
              {displayStatus}
            </span>
          </div>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: '2px',
          }}>
            {video?.title || (video?.accountUsername ? `@${video.accountUsername}` : '')}
          </p>
          <p className="label" style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span title={url} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {url.length > 50 ? url.slice(0, 50) + '…' : url}
            </span>
            <button
              onClick={handleOpenUrl}
              title="Open original URL"
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                padding: '0 2px',
                cursor: 'pointer',
                color: 'var(--color-muted)',
                fontSize: '9px',
                lineHeight: 1,
                fontFamily: 'var(--font-mono)',
              }}
            >↗</button>
          </p>
          {video?.stats?.viewCount != null && (
            <p className="label" style={{ fontSize: '8px', marginTop: '2px' }}>
              {Number(video.stats.viewCount).toLocaleString()} views
              {video.stats.likeCount != null && ` · ${Number(video.stats.likeCount).toLocaleString()} likes`}
            </p>
          )}
          {video?.statsError === true && video?.stats?.viewCount == null && videoId && (
            <button
              onClick={handleRefreshStats}
              disabled={statsRefreshing}
              style={{
                marginTop: '4px',
                background: 'none',
                border: '1px solid var(--color-border)',
                padding: '2px 6px',
                cursor: statsRefreshing ? 'default' : 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: '7px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
              }}
            >
              {statsRefreshing ? '…' : '↻ stats'}
            </button>
          )}
          {(video?.annotationCount ?? 0) > 0 && (
            <p className="label" style={{ fontSize: '8px', marginTop: '2px' }}>
              {video.annotationCount} &#9998;
            </p>
          )}
          {(!videoId || displayStatus === 'error' || displayStatus === 'not_video') && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              style={{
                marginTop: '4px',
                background: 'none',
                border: '1px solid var(--color-border)',
                padding: '2px 6px',
                cursor: retrying ? 'default' : 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: '7px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
              }}
            >
              {retrying ? '…' : '↻ Retry'}
            </button>
          )}
        </div>

        {videoId && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '8px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            flexShrink: 0,
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
          }}>
            Open ›
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const SocialVideoBlock = Node.create({
  name: 'socialVideoBlock',
  group: 'block',
  atom: true,

  addOptions() {
    return {
      onVideoClick: null,
    };
  },

  addAttributes() {
    return {
      url: { default: null },
      videoId: { default: null },
      platform: { default: null },
      status: { default: 'loading' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-social-video]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-social-video': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SocialVideoBlockView);
  },
});

/**
 * Detect if a pasted string is a social video URL and return platform or null.
 */
export function detectSocialPlatform(text) {
  const trimmed = text.trim();
  // Reject multi-token strings — the WHATWG URL parser silently strips newlines,
  // which causes "url1\nurl2" to parse as a single (malformed) URL.
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'instagram.com') {
      // Must be a post/reel, not a profile
      if (/\/(p|reel|reels|tv)\//i.test(u.pathname)) return 'instagram';
    }
    if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 't.tiktok.com' || host === 'vt.tiktok.com') {
      // Short-link domains (vm/t/vt) are always video links; tiktok.com must have /video/ in path
      if (host !== 'tiktok.com' || /\/video\//i.test(u.pathname)) return 'tiktok';
    }
  } catch {
    // not a URL
  }
  return null;
}

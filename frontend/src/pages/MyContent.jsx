import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMetaStatus,
  metaOauthStartUrl,
  disconnectMeta,
  startAnalyticsSync,
  getAnalyticsSyncStatus,
  cancelAnalyticsSync,
  listAnalyticsPosts,
  frameFileUrl,
} from '../api.js';

const SORT_OPTIONS = [
  { key: '', label: 'Latest' },
  { key: 'reach', label: 'Top Reach' },
  { key: 'saved', label: 'Top Saves' },
  { key: 'shares', label: 'Top Shares' },
  { key: 'follows', label: 'Top Follows' },
];

function formatMetric(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function PostCard({ post }) {
  const thumbSrc = post.heroFrame
    ? frameFileUrl(post.manifestId, post.heroFrame)
    : post.thumbnailUrl || null;
  const m = post.latestMetrics || {};
  const linkTo = post.manifestId ? `/video/${post.manifestId}` : null;

  const content = (
    <>
      <div style={{ aspectRatio: '9/16', background: '#e0e0e0', overflow: 'hidden' }}>
        {thumbSrc && <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{
        position: 'absolute', top: '6px', left: '6px',
        background: 'rgba(0,0,0,0.75)', color: '#fff',
        fontFamily: 'var(--font-mono)', fontSize: '7px', fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 5px',
      }}>
        {post.media_product_type || post.media_type}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginBottom: '3px',
        }}>
          {post.title || post.caption?.slice(0, 60) || '—'}
        </p>
        <p className="label">{formatMetric(m.reach)} reach · {formatMetric(m.saved)} saves</p>
        <p className="label">{formatMetric(m.shares)} shares · {formatMetric(m.follows)} follows</p>
        {!post.manifestId && <p className="label" style={{ color: '#c00' }}>Downloading…</p>}
      </div>
    </>
  );

  const style = {
    display: 'block', border: 'var(--border)', background: 'var(--color-white)',
    textDecoration: 'none', color: 'inherit', overflow: 'hidden', position: 'relative',
  };

  return linkTo ? <Link to={linkTo} style={style}>{content}</Link> : <div style={style}>{content}</div>;
}

export default function MyContent() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [sortBy, setSortBy] = useState('');
  const [syncJob, setSyncJob] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    getMetaStatus().then(setStatus).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function fetchPosts() {
    if (!status?.connected) return;
    setPostsLoading(true);
    try {
      const data = await listAnalyticsPosts({ sortBy: sortBy || undefined, order: 'desc' });
      setPosts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setPostsLoading(false);
    }
  }

  useEffect(() => { fetchPosts(); }, [status?.connected, sortBy]);

  // Poll sync job every 2s while running — same pattern as AccountDetail.jsx
  useEffect(() => {
    if (!syncJob?.jobId || syncJob.status === 'done' || syncJob.status === 'error' || syncJob.status === 'cancelled') {
      clearInterval(pollRef.current);
      return;
    }
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const updated = await getAnalyticsSyncStatus(syncJob.jobId);
        setSyncJob((prev) => ({ ...prev, ...updated }));
        if (updated.status === 'done' || updated.status === 'error' || updated.status === 'cancelled') {
          clearInterval(pollRef.current);
          fetchPosts();
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [syncJob?.jobId, syncJob?.status]);

  async function handleSync(full) {
    try {
      const { jobId } = await startAnalyticsSync({ full });
      setSyncJob({ jobId, status: 'running', phase: 'listing', total: 0, done: 0, queued: 0, skipped: 0, error: null });
    } catch (err) {
      setSyncJob({ status: 'error', error: err.message });
    }
  }

  async function handleCancelSync() {
    if (!syncJob?.jobId) return;
    try {
      await cancelAnalyticsSync(syncJob.jobId);
      setSyncJob((prev) => ({ ...prev, status: 'cancelled' }));
    } catch { /* ignore */ }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect your Instagram account? Existing posts/insights stay saved.')) return;
    await disconnectMeta();
    setStatus({ connected: false });
  }

  if (loading) return <div style={{ padding: '40px 24px' }}><p className="label">Loading…</p></div>;

  if (!status?.connected) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
          My Content
        </h2>
        <p className="label" style={{ marginBottom: '20px' }}>
          Connect your Instagram Business/Creator account (via its linked Facebook Page) to pull real analytics —
          reach, saves, shares, follows, watch time — for every post.
        </p>
        <a href={metaOauthStartUrl} className="primary" style={{ display: 'inline-block', textDecoration: 'none', padding: '8px 18px' }}>
          Connect Instagram
        </a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{
        background: 'var(--color-white)', borderBottom: 'var(--border)',
        padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          @{status.igUsername}
        </span>
        <span className="label">via {status.pageName}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {(!syncJob || syncJob.status !== 'running') && (
            <button className="primary" onClick={() => handleSync(false)}>Sync Now</button>
          )}
          {syncJob?.status === 'running' && <button onClick={handleCancelSync}>Cancel</button>}
          <button onClick={handleDisconnect}>Disconnect</button>
        </div>
      </div>

      {syncJob && (
        <div style={{ padding: '10px 24px', borderBottom: 'var(--border)', background: 'var(--color-white)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-muted)', lineHeight: '1.7' }}>
            {syncJob.status === 'running' && syncJob.phase === 'listing' && <p>Listing posts…</p>}
            {syncJob.status === 'running' && syncJob.phase === 'syncing' && (
              <p>{syncJob.done}/{syncJob.total} · {syncJob.queued} new · {syncJob.skipped} refreshed</p>
            )}
            {syncJob.status === 'done' && (
              <p style={{ color: 'green' }}>Done — {syncJob.queued} new, {syncJob.skipped} refreshed</p>
            )}
            {syncJob.status === 'error' && <p style={{ color: '#c00' }}>Error: {syncJob.error}</p>}
            {syncJob.status === 'running' && syncJob.total > 0 && (
              <div style={{ marginTop: '6px', height: '3px', background: '#e0e0e0', width: '100%', maxWidth: '400px' }}>
                <div style={{ height: '100%', background: 'var(--color-black)', width: `${Math.round((syncJob.done / syncJob.total) * 100)}%`, transition: 'width 0.3s' }} />
              </div>
            )}
          </div>
        </div>
      )}

      <main style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
            Posts · {posts.length}
          </h2>
          <div style={{ display: 'flex', gap: '2px' }}>
            {SORT_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                style={{
                  background: sortBy === key ? 'var(--color-black)' : 'transparent',
                  color: sortBy === key ? 'var(--color-white)' : 'var(--color-black)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {postsLoading && <p className="label">Loading…</p>}
        {!postsLoading && posts.length === 0 && (
          <p className="label">No posts yet — click "Sync Now" to pull your Instagram history.</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '2px' }}>
          {posts.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      </main>
    </div>
  );
}

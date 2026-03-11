import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getAccount, getAccountLive, updateAccount, submitVideo, frameFileUrl, syncAccount, getSyncStatus, cancelSync } from '../api.js';

const TYPE_OPTIONS = ['brand', 'creator', 'agency', 'media', 'personal'];

function formatViews(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function SavedVideoCard({ video }) {
  const heroFrame = video.heroFrame;
  const thumbSrc = heroFrame ? frameFileUrl(video.id, heroFrame) : null;
  return (
    <Link to={`/video/${video.id}`} style={{
      display: 'block', border: 'var(--border)', background: 'var(--color-white)',
      textDecoration: 'none', color: 'inherit', overflow: 'hidden', position: 'relative',
    }}>
      <div style={{ aspectRatio: '9/16', background: '#e0e0e0', overflow: 'hidden' }}>
        {thumbSrc && (
          <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>
      {video.isCollab && (
        <div style={{
          position: 'absolute', top: '6px', left: '6px',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontFamily: 'var(--font-mono)', fontSize: '7px', fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          padding: '2px 5px',
        }}>
          COLLAB
        </div>
      )}
      <div style={{ padding: '8px 10px' }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginBottom: '3px',
        }}>
          {video.title || video.platform?.toUpperCase() || 'Video'}
        </p>
        {video.isCollab && video.collaborators?.length > 0 && (
          <p className="label" style={{ marginBottom: '2px' }}>w/ {video.collaborators.join(', ')}</p>
        )}
        {video.stats?.viewCount != null && (
          <p className="label">{formatViews(video.stats.viewCount)} views</p>
        )}
        <p className="label">{video.shotCount} shots</p>
      </div>
    </Link>
  );
}

/**
 * Lightbox showing a native IG or TikTok embed iframe.
 * Nothing is downloaded — this is the platform's own embed player.
 */
function EmbedLightbox({ video, platform, onClose, onSave, saving }) {
  // Build embed URL from webpage URL
  const embedSrc = React.useMemo(() => {
    try {
      const u = new URL(video.webpageUrl);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'instagram.com') {
        // Extract post code: /p/CODE or /reel/CODE
        const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        if (m) return `https://www.instagram.com/p/${m[2]}/embed/`;
      }
      if (host === 'tiktok.com') {
        // Extract video ID: /@user/video/ID
        const m = u.pathname.match(/\/video\/(\d+)/);
        if (m) return `https://www.tiktok.com/embed/v2/${m[1]}`;
      }
    } catch { /* ignore */ }
    return null;
  }, [video.webpageUrl]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400 }}
      />
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 401,
        background: 'var(--color-white)',
        border: 'var(--border)',
        width: '380px',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '92vh',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '10px 14px',
          borderBottom: 'var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '260px',
            }}>
              {video.title || platform?.toUpperCase()}
            </p>
            <p className="label">{formatViews(video.stats?.viewCount)} views</p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              onClick={() => onSave(video.webpageUrl)}
              disabled={saving}
              className={saving ? '' : 'primary'}
            >
              {saving ? 'Saving…' : '+ Save'}
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '18px', padding: '0 4px' }}>×</button>
          </div>
        </div>

        {/* Embed */}
        <div style={{ flex: 1, overflow: 'hidden', background: '#000', minHeight: '200px' }}>
          {embedSrc ? (
            <iframe
              src={embedSrc}
              style={{ width: '100%', height: '100%', minHeight: '560px', border: 'none', display: 'block' }}
              allowFullScreen
              allow="autoplay; encrypted-media"
              scrolling="no"
            />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '300px', flexDirection: 'column', gap: '12px',
            }}>
              <p className="label">Can't embed this video</p>
              <a
                href={video.webpageUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#fff', letterSpacing: '0.06em' }}
              >
                Open on {platform} ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LiveVideoCard({ video, platform, onSave, saving, onPreview }) {
  const uploadDate = video.uploadDate
    ? `${video.uploadDate.slice(0, 4)}-${video.uploadDate.slice(4, 6)}-${video.uploadDate.slice(6)}`
    : null;

  return (
    <div style={{
      border: 'var(--border)', background: 'var(--color-white)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Thumbnail — clickable to preview */}
      <div
        onClick={() => onPreview(video)}
        style={{ aspectRatio: '9/16', background: '#e0e0e0', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
      >
        {video.thumbnailUrl && (
          <img
            src={video.thumbnailUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.19)' }}
          />
        )}
        {/* Play icon overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', paddingLeft: '2px',
          }}>
            ▶
          </div>
        </div>
      </div>
      <div style={{ padding: '8px 10px', flex: 1 }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginBottom: '3px',
        }}>
          {video.title || '—'}
        </p>
        <p className="label">{formatViews(video.stats?.viewCount)} views</p>
        {uploadDate && <p className="label">{uploadDate}</p>}
      </div>
      <button
        onClick={() => onSave(video.webpageUrl)}
        disabled={saving}
        style={{
          border: 'none', borderTop: 'var(--border)',
          padding: '7px', fontSize: '8px', fontFamily: 'var(--font-mono)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
          background: saving ? '#f0f0f0' : 'var(--color-white)',
          cursor: saving ? 'default' : 'pointer',
          color: saving ? 'var(--color-muted)' : 'var(--color-black)',
        }}
      >
        {saving ? 'Saving…' : '+ Save'}
      </button>
    </div>
  );
}

export default function AccountDetail() {
  const { id } = useParams();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [livePlatform, setLivePlatform] = useState('instagram');
  const [liveSort, setLiveSort] = useState('date');
  const [savingUrl, setSavingUrl] = useState(null);
  const [previewVideo, setPreviewVideo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [collabFilter, setCollabFilter] = useState('all'); // 'all' | 'original' | 'collab'
  const [syncPlatform, setSyncPlatform] = useState('instagram');
  const [syncJob, setSyncJob] = useState(null); // { jobId, status, phase, total, done, queued, skipped, error }
  const syncPollRef = useRef(null);

  useEffect(() => {
    getAccount(id).then((a) => {
      setAccount(a);
      setEditFields({
        display_name: a.display_name || '',
        ig_username: a.ig_username || '',
        tt_username: a.tt_username || '',
        type_tag: a.type_tag || '',
        tags: (a.tags || []).join(', '),
      });
      const defaultPlatform = a.ig_username ? 'instagram' : 'tiktok';
      setLivePlatform(defaultPlatform);
      setSyncPlatform(defaultPlatform);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  // Poll sync job status every 2 s while running
  useEffect(() => {
    if (!syncJob?.jobId || syncJob.status === 'done' || syncJob.status === 'error' || syncJob.status === 'cancelled') {
      clearInterval(syncPollRef.current);
      return;
    }
    clearInterval(syncPollRef.current);
    syncPollRef.current = setInterval(async () => {
      try {
        const updated = await getSyncStatus(id, syncJob.jobId);
        setSyncJob((prev) => ({ ...prev, ...updated }));
        if (updated.status === 'done' || updated.status === 'error' || updated.status === 'cancelled') {
          clearInterval(syncPollRef.current);
          // Refresh account data to show newly queued videos
          getAccount(id).then(setAccount).catch(() => {});
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
    return () => clearInterval(syncPollRef.current);
  }, [syncJob?.jobId, syncJob?.status, id]);

  async function handleStartSync() {
    try {
      const { jobId } = await syncAccount(id, syncPlatform);
      setSyncJob({ jobId, status: 'running', phase: 'listing', total: 0, done: 0, queued: 0, skipped: 0, error: null });
    } catch (err) {
      setSyncJob({ status: 'error', error: err.message });
    }
  }

  async function handleCancelSync() {
    if (!syncJob?.jobId) return;
    try {
      await cancelSync(id, syncJob.jobId);
      setSyncJob((prev) => ({ ...prev, status: 'cancelled' }));
    } catch { /* ignore */ }
  }

  async function fetchLive() {
    setLiveLoading(true);
    setLiveError('');
    try {
      const data = await getAccountLive(id, { platform: livePlatform, sort: liveSort, limit: 20 });
      setLiveData(data);
    } catch (err) {
      setLiveError(err.message);
    } finally {
      setLiveLoading(false);
    }
  }

  async function handleSaveVideo(url) {
    setSavingUrl(url);
    try {
      await submitVideo(url);
      // Refresh account to update saved video count
      const updated = await getAccount(id);
      setAccount(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingUrl(null);
    }
  }

  async function handleSaveEdit() {
    const tags = editFields.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const updated = await updateAccount(id, {
      display_name: editFields.display_name || null,
      ig_username: editFields.ig_username || null,
      tt_username: editFields.tt_username || null,
      type_tag: editFields.type_tag || null,
      tags,
    });
    setAccount((prev) => ({ ...prev, ...updated, tags }));
    setEditing(false);
  }

  if (loading) return <div style={{ padding: '40px 24px' }}><p className="label">Loading…</p></div>;
  if (!account) return <div style={{ padding: '40px 24px' }}><p className="label">Account not found</p></div>;

  const platforms = [
    account.ig_username && { key: 'instagram', label: 'IG' },
    account.tt_username && { key: 'tiktok', label: 'TT' },
  ].filter(Boolean);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--color-white)', borderBottom: 'var(--border)',
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <Link to="/accounts" style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.06em',
          textTransform: 'uppercase', color: 'var(--color-muted)', textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}>
          ← Accounts
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              @{account.username}
            </span>
            {account.type_tag && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '0.06em',
                textTransform: 'uppercase', padding: '1px 6px', border: 'var(--border)',
                color: 'var(--color-muted)',
              }}>
                {account.type_tag}
              </span>
            )}
            {platforms.map(({ key, label }) => (
              <span key={key} style={{
                fontFamily: 'var(--font-mono)', fontSize: '8px', padding: '1px 5px',
                background: 'var(--color-black)', color: 'var(--color-white)', letterSpacing: '0.06em',
              }}>
                {label}
              </span>
            ))}
          </div>
          {account.display_name && (
            <p style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '2px' }}>
              {account.display_name}
            </p>
          )}
        </div>
        <button onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {/* Edit panel */}
      {editing && (
        <div style={{
          background: 'var(--color-white)', borderBottom: 'var(--border)',
          padding: '16px 24px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', maxWidth: '720px' }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>Display Name</label>
              <input value={editFields.display_name} onChange={(e) => setEditFields((f) => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>IG Username</label>
              <input value={editFields.ig_username} onChange={(e) => setEditFields((f) => ({ ...f, ig_username: e.target.value }))} />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>TT Username</label>
              <input value={editFields.tt_username} onChange={(e) => setEditFields((f) => ({ ...f, tt_username: e.target.value }))} />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: '4px' }}>Tags (comma separated)</label>
              <input value={editFields.tags} onChange={(e) => setEditFields((f) => ({ ...f, tags: e.target.value }))} placeholder="tag1, tag2" />
            </div>
          </div>
          <div style={{ marginTop: '12px' }}>
            <label className="label" style={{ display: 'block', marginBottom: '6px' }}>Type</label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEditFields((f) => ({ ...f, type_tag: f.type_tag === t ? '' : t }))}
                  style={{
                    background: editFields.type_tag === t ? 'var(--color-black)' : 'transparent',
                    color: editFields.type_tag === t ? 'var(--color-white)' : 'var(--color-black)',
                    border: 'var(--border)', padding: '4px 10px',
                    fontSize: '9px', letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <button className="primary" onClick={handleSaveEdit}>Save Changes</button>
          </div>
        </div>
      )}

      <main style={{ padding: '24px' }}>
        {/* Saved videos */}
        {account.savedVideos?.length > 0 && (
          <section style={{ marginBottom: '40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <h2 style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)',
              }}>
                Saved · {account.savedVideos.length}
              </h2>
              {/* Collab filter */}
              <div style={{ display: 'flex', gap: '2px' }}>
                {[['all', 'All'], ['original', 'Original'], ['collab', 'Collab']].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setCollabFilter(val)}
                    style={{
                      background: collabFilter === val ? 'var(--color-black)' : 'transparent',
                      color: collabFilter === val ? 'var(--color-white)' : 'var(--color-black)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '2px',
            }}>
              {account.savedVideos
                .filter((v) => {
                  if (collabFilter === 'collab') return v.isCollab;
                  if (collabFilter === 'original') return !v.isCollab;
                  return true;
                })
                .map((v) => <SavedVideoCard key={v.id} video={v} />)}
            </div>
          </section>
        )}

        {/* Sync All section */}
        <section style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <h2 style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)',
            }}>
              Sync All Videos
            </h2>
            {/* Platform picker */}
            <div style={{ display: 'flex', gap: '2px' }}>
              {platforms.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSyncPlatform(key)}
                  disabled={syncJob?.status === 'running'}
                  style={{
                    background: syncPlatform === key ? 'var(--color-black)' : 'transparent',
                    color: syncPlatform === key ? 'var(--color-white)' : 'var(--color-black)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {(!syncJob || syncJob.status === 'done' || syncJob.status === 'error' || syncJob.status === 'cancelled') && (
              <button className="primary" onClick={handleStartSync}>
                Sync All
              </button>
            )}
            {syncJob?.status === 'running' && (
              <button onClick={handleCancelSync}>Cancel</button>
            )}
          </div>

          {/* Progress */}
          {syncJob && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-muted)', lineHeight: '1.7' }}>
              {syncJob.status === 'running' && syncJob.phase === 'listing' && (
                <p>Listing videos…</p>
              )}
              {syncJob.status === 'running' && syncJob.phase === 'syncing' && (
                <p>
                  {syncJob.done}/{syncJob.total} &nbsp;·&nbsp;
                  {syncJob.queued} queued &nbsp;·&nbsp;
                  {syncJob.skipped} already saved
                </p>
              )}
              {syncJob.status === 'done' && (
                <p style={{ color: 'green' }}>
                  Done — {syncJob.queued} queued for download, {syncJob.skipped} already saved
                </p>
              )}
              {syncJob.status === 'cancelled' && (
                <p>Cancelled — {syncJob.queued} queued, {syncJob.skipped} already saved</p>
              )}
              {syncJob.status === 'error' && (
                <p style={{ color: '#c00' }}>Error: {syncJob.error}</p>
              )}
              {/* Progress bar */}
              {syncJob.status === 'running' && syncJob.total > 0 && (
                <div style={{ marginTop: '6px', height: '3px', background: '#e0e0e0', width: '100%', maxWidth: '400px' }}>
                  <div style={{
                    height: '100%',
                    background: 'var(--color-black)',
                    width: `${Math.round((syncJob.done / syncJob.total) * 100)}%`,
                    transition: 'width 0.3s',
                  }} />
                </div>
              )}
            </div>
          )}

          {!syncJob && (
            <p className="label">
              Pulls every video from this creator's profile — oldest to newest. New videos are queued for download automatically.
              Uses the scraper IG account to protect your main.
            </p>
          )}
        </section>

        {/* Live fetch */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <h2 style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)',
            }}>
              Live Videos
            </h2>
            <div style={{ display: 'flex', gap: '2px' }}>
              {platforms.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLivePlatform(key)}
                  style={{
                    background: livePlatform === key ? 'var(--color-black)' : 'transparent',
                    color: livePlatform === key ? 'var(--color-white)' : 'var(--color-black)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '2px' }}>
              {['date', 'views'].map((s) => (
                <button
                  key={s}
                  onClick={() => setLiveSort(s)}
                  style={{
                    background: liveSort === s ? 'var(--color-black)' : 'transparent',
                    color: liveSort === s ? 'var(--color-white)' : 'var(--color-black)',
                  }}
                >
                  {s === 'date' ? 'Latest' : 'Top'}
                </button>
              ))}
            </div>
            <button className="primary" onClick={fetchLive} disabled={liveLoading}>
              {liveLoading ? 'Fetching…' : 'Fetch Live'}
            </button>
          </div>

          {liveError && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#c00', marginBottom: '12px' }}>
              {liveError}
            </p>
          )}

          {!liveData && !liveLoading && (
            <p className="label">Click "Fetch Live" to load this account's videos — nothing is saved until you click + Save on a video.</p>
          )}

          {liveData?.videos?.length === 0 && (
            <p className="label">No videos found.</p>
          )}

          {liveData?.videos?.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '2px',
            }}>
              {liveData.videos.map((v) => (
                <LiveVideoCard
                  key={v.id}
                  video={v}
                  platform={livePlatform}
                  onSave={handleSaveVideo}
                  saving={savingUrl === v.webpageUrl}
                  onPreview={setPreviewVideo}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {previewVideo && (
        <EmbedLightbox
          video={previewVideo}
          platform={livePlatform}
          onClose={() => setPreviewVideo(null)}
          onSave={handleSaveVideo}
          saving={savingUrl === previewVideo.webpageUrl}
        />
      )}
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { listVideos, frameFileUrl, parseAccount, retryVideo } from '../api.js';
import AddVideoModal from '../components/AddVideoModal.jsx';
import VideoPane from '../components/VideoPane.jsx';

function VideoCard({ video, onRetry, onPlay }) {
  const [hovered, setHovered] = useState(false);
  const thumbSrc = video.heroFrame ? frameFileUrl(video.id, video.heroFrame) : null;
  const account = video.accountUsername
    ? `@${video.accountUsername}`
    : parseAccount(video.url);
  const displayTitle = video.title || account || video.platform?.toUpperCase() || 'VIDEO';
  const videoTags = video.tags || [];
  const canRetry = video.status === 'error' || video.status === 'processing';

  const date = new Date(video.downloadedAt).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
  });

  return (
    <div
      style={{ position: 'relative', border: 'var(--border)', overflow: 'hidden' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        to={`/video/${video.id}`}
        style={{ display: 'block', aspectRatio: '9/16', position: 'relative', overflow: 'hidden', background: '#ddd' }}
      >
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              // Scale up to crop 8% from top+bottom+sides — shows central 84%
              transform: 'scale(1.19)',
            }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: '8px',
          }}>
            <span className={`badge ${video.status}`}>{video.status}</span>
          </div>
        )}

        {/* Status badge — top left, only when there's a thumbnail */}
        {thumbSrc && (
          <div style={{ position: 'absolute', top: '8px', left: '8px' }}>
            <span className={`badge ${video.status}`} style={{ background: 'var(--color-white)' }}>
              {video.status}
            </span>
          </div>
        )}

        {/* Play button — shown on hover for ready videos */}
        {video.status === 'ready' && hovered && (
          <div
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlay(video.id); }}
            style={{
              position: 'absolute',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '44px', height: '44px',
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.65)',
              border: '1.5px solid rgba(255,255,255,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
            }}
          >
            <span style={{ color: '#fff', fontSize: '16px', marginLeft: '3px', lineHeight: 1 }}>▶</span>
          </div>
        )}

        {/* Bottom overlay — title + meta */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '28px 10px 10px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
          pointerEvents: 'none',
        }}>
          {/* Tags row */}
          {videoTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '5px' }}>
              {videoTags.map((tag) => (
                <span key={tag} style={{
                  fontFamily: 'var(--font-mono)', fontSize: '7px',
                  color: '#fff', background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  padding: '1px 5px', letterSpacing: '0.04em',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#fff',
            marginBottom: '3px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {displayTitle}
          </p>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '7px',
            letterSpacing: '0.04em',
            color: 'rgba(255,255,255,0.65)',
          }}>
            {video.shotCount} shots · {date}
            {video.stats?.viewCount != null && ` · ${Number(video.stats.viewCount).toLocaleString()} views`}
          </p>
        </div>
      </Link>

      {/* Retry button — outside the Link so it doesn't navigate */}
      {canRetry && (
        <button
          onClick={() => onRetry(video.id)}
          style={{
            position: 'absolute',
            top: '8px', right: '8px',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.3)',
            padding: '4px 9px',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
          title={video.status === 'error' ? `Error: ${video.error}` : 'Stuck? Retry'}
        >
          ↻ Retry
        </button>
      )}
    </div>
  );
}

export default function Library() {
  const [videos, setVideos] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewVideoId, setPreviewVideoId] = useState(null);

  const fetchVideos = useCallback(async () => {
    try {
      const data = await listVideos();
      setVideos(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  useEffect(() => {
    const hasPending = videos.some((v) => v.status === 'pending' || v.status === 'processing');
    if (!hasPending) return;
    const interval = setInterval(fetchVideos, 3000);
    return () => clearInterval(interval);
  }, [videos, fetchVideos]);

  function handleSuccess(newVideo) {
    setShowModal(false);
    setVideos((prev) => [{ ...newVideo, shotCount: 0, heroFrame: null }, ...prev]);
  }

  async function handleRetry(videoId) {
    try {
      await retryVideo(videoId);
      setVideos((prev) => prev.map((v) => v.id === videoId ? { ...v, status: 'pending', error: null } : v));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: 'var(--border)', background: 'var(--color-white)',
      }}>
        <span className="label">{videos.length} video{videos.length !== 1 ? 's' : ''}</span>
        <button className="primary" onClick={() => setShowModal(true)}>+ Add Video</button>
      </div>

      <main style={{ padding: '24px' }}>
        {loading && videos.length === 0 ? (
          <p className="label">Loading...</p>
        ) : videos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '12px', letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '24px',
            }}>
              No videos yet
            </p>
            <button className="primary" onClick={() => setShowModal(true)}>+ Add Your First Video</button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '2px',
          }}>
            {videos.map((v) => <VideoCard key={v.id} video={v} onRetry={handleRetry} onPlay={setPreviewVideoId} />)}
          </div>
        )}
      </main>

      {showModal && (
        <AddVideoModal onSuccess={handleSuccess} onClose={() => setShowModal(false)} />
      )}

      {previewVideoId && (
        <VideoPane videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />
      )}
    </div>
  );
}

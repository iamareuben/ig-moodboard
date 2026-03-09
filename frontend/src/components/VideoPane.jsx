import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getVideo, frameFileUrl, videoUrl, retryVideo, addAnnotation, deleteAnnotation } from '../api.js';

function StatBubble({ label, value }) {
  if (value == null) return null;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        lineHeight: 1.2,
      }}>
        {Number(value).toLocaleString()}
      </div>
      <div className="label" style={{ marginTop: '2px' }}>{label}</div>
    </div>
  );
}

function ShotStrip({ videoId, shots, heroShotId, videoRef }) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
      <div style={{ display: 'flex', gap: '2px', minWidth: 'min-content' }}>
        {shots.map((shot) => (
          <div
            key={shot.id}
            onClick={() => {
              if (videoRef?.current && shot.timestamp != null) {
                videoRef.current.currentTime = shot.timestamp;
                videoRef.current.play().catch(() => {});
              }
            }}
            style={{
              width: '54px',
              height: '96px',
              flexShrink: 0,
              background: '#e0e0e0',
              position: 'relative',
              outline: shot.id === heroShotId ? '2px solid var(--color-black)' : 'none',
              outlineOffset: '-2px',
              cursor: videoRef ? 'pointer' : 'default',
            }}
          >
            <img
              src={frameFileUrl(videoId, shot.frameFile)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            {shot.label && (
              <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.55)',
                padding: '2px 3px',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '7px',
                  color: '#fff',
                  letterSpacing: '0.04em',
                }}>
                  {shot.label}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VideoPane({ videoId, onClose }) {
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [annotationInput, setAnnotationInput] = useState('');
  const [addingAnnotation, setAddingAnnotation] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const videoRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!videoId) return;
    setLoading(true);
    setVideo(null);
    setSlideIndex(0);
    let cancelled = false;

    async function poll() {
      try {
        const v = await getVideo(videoId);
        if (!cancelled) {
          setVideo(v);
          setLoading(false);
          if (v.status === 'pending' || v.status === 'processing') {
            setTimeout(poll, 3000);
          }
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [videoId]);

  // Fetch annotations when pane opens
  useEffect(() => {
    if (!videoId) return;
    fetch(`/api/videos/${videoId}/annotations`)
      .then((r) => r.json())
      .then(setAnnotations)
      .catch(() => {});
  }, [videoId]);

  // Auto-play when video loads
  useEffect(() => {
    if (videoRef.current && video?.status === 'ready') {
      videoRef.current.play().catch(() => {});
    }
  }, [video?.status]);

  // Mute when tab is hidden, unmute when visible
  useEffect(() => {
    function handleVisibilityChange() {
      if (!videoRef.current) return;
      videoRef.current.muted = document.hidden;
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  async function handleAddAnnotation() {
    const content = annotationInput.trim();
    if (!content) return;
    setAddingAnnotation(true);
    try {
      const a = await addAnnotation(videoId, content);
      setAnnotations((prev) => [...prev, a]);
      setAnnotationInput('');
    } catch (err) {
      console.error(err);
    } finally {
      setAddingAnnotation(false);
    }
  }

  async function handleDeleteAnnotation(annotationId) {
    try {
      await deleteAnnotation(videoId, annotationId);
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryVideo(videoId);
      // Optimistically update status, polling will catch the real updates
      setVideo((v) => v ? { ...v, status: 'pending', error: null } : v);
    } catch (err) {
      console.error(err);
    } finally {
      setRetrying(false);
    }
  }

  const stats = video?.stats;
  const shots = video?.shots || [];
  const canRetry = video?.status === 'error' || video?.status === 'processing';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 200,
        }}
      />

      {/* Pane */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: '420px',
        background: 'var(--color-white)',
        borderLeft: 'var(--border)',
        zIndex: 201,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Pane header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: 'var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            {video && (
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '2px',
              }}>
                {video.title || (video.accountUsername ? `@${video.accountUsername}` : 'Video')}
              </p>
            )}
            <span className={`badge ${video?.status || 'pending'}`} style={{ fontSize: '7px' }}>
              {video?.status || 'loading'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {canRetry && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {retrying ? '…' : '↻ Retry'}
              </button>
            )}
            {video && (
              <Link
                to={`/video/${videoId}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '5px 10px',
                  border: 'var(--border)',
                  color: 'var(--color-black)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Open full →
              </Link>
            )}
            <button
              onClick={onClose}
              style={{
                border: 'none', background: 'transparent',
                fontSize: '20px', color: 'var(--color-muted)',
                padding: '0 4px', lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && !video && (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <p className="label">Loading…</p>
            </div>
          )}

          {video && (
            <>
              {/* Main media area */}
              {video.status === 'ready' && video.isCarousel ? (
                // Carousel slideshow
                <div style={{ position: 'relative', background: '#111', width: '100%' }}>
                  <img
                    src={frameFileUrl(videoId, shots[slideIndex]?.frameFile)}
                    alt={`Slide ${slideIndex + 1}`}
                    style={{
                      width: '100%',
                      maxHeight: '55vh',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                  {/* Prev / Next */}
                  {shots.length > 1 && (
                    <>
                      <button
                        onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                        disabled={slideIndex === 0}
                        style={{
                          position: 'absolute', left: '8px', top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'rgba(0,0,0,0.5)', color: '#fff',
                          border: 'none', borderRadius: '50%',
                          width: '32px', height: '32px', fontSize: '16px',
                          cursor: slideIndex === 0 ? 'default' : 'pointer',
                          opacity: slideIndex === 0 ? 0.3 : 0.85,
                          lineHeight: 1, padding: 0,
                        }}
                      >‹</button>
                      <button
                        onClick={() => setSlideIndex((i) => Math.min(shots.length - 1, i + 1))}
                        disabled={slideIndex === shots.length - 1}
                        style={{
                          position: 'absolute', right: '8px', top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'rgba(0,0,0,0.5)', color: '#fff',
                          border: 'none', borderRadius: '50%',
                          width: '32px', height: '32px', fontSize: '16px',
                          cursor: slideIndex === shots.length - 1 ? 'default' : 'pointer',
                          opacity: slideIndex === shots.length - 1 ? 0.3 : 0.85,
                          lineHeight: 1, padding: 0,
                        }}
                      >›</button>
                      <div style={{
                        position: 'absolute', bottom: '8px', left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.5)',
                        color: '#fff',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '9px',
                        letterSpacing: '0.06em',
                        padding: '2px 8px',
                      }}>
                        {slideIndex + 1} / {shots.length}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                // Video player (or status placeholder)
                <div style={{
                  aspectRatio: '9/16',
                  background: '#111',
                  width: '100%',
                  maxHeight: '55vh',
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                  {video.status === 'ready' ? (
                    <video
                      ref={videoRef}
                      src={videoUrl(videoId)}
                      controls
                      loop
                      playsInline
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexDirection: 'column', gap: '10px', padding: '16px',
                    }}>
                      <p className="label" style={{ textAlign: 'center' }}>
                        {video.status === 'error'
                          ? (video.error || 'Processing failed')
                          : video.status}
                      </p>
                      {canRetry && (
                        <button onClick={handleRetry} disabled={retrying}>
                          {retrying ? '…' : '↻ Retry'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Account + URL */}
              <div style={{ padding: '12px 16px', borderBottom: 'var(--border)' }}>
                {(video.accountUsername || (video.platform === 'instagram' && video.title?.match(/^Video by (.+)$/i))) && (() => {
                  const username = video.accountUsername
                    || video.title?.match(/^Video by (.+)$/i)?.[1]
                    || null;
                  const profileUrl = video.platform === 'instagram'
                    ? `https://www.instagram.com/${username}/`
                    : video.platform === 'tiktok' && username
                      ? `https://www.tiktok.com/@${username}`
                      : null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <p style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        margin: 0,
                      }}>
                        @{username}
                        {video.accountDisplayName && video.accountDisplayName !== username && (
                          <span style={{ fontWeight: 400, marginLeft: '6px', textTransform: 'none' }}>
                            {video.accountDisplayName}
                          </span>
                        )}
                      </p>
                      {profileUrl && (
                        <a
                          href={profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '8px',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: 'var(--color-black)',
                            border: 'var(--border)',
                            padding: '3px 7px',
                            textDecoration: 'none',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          ↗ {video.platform === 'instagram' ? 'IG' : 'TT'} Profile
                        </a>
                      )}
                    </div>
                  );
                })()}
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8px',
                    color: 'var(--color-muted)',
                    letterSpacing: '0.04em',
                    wordBreak: 'break-all',
                  }}
                >
                  {video.platform?.toUpperCase()} ↗
                </a>
              </div>

              {/* Stats */}
              {stats && Object.values(stats).some((v) => v != null) && (
                <div style={{
                  padding: '16px',
                  borderBottom: 'var(--border)',
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'space-around',
                }}>
                  <StatBubble label="Views" value={stats.viewCount} />
                  <StatBubble label="Likes" value={stats.likeCount} />
                  <StatBubble label="Comments" value={stats.commentCount} />
                  <StatBubble label="Shares" value={stats.shareCount} />
                </div>
              )}

              {/* Shot strip */}
              {shots.length > 0 && (
                <div style={{ padding: '12px 16px', borderBottom: 'var(--border)' }}>
                  <p className="label" style={{ marginBottom: '8px' }}>
                    {shots.length} shot{shots.length !== 1 ? 's' : ''}
                  </p>
                  <ShotStrip videoId={videoId} shots={shots} heroShotId={video.heroShotId} videoRef={video.isCarousel ? null : videoRef} />
                </div>
              )}

              {/* Backlinks */}
              {video.backlinks?.length > 0 && (
                <div style={{ padding: '12px 16px', borderBottom: 'var(--border)' }}>
                  <p className="label" style={{ marginBottom: '8px' }}>In notes</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {video.backlinks.map((note) => (
                      <Link
                        key={note.id}
                        to={`/notes/${note.id}`}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '9px',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '6px 10px',
                          border: 'var(--border)',
                          display: 'block',
                          color: 'var(--color-black)',
                          textDecoration: 'none',
                        }}
                      >
                        ↗ {note.title || 'Untitled'}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Annotations */}
              <div style={{ padding: '12px 16px' }}>
                <p className="label" style={{ marginBottom: '8px' }}>
                  Annotations{annotations.length > 0 ? ` (${annotations.length})` : ''}
                </p>
                {annotations.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                    {annotations.map((a) => (
                      <div key={a.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                        padding: '6px 10px', border: 'var(--border)', background: a.source === 'ig_collection' ? '#fafafa' : 'transparent',
                      }}>
                        <span style={{
                          flex: 1,
                          fontFamily: 'var(--font-mono)',
                          fontSize: '9px',
                          letterSpacing: '0.03em',
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}>
                          {a.source === 'ig_collection' && (
                            <span style={{ color: 'var(--color-muted)', marginRight: '4px' }}>[{a.source}]</span>
                          )}
                          {a.content}
                        </span>
                        <button
                          onClick={() => handleDeleteAnnotation(a.id)}
                          style={{
                            border: 'none', background: 'transparent',
                            color: 'var(--color-muted)', cursor: 'pointer',
                            fontSize: '14px', lineHeight: 1, padding: '0',
                            flexShrink: 0,
                          }}
                          title="Delete annotation"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={annotationInput}
                    onChange={(e) => setAnnotationInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddAnnotation(); }}
                    placeholder="Add annotation…"
                    style={{
                      flex: 1,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      letterSpacing: '0.03em',
                      padding: '6px 8px',
                      border: 'var(--border)',
                      background: 'var(--color-bg)',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleAddAnnotation}
                    disabled={addingAnnotation || !annotationInput.trim()}
                    style={{ flexShrink: 0 }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

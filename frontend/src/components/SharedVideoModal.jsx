import React, { useEffect, useState, useRef } from 'react';

/**
 * Video pane for shared notes — uses public /api/share endpoints,
 * no authentication required.
 */
export default function SharedVideoModal({ shareId, videoId, onClose }) {
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);
  const videoRef = useRef(null);

  const frameUrl = (frameFile) => `/api/share/${shareId}/media/${videoId}/${frameFile}`;
  const playUrl = `/api/share/${shareId}/play/${videoId}`;

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!videoId || !shareId) return;
    setLoading(true);
    setVideo(null);
    setSlideIndex(0);

    fetch(`/api/share/${shareId}/video/${videoId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((v) => { setVideo(v); setLoading(false); })
      .catch(() => setLoading(false));
  }, [shareId, videoId]);

  useEffect(() => {
    if (videoRef.current && video?.status === 'ready' && !video?.isCarousel) {
      videoRef.current.play().catch(() => {});
    }
  }, [video?.status]);

  const shots = video?.shots || [];
  const stats = video?.stats;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200 }}
      />

      {/* Pane */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: 'min(420px, 100vw)',
        background: 'var(--color-white)',
        borderLeft: 'var(--border)',
        zIndex: 201,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: 'var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1, paddingRight: '8px' }}>
            {video && (
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {video.title || (video.accountUsername ? `@${video.accountUsername}` : 'Video')}
              </p>
            )}
            {video?.url && (
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--color-muted)', letterSpacing: '0.04em' }}
              >
                {video.platform?.toUpperCase() || 'View original'} ↗
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', fontSize: '20px', color: 'var(--color-muted)', padding: '0 4px', lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-muted)' }}>
              Loading…
            </div>
          )}

          {video && (
            <>
              {/* Media area */}
              {video.isCarousel ? (
                <div style={{ position: 'relative', background: '#111', width: '100%' }}>
                  <img
                    src={frameUrl(shots[slideIndex]?.frameFile)}
                    alt={`Slide ${slideIndex + 1}`}
                    style={{ width: '100%', maxHeight: '55vh', objectFit: 'contain', display: 'block' }}
                  />
                  {shots.length > 1 && (
                    <>
                      <button
                        onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                        disabled={slideIndex === 0}
                        style={{
                          position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                          background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%',
                          width: '32px', height: '32px', fontSize: '16px', cursor: slideIndex === 0 ? 'default' : 'pointer',
                          opacity: slideIndex === 0 ? 0.3 : 0.85, lineHeight: 1, padding: 0,
                        }}
                      >‹</button>
                      <button
                        onClick={() => setSlideIndex((i) => Math.min(shots.length - 1, i + 1))}
                        disabled={slideIndex === shots.length - 1}
                        style={{
                          position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                          background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%',
                          width: '32px', height: '32px', fontSize: '16px', cursor: slideIndex === shots.length - 1 ? 'default' : 'pointer',
                          opacity: slideIndex === shots.length - 1 ? 0.3 : 0.85, lineHeight: 1, padding: 0,
                        }}
                      >›</button>
                      <div style={{
                        position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.5)', color: '#fff', fontFamily: 'var(--font-mono)',
                        fontSize: '9px', letterSpacing: '0.06em', padding: '2px 8px',
                      }}>
                        {slideIndex + 1} / {shots.length}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ aspectRatio: '9/16', background: '#111', width: '100%', maxHeight: '55vh', overflow: 'hidden' }}>
                  {video.status === 'ready' ? (
                    <video
                      ref={videoRef}
                      src={playUrl}
                      controls
                      loop
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#aaa' }}>{video.status}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Stats */}
              {stats && Object.values(stats).some((v) => v != null) && (
                <div style={{
                  padding: '16px', borderBottom: 'var(--border)',
                  display: 'flex', gap: '8px', justifyContent: 'space-around',
                }}>
                  {[['Views', stats.viewCount], ['Likes', stats.likeCount], ['Comments', stats.commentCount], ['Shares', stats.shareCount]].map(([label, val]) =>
                    val != null ? (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1.2 }}>
                          {Number(val).toLocaleString()}
                        </div>
                        <div className="label" style={{ marginTop: '2px' }}>{label}</div>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {/* Shot strip */}
              {shots.length > 0 && (
                <div style={{ padding: '12px 16px', borderBottom: 'var(--border)' }}>
                  <p className="label" style={{ marginBottom: '8px' }}>
                    {shots.length} shot{shots.length !== 1 ? 's' : ''}
                  </p>
                  <div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '2px', minWidth: 'min-content' }}>
                      {shots.map((shot) => (
                        <div
                          key={shot.id}
                          onClick={() => {
                            if (video.isCarousel) {
                              setSlideIndex(shots.indexOf(shot));
                            } else if (videoRef.current && shot.timestamp != null) {
                              videoRef.current.currentTime = shot.timestamp;
                              videoRef.current.play().catch(() => {});
                            }
                          }}
                          style={{
                            width: '54px', height: '96px', flexShrink: 0,
                            background: '#e0e0e0', position: 'relative',
                            outline: shot.id === video.heroShotId ? '2px solid var(--color-black)' : 'none',
                            outlineOffset: '-2px', cursor: 'pointer',
                          }}
                        >
                          <img
                            src={frameUrl(shot.frameFile)}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && !video && (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-muted)' }}>
              Could not load video.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

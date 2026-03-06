import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getVideo, updateVideo, addShot, updateShot, deleteShot, parseAccount, retryVideo, archiveVideo, listVideos, transcribeVideo } from '../api.js';
import ShotGrid from '../components/ShotGrid.jsx';
import CardPreview from '../components/CardPreview.jsx';
import ShotModal from '../components/ShotModal.jsx';
import TagInput from '../components/TagInput.jsx';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [siblings, setSiblings] = useState([]); // ordered list of video ids for prev/next
  const [activeShotIndex, setActiveShotIndex] = useState(null);
  const [showCard, setShowCard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [transcript, setTranscript] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState(null);

  const fetchVideo = useCallback(async () => {
    try {
      const data = await getVideo(id);
      setVideo(data);
      if (!titleEditing) setTitleValue(data.title || '');
      if (data.transcript && !transcript) {
        setTranscript(data.transcript);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id, titleEditing]);

  useEffect(() => { fetchVideo(); }, [fetchVideo]);

  useEffect(() => {
    listVideos()
      .then((all) => setSiblings(
        all.filter((v) => v.status !== 'not_video' && v.status !== 'archived').map((v) => v.id)
      ))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!video || video.status === 'ready' || video.status === 'error') return;
    const interval = setInterval(fetchVideo, 2000);
    return () => clearInterval(interval);
  }, [video, fetchVideo]);

  async function handleAddShot(timestamp) {
    try { await addShot(id, timestamp); await fetchVideo(); } catch (err) { console.error(err); }
  }

  async function handleSetHero(shotId) {
    try { await updateVideo(id, { heroShotId: shotId }); await fetchVideo(); } catch (err) { console.error(err); }
  }

  async function handleDeleteShot(shotId) {
    try { await deleteShot(id, shotId); await fetchVideo(); } catch (err) { console.error(err); }
  }

  async function handleLabelChange(shotId, label) {
    try { await updateShot(id, shotId, { label }); await fetchVideo(); } catch (err) { console.error(err); }
  }

  async function handleShotTagChange(shotId, tags) {
    try { await updateShot(id, shotId, { tags }); await fetchVideo(); } catch (err) { console.error(err); }
  }

  async function handleVideoTagChange(tags) {
    try { await updateVideo(id, { tags }); await fetchVideo(); } catch (err) { console.error(err); }
  }

  async function handleRetry() {
    try {
      await retryVideo(id);
      await fetchVideo();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this video? It will be hidden from the library.')) return;
    try {
      await archiveVideo(id);
      navigate('/');
    } catch (err) {
      console.error(err);
    }
  }

  async function handleTranscribe() {
    if (transcript) {
      setShowTranscript((v) => !v);
      return;
    }
    setTranscribing(true);
    setTranscriptError(null);
    setShowTranscript(true);
    try {
      const result = await transcribeVideo(id);
      setTranscript(result);
    } catch (err) {
      setTranscriptError(err.message);
    } finally {
      setTranscribing(false);
    }
  }

  async function handleTitleBlur() {
    setTitleEditing(false);
    if (video && titleValue !== video.title) {
      await updateVideo(id, { title: titleValue });
      await fetchVideo();
    }
  }

  if (loading) return (
    <div style={{ padding: '40px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>Loading...</div>
  );

  if (!video) return (
    <div style={{ padding: '40px' }}><p>Video not found. <Link to="/">← Back</Link></p></div>
  );

  const account = parseAccount(video.url);
  const displayTitle = video.title || account || video.platform?.toUpperCase() || 'VIDEO';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <header
        style={{
          borderBottom: 'var(--border)',
          background: 'var(--color-white)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          height: '56px',
        }}
      >
        <Link
          to="/"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            flexShrink: 0,
          }}
        >
          ← Library
        </Link>

        {siblings.length > 1 && (() => {
          const idx = siblings.indexOf(id);
          const prevId = idx > 0 ? siblings[idx - 1] : null;
          const nextId = idx < siblings.length - 1 ? siblings[idx + 1] : null;
          const navStyle = (disabled) => ({
            fontFamily: 'var(--font-mono)',
            fontSize: '14px',
            lineHeight: 1,
            padding: '0 6px',
            background: 'transparent',
            border: 'none',
            color: disabled ? 'var(--color-border)' : 'var(--color-muted)',
            cursor: disabled ? 'default' : 'pointer',
            flexShrink: 0,
          });
          return (
            <>
              <button style={navStyle(!prevId)} disabled={!prevId} onClick={() => prevId && navigate(`/video/${prevId}`)}>↑</button>
              <button style={navStyle(!nextId)} disabled={!nextId} onClick={() => nextId && navigate(`/video/${nextId}`)}>↓</button>
            </>
          );
        })()}

        <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', flexShrink: 0 }} />

        {/* Title */}
        {titleEditing ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTitleBlur(); }}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              border: 'none',
              borderBottom: 'var(--border)',
              padding: '2px 0',
              background: 'transparent',
              minWidth: 0,
              flex: '0 1 180px',
            }}
          />
        ) : (
          <h1
            onClick={() => setTitleEditing(true)}
            title="Click to edit title"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'text',
              flex: '0 1 180px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayTitle}
          </h1>
        )}

        {/* Original URL */}
        {video.url && (
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              letterSpacing: '0.04em',
              color: 'var(--color-muted)',
              flexShrink: 0,
              maxWidth: '200px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {video.url}
          </a>
        )}

        {/* Video-level tags */}
        {video.status === 'ready' && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <TagInput
              tags={video.tags || []}
              onChange={handleVideoTagChange}
            />
          </div>
        )}

        <span className={`badge ${video.status}`} style={{ flexShrink: 0 }}>
          {video.isCarousel ? 'carousel' : video.status}
        </span>

        {(video.status === 'error' || video.status === 'processing') && (
          <button style={{ flexShrink: 0 }} onClick={handleRetry}>↻ Retry</button>
        )}

        {video.status === 'ready' && (
          <>
            {!video.isCarousel && (
              <button style={{ flexShrink: 0 }} onClick={() => setActiveShotIndex(-1)}>+ Shot</button>
            )}
            {!video.isCarousel && (
              <button
                style={{ flexShrink: 0 }}
                onClick={handleTranscribe}
                disabled={transcribing}
              >
                {transcribing ? 'Transcribing…' : transcript ? (showTranscript ? 'Hide Transcript' : 'Transcript') : 'Transcribe'}
              </button>
            )}
            <button style={{ flexShrink: 0 }} onClick={() => setShowCard(true)}>Card Preview</button>
          </>
        )}

        <button
          style={{ flexShrink: 0, color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
          onClick={handleArchive}
        >
          Archive
        </button>
      </header>

      {/* Stats + backlinks strip */}
      {(video.accountUsername || video.stats || video.backlinks?.length > 0) && (
        <div style={{
          borderBottom: 'var(--border)',
          background: 'var(--color-white)',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          flexWrap: 'wrap',
        }}>
          {video.accountUsername && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              @{video.accountUsername}
            </span>
          )}
          {video.stats && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {[
                ['Views', video.stats.viewCount],
                ['Likes', video.stats.likeCount],
                ['Comments', video.stats.commentCount],
                ['Shares', video.stats.shareCount],
              ].filter(([, v]) => v != null).map(([label, val]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.02em',
                    lineHeight: 1.1,
                  }}>
                    {Number(val) >= 1_000_000
                      ? (Number(val) / 1_000_000).toFixed(1) + 'M'
                      : Number(val) >= 1_000
                        ? (Number(val) / 1_000).toFixed(1) + 'K'
                        : Number(val).toLocaleString()}
                  </span>
                  <span className="label">{label}</span>
                </div>
              ))}
            </div>
          )}
          {video.backlinks?.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span className="label">In:</span>
              {video.backlinks.map((note) => (
                <Link
                  key={note.id}
                  to={`/notes/${note.id}`}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '3px 8px',
                    border: 'var(--border)',
                    color: 'var(--color-black)',
                    textDecoration: 'none',
                  }}
                >
                  ↗ {note.title || 'Untitled'}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transcript panel */}
      {showTranscript && (
        <div style={{
          borderBottom: 'var(--border)',
          background: 'var(--color-white)',
          padding: '12px 24px',
        }}>
          {transcribing && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.06em',
              color: 'var(--color-muted)',
              textTransform: 'uppercase',
            }}>
              Transcribing… (downloading model on first run)
            </span>
          )}
          {transcriptError && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: '#c00',
            }}>
              Error: {transcriptError}
            </span>
          )}
          {transcript && (
            <div>
              {transcript.language && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                  marginRight: '12px',
                }}>
                  [{transcript.language}]
                </span>
              )}
              {transcript.segments?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                  {transcript.segments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '9px',
                        color: 'var(--color-muted)',
                        flexShrink: 0,
                        minWidth: '60px',
                      }}>
                        {formatTime(seg.start)}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        lineHeight: 1.5,
                      }}>
                        {seg.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--color-muted)',
                }}>
                  No speech detected.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Processing / Error states */}
      {(video.status === 'pending' || video.status === 'processing') && (
        <div style={{
          padding: '40px 24px', textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)',
        }}>
          {video.status === 'pending' ? 'Downloading...' : 'Analysing shots...'}
        </div>
      )}
      {video.status === 'error' && (
        <div style={{
          padding: '24px', fontFamily: 'var(--font-mono)', fontSize: '10px',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{ color: '#c00' }}>Error: {video.error || 'Processing failed'}</span>
          <button onClick={handleRetry}>↻ Retry</button>
        </div>
      )}

      {/* Shot grid — organic mosaic */}
      {video.status === 'ready' && (
        <ShotGrid
          shots={video.shots || []}
          videoId={id}
          heroShotId={video.heroShotId}
          isCarousel={video.isCarousel}
          onOpenModal={(index) => setActiveShotIndex(index)}
          onSetHero={handleSetHero}
          onDelete={handleDeleteShot}
        />
      )}

      {/* Shot modal */}
      {activeShotIndex !== null && video.status === 'ready' && (
        <ShotModal
          video={video}
          initialShotIndex={activeShotIndex}
          onClose={() => setActiveShotIndex(null)}
          onAddShot={handleAddShot}
          onSetHero={handleSetHero}
          onDelete={handleDeleteShot}
          onLabelChange={handleLabelChange}
          onShotTagChange={handleShotTagChange}
        />
      )}

      {/* Card Preview */}
      {showCard && video.status === 'ready' && (
        <CardPreview video={video} onClose={() => setShowCard(false)} />
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { videoUrl } from '../api.js';
import TagInput from './TagInput.jsx';

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = String((t % 60).toFixed(2)).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export default function ShotModal({
  video,
  initialShotIndex,
  onClose,
  onAddShot,
  onSetHero,
  onDelete,
  onLabelChange,
  onShotTagChange,
}) {
  const shots = video.shots || [];
  const [currentShotIndex, setCurrentShotIndex] = useState(
    initialShotIndex >= 0 ? initialShotIndex : -1
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [label, setLabel] = useState('');
  const videoRef = useRef(null);

  const currentShot =
    currentShotIndex >= 0 && currentShotIndex < shots.length
      ? shots[currentShotIndex]
      : null;

  // Seek to the initial shot on mount only
  useEffect(() => {
    if (initialShotIndex >= 0 && shots[initialShotIndex] && videoRef.current) {
      videoRef.current.currentTime = shots[initialShotIndex].timestamp;
    }
  }, []); // eslint-disable-line

  // Sync label when the active shot changes
  useEffect(() => {
    setLabel(currentShot?.label || '');
  }, [currentShot?.id]); // eslint-disable-line

  // Close if all shots deleted; clamp index if shots shrink
  useEffect(() => {
    if (shots.length === 0 && currentShotIndex >= 0) {
      onClose();
    } else if (currentShotIndex >= shots.length) {
      setCurrentShotIndex(shots.length - 1);
    }
  }, [shots.length]); // eslint-disable-line

  // Which shot contains this timestamp? (shots assumed sorted by timestamp)
  function shotIndexAtTime(t) {
    let result = -1;
    for (let i = 0; i < shots.length; i++) {
      if (shots[i].timestamp <= t) result = i;
    }
    return result;
  }

  function handleTimeUpdate() {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setCurrentTime(t);
    // Auto-advance the active shot as playback crosses shot markers
    const autoIndex = shotIndexAtTime(t);
    if (autoIndex >= 0 && autoIndex !== currentShotIndex) {
      setCurrentShotIndex(autoIndex);
    }
  }

  function handleTimelineClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current) videoRef.current.currentTime = ratio * (video.duration || 0);
  }

  function handlePrev() {
    if (currentShotIndex <= 0) return;
    const newIndex = currentShotIndex - 1;
    if (videoRef.current) videoRef.current.currentTime = shots[newIndex].timestamp;
    setCurrentShotIndex(newIndex);
  }

  function handleNext() {
    if (currentShotIndex >= shots.length - 1) return;
    const newIndex = currentShotIndex + 1;
    if (videoRef.current) videoRef.current.currentTime = shots[newIndex].timestamp;
    setCurrentShotIndex(newIndex);
  }

  async function handleDelete() {
    if (!currentShot) return;
    await onDelete(currentShot.id);
    // shots.length useEffect will clamp/close after video prop updates
  }

  const progressPct = video.duration ? (currentTime / video.duration) * 100 : 0;

  const navBtn = (disabled) => ({
    background: 'transparent',
    color: 'var(--color-white)',
    border: 'none',
    fontSize: '24px',
    padding: '0 12px',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.2 : 0.8,
    flexShrink: 0,
    lineHeight: 1,
  });

  const actionBtn = (active) => ({
    background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
    color: 'rgba(255,255,255,0.8)',
    border: '1px solid rgba(255,255,255,0.3)',
    padding: '3px 10px',
    fontSize: '10px',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.06em',
    cursor: 'pointer',
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          maxWidth: '420px',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '-44px',
            right: 0,
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            border: 'none',
            fontSize: '22px',
            cursor: 'pointer',
            padding: '4px 8px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ×
        </button>

        {/* Prev / Player / Next */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <button
            onClick={handlePrev}
            disabled={currentShotIndex <= 0}
            style={navBtn(currentShotIndex <= 0)}
          >
            ←
          </button>

          {/* 9:16 player */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <video
              ref={videoRef}
              src={videoUrl(video.id)}
              controls
              style={{
                height: '62vh',
                width: 'auto',
                aspectRatio: '9/16',
                background: '#000',
                display: 'block',
                maxWidth: '100%',
              }}
              onTimeUpdate={handleTimeUpdate}
            />
          </div>

          <button
            onClick={handleNext}
            disabled={currentShotIndex >= shots.length - 1}
            style={navBtn(currentShotIndex >= shots.length - 1)}
          >
            →
          </button>
        </div>

        {/* Timeline / scrubber */}
        <div
          onClick={handleTimelineClick}
          style={{
            width: '100%',
            height: '6px',
            background: 'rgba(255,255,255,0.15)',
            cursor: 'pointer',
            position: 'relative',
            borderRadius: '3px',
          }}
        >
          {/* Progress fill */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${progressPct}%`,
              background: 'rgba(255,255,255,0.7)',
              borderRadius: '3px',
              pointerEvents: 'none',
            }}
          />
          {/* Shot markers */}
          {shots.map((shot, i) => (
            <div
              key={shot.id}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(shot.timestamp / (video.duration || 1)) * 100}%`,
                width: '2px',
                background:
                  i === currentShotIndex
                    ? 'var(--color-white)'
                    : 'rgba(255,255,255,0.4)',
                transform: 'translateX(-1px)',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>

        {/* Shot info row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          <span style={{ flex: 1 }}>
            {currentShot
              ? `SHOT ${String(currentShotIndex + 1).padStart(2, '0')} / ${String(shots.length).padStart(2, '0')}`
              : shots.length > 0
              ? `${shots.length} SHOTS — SEEK & CAPTURE`
              : 'NO SHOTS YET'}
          </span>
          {currentShot && (
            <>
              <button
                title="Set as hero"
                onClick={() => onSetHero(currentShot.id)}
                style={actionBtn(currentShot.id === video.heroShotId)}
              >
                ★ HERO
              </button>
              <button
                title="Delete shot"
                onClick={handleDelete}
                style={actionBtn(false)}
              >
                ✕ DEL
              </button>
            </>
          )}
        </div>

        {/* Label input */}
        {currentShot && (
          <input
            type="text"
            placeholder="Add label..."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => onLabelChange(currentShot.id, label)}
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.04em',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'var(--color-white)',
              padding: '7px 10px',
              boxSizing: 'border-box',
            }}
          />
        )}

        {/* Shot tags */}
        {currentShot && onShotTagChange && (
          <div style={{ width: '100%' }}>
            <TagInput
              tags={currentShot.tags || []}
              onChange={(tags) => onShotTagChange(currentShot.id, tags)}
              dark
            />
          </div>
        )}

        {/* Capture button */}
        <button
          onClick={() => onAddShot(currentTime)}
          style={{
            width: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.25)',
            padding: '9px 16px',
            cursor: 'pointer',
          }}
        >
          Capture Frame at {formatTime(currentTime)}
        </button>
      </div>
    </div>
  );
}

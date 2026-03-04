import React, { useRef } from 'react';

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export default function ShotTimeline({ shots, duration, currentTime, onSeek, onAddShot }) {
  const barRef = useRef(null);

  function handleBarClick(e) {
    if (!barRef.current || !duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    onSeek(ratio * duration);
  }

  const playheadPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{ padding: '16px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <span className="label">Timeline</span>
        <button onClick={() => onAddShot(currentTime)}>
          Capture frame at {formatTime(currentTime)}
        </button>
      </div>

      {/* Bar */}
      <div
        ref={barRef}
        onClick={handleBarClick}
        style={{
          position: 'relative',
          height: '32px',
          background: 'var(--color-white)',
          border: 'var(--border)',
          cursor: 'crosshair',
          userSelect: 'none',
        }}
      >
        {/* Shot ticks */}
        {duration &&
          shots.map((shot) => {
            const pct = (shot.timestamp / duration) * 100;
            return (
              <div
                key={shot.id}
                title={formatTime(shot.timestamp)}
                style={{
                  position: 'absolute',
                  left: `${pct}%`,
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: shot.isHero ? 'var(--color-black)' : '#999',
                  transform: 'translateX(-1px)',
                }}
              />
            );
          })}

        {/* Playhead */}
        <div
          style={{
            position: 'absolute',
            left: `${playheadPct}%`,
            top: 0,
            bottom: 0,
            width: '1px',
            background: '#e00',
            pointerEvents: 'none',
            transform: 'translateX(-0.5px)',
          }}
        />

        {/* Time label */}
        <div
          style={{
            position: 'absolute',
            bottom: '2px',
            right: '6px',
            fontFamily: 'var(--font-mono)',
            fontSize: '8px',
            color: 'var(--color-muted)',
            pointerEvents: 'none',
          }}
        >
          {formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}
        </div>
      </div>
    </div>
  );
}

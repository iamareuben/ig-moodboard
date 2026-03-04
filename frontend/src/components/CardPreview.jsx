import React from 'react';
import { frameFileUrl, parseAccount } from '../api.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmt(ts) {
  const m = Math.floor(ts / 60);
  const s = String(Math.floor(ts % 60)).padStart(2, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

/** Gradient label burned into the bottom of a cell */
function BurnIn({ shot, index, hero }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent 0%, rgba(0,0,0,0.75) 100%)',
        padding: hero ? '32px 10px 10px' : '16px 7px 7px',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <span style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: hero ? '13px' : '9px',
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '0.06em',
        }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: hero ? '11px' : '8px',
          color: 'rgba(255,255,255,0.7)',
          letterSpacing: '0.04em',
        }}>
          {fmt(shot.timestamp)}
        </span>
      </div>
      {shot.label && (
        <p style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: hero ? '12px' : '9px',
          color: '#fff',
          marginTop: '3px',
          letterSpacing: '0.03em',
          lineHeight: 1.3,
          textTransform: 'uppercase',
        }}>
          {shot.label}
        </p>
      )}
    </div>
  );
}

/**
 * Portrait cell: explicit width, aspect-ratio: 9/16 derives height automatically.
 * objectFit: cover fills the cell perfectly since cell and image are both 9:16.
 */
function Cell({ shot, index, videoId, hero, width }) {
  return (
    <div style={{
      width,
      aspectRatio: '9 / 16',
      position: 'relative',
      overflow: 'hidden',
      background: '#111',
      flexShrink: 0,
    }}>
      <img
        src={frameFileUrl(videoId, shot.frameFile)}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      <BurnIn shot={shot} index={index} hero={hero} />
    </div>
  );
}

// ─── layout maths ─────────────────────────────────────────────────────────────
// Card is 210mm wide. Gap between cells: 2px.
//
// Row 1: hero (2/3 width) | side column (1/3 width, up to 2 shots stacked)
//   • hero:  calc((210mm - 2px) * 2/3)  wide  →  9:16 via aspect-ratio
//   • side:  calc((210mm - 2px) / 3)    wide  →  9:16 via aspect-ratio
//   • 2 stacked side shots = hero height exactly (verified: 2 × (1/3 × 16/9) = 2/3 × 16/9) ✓
//
// Extra rows: up to 4 shots per row, distributed evenly.

const GAP = 2; // px
const HERO_W = `calc((210mm - ${GAP}px) * 2 / 3)`;
const SIDE_W = `calc((210mm - ${GAP}px) / 3)`;

function rowWidth(n) {
  // n shots in a row, (n-1) gaps between them
  return `calc((210mm - ${(n - 1) * GAP}px) / ${n})`;
}

function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── main component ────────────────────────────────────────────────────────────

export default function CardPreview({ video, onClose }) {
  const shots = video.shots || [];
  if (shots.length === 0) return null;

  const heroShot = shots.find((s) => s.id === video.heroShotId) || shots[0];
  const nonHeroShots = shots.filter((s) => s !== heroShot);
  const sideShots = nonHeroShots.slice(0, 2);
  const extraRows = chunk(nonHeroShots.slice(2), 4);

  const account = parseAccount(video.url);
  const displayTitle = video.title || account || video.platform?.toUpperCase() || 'VIDEO';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 200,
        overflow: 'auto',
        padding: '24px',
      }}
    >
      {/* Controls */}
      <div
        style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          display: 'flex',
          gap: '6px',
          zIndex: 201,
        }}
      >
        <button className="primary" onClick={() => window.print()}>Print</button>
        <button onClick={onClose}>Close</button>
      </div>

      {/* Card — 210mm wide, height auto (grows with portrait content) */}
      <div
        className="card"
        style={{
          width: '210mm',
          background: '#000',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {/* Content: nestled portrait cells */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px` }}>

          {/* Row 1: hero (large, 2/3 width) + up to 2 side shots stacked (1/3 width) */}
          <div style={{ display: 'flex', gap: `${GAP}px`, alignItems: 'flex-start' }}>
            <Cell
              shot={heroShot}
              index={shots.indexOf(heroShot)}
              videoId={video.id}
              hero
              width={HERO_W}
            />
            {sideShots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px` }}>
                {sideShots.map((shot) => (
                  <Cell
                    key={shot.id}
                    shot={shot}
                    index={shots.indexOf(shot)}
                    videoId={video.id}
                    width={SIDE_W}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Extra rows: remaining shots, up to 4 per row */}
          {extraRows.map((rowShots, rowIdx) => (
            <div key={rowIdx} style={{ display: 'flex', gap: `${GAP}px`, alignItems: 'flex-start' }}>
              {rowShots.map((shot) => (
                <Cell
                  key={shot.id}
                  shot={shot}
                  index={shots.indexOf(shot)}
                  videoId={video.id}
                  width={rowWidth(rowShots.length)}
                />
              ))}
            </div>
          ))}

        </div>

        {/* Footer */}
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid #333',
            padding: '0 8mm',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: "'Space Mono', monospace",
            fontSize: '7px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#666',
            height: '10mm',
            background: '#000',
          }}
        >
          <span style={{ fontWeight: 700, color: '#999' }}>{displayTitle}</span>
          <span>{video.url}</span>
          <span>{formatDate(video.downloadedAt)}</span>
        </div>
      </div>
    </div>
  );
}

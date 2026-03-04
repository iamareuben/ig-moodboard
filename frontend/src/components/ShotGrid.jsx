import React, { useState, useEffect } from 'react';
import ShotCell from './ShotCell.jsx';

// ─── viewport hook ─────────────────────────────────────────────────────────────

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return vp;
}

// ─── column builder ────────────────────────────────────────────────────────────
//
// Shot heights (vh) cycle through this pattern, column by column, until
// adding the next column would overflow the viewport width.
// Width of each column = (shotHeight / 100) * viewportHeight * (9/16)
//
// Result: the layout fills the screen regardless of aspect ratio, and
// each shot stays correctly sized relative to the viewport height.

const HEIGHT_PATTERN = [70, 50, 35];

function buildColumns(shots, heroShotId, vw, vh) {
  // Sort by timestamp — hero pinned to position 0 for prominence
  const byTime = [...shots].sort((a, b) => a.timestamp - b.timestamp);
  const hero   = shots.find(s => s.id === heroShotId) ?? byTime[0];
  const ordered = [hero, ...byTime.filter(s => s !== hero)];

  // Grow the column list, one column per shot, until the next would overflow
  const colHeights = [];
  let usedW = 4; // 2px padding on each side

  for (let i = 0; i < ordered.length; i++) {
    const h   = HEIGHT_PATTERN[i % HEIGHT_PATTERN.length];
    const w   = (h / 100) * vh * (9 / 16);
    const gap = colHeights.length > 0 ? 2 : 0;

    // Once we have at least one column, stop if the next one won't fit
    if (colHeights.length > 0 && usedW + gap + w > vw) break;

    colHeights.push(h);
    usedW += gap + w;
  }

  // Round-robin across columns → left-to-right chronological reading
  // Row 1: shots 0,1,2,3,4,5  Row 2: shots 6,7,8,9,10,11  etc.
  const cols = colHeights.map(h => ({ shotH: h, items: [] }));
  ordered.forEach((shot, i) => {
    cols[i % colHeights.length].items.push({ shot, idx: shots.indexOf(shot) });
  });

  return cols.filter(col => col.items.length > 0);
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ShotGrid({ shots, videoId, heroShotId, onOpenModal, onSetHero, onDelete }) {
  const { w: vw, h: vh } = useViewport();

  if (!shots || shots.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '300px', color: 'var(--color-muted)',
        fontFamily: 'var(--font-mono)', fontSize: '10px',
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        No shots yet — click + Shot to add one
      </div>
    );
  }

  const cols = buildColumns(shots, heroShotId, vw, vh);

  return (
    <div style={{
      display: 'flex',
      gap: '2px',
      alignItems: 'flex-start',
      background: 'var(--color-border)',
      padding: '2px',
    }}>
      {cols.map((col, ci) => (
        <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {col.items.map(({ shot, idx }) => (
            <div
              key={shot.id}
              style={{ height: `${col.shotH}vh`, aspectRatio: '9 / 16', flexShrink: 0 }}
            >
              <ShotCell
                shot={shot}
                index={idx}
                videoId={videoId}
                heroShotId={heroShotId}
                onOpenModal={onOpenModal}
                onSetHero={onSetHero}
                onDelete={onDelete}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

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

const HEIGHT_PATTERN = [70, 50, 35];

function buildColumns(shots, heroShotId, vw, vh, shotRatio) {
  const byTime = [...shots].sort((a, b) => a.timestamp - b.timestamp);
  const hero   = shots.find(s => s.id === heroShotId) ?? byTime[0];
  const ordered = [hero, ...byTime.filter(s => s !== hero)];

  const colHeights = [];
  let usedW = 4;

  for (let i = 0; i < ordered.length; i++) {
    const h   = HEIGHT_PATTERN[i % HEIGHT_PATTERN.length];
    const w   = (h / 100) * vh * shotRatio;
    const gap = colHeights.length > 0 ? 2 : 0;
    if (colHeights.length > 0 && usedW + gap + w > vw) break;
    colHeights.push(h);
    usedW += gap + w;
  }

  const cols = colHeights.map(h => ({ shotH: h, items: [] }));
  ordered.forEach((shot, i) => {
    cols[i % colHeights.length].items.push({ shot, idx: shots.indexOf(shot) });
  });

  return cols.filter(col => col.items.length > 0);
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ShotGrid({ shots, videoId, heroShotId, onOpenModal, onSetHero, onDelete, isCarousel }) {
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

  // For carousels, use the actual image ratio from the first shot (all slides are the same ratio).
  // Fall back to 9/16 if dimensions weren't stored (older manifests).
  const shotRatio = isCarousel && shots[0]?.width && shots[0]?.height
    ? shots[0].width / shots[0].height
    : 9 / 16;

  const cols = buildColumns(shots, heroShotId, vw, vh, shotRatio);

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
              style={{
                height: `${col.shotH}vh`,
                aspectRatio: `${shotRatio}`,
                flexShrink: 0,
              }}
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

import React, { useState } from 'react';
import { frameFileUrl } from '../api.js';

export default function ShotCell({ shot, index, videoId, heroShotId, onOpenModal, onSetHero, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const isHero = shot.id === heroShotId;
  const src = frameFileUrl(videoId, shot.frameFile);
  const shotTags = shot.tags || [];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpenModal(index)}
    >
      <img
        src={src}
        alt={`Shot ${index + 1}`}
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {/* Top gradient: shot number + hero star + shot tags */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          padding: '5px 6px',
          background: 'linear-gradient(rgba(0,0,0,0.55) 0%, transparent 100%)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          pointerEvents: 'none',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '18px',
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          {shotTags.map((tag) => (
            <span key={tag} style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '7px',
              color: 'rgba(255,255,255,0.8)',
              background: 'rgba(0,0,0,0.4)',
              padding: '1px 4px',
              letterSpacing: '0.04em',
            }}>
              {tag}
            </span>
          ))}
        </div>
        {isHero && (
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.9)', flexShrink: 0 }}>★</span>
        )}
      </div>

      {/* Bottom gradient: label */}
      {shot.label && (
        <div
          style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            padding: '12px 6px 5px',
            background: 'linear-gradient(transparent 0%, rgba(0,0,0,0.65) 100%)',
            pointerEvents: 'none',
          }}
        >
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '8px',
            color: 'rgba(255,255,255,0.9)',
            letterSpacing: '0.04em',
          }}>
            {shot.label}
          </span>
        </div>
      )}

      {/* Hover overlay */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.32)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <button
            title="Set as hero"
            onClick={(e) => { e.stopPropagation(); onSetHero(shot.id); }}
            style={{
              background: isHero ? 'rgba(255,255,255,0.25)' : 'transparent',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.6)',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ★
          </button>
          <button
            title="Delete shot"
            onClick={(e) => { e.stopPropagation(); onDelete(shot.id); }}
            style={{
              background: 'transparent',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.6)',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

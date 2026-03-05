import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { frameFileUrl } from '../api.js';

const VideoFinderPanel = forwardRef(function VideoFinderPanel(
  { items, command, clientRect, query },
  ref
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef(null);

  // Reset selection when items change
  useEffect(() => setSelectedIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        if (items[selectedIndex]) command(items[selectedIndex]);
        return true;
      }
      return false;
    },
  }));

  const rect = clientRect?.();
  if (!rect) return null;

  const style = {
    position: 'fixed',
    top: rect.bottom + 4,
    left: rect.left,
    zIndex: 9999,
    background: '#fff',
    border: '1px solid #ddd',
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    width: '320px',
    maxHeight: '320px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  return createPortal(
    <div style={style}>
      {items.length === 0 ? (
        <div style={{
          padding: '16px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          color: 'var(--color-muted)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          No videos found
        </div>
      ) : (
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {items.map((item, i) => (
            <div
              key={item.id}
              onClick={() => command(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                cursor: 'pointer',
                background: i === selectedIndex ? '#f0f0f0' : 'transparent',
                borderBottom: '1px solid #f0f0f0',
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {/* Thumbnail */}
              <div style={{
                width: '32px',
                height: '57px',
                flexShrink: 0,
                background: '#e0e0e0',
                overflow: 'hidden',
              }}>
                {item.heroFrame ? (
                  <img
                    src={frameFileUrl(item.id, item.heroFrame)}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : null}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginBottom: '2px',
                }}>
                  {item.title || item.accountUsername || item.platform?.toUpperCase() || 'Video'}
                </p>
                {item.accountUsername && (
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8px',
                    color: 'var(--color-muted)',
                    letterSpacing: '0.03em',
                  }}>
                    @{item.accountUsername}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
});

export default VideoFinderPanel;

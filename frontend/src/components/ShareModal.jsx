import React, { useEffect, useState } from 'react';
import { listNoteShares, createNoteShare, deleteNoteShare } from '../api.js';

const MONO = 'var(--font-mono)';

function shareUrl(shareId) {
  return `${window.location.origin}/share/${shareId}`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback: select input
    }
  }
  return (
    <button
      onClick={handleCopy}
      style={{
        fontFamily: MONO,
        fontSize: '10px',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        border: 'var(--border)',
        background: copied ? 'var(--color-black)' : 'transparent',
        color: copied ? 'var(--color-white)' : 'var(--color-black)',
        padding: '4px 10px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}

export default function ShareModal({ noteId, onClose }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listNoteShares(noteId)
      .then(setShares)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [noteId]);

  async function handleCreate(mode) {
    setCreating(true);
    try {
      const share = await createNoteShare(noteId, mode);
      setShares((prev) => [share, ...prev]);
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(shareId) {
    try {
      await deleteNoteShare(noteId, shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.35)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 201,
        background: 'var(--color-white)',
        border: 'var(--border)',
        width: 'min(560px, 94vw)',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: 'var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Share note
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: '16px', color: 'var(--color-muted)', padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        {/* Create buttons */}
        <div style={{ padding: '16px 20px', borderBottom: 'var(--border)', flexShrink: 0, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleCreate('read')}
            disabled={creating}
            style={{
              fontFamily: MONO, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
              border: 'var(--border)', background: 'transparent', color: 'var(--color-black)',
              padding: '6px 14px', cursor: 'pointer', opacity: creating ? 0.5 : 1,
            }}
          >
            + Read-only link
          </button>
          <button
            onClick={() => handleCreate('edit')}
            disabled={creating}
            style={{
              fontFamily: MONO, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
              border: 'var(--border)', background: 'var(--color-black)', color: 'var(--color-white)',
              padding: '6px 14px', cursor: 'pointer', opacity: creating ? 0.5 : 1,
            }}
          >
            + Editable link
          </button>
          <span style={{ fontFamily: MONO, fontSize: '10px', color: 'var(--color-muted)', alignSelf: 'center', marginLeft: 'auto' }}>
            Editable links include edit history
          </span>
        </div>

        {/* Share list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '20px', fontFamily: MONO, fontSize: '11px', color: 'var(--color-muted)' }}>Loading…</div>
          ) : shares.length === 0 ? (
            <div style={{ padding: '20px', fontFamily: MONO, fontSize: '11px', color: 'var(--color-muted)' }}>
              No active share links. Create one above.
            </div>
          ) : shares.map((share) => (
            <div
              key={share.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 20px',
                borderBottom: 'var(--border)',
              }}
            >
              {/* Mode badge */}
              <span style={{
                fontFamily: MONO, fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase',
                border: 'var(--border)', padding: '2px 7px',
                background: share.mode === 'edit' ? 'var(--color-black)' : 'transparent',
                color: share.mode === 'edit' ? 'var(--color-white)' : 'var(--color-black)',
                flexShrink: 0,
              }}>
                {share.mode === 'edit' ? 'Editable' : 'Read-only'}
              </span>

              {/* URL */}
              <input
                readOnly
                value={shareUrl(share.id)}
                onClick={(e) => e.target.select()}
                style={{
                  flex: 1,
                  fontFamily: MONO, fontSize: '10px',
                  border: 'var(--border)', background: 'var(--color-bg)',
                  padding: '4px 8px',
                  color: 'var(--color-black)',
                  minWidth: 0,
                }}
              />

              <CopyButton text={shareUrl(share.id)} />

              {/* Created date */}
              <span style={{ fontFamily: MONO, fontSize: '9px', color: 'var(--color-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {formatDate(share.created_at)}
              </span>

              {/* Revoke */}
              <button
                onClick={() => handleRevoke(share.id)}
                title="Revoke this link"
                style={{
                  fontFamily: MONO, fontSize: '10px', letterSpacing: '0.04em',
                  border: 'var(--border)', background: 'transparent', color: 'var(--color-muted)',
                  padding: '3px 8px', cursor: 'pointer', flexShrink: 0,
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

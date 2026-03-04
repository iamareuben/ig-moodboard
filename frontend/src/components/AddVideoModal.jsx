import React, { useState } from 'react';
import { submitVideo } from '../api.js';

function validateUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host === 'tiktok.com';
  } catch {
    return false;
  }
}

export default function AddVideoModal({ onSuccess, onClose }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!validateUrl(url)) {
      setError('Please enter a valid Instagram or TikTok URL');
      return;
    }

    setSubmitting(true);
    try {
      const video = await submitVideo(url);
      onSuccess(video);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--color-white)',
          border: 'var(--border)',
          padding: '32px',
          width: '480px',
          maxWidth: '90vw',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <p className="label" style={{ marginBottom: '4px' }}>Add Video</p>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700 }}>
            Paste URL
          </h2>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="url"
            placeholder="https://www.instagram.com/reel/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            style={{ marginBottom: '8px' }}
          />
          {error && (
            <p style={{ color: '#c00', fontFamily: 'var(--font-mono)', fontSize: '10px', marginBottom: '16px' }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={submitting}
              style={{ flex: 2 }}
            >
              {submitting ? 'Submitting...' : 'Download + Analyse'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

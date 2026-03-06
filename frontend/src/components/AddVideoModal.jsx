import React, { useState, useRef } from 'react';
import { submitVideo, uploadVideo } from '../api.js';

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
  const [tab, setTab] = useState('url'); // 'url' | 'upload'
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  async function handleUrlSubmit(e) {
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

  async function handleUploadSubmit(e) {
    e.preventDefault();
    if (!file) { setError('Please select an MP4 file'); return; }
    setError('');
    setSubmitting(true);
    try {
      const video = await uploadVideo(file);
      onSuccess(video);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.type === 'video/mp4' || dropped.name.toLowerCase().endsWith('.mp4'))) {
      setFile(dropped);
      setError('');
    } else {
      setError('Only MP4 files are supported');
    }
  }

  const tabStyle = (active) => ({
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '6px 16px',
    border: 'var(--border)',
    borderBottom: active ? '2px solid var(--color-black)' : 'var(--border)',
    background: active ? 'var(--color-white)' : 'transparent',
    color: active ? 'var(--color-black)' : 'var(--color-muted)',
    cursor: 'pointer',
    marginBottom: '-1px',
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-white)',
        border: 'var(--border)',
        padding: '32px',
        width: '480px',
        maxWidth: '90vw',
      }}>
        <p className="label" style={{ marginBottom: '16px' }}>Add Video</p>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', borderBottom: 'var(--border)', marginBottom: '24px' }}>
          <button style={tabStyle(tab === 'url')} onClick={() => { setTab('url'); setError(''); }}>
            Paste URL
          </button>
          <button style={tabStyle(tab === 'upload')} onClick={() => { setTab('upload'); setError(''); }}>
            Upload MP4
          </button>
        </div>

        {tab === 'url' && (
          <form onSubmit={handleUrlSubmit}>
            <input
              type="url"
              placeholder="https://www.instagram.com/reel/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              style={{ marginBottom: '8px' }}
            />
            {error && <p style={{ color: '#c00', fontFamily: 'var(--font-mono)', fontSize: '10px', marginBottom: '8px' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button type="button" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="primary" disabled={submitting} style={{ flex: 2 }}>
                {submitting ? 'Submitting…' : 'Download + Analyse'}
              </button>
            </div>
          </form>
        )}

        {tab === 'upload' && (
          <form onSubmit={handleUploadSubmit}>
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-black)' : 'var(--color-border)'}`,
                background: dragOver ? '#f5f5f5' : 'transparent',
                padding: '32px',
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: '12px',
                transition: 'border-color 0.15s',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,video/mp4"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setFile(f); setError(''); }
                }}
              />
              {file ? (
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                    {file.name}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--color-muted)' }}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB · click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-muted)', marginBottom: '6px' }}>
                    Drop an MP4 here
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--color-muted)', letterSpacing: '0.04em' }}>
                    or click to browse · max 500 MB
                  </p>
                </div>
              )}
            </div>

            {error && <p style={{ color: '#c00', fontFamily: 'var(--font-mono)', fontSize: '10px', marginBottom: '8px' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="primary" disabled={submitting || !file} style={{ flex: 2 }}>
                {submitting ? 'Uploading…' : 'Upload + Analyse'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

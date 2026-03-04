import React, { useEffect, useState } from 'react';

const PLATFORMS = [
  {
    id: 'tiktok',
    label: 'TikTok',
    domain: 'tiktok.com',
    steps: [
      'Open www.tiktok.com in your browser and make sure you are logged in.',
      'Open DevTools (F12 or Cmd+Option+I) and go to the Network tab.',
      'In the filter bar, type "www.tiktok.com" to show only main-domain requests.',
      'Reload the page. Click the first request in the list (the HTML document, type "Doc").',
      'Right-click it → Copy → Copy as cURL. Paste below.',
    ],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    domain: 'instagram.com',
    steps: [
      'Open www.instagram.com in your browser and make sure you are logged in.',
      'Open DevTools (F12 or Cmd+Option+I) and go to the Network tab.',
      'In the filter bar, type "www.instagram.com" to show only main-domain requests.',
      'Reload the page. Click the first request in the list (the HTML document, type "Doc").',
      'Right-click it → Copy → Copy as cURL. Paste below.',
    ],
  },
];

function PlatformCard({ platform, savedAt, onSaved, onDeleted }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null); // null | 'saving' | 'ok' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSave() {
    if (!input.trim()) return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/settings/cookies/${platform.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curlCommand: input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setStatus('ok');
      setInput('');
      onSaved();
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  }

  async function handleDelete() {
    await fetch(`/api/settings/cookies/${platform.id}`, { method: 'DELETE' });
    onDeleted();
  }

  return (
    <div style={{
      border: 'var(--border)',
      marginBottom: '24px',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: 'var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: savedAt ? 'var(--color-black)' : 'transparent',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: savedAt ? 'var(--color-white)' : 'var(--color-black)',
        }}>
          {platform.label}
        </span>
        {savedAt ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: '#aaa',
              letterSpacing: '0.04em',
            }}>
              saved {new Date(savedAt).toLocaleDateString()}
            </span>
            <button
              onClick={handleDelete}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'transparent',
                border: '1px solid #555',
                color: '#aaa',
                padding: '3px 10px',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: '#999',
            letterSpacing: '0.04em',
          }}>
            not configured
          </span>
        )}
      </div>

      {/* Instructions */}
      <div style={{ padding: '16px', borderBottom: 'var(--border)' }}>
        <ol style={{
          margin: 0,
          paddingLeft: '20px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          lineHeight: '1.8',
          color: '#444',
        }}>
          {platform.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      {/* Paste area */}
      <div style={{ padding: '16px' }}>
        <textarea
          value={input}
          onChange={(e) => { setInput(e.target.value); setStatus(null); }}
          placeholder={`Paste cURL command for ${platform.domain} here…`}
          rows={5}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            lineHeight: '1.6',
            border: 'var(--border)',
            padding: '10px',
            resize: 'vertical',
            outline: 'none',
            color: 'var(--color-black)',
            background: '#fafafa',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
          <button
            onClick={handleSave}
            disabled={!input.trim() || status === 'saving'}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: input.trim() ? 'var(--color-black)' : '#ccc',
              color: 'var(--color-white)',
              border: 'none',
              padding: '8px 20px',
              cursor: input.trim() ? 'pointer' : 'default',
            }}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {status === 'ok' && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'green' }}>
              Saved
            </span>
          )}
          {status === 'error' && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'red' }}>
              {errorMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RetryFailedSection() {
  const [state, setState] = useState('idle'); // idle | running | done
  const [counts, setCounts] = useState({ total: 0, done: 0 });

  async function handleRetryAll() {
    setState('running');
    const res = await fetch('/api/videos');
    const videos = await res.json();
    const failed = videos.filter((v) => v.status === 'error');
    setCounts({ total: failed.length, done: 0 });

    for (let i = 0; i < failed.length; i++) {
      await fetch(`/api/videos/${failed[i].id}/retry`, { method: 'POST' });
      setCounts({ total: failed.length, done: i + 1 });
    }
    setState('done');
  }

  return (
    <div style={{ border: 'var(--border)', marginBottom: '24px' }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: 'var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        Downloads
      </div>
      <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button
          onClick={handleRetryAll}
          disabled={state === 'running'}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: state === 'running' ? '#ccc' : 'var(--color-black)',
            color: 'var(--color-white)',
            border: 'none',
            padding: '8px 20px',
            cursor: state === 'running' ? 'default' : 'pointer',
          }}
        >
          {state === 'running' ? `Retrying… (${counts.done}/${counts.total})` : 'Retry All Failed Downloads'}
        </button>
        {state === 'done' && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#666' }}>
            Queued {counts.total} download{counts.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const [saved, setSaved] = useState({}); // { tiktok: '2024-...', instagram: '...' }

  async function loadSaved() {
    const res = await fetch('/api/settings/cookies');
    const rows = await res.json();
    const map = {};
    for (const row of rows) map[row.platform] = row.updated_at;
    setSaved(map);
  }

  useEffect(() => { loadSaved(); }, []);

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: '32px',
        color: 'var(--color-black)',
      }}>
        Settings
      </h1>

      <RetryFailedSection />

      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: '#666',
        lineHeight: '1.7',
        marginBottom: '28px',
      }}>
        To download private or login-gated posts, paste your browser session cookies below.
        Cookies are stored locally in the database and used only for yt-dlp download calls.
        They expire when your browser session expires — re-paste to refresh.
      </p>

      {PLATFORMS.map((p) => (
        <PlatformCard
          key={p.id}
          platform={p}
          savedAt={saved[p.id]}
          onSaved={loadSaved}
          onDeleted={loadSaved}
        />
      ))}
    </div>
  );
}

import React, { useState } from 'react';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onLogin();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-white)',
    }}>
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '280px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-black)',
          marginBottom: '8px',
        }}>
          IG MSB
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          required
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            padding: '8px 12px',
            border: 'var(--border)',
            background: 'var(--color-white)',
            color: 'var(--color-black)',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: '#c00',
            letterSpacing: '0.04em',
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '8px 16px',
            background: 'var(--color-black)',
            color: 'var(--color-white)',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

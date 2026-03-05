import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Link } from 'react-router-dom';
import { getCookieStatus } from './api.js';
import Library from './pages/Library.jsx';
import VideoEditor from './pages/VideoEditor.jsx';
import Notes from './pages/Notes.jsx';
import NoteEditor from './pages/NoteEditor.jsx';
import Accounts from './pages/Accounts.jsx';
import AccountDetail from './pages/AccountDetail.jsx';
import Settings from './pages/Settings.jsx';

const PLATFORM_LABELS = { tiktok: 'TikTok', instagram: 'Instagram' };

function CookieBanner() {
  const [issues, setIssues] = useState([]); // [{ platform, status }]

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const status = await getCookieStatus().catch(() => ({}));
      if (!cancelled) {
        setIssues(Object.entries(status).map(([platform, s]) => ({ platform, status: s })));
      }
    }
    check();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (issues.length === 0) return null;

  return (
    <div style={{
      background: '#1a1a1a',
      color: '#fff',
      padding: '8px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap',
      fontFamily: 'var(--font-mono)',
      fontSize: '10px',
      letterSpacing: '0.04em',
    }}>
      <span style={{ color: '#f5a623', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        ⚠ Downloads failing
      </span>
      {issues.map(({ platform, status }) => (
        <span key={platform} style={{ color: '#ccc' }}>
          {PLATFORM_LABELS[platform] || platform} cookies {status === 'invalid' ? 'expired' : 'missing'}
        </span>
      ))}
      <Link
        to="/settings"
        style={{
          marginLeft: 'auto',
          color: '#fff',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          textDecoration: 'none',
          border: '1px solid #555',
          padding: '3px 12px',
          whiteSpace: 'nowrap',
        }}
      >
        Update cookies →
      </Link>
    </div>
  );
}

function Nav() {
  const location = useLocation();
  const isVideoEditor = location.pathname.startsWith('/video/');
  const isNoteEditor = location.pathname.startsWith('/notes/') && location.pathname !== '/notes';

  if (isVideoEditor || isNoteEditor) return null;

  return (
    <header style={{
      borderBottom: 'var(--border)',
      background: 'var(--color-white)',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '48px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <NavLink to="/" end style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-black)',
        textDecoration: 'none',
      }}>
        IG MSB
      </NavLink>
      <nav style={{ display: 'flex', gap: 0 }}>
        {[
          { to: '/', label: 'Videos' },
          { to: '/notes', label: 'Notes' },
          { to: '/accounts', label: 'Accounts' },
          { to: '/settings', label: 'Settings' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end
            style={({ isActive }) => ({
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '6px 16px',
              borderLeft: 'var(--border)',
              borderRight: to === '/settings' ? 'var(--border)' : 'none',
              background: isActive ? 'var(--color-black)' : 'transparent',
              color: isActive ? 'var(--color-white)' : 'var(--color-black)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              height: '100%',
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <CookieBanner />
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/video/:id" element={<VideoEditor />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/notes/:id" element={<NoteEditor />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:id" element={<AccountDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

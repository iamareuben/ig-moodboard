import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listNotes, createNote, deleteNote } from '../api.js';

function NoteCard({ note, onDelete }) {
  const date = new Date(note.updated_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div style={{
      background: 'var(--color-white)',
      border: 'var(--border)',
      display: 'flex',
      alignItems: 'stretch',
    }}>
      <Link
        to={`/notes/${note.id}`}
        style={{
          flex: 1,
          padding: '16px 20px',
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: '6px',
        }}>
          {note.title || 'Untitled'}
        </p>
        <p className="label">Updated {date}</p>
      </Link>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
        style={{
          borderLeft: 'var(--border)',
          padding: '0 14px',
          background: 'transparent',
          border: 'none',
          borderLeft: 'var(--border)',
          color: 'var(--color-muted)',
          fontSize: '16px',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        title="Delete note"
      >
        ×
      </button>
    </div>
  );
}

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    listNotes().then(setNotes).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const note = await createNote({ title: 'Untitled', content: '{}' });
    navigate(`/notes/${note.id}`);
  }

  async function handleDelete(id) {
    await deleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: 'var(--border)',
        background: 'var(--color-white)',
      }}>
        <span className="label">{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
        <button className="primary" onClick={handleCreate}>+ New Note</button>
      </div>

      <main style={{ padding: '24px', maxWidth: '720px' }}>
        {loading ? (
          <p className="label">Loading...</p>
        ) : notes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-muted)',
              marginBottom: '24px',
            }}>
              No notes yet
            </p>
            <button className="primary" onClick={handleCreate}>
              + Create Your First Note
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

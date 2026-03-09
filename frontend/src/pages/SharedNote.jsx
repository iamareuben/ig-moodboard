import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TiptapLink from '@tiptap/extension-link';
import { SocialVideoBlock, SharedVideoContext } from '../components/SocialVideoExtension.jsx';
import { getSharedNote, updateSharedNote, getSharedNoteHistory, getSharedNoteHistoryEntry } from '../api.js';
import SharedVideoModal from '../components/SharedVideoModal.jsx';

const SAVE_DEBOUNCE_MS = 1500;
const MONO = 'var(--font-mono)';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function HistoryPanel({ shareId, onRestore, onClose }) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);

  useEffect(() => {
    getSharedNoteHistory(shareId)
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [shareId]);

  async function handleRestore(entry) {
    setRestoring(entry.id);
    try {
      const full = await getSharedNoteHistoryEntry(shareId, entry.id);
      onRestore(full);
    } catch (err) {
      console.error(err);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div style={{
      width: '280px', borderLeft: 'var(--border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      background: 'var(--color-white)',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: 'var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Edit history
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: '14px', color: 'var(--color-muted)', padding: '0 2px' }}
        >
          ×
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: '16px', fontFamily: MONO, fontSize: '11px', color: 'var(--color-muted)' }}>Loading…</div>
        ) : !entries?.length ? (
          <div style={{ padding: '16px', fontFamily: MONO, fontSize: '11px', color: 'var(--color-muted)' }}>No history yet.</div>
        ) : entries.map((entry) => (
          <div key={entry.id} style={{ padding: '10px 16px', borderBottom: 'var(--border)' }}>
            <div style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.title || '(Untitled)'}
            </div>
            <div style={{ fontFamily: MONO, fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px' }}>
              {formatDate(entry.saved_at)}
            </div>
            <button
              onClick={() => handleRestore(entry)}
              disabled={restoring === entry.id}
              style={{
                fontFamily: MONO, fontSize: '9px', letterSpacing: '0.06em', textTransform: 'uppercase',
                border: 'var(--border)', background: 'transparent', color: 'var(--color-black)',
                padding: '3px 8px', cursor: 'pointer', opacity: restoring === entry.id ? 0.5 : 1,
              }}
            >
              {restoring === entry.id ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SharedNote() {
  const { shareId } = useParams();
  const [share, setShare] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [preloadedVideos, setPreloadedVideos] = useState({});
  const [videoModalId, setVideoModalId] = useState(null);
  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);

  const isEdit = share?.mode === 'edit';

  // Context value: provides video data + URL builders to SocialVideoBlock node views.
  // Using context (not extension options) because TipTap node views don't re-render
  // when extension options are mutated after creation.
  const sharedCtx = useMemo(() => ({
    videos: preloadedVideos,
    frameUrlBuilder: (videoId, frameFile) => `/api/share/${shareId}/media/${videoId}/${frameFile}`,
    onVideoClick: (videoId) => setVideoModalId(videoId),
  }), [preloadedVideos, shareId]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ inline: false, allowBase64: true }),
      TiptapLink.configure({
        openOnClick: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      // onVideoClick is set here too (works at init time); context also provides it
      SocialVideoBlock.configure({ onVideoClick: null }),
    ],
    content: '',
    editable: false,
    onUpdate: ({ editor }) => {
      if (!initialLoadDone.current || !isEdit) return;
      setSaveStatus('unsaved');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        doSave(title, editor.getJSON());
      }, SAVE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    getSharedNote(shareId)
      .then(({ share, note, videos }) => {
        setShare(share);
        setTitle(note.title || '');
        setPreloadedVideos(videos || {});
        try {
          const content = JSON.parse(note.content);
          editor?.commands.setContent(content);
        } catch {
          editor?.commands.setContent('');
        }
        if (share.mode === 'edit') editor?.setEditable(true);
        initialLoadDone.current = true;
        setSaveStatus('saved');
      })
      .catch((err) => setError(err.message));
  }, [shareId, editor]);

  async function doSave(currentTitle, content) {
    setSaveStatus('saving');
    try {
      await updateSharedNote(shareId, {
        title: currentTitle,
        content: JSON.stringify(content),
      });
      setSaveStatus('saved');
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setSaveStatus('unsaved');
      console.error(err);
    }
  }

  function handleTitleChange(e) {
    const val = e.target.value;
    setTitle(val);
    if (!initialLoadDone.current || !isEdit) return;
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (editor) doSave(val, editor.getJSON());
    }, SAVE_DEBOUNCE_MS);
  }

  function handleRestore(entry) {
    try {
      editor?.commands.setContent(JSON.parse(entry.content));
      setTitle(entry.title);
      setSaveStatus('unsaved');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (editor) doSave(entry.title, editor.getJSON());
      }, SAVE_DEBOUNCE_MS);
    } catch (err) {
      console.error(err);
    }
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: MONO, fontSize: '13px', color: '#666' }}>
        {error === 'Share link not found' ? 'This share link has been revoked or does not exist.' : `Error: ${error}`}
      </div>
    );
  }

  if (!share) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: MONO, fontSize: '11px', color: '#aaa' }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--color-white)', borderBottom: 'var(--border)',
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0,
      }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
          Vinspo
        </span>

        {isEdit ? (
          <input
            value={title}
            onChange={handleTitleChange}
            placeholder="Note title"
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontFamily: MONO, fontSize: '13px', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              outline: 'none', padding: 0,
            }}
          />
        ) : (
          <span style={{ flex: 1, fontFamily: MONO, fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {title || 'Untitled'}
          </span>
        )}

        <span style={{
          fontFamily: MONO, fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase',
          border: 'var(--border)', padding: '2px 8px',
          background: isEdit ? 'var(--color-black)' : 'transparent',
          color: isEdit ? 'var(--color-white)' : 'var(--color-black)',
          flexShrink: 0,
        }}>
          {isEdit ? 'Editable' : 'Read-only'}
        </span>

        {isEdit && (
          <span style={{ fontFamily: MONO, fontSize: '10px', color: 'var(--color-muted)', whiteSpace: 'nowrap', minWidth: '50px', textAlign: 'right' }}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? '●' : 'Saved'}
          </span>
        )}

        {isEdit && (
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            style={{
              fontFamily: MONO, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
              border: 'var(--border)',
              background: historyOpen ? 'var(--color-black)' : 'transparent',
              color: historyOpen ? 'var(--color-white)' : 'var(--color-black)',
              padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            History
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '40px 24px' }}>
          <div style={{ width: '100%', maxWidth: '720px' }}>
            {/* Wrap editor in context so node views get preloaded data + URL builders */}
            <SharedVideoContext.Provider value={sharedCtx}>
              <EditorContent editor={editor} />
            </SharedVideoContext.Provider>
          </div>
        </div>

        {isEdit && historyOpen && (
          <HistoryPanel
            key={historyKey}
            shareId={shareId}
            onRestore={handleRestore}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>

      {/* Video modal */}
      {videoModalId && (
        <SharedVideoModal
          shareId={shareId}
          videoId={videoModalId}
          onClose={() => setVideoModalId(null)}
        />
      )}
    </div>
  );
}

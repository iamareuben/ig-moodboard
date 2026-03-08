import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TiptapLink from '@tiptap/extension-link';
import { DOMParser as PMMParser } from '@tiptap/pm/model';
import { getNote, updateNote, submitVideo, listVideos } from '../api.js';
import { SocialVideoBlock, detectSocialPlatform } from '../components/SocialVideoExtension.jsx';
import { buildVideoFinderExtension } from '../components/VideoFinderExtension.js';
import VideoPane from '../components/VideoPane.jsx';

const SAVE_DEBOUNCE_MS = 1200;

function ToolbarBtn({ active, onClick, children, title }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      style={{
        background: active ? 'var(--color-black)' : 'transparent',
        color: active ? 'var(--color-white)' : 'var(--color-black)',
        border: 'none',
        padding: '5px 9px',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        letterSpacing: 0,
        cursor: 'pointer',
        textTransform: 'none',
      }}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }) {
  if (!editor) return null;
  return (
    <div style={{
      display: 'flex',
      gap: '1px',
      padding: '6px 16px',
      borderBottom: 'var(--border)',
      background: 'var(--color-white)',
      flexShrink: 0,
      flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      <ToolbarBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1">H1</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2">H2</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3">H3</ToolbarBtn>
      <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} />
      <ToolbarBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><strong>B</strong></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">`</ToolbarBtn>
      <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} />
      <ToolbarBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">•</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list">1.</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">"</ToolbarBtn>
      <ToolbarBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">—</ToolbarBtn>
    </div>
  );
}

export default function NoteEditor() {
  const { id } = useParams();
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved'
  const [videoPane, setVideoPane] = useState(null); // videoId or null
  const [loadingVideo, setLoadingVideo] = useState(false);
  const videoListRef = useRef([]);
  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);

  const handleVideoClick = useCallback((videoId) => {
    setVideoPane(videoId);
  }, []);

  // Load video list for VideoFinder (use ref so extension always reads latest)
  useEffect(() => {
    listVideos().then((vids) => {
      videoListRef.current = vids.filter((v) => v.status === 'ready');
    }).catch(() => {});
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({
        placeholder: 'Start writing… Paste an Instagram or TikTok link to embed a video. Type / to find a saved video.',
      }),
      TiptapLink.configure({
        openOnClick: false,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      SocialVideoBlock.configure({
        onVideoClick: handleVideoClick,
      }),
      buildVideoFinderExtension(() => videoListRef.current),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (!initialLoadDone.current) return;
      setSaveStatus('unsaved');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        doSave(editor.getJSON());
      }, SAVE_DEBOUNCE_MS);
    },
    editorProps: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') || '';
        const html = event.clipboardData?.getData('text/html') || '';

        const lines = text.split('\n');
        const hasBareUrls = lines.some((l) => detectSocialPlatform(l.trim()));

        // Also check for social URLs hiding in <a href> attributes
        const hasLinkedUrls = (() => {
          if (!html) return false;
          try {
            const tmp = new window.DOMParser().parseFromString(html, 'text/html');
            return [...tmp.querySelectorAll('a[href]')].some(
              (a) => detectSocialPlatform(a.getAttribute('href') || ''),
            );
          } catch { return false; }
        })();

        // No social URLs anywhere — let TipTap handle natively (preserves headings, bold, links)
        if (!hasBareUrls && !hasLinkedUrls) return false;

        event.preventDefault();

        const schema = view.state.schema;
        const nodes = [];
        const socialUrlsToSubmit = [];

        if (html) {
          const domDoc = new window.DOMParser().parseFromString(html, 'text/html');
          const pmParser = PMMParser.fromSchema(schema);
          let buffer = domDoc.createElement('div');

          function flushBuffer() {
            if (!buffer.hasChildNodes()) return;
            try {
              const parsed = pmParser.parse(buffer);
              parsed.content.forEach((n) => nodes.push(n));
            } catch {
              const t = buffer.textContent.trim();
              if (t) nodes.push(schema.nodes.paragraph.create(null, schema.text(t)));
            }
            buffer = domDoc.createElement('div');
          }

          // Split a block element at any social <a> links it contains, inserting video
          // cards as block-level breaks. Parts before/after keep the parent tag (h1, p, etc).
          function splitBlockAtSocialLinks(blockEl) {
            const tag = blockEl.tagName || 'P';
            let frag = domDoc.createElement(tag);

            function flushFrag() {
              if (!frag.hasChildNodes()) return;
              const wrapper = domDoc.createElement('div');
              wrapper.appendChild(frag);
              try {
                const parsed = pmParser.parse(wrapper);
                parsed.content.forEach((n) => nodes.push(n));
              } catch {
                const t = frag.textContent.trim();
                if (t) nodes.push(schema.nodes.paragraph.create(null, schema.text(t)));
              }
              frag = domDoc.createElement(tag);
            }

            for (const cn of [...blockEl.childNodes]) {
              const href = cn.nodeName === 'A' ? (cn.getAttribute?.('href') || '') : '';
              const anchorPlatform = href ? detectSocialPlatform(href) : null;
              if (anchorPlatform) {
                flushFrag();
                nodes.push(schema.nodes.socialVideoBlock.create({
                  url: href, platform: anchorPlatform, videoId: null, status: 'pending',
                }));
                socialUrlsToSubmit.push(href);
              } else {
                frag.appendChild(cn.cloneNode(true));
              }
            }
            flushFrag();
          }

          for (const child of [...domDoc.body.childNodes]) {
            if (child.nodeType !== 1) {
              buffer.appendChild(child.cloneNode(true));
              continue;
            }
            const txt = (child.textContent || '').trim();
            const barePlatform = detectSocialPlatform(txt);
            if (barePlatform) {
              // Entire block is a bare social URL
              flushBuffer();
              nodes.push(schema.nodes.socialVideoBlock.create({
                url: txt, platform: barePlatform, videoId: null, status: 'pending',
              }));
              socialUrlsToSubmit.push(txt);
            } else {
              // Check for social links within the block
              const hasSocialLink = [...child.querySelectorAll('a[href]')].some(
                (a) => detectSocialPlatform(a.getAttribute('href') || ''),
              );
              if (hasSocialLink) {
                flushBuffer();
                splitBlockAtSocialLinks(child);
              } else {
                buffer.appendChild(child.cloneNode(true));
              }
            }
          }
          flushBuffer();
        } else {
          // Plain text fallback
          let textBuffer = [];

          function flushText() {
            const joined = textBuffer.join('\n');
            const paras = joined.split(/\n{2,}/);
            for (const para of paras) {
              const trimmed = para.trim();
              if (trimmed) {
                try {
                  nodes.push(schema.nodes.paragraph.create(null, schema.text(trimmed)));
                } catch {
                  nodes.push(schema.nodes.paragraph.create());
                }
              }
            }
            textBuffer = [];
          }

          for (const rawLine of lines) {
            const line = rawLine.trim();
            const platform = detectSocialPlatform(line);
            if (platform && line) {
              flushText();
              nodes.push(schema.nodes.socialVideoBlock.create({
                url: line, platform, videoId: null, status: 'pending',
              }));
              socialUrlsToSubmit.push(line);
            } else {
              textBuffer.push(rawLine);
            }
          }
          flushText();
        }

        if (nodes.length === 0) return false;

        const { tr } = view.state;
        const { from, to } = tr.selection;
        tr.replaceWith(from, to, nodes);
        view.dispatch(tr);

        for (const url of socialUrlsToSubmit) {
          submitVideo(url).then(({ id: videoId }) => {
            view.state.doc.descendants((node, pos) => {
              if (
                node.type.name === 'socialVideoBlock' &&
                node.attrs.url === url &&
                !node.attrs.videoId
              ) {
                view.dispatch(
                  view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, videoId, status: 'pending' })
                );
                return false;
              }
            });
          }).catch(console.error);
        }

        return true;
      },
    },
  });

  // Load note
  useEffect(() => {
    if (!editor) return;
    getNote(id).then((note) => {
      setTitle(note.title || '');
      try {
        const content = JSON.parse(note.content);
        editor.commands.setContent(content);
      } catch {
        editor.commands.setContent('');
      }
      initialLoadDone.current = true;
      setSaveStatus('saved');
    }).catch(console.error);
  }, [id, editor]);

  async function doSave(content) {
    setSaveStatus('saving');
    try {
      await updateNote(id, {
        title,
        content: JSON.stringify(content),
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('unsaved');
    }
  }

  function handleTitleChange(e) {
    setTitle(e.target.value);
    if (!initialLoadDone.current) return;
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (editor) doSave(editor.getJSON());
    }, SAVE_DEBOUNCE_MS);
  }

  function handleTitleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.focus();
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--color-bg)',
    }}>
      {/* Editor header */}
      <div style={{
        background: 'var(--color-white)',
        borderBottom: 'var(--border)',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexShrink: 0,
      }}>
        <Link to="/notes" style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}>
          ← Notes
        </Link>
        <input
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
          placeholder="Note title"
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            outline: 'none',
            padding: 0,
          }}
        />
        <span className="label" style={{ whiteSpace: 'nowrap', minWidth: '50px', textAlign: 'right' }}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? '●' : 'Saved'}
        </span>
      </div>

      <Toolbar editor={editor} />

      {/* Editor body */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '40px 24px',
      }}>
        <div style={{ width: '100%', maxWidth: '720px' }}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* VideoPane overlay */}
      {videoPane && (
        <VideoPane videoId={videoPane} onClose={() => setVideoPane(null)} />
      )}
    </div>
  );
}

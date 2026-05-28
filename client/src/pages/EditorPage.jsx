import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUser() {
  return {
    name:  localStorage.getItem('novelUsername') || 'Anonymous',
    color: localStorage.getItem('novelColor')    || '#60A5FA',
  };
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Editor Page ───────────────────────────────────────────────────────────────

export default function EditorPage() {
  const { id: novelId } = useParams();
  const navigate        = useNavigate();
  const user            = useMemo(getUser, []);

  const [title, setTitle]               = useState('');
  const [collaborators, setCollaborators] = useState([]);
  const [status, setStatus]             = useState('connecting');
  const [wordCount, setWordCount]       = useState(0);
  const [copied, setCopied]             = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const downloadRef                     = useRef(null);

  // ── Yjs + WebSocket provider (created once) ──────────────────────────────
  const { ydoc, provider } = useMemo(() => {
    const ydoc = new Y.Doc();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const provider = new WebsocketProvider(
      `${proto}//${window.location.host}/ws`,
      novelId,
      ydoc
    );
    provider.awareness.setLocalStateField('user', user);
    return { ydoc, provider };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  // Destroy provider on unmount
  useEffect(() => () => provider.destroy(), [provider]);

  // ── Connection status ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = ({ status }) => setStatus(status);
    provider.on('status', handler);
    return () => provider.off('status', handler);
  }, [provider]);

  // ── Synced title (via Yjs shared map) ───────────────────────────────────
  useEffect(() => {
    const meta = ydoc.getMap('meta');
    const sync = () => { const t = meta.get('title'); if (t) setTitle(t); };
    meta.observe(sync);
    sync();
    return () => meta.unobserve(sync);
  }, [ydoc]);

  const handleTitleChange = useCallback((e) => {
    const val = e.target.value;
    setTitle(val);
    ydoc.getMap('meta').set('title', val);
  }, [ydoc]);

  // ── Live collaborators (awareness) ───────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const list = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (state.user && clientId !== provider.awareness.clientID) {
          list.push({ ...state.user, clientId });
        }
      });
      setCollaborators(list);
    };
    provider.awareness.on('change', update);
    return () => provider.awareness.off('change', update);
  }, [provider]);

  // ── Tiptap editor ────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }), // Yjs handles undo/redo
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({ provider, user }),
    ],
    editorProps: {
      attributes: { 'data-placeholder': 'Once upon a time…' },
    },
    onUpdate: ({ editor }) => {
      setWordCount(countWords(editor.getText()));
    },
  });

  // ── Close download menu on outside click ─────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target)) {
        setShowDownload(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Download helpers ─────────────────────────────────────────────────────
  const downloadAs = useCallback((type) => {
    if (!editor) return;
    setShowDownload(false);
    const safeTitle = title || 'novel';

    if (type === 'txt') {
      const content = `${safeTitle}\n${'─'.repeat(safeTitle.length)}\n\n${editor.getText({ blockSeparator: '\n\n' })}`;
      trigger(content, 'text/plain', `${safeTitle}.txt`);
    } else {
      const html = buildHtmlDoc(safeTitle, editor.getHTML());
      trigger(html, 'text/html', `${safeTitle}.html`);
    }
  }, [editor, title]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // ── Toolbar shortcut ─────────────────────────────────────────────────────
  const tb = (action) => editor?.chain().focus()[action]().run();

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="editor-page">

      {/* Top header */}
      <header className="editor-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Home</button>

        <input
          className="title-input"
          value={title}
          onChange={handleTitleChange}
          placeholder="Novel title…"
          maxLength={120}
        />

        <div className="header-right">
          {/* Collaborators */}
          <div className="collaborators">
            {collaborators.slice(0, 5).map(c => (
              <div
                key={c.clientId}
                className="collab-avatar"
                style={{ background: c.color }}
                title={c.name}
              >
                {initials(c.name)}
              </div>
            ))}
            {collaborators.length > 5 && (
              <div className="collab-avatar" style={{ background: '#555' }}>
                +{collaborators.length - 5}
              </div>
            )}
          </div>

          {/* Copy link */}
          <button
            className={`icon-btn${copied ? ' copied' : ''}`}
            onClick={copyLink}
            title="Copy share link"
          >
            {copied ? '✓ Copied' : '🔗 Share'}
          </button>

          {/* Download */}
          <div className="download-wrapper" ref={downloadRef}>
            <button
              className="icon-btn"
              onClick={() => setShowDownload(v => !v)}
            >
              ↓ Download
            </button>
            {showDownload && (
              <div className="download-menu">
                <button onClick={() => downloadAs('txt')}>Plain text (.txt)</button>
                <button onClick={() => downloadAs('html')}>Web page (.html)</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Formatting toolbar */}
      <div className="toolbar">
        <button className={`toolbar-btn${editor?.isActive('bold')      ? ' is-active':''}`} onClick={() => tb('toggleBold')}    title="Bold (Ctrl+B)"><b>B</b></button>
        <button className={`toolbar-btn${editor?.isActive('italic')    ? ' is-active':''}`} onClick={() => tb('toggleItalic')}  title="Italic (Ctrl+I)"><i>I</i></button>
        <button className={`toolbar-btn${editor?.isActive('strike')    ? ' is-active':''}`} onClick={() => tb('toggleStrike')}  title="Strikethrough"><s>S</s></button>
        <div className="toolbar-sep" />
        <button className={`toolbar-btn${editor?.isActive('heading',{level:1})?' is-active':''}`} onClick={() => editor?.chain().focus().toggleHeading({level:1}).run()} title="Heading 1">H1</button>
        <button className={`toolbar-btn${editor?.isActive('heading',{level:2})?' is-active':''}`} onClick={() => editor?.chain().focus().toggleHeading({level:2}).run()} title="Heading 2">H2</button>
        <button className={`toolbar-btn${editor?.isActive('heading',{level:3})?' is-active':''}`} onClick={() => editor?.chain().focus().toggleHeading({level:3}).run()} title="Heading 3">H3</button>
        <div className="toolbar-sep" />
        <button className={`toolbar-btn${editor?.isActive('blockquote')?' is-active':''}`} onClick={() => tb('toggleBlockquote')} title="Quote">❝</button>
        <button className={`toolbar-btn${editor?.isActive('bulletList')?' is-active':''}`} onClick={() => tb('toggleBulletList')} title="Bullet list">•</button>
        <button className={`toolbar-btn${editor?.isActive('orderedList')?' is-active':''}`} onClick={() => tb('toggleOrderedList')} title="Numbered list">1.</button>
        <div className="toolbar-sep" />
        <button className="toolbar-btn" onClick={() => editor?.chain().focus().setHorizontalRule().run()} title="Scene break">—</button>
        <div className="toolbar-sep" />
        <button className="toolbar-btn" onClick={() => editor?.chain().focus().undo().run()} title="Undo (Ctrl+Z)">↩</button>
        <button className="toolbar-btn" onClick={() => editor?.chain().focus().redo().run()} title="Redo (Ctrl+Y)">↪</button>
      </div>

      {/* Editor */}
      <div className="editor-scroll">
        <EditorContent editor={editor} />
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <span>
          <span className={`status-dot ${status}`} />
          {status === 'connected'
            ? `Connected · ${collaborators.length} other writer${collaborators.length !== 1 ? 's' : ''} online`
            : status === 'connecting'
            ? 'Connecting…'
            : 'Disconnected — changes may not save'}
        </span>
        <span>{wordCount.toLocaleString()} word{wordCount !== 1 ? 's' : ''}</span>
      </div>

    </div>
  );
}

// ── Utils ────────────────────────────────────────────────────────────────────

function trigger(content, type, filename) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function buildHtmlDoc(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <style>
    body{font-family:Georgia,'Times New Roman',serif;max-width:700px;margin:60px auto;
         line-height:1.85;font-size:18px;color:#1f1e1c;padding:0 1.5rem;}
    h1{font-size:2.4rem;margin-bottom:.5em;line-height:1.2;}
    h2{font-size:1.7rem;margin:1.5em 0 .5em;}
    h3{font-size:1.3rem;margin:1.2em 0 .4em;}
    p{margin:0 0 1.1em;}
    blockquote{border-left:3px solid #c4813a;margin:1.5em 0;padding:.4em 1.5em;
               color:#5a5045;font-style:italic;}
    hr{border:none;border-top:1px solid #ccc;margin:2em auto;width:50%;}
    ul,ol{padding-left:1.8em;margin:0 0 1em;}
    li{margin-bottom:.3em;}
  </style>
</head>
<body>
  <h1>${escHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

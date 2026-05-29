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
function countWords(text) { return text.trim().split(/\s+/).filter(Boolean).length; }
function initials(name)   { return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

// ── Editor Page ───────────────────────────────────────────────────────────────

export default function EditorPage() {
  const { id: novelId } = useParams();
  const navigate        = useNavigate();
  const user            = useMemo(getUser, []);

  // General state
  const [title, setTitle]                   = useState('');
  const [collaborators, setCollaborators]   = useState([]);
  const [status, setStatus]                 = useState('connecting');
  const [wordCount, setWordCount]           = useState(0);
  const [copied, setCopied]                 = useState(false);
  const [showDownload, setShowDownload]     = useState(false);
  const downloadRef                         = useRef(null);

  // Chapter state
  const [chapters, setChapters]             = useState([]);
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [editingChapterId, setEditingChapterId] = useState(null);
  const [editingTitle, setEditingTitle]     = useState('');
  const [sidebarOpen, setSidebarOpen]       = useState(true);
  const [synced, setSynced]                 = useState(false);

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

  useEffect(() => () => provider.destroy(), [provider]);

  // ── Initial sync signal ──────────────────────────────────────────────────
  // Wait for y-websocket to fully sync before initialising chapters,
  // so we don't create a duplicate "Chapter 1" on reconnect.
  useEffect(() => {
    const handler = (isSynced) => { if (isSynced) setSynced(true); };
    provider.on('sync', handler);
    return () => provider.off('sync', handler);
  }, [provider]);

  // ── Connection status ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = ({ status }) => setStatus(status);
    provider.on('status', handler);
    return () => provider.off('status', handler);
  }, [provider]);

  // ── Title (Yjs shared map) ───────────────────────────────────────────────
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

  // ── Chapters (Yjs shared map) ────────────────────────────────────────────
  // chaptersMap: chapterId → { title: string, order: number }
  const chaptersMap = useMemo(() => ydoc.getMap('chapters'), [ydoc]);

  useEffect(() => {
    const sync = () => {
      const list = [];
      chaptersMap.forEach((val, id) => list.push({ id, ...val }));
      list.sort((a, b) => a.order - b.order);
      setChapters(list);
    };
    chaptersMap.observe(sync);
    sync();
    return () => chaptersMap.unobserve(sync);
  }, [chaptersMap]);

  // After sync: auto-create Chapter 1 for brand-new novels, or pick first chapter
  useEffect(() => {
    if (!synced) return;
    if (chapters.length === 0) {
      const id = crypto.randomUUID();
      chaptersMap.set(id, { title: 'Chapter 1', order: 0 });
    } else if (!activeChapterId || !chapters.find(c => c.id === activeChapterId)) {
      setActiveChapterId(chapters[0].id);
    }
  }, [synced, chapters, activeChapterId, chaptersMap]);

  // ── Chapter CRUD ─────────────────────────────────────────────────────────
  const addChapter = useCallback(() => {
    const id    = crypto.randomUUID();
    const order = chapters.length;
    chaptersMap.set(id, { title: `Chapter ${order + 1}`, order });
    setActiveChapterId(id);
  }, [chaptersMap, chapters.length]);

  const startRename = useCallback((ch) => {
    setEditingChapterId(ch.id);
    setEditingTitle(ch.title);
  }, []);

  const commitRename = useCallback(() => {
    if (editingChapterId) {
      const existing = chaptersMap.get(editingChapterId);
      if (existing && editingTitle.trim()) {
        chaptersMap.set(editingChapterId, { ...existing, title: editingTitle.trim() });
      }
    }
    setEditingChapterId(null);
    setEditingTitle('');
  }, [chaptersMap, editingChapterId, editingTitle]);

  const deleteChapter = useCallback((id) => {
    if (chapters.length <= 1) return; // always keep at least one chapter
    if (!window.confirm('Delete this chapter? Its content will be lost.')) return;
    chaptersMap.delete(id);
    if (activeChapterId === id) {
      const remaining = chapters.filter(c => c.id !== id);
      setActiveChapterId(remaining[0]?.id ?? null);
    }
  }, [chaptersMap, chapters, activeChapterId]);

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

  // ── Tiptap editor ─────────────────────────────────────────────────────────
  // Using activeChapterId as a dep causes the editor to be destroyed and
  // recreated whenever the writer switches chapters, loading the correct
  // Y.XmlFragment for that chapter via the `field` option.
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc, field: activeChapterId || 'default' }),
      CollaborationCursor.configure({ provider, user }),
    ],
    editorProps: {
      attributes: { 'data-placeholder': 'Begin writing your chapter…' },
    },
    onUpdate: ({ editor }) => setWordCount(countWords(editor.getText())),
  }, [activeChapterId]);

  // ── Download ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target))
        setShowDownload(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const activeChapter = chapters.find(c => c.id === activeChapterId);

  const downloadAs = useCallback((type) => {
    if (!editor) return;
    setShowDownload(false);
    const safeTitle = title    || 'novel';
    const chTitle   = activeChapter?.title || 'Chapter';

    if (type === 'txt') {
      const content = `${safeTitle}\n${'═'.repeat(safeTitle.length)}\n\n${chTitle}\n${'─'.repeat(chTitle.length)}\n\n${editor.getText({ blockSeparator: '\n\n' })}`;
      triggerDownload(content, 'text/plain', `${safeTitle} - ${chTitle}.txt`);
    } else {
      triggerDownload(buildHtmlDoc(safeTitle, chTitle, editor.getHTML()), 'text/html', `${safeTitle} - ${chTitle}.html`);
    }
  }, [editor, title, activeChapter]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="editor-page">
      {/* Inject chapter sidebar styles without touching index.css */}
      <style>{CHAPTER_STYLES}</style>

      {/* ── Top header ── */}
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
          {/* Live collaborator avatars */}
          <div className="collaborators">
            {collaborators.slice(0, 5).map(c => (
              <div key={c.clientId} className="collab-avatar" style={{ background: c.color }} title={c.name}>
                {initials(c.name)}
              </div>
            ))}
            {collaborators.length > 5 && (
              <div className="collab-avatar" style={{ background: '#555' }}>+{collaborators.length - 5}</div>
            )}
          </div>

          <button className={`icon-btn${copied ? ' copied' : ''}`} onClick={copyLink}>
            {copied ? '✓ Copied' : '🔗 Share'}
          </button>

          <div className="download-wrapper" ref={downloadRef}>
            <button className="icon-btn" onClick={() => setShowDownload(v => !v)}>↓ Download</button>
            {showDownload && (
              <div className="download-menu">
                <button onClick={() => downloadAs('txt')}>Current chapter (.txt)</button>
                <button onClick={() => downloadAs('html')}>Current chapter (.html)</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main body: sidebar + editor ── */}
      <div className="editor-body">

        {/* ── Chapters sidebar ── */}
        <aside className={`chapters-sidebar${sidebarOpen ? '' : ' collapsed'}`}>
          <div className="chapters-header">
            {sidebarOpen && <span className="chapters-label">Chapters</span>}
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(v => !v)}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen ? '‹' : '›'}
            </button>
          </div>

          {sidebarOpen && (
            <>
              <div className="chapters-list">
                {chapters.map((ch, i) => (
                  <div
                    key={ch.id}
                    className={`chapter-item${ch.id === activeChapterId ? ' active' : ''}`}
                    onClick={() => setActiveChapterId(ch.id)}
                  >
                    {editingChapterId === ch.id ? (
                      /* Rename input */
                      <input
                        className="chapter-rename-input"
                        value={editingTitle}
                        autoFocus
                        onChange={e => setEditingTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') { setEditingChapterId(null); setEditingTitle(''); }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="chapter-num">{i + 1}</span>
                        <span
                          className="chapter-name"
                          title="Double-click to rename"
                          onDoubleClick={e => { e.stopPropagation(); startRename(ch); }}
                        >
                          {ch.title}
                        </span>
                        {chapters.length > 1 && (
                          <button
                            className="chapter-del"
                            title="Delete chapter"
                            onClick={e => { e.stopPropagation(); deleteChapter(ch.id); }}
                          >
                            ×
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <button className="add-chapter-btn" onClick={addChapter}>
                + Add Chapter
              </button>
            </>
          )}
        </aside>

        {/* ── Editor area ── */}
        <div className="editor-main">
          {/* Formatting toolbar */}
          <div className="toolbar">
            <button className={`toolbar-btn${editor?.isActive('bold')        ? ' is-active':''}`} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
            <button className={`toolbar-btn${editor?.isActive('italic')      ? ' is-active':''}`} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
            <button className={`toolbar-btn${editor?.isActive('strike')      ? ' is-active':''}`} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></button>
            <div className="toolbar-sep" />
            <button className={`toolbar-btn${editor?.isActive('heading',{level:1})?' is-active':''}`} onClick={() => editor?.chain().focus().toggleHeading({level:1}).run()}>H1</button>
            <button className={`toolbar-btn${editor?.isActive('heading',{level:2})?' is-active':''}`} onClick={() => editor?.chain().focus().toggleHeading({level:2}).run()}>H2</button>
            <button className={`toolbar-btn${editor?.isActive('heading',{level:3})?' is-active':''}`} onClick={() => editor?.chain().focus().toggleHeading({level:3}).run()}>H3</button>
            <div className="toolbar-sep" />
            <button className={`toolbar-btn${editor?.isActive('blockquote')  ? ' is-active':''}`} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❝</button>
            <button className={`toolbar-btn${editor?.isActive('bulletList')  ? ' is-active':''}`} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
            <button className={`toolbar-btn${editor?.isActive('orderedList') ? ' is-active':''}`} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
            <div className="toolbar-sep" />
            <button className="toolbar-btn" onClick={() => editor?.chain().focus().setHorizontalRule().run()} title="Scene break">—</button>
            <div className="toolbar-sep" />
            <button className="toolbar-btn" onClick={() => editor?.chain().focus().undo().run()} title="Undo (Ctrl+Z)">↩</button>
            <button className="toolbar-btn" onClick={() => editor?.chain().focus().redo().run()} title="Redo">↪</button>
          </div>

          {/* Scrollable editor with chapter title heading */}
          <div className="editor-scroll">
            {activeChapter && (
              <div className="chapter-heading">{activeChapter.title}</div>
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
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

// ── Chapter sidebar styles (injected inline to keep changes to one file) ─────

const CHAPTER_STYLES = `
  .editor-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* Sidebar */
  .chapters-sidebar {
    width: 210px;
    flex-shrink: 0;
    background: #10102a;
    border-right: 1px solid rgba(255,255,255,0.07);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.2s ease;
  }
  .chapters-sidebar.collapsed { width: 38px; }

  .chapters-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0.75rem 0.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    flex-shrink: 0;
  }
  .chapters-label {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.3);
  }
  .sidebar-toggle {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.3);
    font-size: 1.1rem;
    padding: 0 0.15rem;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s;
  }
  .sidebar-toggle:hover { color: rgba(255,255,255,0.7); }

  .chapters-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.4rem 0;
  }
  .chapters-list::-webkit-scrollbar { width: 3px; }
  .chapters-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: background 0.12s, border-color 0.12s;
    min-height: 36px;
  }
  .chapter-item:hover { background: rgba(255,255,255,0.05); }
  .chapter-item.active {
    background: rgba(196,129,58,0.1);
    border-left-color: #c4813a;
  }

  .chapter-num {
    font-size: 0.62rem;
    font-weight: 700;
    color: rgba(255,255,255,0.22);
    min-width: 14px;
    flex-shrink: 0;
  }
  .chapter-name {
    flex: 1;
    font-size: 0.82rem;
    color: rgba(255,255,255,0.65);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .chapter-item.active .chapter-name { color: #e2dfd8; }

  .chapter-del {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.18);
    font-size: 0.95rem;
    padding: 0 2px;
    line-height: 1;
    opacity: 0;
    flex-shrink: 0;
    cursor: pointer;
    transition: opacity 0.12s, color 0.12s;
  }
  .chapter-item:hover .chapter-del { opacity: 1; }
  .chapter-del:hover { color: #f87171 !important; }

  .chapter-rename-input {
    flex: 1;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(196,129,58,0.5);
    border-radius: 3px;
    color: #e2dfd8;
    font-size: 0.82rem;
    padding: 2px 6px;
    outline: none;
    min-width: 0;
  }

  .add-chapter-btn {
    margin: 0.5rem 0.75rem 0.75rem;
    padding: 0.45rem 0.75rem;
    background: transparent;
    border: 1px dashed rgba(255,255,255,0.13);
    border-radius: 5px;
    color: rgba(255,255,255,0.35);
    font-size: 0.78rem;
    font-weight: 500;
    text-align: center;
    cursor: pointer;
    width: calc(100% - 1.5rem);
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .add-chapter-btn:hover {
    border-color: #c4813a;
    color: #c4813a;
    background: rgba(196,129,58,0.05);
  }

  /* Editor area to the right of sidebar */
  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Chapter title shown above editor content */
  .chapter-heading {
    text-align: center;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.5rem;
    font-weight: 500;
    color: #7a6a5a;
    padding: 2.5rem 2rem 0;
    max-width: 700px;
    margin: 0 auto;
    width: 100%;
    letter-spacing: 0.03em;
    pointer-events: none;
  }

  @media (max-width: 600px) {
    .chapters-sidebar         { width: 160px; }
    .chapters-sidebar.collapsed { width: 32px; }
  }
`;

// ── Download utils ────────────────────────────────────────────────────────────

function triggerDownload(content, type, filename) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function buildHtmlDoc(novelTitle, chapterTitle, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(novelTitle)} — ${esc(chapterTitle)}</title>
  <style>
    body{font-family:Georgia,serif;max-width:700px;margin:60px auto;
         line-height:1.85;font-size:18px;color:#1f1e1c;padding:0 1.5rem;}
    .novel-title{font-size:2.4rem;margin-bottom:.2em;}
    .ch-title{font-size:1.4rem;color:#7a6a5a;font-style:italic;margin-bottom:2.5em;}
    h1{font-size:2rem;margin:1.5em 0 .5em;}
    h2{font-size:1.5rem;margin:1.2em 0 .4em;}
    h3{font-size:1.2rem;margin:1em 0 .35em;}
    p{margin:0 0 1.1em;}
    blockquote{border-left:3px solid #c4813a;margin:1.5em 0;
               padding:.4em 1.5em;color:#5a5045;font-style:italic;}
    hr{border:none;border-top:1px solid #ccc;margin:2em auto;width:50%;}
    ul,ol{padding-left:1.8em;margin:0 0 1em;}
  </style>
</head>
<body>
  <h1 class="novel-title">${esc(novelTitle)}</h1>
  <p  class="ch-title">${esc(chapterTitle)}</p>
  ${body}
</body>
</html>`;
}

function esc(s = '') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

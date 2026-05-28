import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const COLORS = [
  '#F87171', '#FB923C', '#FBBF24', '#34D399',
  '#60A5FA', '#818CF8', '#C084FC', '#F472B6',
];

const ADJECTIVES = ['Swift','Clever','Bold','Vivid','Bright','Keen','Sharp','Witty','Calm','Fierce'];
const NOUNS       = ['Quill','Scribe','Author','Bard','Poet','Muse','Sage','Weaver','Voice','Ink'];

function randomUsername() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a}${n}`;
}

function initUser() {
  if (!localStorage.getItem('novelUsername')) {
    localStorage.setItem('novelUsername', randomUsername());
    localStorage.setItem('novelColor', COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Home() {
  const [novels, setNovels]         = useState([]);
  const [newTitle, setNewTitle]     = useState('');
  const [creating, setCreating]     = useState(false);
  const [loading, setLoading]       = useState(true);
  const [username, setUsernameState] = useState('');
  const [color, setColor]           = useState('');
  const [editingName, setEditingName] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    initUser();
    setUsernameState(localStorage.getItem('novelUsername'));
    setColor(localStorage.getItem('novelColor'));

    fetch('/api/novels')
      .then(r => r.json())
      .then(data => { setNovels(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const createNovel = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/novels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      const novel = await res.json();
      navigate(`/novel/${novel.id}`);
    } catch {
      alert('Could not create novel. Is the server running?');
      setCreating(false);
    }
  };

  const saveUsername = (e) => {
    if (e.key === 'Enter' || e.type === 'blur') {
      const val = e.target.value.trim();
      if (val) {
        localStorage.setItem('novelUsername', val);
        setUsernameState(val);
      }
      setEditingName(false);
    }
  };

  const cycleColor = () => {
    const next = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
    localStorage.setItem('novelColor', next);
    setColor(next);
  };

  return (
    <div className="home">
      {/* ── Header ── */}
      <header className="home-header">
        <div className="logo">
          <svg className="logo-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4h14l6 6v18H6V4z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M20 4v6h6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            <line x1="10" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="10" y1="17" x2="22" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="10" y1="21" x2="17" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          NovelCollab
        </div>
        <p className="tagline">Write stories together, in real time</p>
      </header>

      {/* ── Main ── */}
      <main className="home-main">
        {/* Create */}
        <section className="create-section">
          <h2>Start a new novel</h2>
          <div className="create-form">
            <input
              type="text"
              placeholder="Give your novel a title…"
              value={newTitle}
              maxLength={120}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createNovel()}
              autoFocus
            />
            <button
              className="btn-primary"
              onClick={createNovel}
              disabled={!newTitle.trim() || creating}
            >
              {creating ? 'Creating…' : 'Create Novel'}
            </button>
          </div>
        </section>

        {/* All novels */}
        <section className="novels-section">
          <h2>All novels</h2>
          {loading ? (
            <p className="hint">Loading novels…</p>
          ) : novels.length === 0 ? (
            <p className="hint">No novels yet — create the first one above!</p>
          ) : (
            <div className="novels-grid">
              {novels.map(n => (
                <div
                  key={n.id}
                  className="novel-card"
                  onClick={() => navigate(`/novel/${n.id}`)}
                >
                  <h3>{n.title}</h3>
                  <p className="novel-date">Updated {formatDate(n.updated_at)}</p>
                  <button className="join-btn">Open →</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ── Username banner ── */}
      <footer className="username-banner">
        <span>Writing as</span>
        <span
          className="color-dot"
          style={{ background: color, cursor: 'pointer' }}
          title="Click to change colour"
          onClick={cycleColor}
        />
        {editingName ? (
          <input
            autoFocus
            defaultValue={username}
            onKeyDown={saveUsername}
            onBlur={saveUsername}
            maxLength={30}
          />
        ) : (
          <strong
            style={{ cursor: 'pointer' }}
            title="Click to change your name"
            onClick={() => setEditingName(true)}
          >
            {username}
          </strong>
        )}
        <span style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}>
          (click name or dot to change)
        </span>
      </footer>
    </div>
  );
}

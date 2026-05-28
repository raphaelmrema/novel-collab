const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const Y = require('yjs');
const { setupWSConnection, setPersistence } = require('y-websocket/bin/utils');

const app = express();
const server = http.createServer(app);
// noServer: true — we manually handle the upgrade so we can route /ws/* only
const wss = new WebSocket.Server({ noServer: true });

const isProduction = process.env.NODE_ENV === 'production';

// ─── Database ───────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS novels (
      id         TEXT        PRIMARY KEY,
      title      TEXT        NOT NULL DEFAULT 'Untitled Novel',
      ydoc_state BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✓ Database ready');
}

// ─── Yjs Persistence (PostgreSQL) ────────────────────────────────────────────

setPersistence({
  bindState: async (docName, ydoc) => {
    try {
      const { rows } = await pool.query(
        'SELECT ydoc_state FROM novels WHERE id = $1',
        [docName]
      );
      if (rows[0]?.ydoc_state) {
        Y.applyUpdate(ydoc, new Uint8Array(rows[0].ydoc_state));
      }

      // Debounced save on every update
      let saveTimer;
      ydoc.on('update', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          try {
            const state = Y.encodeStateAsUpdate(ydoc);
            const meta = ydoc.getMap('meta');
            const title = meta.get('title') || 'Untitled Novel';
            await pool.query(
              'UPDATE novels SET ydoc_state = $1, title = $2, updated_at = NOW() WHERE id = $3',
              [Buffer.from(state), title, docName]
            );
          } catch (e) {
            console.error('Save error:', e.message);
          }
        }, 3000);
      });
    } catch (err) {
      console.error('bindState error:', err.message);
    }
  },

  // Called when the last client disconnects — do a final save
  writeState: async (docName, ydoc) => {
    try {
      const state = Y.encodeStateAsUpdate(ydoc);
      const meta = ydoc.getMap('meta');
      const title = meta.get('title') || 'Untitled Novel';
      await pool.query(
        'UPDATE novels SET ydoc_state = $1, title = $2, updated_at = NOW() WHERE id = $3',
        [Buffer.from(state), title, docName]
      );
    } catch (err) {
      console.error('writeState error:', err.message);
    }
  },
});

// ─── WebSocket (Yjs sync + awareness) ────────────────────────────────────────

// Only upgrade connections on the /ws/* path
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/')) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  // Strip /ws/ prefix and any query string to get the novelId as docName
  const novelId = req.url.replace('/ws/', '').split('?')[0];
  setupWSConnection(ws, req, { docName: novelId });
});

// ─── REST API ────────────────────────────────────────────────────────────────

app.use(express.json());

// Create a new novel
app.post('/api/novels', async (req, res) => {
  try {
    const id = uuidv4();
    const title = (req.body.title || 'Untitled Novel').trim() || 'Untitled Novel';
    await pool.query('INSERT INTO novels (id, title) VALUES ($1, $2)', [id, title]);
    res.status(201).json({ id, title });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create novel' });
  }
});

// List all novels
app.get('/api/novels', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, created_at, updated_at FROM novels ORDER BY updated_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list novels' });
  }
});

// Get a single novel
app.get('/api/novels/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, created_at, updated_at FROM novels WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Novel not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch novel' });
  }
});

// ─── Serve React app in production ───────────────────────────────────────────

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────

setupDB()
  .then(() => {
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () =>
      console.log(`✓ NovelCollab running → http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error('Fatal DB error:', err);
    process.exit(1);
  });

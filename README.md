# NovelCollab

Real-time collaborative novel writing platform. Multiple writers can work on the same story simultaneously — seeing each other's cursors and changes live.

## Features

- **Real-time collaboration** — powered by Yjs CRDTs + WebSockets
- **Coloured cursors** — see exactly where each writer is
- **Undo/Redo** — full undo history per writer
- **Auto-save** — content is saved to PostgreSQL automatically
- **Download** — export your novel as plain text or HTML
- **No login** — share a URL and anyone can join instantly

---

## Local Development

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/novel-collab.git
cd novel-collab
npm install
cd client && npm install && cd ..
```

### 2. Set up the database

```bash
createdb novelcollab
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL to your local postgres URL
```

### 4. Run the server

```bash
npm run dev
```

### 5. Run the React dev server (separate terminal)

```bash
cd client
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Deploy to Render (GitHub → Render)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/novel-collab.git
git push -u origin main
```

### Step 2 — Create a PostgreSQL database on Render

1. Go to [render.com](https://render.com) → **New +** → **PostgreSQL**
2. Name: `novelcollab-db` · Plan: **Free**
3. Click **Create Database**
4. Copy the **Internal Database URL** (you'll need it in step 3)

### Step 3 — Create a Web Service on Render

1. **New +** → **Web Service**
2. Connect your GitHub repo
3. Fill in:
   | Field | Value |
   |-------|-------|
   | Name | `novelcollab` (or whatever you like) |
   | Runtime | `Node` |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm start` |
4. **Environment Variables** — add:
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | *(paste Internal Database URL from step 2)* |
   | `NODE_ENV` | `production` |
5. Click **Create Web Service**

> **Tip:** You can also use `render.yaml` — Render will detect it automatically and offer to create both the service and database at once via the Blueprint feature.

Render will build and deploy in ~2 minutes. Your app will be live at  
`https://novelcollab.onrender.com` (or whatever name you chose).

---

## How It Works

```
Browser A ──┐
            ├── WebSocket (/ws/<novelId>) ──► Express server
Browser B ──┘                                    │
                                         y-websocket (Yjs sync)
                                                 │
                                           PostgreSQL (persistence)
```

- Each novel has a unique UUID URL
- The Yjs CRDT engine merges concurrent edits without conflicts
- The title is stored in a Yjs shared map and syncs in real time
- The server auto-saves document state every 3 seconds while writers are active, and on disconnect

---

## Project Structure

```
novel-collab/
├── server.js          # Express + WebSocket + Yjs persistence
├── package.json       # Server dependencies & build scripts
├── render.yaml        # One-click Render deployment
└── client/
    ├── vite.config.js
    └── src/
        ├── App.jsx
        ├── index.css
        └── pages/
            ├── Home.jsx        # Novel list + create
            └── EditorPage.jsx  # Collaborative editor
```

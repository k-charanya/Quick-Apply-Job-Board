# Quick Apply — full-stack job board

A real, standalone job board you can run on your own machine: React frontend,
Express + Socket.IO backend, and a JSON-file database. Nothing here depends on
Claude.ai — it's a normal Node/React project.

## What's inside

```
quickapply/
├── backend/                Express API + Socket.IO + database
│   ├── server.js           entry point
│   ├── db.js                lowdb (JSON file) database setup
│   ├── data/db.json          the actual database file — open it, it's just JSON
│   ├── seedJobs.js          the 24 starter listings
│   ├── middleware/auth.js   JWT signing + verification (server-side secret)
│   └── routes/              auth, jobs, applications, me (saved/trash/history/profile)
└── frontend/                React + Vite app
    ├── src/App.jsx           the whole UI
    ├── src/api.js             fetch wrapper for the backend
    ├── src/socket.js          Socket.IO client (real-time updates)
    └── src/styles.css
```

## Requirements

- Node.js 18 or newer (for both frontend and backend)
- Internet access the first time, to run `npm install` (this sandbox couldn't
  reach the npm registry to test the install for you, so the "does `npm install`
  work" step hasn't been run end-to-end — everything has been syntax-checked,
  but do a smoke test once it's installed)

## 1. Run the backend

```bash
cd backend
npm install
cp .env.example .env      # then edit JWT_SECRET to something random and long
npm run dev                # or: npm start
```

This starts the API on **http://localhost:4000**. The database file lives at
`backend/data/db.json` — it's pre-seeded with 24 sample jobs already, so you
can open it in a text editor at any point and see exactly what's stored
(users, jobs, applications, saved/trash/history, profiles).

**Important:** `.env.example` ships with a placeholder `JWT_SECRET`. Change it
to a long random string before you rely on this for anything real — that
secret is what makes the signed sessions trustworthy, and it now lives only on
the server (never sent to the browser), which is the actual security
improvement over the earlier prototype.

## 2. Run the frontend

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env      # defaults to http://localhost:4000, change if needed
npm run dev
```

This starts the app on **http://localhost:5173**. Open that in your browser.

## How auth works now

- Passwords are hashed server-side with bcrypt — never stored in plain text,
  never sent back to the client.
- Login issues a real JWT (HS256), signed with `JWT_SECRET` from your `.env`.
  Every request that needs auth sends it as `Authorization: Bearer <token>`,
  and the server verifies the signature and expiry on every single request —
  this is the real security boundary now, not just client-side logic.
- The token is stored in the browser's `localStorage` (fine for a standalone
  app like this one — unlike the Claude.ai artifact version, there's no
  platform restriction against it) so refreshing the page keeps you logged in.
- Click **"Session"** in the header to see the decoded token claims and how
  much time is left before it expires (2 hours by default).

## How real-time works now

The backend keeps a Socket.IO connection open per browser tab. When someone:
- posts a new job → everyone browsing the board gets it pushed instantly
- applies to a role → only that employer's dashboard gets notified
- has their application status changed → only that candidate gets notified

No polling — these are genuine WebSocket push events. The "Live"/"Offline"
badge in the header reflects the actual socket connection state.

## Known limitations (same job board, real backend now)

- The database is a single JSON file (`lowdb`), not a production database
  like Postgres — great for running locally or for a small deployment,
  not for scale or concurrent-write-heavy production use.
- Resumes are stored as base64 inside that JSON file rather than as separate
  files on disk or in object storage — fine for a demo, but a real product
  would put them in something like S3.
- There's no email verification, password reset, or rate limiting on auth
  endpoints — add those before exposing this to the public internet.
- CORS is locked to a single `CLIENT_ORIGIN` — update `.env` if you deploy
  the frontend somewhere other than `localhost:5173`.

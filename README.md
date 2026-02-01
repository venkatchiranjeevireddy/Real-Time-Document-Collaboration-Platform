# Distributed Document Collaboration System

Real-time multi-user document collaboration: shared documents, version control, roles, invites, presence, audit trail, and auto-snapshots. Built with **Node.js**, **Express**, **Socket.io**, and **Supabase**.

---

## What It Can Do — All Features

### Core (Real-time & Persistence)

- **Shared documents** — In-memory document state with `{ content, version }`; clients get via socket, edit via `document:edit`.
- **Real-time sync** — Every accepted edit is broadcast to all clients in the room; everyone sees updates instantly.
- **Multi-client handling** — Server tracks connected clients; presence shows who is online per document.
- **Version-based concurrency** — Client sends `{ version, content }`; server accepts only if version matches current; stale edits are rejected.
- **Mutex safety** — Per-document mutex so only one update is applied at a time; no race conditions.
- **Supabase persistence** — Documents and edit history saved to PostgreSQL; load on startup, save on every accepted edit.
- **Edit history in DB** — Each accepted edit is appended to `edit_history`; clients can request history via `history:get`.
- **Undo** — Restore document to the previous version from history; broadcast to all; persisted.
- **Client auto-save** — Debounced input (e.g. 3s); after user stops typing, client sends edit and shows "Saving…" / "Saved".
- **Logging** — Structured logger for connect, disconnect, edits, rejects, and Supabase load/save.

### Auth & Identity (STEP 1)

- **Login & signup pages** — Dedicated `/login` and `/signup`; root `/` redirects to login.
- **OTP verification** — Sign up sends OTP via email (e.g. Gmail); verify OTP then create user in Supabase Auth.
- **JWT session** — Sign in returns Supabase session (JWT); client stores it and sends token in socket handshake.
- **User identity on every edit** — Server attaches `editedBy: { id, email }` to `document:updated` and to presence; audit uses userId/userEmail.

### Documents & Ownership (STEP 2)

- **Multi-document** — Create many documents; each has its own content, version, and owner.
- **Document owner** — Creator is stored as `owner_id` in `documents`; only owner can update title, delete doc, and invite.
- **Owner badge** — UI shows "You are the owner" (or owner email) on the document page.
- **Editable title** — Owner can change document title (inline edit or API `PATCH /api/documents/:id`).
- **Delete document** — Owner can delete a document (API `DELETE /api/documents/:id`; UI button on doc page and dashboard).

### Roles (STEP 3)

- **Editor vs Viewer** — `document_members` table stores role per user per document; server rejects edits from viewers.
- **Role enforcement** — Only users with role `owner` or `editor` can edit; viewers get "View only" and disabled textarea.
- **UI badges** — "View only" for viewers; "You are the owner" or editor indication for editors.

### Invites (STEP 4)

- **Invite by email** — Owner can invite by email and role (editor/viewer); stored in `document_invites`.
- **Dashboard sections** — "My documents" (owned), "Shared with me" (member), "Invited" (pending invite by email).
- **Accept on open** — When a user opens a document they were invited to, invite is accepted (added to `document_members`); they then have access by role.
- **Invite UI** — On document page, owner can invite via email + role and see pending invites.

### Presence (STEP 5)

- **Online presence panel** — Shows list of connected users (emails) and count per document.
- **Join/leave toasts** — "X joined" and "X left" when users connect or disconnect from the document.

### Conflict UX (STEP 6)

- **Stale edit message** — When server rejects an edit (version mismatch), client shows: "Your edit was based on an old version — document refreshed."
- **Auto refresh** — Document content and version are updated to the latest so the user can edit again.

### Audit Trail (STEP 7)

- **In-memory audit log** — Server keeps last N (e.g. 500) edit events: docId, userId, userEmail, oldVersion, newVersion, timestamp, action (`edit` / `undo` / `restore`).
- **GET /api/audit** — Returns recent audit entries (auth required); optional `?limit=N` and `?documentId=uuid`; filtered by document access.

### Version History & Restore (STEP 8)

- **Cap at 20 versions** — After each save, older `edit_history` rows are pruned so only the last 20 versions per document are kept.
- **Restore by version** — Socket event `document:restore` with `{ version }`; server loads that version from history, restores document, broadcasts, and persists.
- **History panel in UI** — List of versions with timestamp and a **Restore** button per version; only editors can restore.

### Rate Limit (STEP 9)

- **Max edits per second per user** — Configurable (e.g. 5); if exceeded, server emits `document:rejected` with `reason: 'rate_limit'` and message "Too many edits. Please slow down."
- **Client feedback** — Toast shows the message; document still refreshes if server sends latest doc.

### Auto-Snapshot (STEP 10)

- **Server timer** — Every X minutes (e.g. 5), server writes current state of each in-memory document to `edit_history` with `source: 'auto'`.
- **Prune after snapshot** — Keeps last 20 versions per document including auto-snapshots.
- **Configurable** — Interval via env `AUTO_SNAPSHOT_INTERVAL_MINUTES`.

---

## Tech Stack

| Layer        | Tech                    |
|-------------|-------------------------|
| Backend     | Node.js, Express        |
| Real-time   | Socket.io (WebSockets) |
| Database    | Supabase (PostgreSQL)   |
| Auth        | Supabase Auth (OTP/JWT) |
| Frontend    | Vanilla HTML/CSS/JS    |

---

## Prerequisites

- **Node.js** 20+
- **Supabase** project (for persistence and auth)
- **Gmail** (or SMTP) for OTP emails on signup

---

## Installation & Setup

1. **Clone and install**

   ```bash
   git clone <your-repo-url>
   cd zzz_document_collab
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set:

   - `SUPABASE_URL` — Project URL from Supabase Dashboard → Project Settings → API  
   - `SUPABASE_ANON_KEY` — anon public key  
   - `SUPABASE_SERVICE_ROLE_KEY` — service_role key (for creating users, server-side DB)  
   - `EMAIL_USER`, `EMAIL_PASSWORD` — Gmail (or SMTP) for OTP on signup  

   Optional:

   - `PORT` (default `3000`)  
   - `CORS_ORIGIN` (default `*`)  
   - `MAX_EDITS_PER_SECOND` (default `5`)  
   - `AUTO_SNAPSHOT_INTERVAL_MINUTES` (default `5`)  

3. **Supabase schema**

   - In Supabase → SQL Editor, run **`supabase-schema-multi-doc.sql`** (creates `documents`, `edit_history`, `document_members`, `document_invites`).
   - Optional: run **`supabase-step10-migration.sql`** to add `source` column to `edit_history` for auto-snapshots.

   See **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** for step-by-step SQL and dashboard settings.

4. **Run**

   ```bash
   npm start
   ```

   Server runs at **http://localhost:3000** (or your `PORT`).

---

## Routes & API

| Route / API | Description |
|------------|-------------|
| `GET /` | Redirect to `/login` |
| `GET /login`, `GET /signup` | Login and signup pages |
| `GET /dashboard` | Dashboard (list documents; requires auth) |
| `GET /doc/:id` | Document editor (requires auth) |
| `GET /api/documents` | List documents for current user (auth) |
| `POST /api/documents` | Create document (auth) |
| `GET /api/documents/:id` | Get document + role (auth) |
| `PATCH /api/documents/:id` | Update title (owner only) |
| `DELETE /api/documents/:id` | Delete document (owner only) |
| `POST /api/documents/:id/invite` | Invite by email + role (owner only) |
| `GET /api/audit?limit=N&documentId=uuid` | Recent edit audit (auth; optional filters) |

---

## Project Structure

```
zzz_document_collab/
├── client/
│   ├── index.html      # Document editor page
│   ├── dashboard.html  # Document list (owned / shared / invited)
│   ├── login.html
│   └── signup.html
├── server/
│   ├── index.js        # Express + Socket.io, routes, socket handlers
│   ├── config.js       # Env config
│   ├── auth.js         # JWT auth routes & middleware
│   ├── document.js     # In-memory document store (per docId)
│   ├── logger.js
│   └── db/
│       └── supabase.js # Supabase client & DB helpers
├── supabase-schema-multi-doc.sql   # Main schema
├── supabase-step10-migration.sql   # Optional: edit_history.source
├── start.js
├── package.json
├── .env.example
├── README.md
├── SUPABASE_SETUP.md
└── PLAN_10_STEPS.md
```

---

## Docs

- **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** — Supabase SQL to run, env vars, and auth settings.  
- **[PLAN_10_STEPS.md](./PLAN_10_STEPS.md)** — Phase-by-phase plan (Steps 1–10).  

---

## License

MIT (see `package.json`).

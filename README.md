# Distributed Document Collaboration System

A real-time, multi-user document editor — the kind of system behind tools like Google Docs or Notion. Multiple people can open the same document, type at the same time, see each other's presence, and trust that no one's edit silently overwrites someone else's. Under the hood it handles concurrency, persistence, permissions, and recovery the way a production system would.

Built with **Node.js**, **Express**, **Socket.io**, and **Supabase (PostgreSQL)**.

---

## Table of Contents

1. [Why This Exists](#why-this-exists)
2. [How It Works](#how-it-works)
3. [Core Capabilities](#core-capabilities)
4. [Feature Breakdown by Phase](#feature-breakdown-by-phase)
5. [Tech Stack](#tech-stack)
6. [Getting Started](#getting-started)
7. [API Reference](#api-reference)
8. [Project Structure](#project-structure)
9. [Documentation](#documentation)
10. [License](#license)

---

## Why This Exists

Real-time collaboration sounds simple until two people edit the same paragraph at once. Most naive implementations either lock the document (annoying) or let the last write silently win (dangerous — someone's work just vanishes). This project takes the harder, correct path:

- Every edit is versioned, so the server can tell a fresh edit from a stale one.
- Conflicting edits are rejected, not merged blindly — the client is told exactly what happened and re-synced.
- Every change is attributable to a real, authenticated user, and every change is recoverable.

The result is a system that behaves predictably even when many people are editing, disconnecting, and reconnecting at once.

---

## How It Works

**1. A client connects.** The browser opens a Socket.io connection and passes its Supabase JWT in the handshake. The server verifies the token and attaches the user's identity to that connection.

**2. The client joins a document room.** The server loads the document from memory (or from Supabase if this is the first request since startup) and sends the current `{ content, version }` down to the client, along with who else is currently present.

**3. The user edits.** Rather than sending a socket event on every keystroke, the client debounces input (default: 3 seconds after the user stops typing) and then emits `document:edit` with the content it was editing *and* the version it started from.

**4. The server validates the edit.**
   - It checks the user's role — viewers are rejected outright.
   - It checks the rate limit — too many edits per second, and the edit is rejected with a "slow down" message.
   - It checks the version — if the client's version doesn't match the server's current version (meaning someone else edited first), the edit is rejected and the client is refreshed with the latest content instead of being silently overwritten.
   - If everything checks out, a per-document mutex ensures the update is applied atomically — no two edits can race each other, even under heavy concurrent load.

**5. The edit is committed.** The new version is written to memory, persisted to Supabase, appended to `edit_history`, and logged to the audit trail. The server then broadcasts the update to every other client in the room, along with who made the change.

**6. Safety nets run in the background.** A snapshot timer periodically checkpoints every open document to the database (even if no one has "saved" recently), and version history is pruned to the last 20 entries so storage doesn't grow unbounded.

This request/response and broadcast cycle repeats for every connected client, which is what makes the experience feel instant and shared.

---

## Core Capabilities

| Capability | What It Means |
|---|---|
| **Real-time sync** | Every accepted edit is pushed to all connected clients in the same document room within milliseconds. |
| **Optimistic concurrency control** | Edits are validated against a version number, so stale edits are caught and rejected instead of silently overwriting newer work. |
| **Mutex-protected writes** | A per-document lock guarantees edits are applied one at a time, eliminating race conditions under concurrent load. |
| **Durable persistence** | Documents and their full edit history live in Supabase (PostgreSQL) and are reloaded automatically on server restart. |
| **Undo & version restore** | Any of the last 20 saved versions can be restored, broadcast to everyone, and persisted. |
| **Debounced auto-save** | The client waits for a pause in typing before sending an edit, with a live "Saving…" / "Saved" indicator. |
| **Structured logging** | Every connection, disconnection, edit, rejection, and database read/write is logged in a consistent format. |

---

## Feature Breakdown by Phase

The system was built incrementally across ten phases, each adding a real production concern on top of the last.

### Step 1 — Authentication & Identity
Establishes who is using the system before anything else can happen.
- Dedicated `/login` and `/signup` pages; the root `/` redirects to `/login`.
- Signup sends a one-time password by email, verified through Supabase Auth before the account is created.
- A successful sign-in returns a JWT session, which the client stores and passes in the Socket.io handshake on every connection.
- Every edit, and every entry in the presence list, is tagged with the real user's identity — never an anonymous or spoofable ID.

### Step 2 — Documents & Ownership
Moves the system from "one document" to "many documents, each with a clear owner."
- Any user can create documents; each has its own content, version, and owner.
- Ownership is stored as `owner_id` on the `documents` table.
- Only the owner can rename the document, delete it, or invite others — enforced server-side, not just hidden in the UI.
- The document page clearly shows an ownership badge so there's no ambiguity about who controls it.

### Step 3 — Roles & Permissions
Introduces controlled, granular access instead of all-or-nothing sharing.
- A `document_members` table maps each `(user, document)` pair to a role.
- Two roles: **Editor**, who can change content, and **Viewer**, who can only read.
- The server rejects edit attempts from viewers regardless of what the client sends — permission checks live on the backend, where they can't be bypassed.

### Step 4 — Invites
Lets owners bring collaborators in without manual database work.
- Owners invite by email and assign a role (editor or viewer) at invite time.
- The dashboard is split into three clear sections: **My Documents** (owned), **Shared with Me** (already a member), and **Invited** (pending).
- Opening an invited document automatically converts the pending invite into membership — no separate "accept" step to forget.

### Step 5 — Presence
Makes collaboration feel alive rather than anonymous.
- A live panel lists everyone currently connected to a document, with a running count.
- Join and leave events surface as toast notifications in real time, so users know who's actively working alongside them.

### Step 6 — Conflict Resolution UX
Turns a rejected edit from a confusing dead end into a clear, recoverable moment.
- When a version mismatch occurs, the client sees a plain-language message: *"Your edit was based on an old version — document refreshed."*
- The client is automatically brought up to date with the latest content and version, ready to edit again immediately.

### Step 7 — Audit Trail
Gives every change a paper trail.
- The server keeps a rolling log of the last 500 edit events — who made them, the old and new version numbers, the timestamp, and whether it was an `edit`, `undo`, or `restore`.
- `GET /api/audit` exposes this log, scoped so users only see activity on documents they actually have access to.

### Step 8 — Version History & Restore
Adds a real safety net for mistakes.
- Every document retains its last 20 versions in `edit_history`; older entries are pruned automatically after each save.
- The `document:restore` socket event rolls a document back to any retained version, broadcasting and persisting the change.
- The UI surfaces this as a history panel with a one-click **Restore** button per version, available to editors.

### Step 9 — Rate Limiting
Protects the system from being overwhelmed, whether by a buggy client or a runaway script.
- Each user is capped at a configurable number of edits per second (default: 5).
- Exceeding the limit produces a clear rejection (`reason: 'rate_limit'`) and a toast telling the user to slow down — the document still syncs to the latest state so nothing feels broken.

### Step 10 — Auto-Snapshot
Adds resilience independent of user behavior.
- A background timer periodically writes the current state of every open document into `edit_history`, tagged `source: 'auto'`, regardless of whether anyone actively saved.
- This means even a document nobody explicitly "saved" recently still has recent, recoverable checkpoints.
- Snapshot frequency is configurable via `AUTO_SNAPSHOT_INTERVAL_MINUTES`, and snapshots respect the same 20-version retention limit.

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Backend | Node.js, Express | HTTP server, REST API, routing |
| Real-time transport | Socket.io (WebSockets) | Live edit broadcast, presence, room management |
| Database | Supabase (PostgreSQL) | Document storage, edit history, membership, invites |
| Auth | Supabase Auth (OTP + JWT) | Signup verification and session management |
| Frontend | Vanilla HTML / CSS / JavaScript | Editor UI, dashboard, login/signup flows |

---

## Getting Started

### 1. Clone and install

```bash
git clone <your-repo-url>
cd zzz_document_collab
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and set the following:

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Project URL — *Supabase Dashboard → Project Settings → API* |
| `SUPABASE_ANON_KEY` | Yes | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key, used for server-side user creation and privileged DB writes |
| `EMAIL_USER` / `EMAIL_PASSWORD` | Yes | SMTP credentials used to send OTP emails on signup |
| `PORT` | No | Server port (default `3000`) |
| `CORS_ORIGIN` | No | Allowed origin (default `*`) |
| `MAX_EDITS_PER_SECOND` | No | Per-user rate limit (default `5`) |
| `AUTO_SNAPSHOT_INTERVAL_MINUTES` | No | Snapshot cadence (default `5`) |

### 3. Apply the database schema

In the Supabase SQL Editor, run:

1. **`supabase-schema-multi-doc.sql`** — creates the core tables: `documents`, `edit_history`, `document_members`, `document_invites`.
2. *(Optional)* **`supabase-step10-migration.sql`** — adds the `source` column to `edit_history`, required for auto-snapshot support.

A full step-by-step walkthrough, including recommended auth settings, is in **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**.

### 4. Run the server

```bash
npm start
```

The app is now available at **http://localhost:3000** (or your configured `PORT`).

---

## API Reference

| Method | Route | Description | Access |
|---|---|---|---|
| `GET` | `/` | Redirects to `/login` | Public |
| `GET` | `/login`, `/signup` | Authentication pages | Public |
| `GET` | `/dashboard` | Lists documents — owned, shared, and invited | Authenticated |
| `GET` | `/doc/:id` | Document editor view | Authenticated |
| `GET` | `/api/documents` | Lists documents for the current user | Authenticated |
| `POST` | `/api/documents` | Creates a new document | Authenticated |
| `GET` | `/api/documents/:id` | Fetches a document plus the caller's role | Authenticated |
| `PATCH` | `/api/documents/:id` | Updates the document title | Owner only |
| `DELETE` | `/api/documents/:id` | Deletes the document | Owner only |
| `POST` | `/api/documents/:id/invite` | Invites a collaborator by email and role | Owner only |
| `GET` | `/api/audit?limit=N&documentId=uuid` | Returns recent audit log entries, optionally filtered | Authenticated |

---

## Project Structure

```
zzz_document_collab/
├── client/
│   ├── index.html          Document editor
│   ├── dashboard.html      Document list (owned / shared / invited)
│   ├── login.html
│   └── signup.html
├── server/
│   ├── index.js             Express + Socket.io bootstrap, routes, socket handlers
│   ├── config.js            Environment configuration
│   ├── auth.js               JWT auth routes & middleware
│   ├── document.js          In-memory document store (per docId)
│   ├── logger.js            Structured logging
│   └── db/
│       └── supabase.js      Supabase client & DB helpers
├── supabase-schema-multi-doc.sql   Core schema
├── supabase-step10-migration.sql   Optional: edit_history.source column
├── start.js
├── package.json
├── .env.example
├── README.md
├── SUPABASE_SETUP.md
└── PLAN_10_STEPS.md
```

---

## Documentation

| Document | Purpose |
|---|---|
| **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** | Supabase SQL scripts, environment variables, and auth configuration |
| **[PLAN_10_STEPS.md](./PLAN_10_STEPS.md)** | The phase-by-phase build plan (Steps 1–10) |

---

## License

Released under the **MIT License** — see [`package.json`](./package.json) for details.

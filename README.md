# Distributed Document Collaboration System

**Real-time, multi-user document editing with version control, roles, invites, presence, and audit trails.**

`Node.js` · `Express` · `Socket.io` · `Supabase (PostgreSQL)` · `MIT License`

---

## Overview

A production-style collaborative document editor — think a lightweight Google Docs — built to demonstrate real-time synchronization, concurrency control, and multi-tenant access management at a systems level.

The project is organized into **10 incremental build phases**, layering authentication, document ownership, role-based permissions, invites, live presence, conflict resolution, audit logging, version history, rate limiting, and automatic snapshots on top of a core real-time sync engine.

---

## Table of Contents

- [Core Capabilities](#core-capabilities)
- [Feature Breakdown by Phase](#feature-breakdown-by-phase)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [License](#license)

---

## Core Capabilities

| Capability | Description |
|---|---|
| **Real-time sync** | Every accepted edit is broadcast instantly to all connected clients in a document room. |
| **Optimistic concurrency control** | Edits carry a `{ version, content }` payload; the server accepts only matching versions and rejects stale writes. |
| **Mutex-protected writes** | A per-document mutex serializes updates, eliminating race conditions under concurrent edits. |
| **Durable persistence** | Documents and full edit history are stored in Supabase (PostgreSQL) and rehydrated on server start. |
| **Undo & version restore** | Roll back to any of the last 20 saved versions, with changes broadcast and persisted. |
| **Debounced auto-save** | Client-side input debouncing (default 3s) with live "Saving…" / "Saved" status. |
| **Structured logging** | Centralized logging for connections, disconnections, edits, rejections, and DB I/O. |

---

## Feature Breakdown by Phase

<details>
<summary><strong>Step 1 — Authentication & Identity</strong></summary>

- Dedicated `/login` and `/signup` pages; root `/` redirects to `/login`.
- Email OTP verification on signup, backed by Supabase Auth.
- JWT-based sessions; token passed via the Socket.io handshake.
- Every edit and presence event carries authenticated user identity (`editedBy: { id, email }`).

</details>

<details>
<summary><strong>Step 2 — Documents & Ownership</strong></summary>

- Support for multiple independent documents, each with its own content, version, and owner.
- Ownership recorded via `owner_id` on the `documents` table.
- Owner-only actions: rename title, delete document, manage invites.
- Ownership clearly surfaced in the UI ("You are the owner").

</details>

<details>
<summary><strong>Step 3 — Roles & Permissions</strong></summary>

- `document_members` table maps `(user, document) → role`.
- Two roles: **Editor** and **Viewer**, enforced server-side on every edit.
- Viewers receive a read-only UI (disabled input, "View only" badge).

</details>

<details>
<summary><strong>Step 4 — Invites</strong></summary>

- Owners invite collaborators by email with an assigned role.
- Dashboard organizes documents into **My Documents**, **Shared with Me**, and **Invited**.
- Invites auto-accept when the invited user opens the document.

</details>

<details>
<summary><strong>Step 5 — Presence</strong></summary>

- Live panel showing connected users and per-document online count.
- Join/leave toast notifications in real time.

</details>

<details>
<summary><strong>Step 6 — Conflict Resolution UX</strong></summary>

- Stale edits (version mismatch) are rejected with a clear client message: *"Your edit was based on an old version — document refreshed."*
- Client automatically syncs to the latest content and version.

</details>

<details>
<summary><strong>Step 7 — Audit Trail</strong></summary>

- Rolling in-memory log of the last 500 edit events (`edit`, `undo`, `restore`) with actor, versions, and timestamp.
- Exposed via `GET /api/audit`, scoped to documents the requester can access.

</details>

<details>
<summary><strong>Step 8 — Version History & Restore</strong></summary>

- Automatic pruning to the most recent 20 versions per document.
- `document:restore` socket event restores, broadcasts, and persists any historical version.
- History panel in the UI with per-version restore (editor role required).

</details>

<details>
<summary><strong>Step 9 — Rate Limiting</strong></summary>

- Configurable per-user edit throttle (default: 5 edits/sec).
- Over-limit edits are rejected with `reason: 'rate_limit'` and a toast: *"Too many edits. Please slow down."*

</details>

<details>
<summary><strong>Step 10 — Auto-Snapshot</strong></summary>

- Background timer periodically snapshots each in-memory document into `edit_history` (`source: 'auto'`).
- Snapshot interval configurable via `AUTO_SNAPSHOT_INTERVAL_MINUTES`.
- Snapshots respect the same 20-version retention cap.

</details>

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express |
| **Real-time transport** | Socket.io (WebSockets) |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth (OTP + JWT) |
| **Frontend** | Vanilla HTML / CSS / JavaScript |

---

## Prerequisites

- **Node.js** 20+
- A **Supabase** project (persistence + auth)
- **Gmail** or any SMTP provider (for OTP delivery on signup)

---

## Getting Started

### 1. Clone and install

```bash
git clone <your-repo-url>
cd zzz_document_collab
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and populate:

| Variable | Required | Description |
|---|:---:|---|
| `SUPABASE_URL` | ✅ | Project URL — *Supabase Dashboard → Project Settings → API* |
| `SUPABASE_ANON_KEY` | ✅ | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (server-side user creation & DB writes) |
| `EMAIL_USER` / `EMAIL_PASSWORD` | ✅ | SMTP credentials for OTP delivery |
| `PORT` | – | Server port (default `3000`) |
| `CORS_ORIGIN` | – | Allowed origin (default `*`) |
| `MAX_EDITS_PER_SECOND` | – | Per-user rate limit (default `5`) |
| `AUTO_SNAPSHOT_INTERVAL_MINUTES` | – | Snapshot cadence (default `5`) |

### 3. Apply the database schema

In the Supabase SQL Editor, run:

1. **`supabase-schema-multi-doc.sql`** — creates `documents`, `edit_history`, `document_members`, `document_invites`
2. *(Optional)* **`supabase-step10-migration.sql`** — adds the `source` column to `edit_history` for auto-snapshot support

Full walkthrough: **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**

### 4. Run the server

```bash
npm start
```

The app is now live at **http://localhost:3000** (or your configured `PORT`).

---

## API Reference

| Method | Route | Description | Auth |
|---|---|---|:---:|
| `GET` | `/` | Redirects to `/login` | – |
| `GET` | `/login`, `/signup` | Auth pages | – |
| `GET` | `/dashboard` | List documents (owned / shared / invited) | ✅ |
| `GET` | `/doc/:id` | Document editor view | ✅ |
| `GET` | `/api/documents` | List documents for current user | ✅ |
| `POST` | `/api/documents` | Create a new document | ✅ |
| `GET` | `/api/documents/:id` | Get document content + caller's role | ✅ |
| `PATCH` | `/api/documents/:id` | Update document title | ✅ Owner |
| `DELETE` | `/api/documents/:id` | Delete document | ✅ Owner |
| `POST` | `/api/documents/:id/invite` | Invite collaborator by email + role | ✅ Owner |
| `GET` | `/api/audit?limit=N&documentId=uuid` | Recent audit log entries | ✅ |

---

## Project Structure

```
zzz_document_collab/
├── client/
│   ├── index.html          # Document editor
│   ├── dashboard.html      # Document list (owned / shared / invited)
│   ├── login.html
│   └── signup.html
├── server/
│   ├── index.js             # Express + Socket.io bootstrap, routes, socket handlers
│   ├── config.js            # Environment configuration
│   ├── auth.js               # JWT auth routes & middleware
│   ├── document.js          # In-memory document store (per docId)
│   ├── logger.js
│   └── db/
│       └── supabase.js      # Supabase client & DB helpers
├── supabase-schema-multi-doc.sql   # Core schema
├── supabase-step10-migration.sql   # Optional: edit_history.source column
├── start.js
├── package.json
├── .env.example
├── README.md
├── SUPABASE_SETUP.md
└── PLAN_10_STEPS.md
```

---

## Documentation

| Doc | Purpose |
|---|---|
| **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** | Supabase SQL scripts, environment variables, and auth configuration |
| **[PLAN_10_STEPS.md](./PLAN_10_STEPS.md)** | Phase-by-phase build plan (Steps 1–10) |

---

## License

Released under the **MIT License** — see [`package.json`](./package.json) for details.

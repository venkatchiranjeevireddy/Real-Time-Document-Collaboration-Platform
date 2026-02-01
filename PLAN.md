# Distributed Document Collaboration System — Phase-by-Phase Plan

**Project path:** `/home/venkat_chiranjeevi/zzz_document_collab`  
**Tech stack:** Node.js, Express.js, Supabase (DB + optional Realtime), WebSockets (Socket.io)  
**UI:** Modern web client (React or vanilla + good UX)

---

## 🎯 Problem We Solve

When multiple users edit the same document at the same time:

- Edits can overwrite each other  
- Data can be lost  
- System becomes inconsistent  

**Goal:** Allow many users to edit safely while keeping data correct and synced.

---

## 🏗 High-Level Architecture (Plan)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS (Browser UI)                      │
│  User A ◄──► WebSocket ◄──►  User B ◄──► WebSocket ◄──►  User C  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXPRESS SERVER (Node.js)                            │
│  • REST API (documents, auth)                                    │
│  • Socket.io server (real-time edits, broadcast)                 │
│  • In-memory doc state + version (Phase 2–4)                     │
│  • Mutex/sync for critical sections (Phase 4)                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE                                      │
│  • PostgreSQL: documents, versions, edit_history, users         │
│  • Optional: Supabase Realtime (or we use Socket.io only)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 Tech Stack Mapping

| Spec concept           | Our stack                                      |
|------------------------|-------------------------------------------------|
| Server                 | **Express.js** (HTTP + REST)                    |
| Real-time / multi-client | **Socket.io** (WebSockets, one connection per client) |
| “Thread per client”    | Node: **one async handler per socket** (no OS threads; same idea) |
| Concurrency control    | **Version numbers** + **mutex** (e.g. `async-mutex`) in Node |
| Persistence            | **Supabase** (PostgreSQL)                       |
| Auth                   | **Supabase Auth** (Phase 6)                     |
| Frontend               | **React** (or vanilla) + good UI/UX             |

---

## 🟢 Phase 1 — Basic Server

**Goal:** Start server, accept client connections, print messages.

| # | Task | Details |
|---|------|--------|
| 1.1 | Init Node project | `package.json`, ES modules or CommonJS, `.gitignore` |
| 1.2 | Express server | Listen on a port (e.g. 3000), health route `GET /health` |
| 1.3 | Socket.io setup | Attach Socket.io to Express, CORS for frontend origin |
| 1.4 | Connection logging | On `connection` and `disconnect`, log client id + count |
| 1.5 | Echo test | Client sends a message → server logs it and can echo back |

**Deliverables:** Server runs; one or more clients can connect via Socket.io; connection/disconnect and messages are visible in server logs. No document logic yet.

**Folder structure (plan):**

- `server/` — Express + Socket.io app  
- `client/` — placeholder for future UI  

---

## 🟡 Phase 2 — Shared Document

**Goal:** Store one shared document in memory; clients can read and write it.

| # | Task | Details |
|---|------|--------|
| 2.1 | Document state (in-memory) | Object: `{ content: string, version: number }` |
| 2.2 | Socket events (design) | `document:get` → server sends full doc; `document:edit` → server applies edit and broadcasts |
| 2.3 | Apply edit | Replace or patch document content; increment version |
| 2.4 | Broadcast | On successful edit, emit updated document (or delta) to all connected clients |
| 2.5 | Client UI (basic) | Simple page: show document, input to append/replace, send edit via Socket.io |

**Deliverables:** One shared document; any client can request it and send edits; all clients see updates. Concurrency not yet handled (Phase 4).

---

## 🟠 Phase 3 — Multi-Client Handling

**Goal:** Many clients; each has its own connection; server broadcasts to everyone.

| # | Task | Details |
|---|------|--------|
| 3.1 | Client list | Track connected socket ids (e.g. in a `Set` or map) on connect/disconnect |
| 3.2 | Broadcast to all | On document update, emit to all clients in room (Socket.io room or all sockets) |
| 3.3 | Presence (optional) | Emit “user joined” / “user left” with count so UI can show “N users online” |
| 3.4 | UI | Show “connected” state and list/count of online users; handle reconnection |

**Deliverables:** Multiple clients; one edit updates everyone; UI feels “multi-user”.

---

## 🔵 Phase 4 — Concurrency Control (Critical)

**Goal:** Version-based consistency; reject stale edits; no race conditions.

| # | Task | Details |
|---|------|--------|
| 4.1 | Version on every edit | Client sends `{ version: N, content/delta }`; server checks `N === currentVersion` |
| 4.2 | Reject stale | If `version !== currentVersion`, reject and send latest document + version back to client |
| 4.3 | Mutex/sync | Use a single lock around “read version → validate → apply → increment → broadcast” so only one update at a time (e.g. `async-mutex` in Node) |
| 4.4 | Client handling | On reject, show message and refresh document from server |
| 4.5 | Optimistic UI (optional) | Show edit locally, then confirm or rollback on server response |

**Deliverables:** No lost updates; stale edits rejected; server logic is thread-safe (single-threaded Node + mutex for critical section).

---

## 🔴 Phase 5 — Persistence (Supabase)

**Goal:** Save and load document; survive server restart.

| # | Task | Details |
|---|------|--------|
| 5.1 | Supabase project | Create project; get URL + anon key; env vars (e.g. `.env`) |
| 5.2 | Tables (design) | e.g. `documents(id, content, version, updated_at)`; optional `edit_history(id, document_id, version, content, created_at)` |
| 5.3 | Load on startup | On server start, fetch document from Supabase (e.g. one default doc or by id); set in-memory state |
| 5.4 | Save on edit | After each accepted edit, upsert `documents` (and optionally append to `edit_history`) |
| 5.5 | Optional: Supabase Realtime | Subscribe to `documents` changes and broadcast to Socket.io clients, or keep Socket.io as single source of truth and only use Supabase for persistence |

**Deliverables:** Document persisted in Supabase; server restart recovers state; clients still sync via Socket.io.

---

## ⚡ Phase 6 — Advanced Features (Wow)

**Goal:** History, auth, logging, auto-save, notifications.

| # | Feature | Details |
|---|--------|--------|
| 6.1 | Edit history | Store each version in DB; API to get history; optional “view history” in UI |
| 6.2 | User authentication | Supabase Auth (email/password or OAuth); protect API and optionally Socket.io (token in handshake) |
| 6.3 | Undo/redo | Server-side: previous versions from history; client sends “undo” → server applies previous version and broadcasts |
| 6.4 | Conflict resolution | Already partly done in Phase 4; optional: merge strategies or show “version conflict” message with diff |
| 6.5 | Logging | Structured logs (e.g. Pino/Winston): connection, edit, reject, save; log levels |
| 6.6 | Auto-save | Debounced save to Supabase after edits (in addition to real-time broadcast) |
| 6.7 | Notifications | Toast or in-ui messages: “Document updated by another user”, “Your edit was rejected (stale version)” |

**Deliverables:** Resume-ready features; clear logging; good UX with auth and notifications.

---

## 📁 Proposed Folder Structure (Final)

```
zzz_document_collab/
├── .env.example
├── .gitignore
├── PLAN.md                 (this file)
├── README.md
├── package.json
├── server/
│   ├── index.js            (Express + Socket.io entry)
│   ├── config.js           (env, port)
│   ├── document.js         (in-memory state, apply edit, version)
│   ├── sync.js             (mutex, validate version, broadcast)
│   ├── db/
│   │   └── supabase.js     (load/save document, history)
│   └── middleware/
│       └── auth.js         (Phase 6: verify Supabase JWT)
├── client/
│   ├── index.html
│   ├── app.jsx or app.tsx  (React) or vanilla JS
│   ├── components/         (Editor, UserList, Notifications)
│   └── api/                (Socket.io client, optional REST)
└── docs/                   (optional: API and events spec)
```

---

## ✅ Feature Checklist (Mapping to Phases)

| Requirement | Phase | How |
|------------|-------|-----|
| Multi-client server | 1, 3 | Express + Socket.io, one connection per client |
| Shared document state | 2 | In-memory `{ content, version }` + broadcast |
| Client editing | 2 | Socket events: get doc, send edit |
| Concurrency control | 4 | Version check + mutex; reject stale |
| Persistent storage | 5 | Supabase PostgreSQL |
| Broadcast updates | 2, 3 | Socket.io emit to all / room |
| Thread safety | 4 | async-mutex (or similar) in Node |
| Edit history | 6 | Supabase table + optional API |
| User authentication | 6 | Supabase Auth |
| Undo/redo | 6 | History + undo event |
| Logging | 6 | Pino/Winston |
| Auto-save | 6 | Debounced Supabase write |
| Notifications | 6 | UI toasts / messages |

---

## 🎤 One-Liner for Interviews

*“I built a distributed document collaboration system with Node.js and Express. Multiple clients connect via WebSockets (Socket.io), edit a shared document, and get live updates. I used version numbers and a mutex for concurrency control so stale edits are rejected, and Supabase for persistence and optional auth. I also added edit history, undo, and a clean UI.”*

---

## ⏱ Suggested Timeline (Planning)

| Phase | Focus | Rough time |
|-------|--------|------------|
| 1 | Basic server + Socket.io | 2–3 days |
| 2 | Shared document + simple UI | 3–4 days |
| 3 | Multi-client + presence | 2 days |
| 4 | Versioning + mutex | 3–4 days |
| 5 | Supabase persistence | 2–3 days |
| 6 | Auth, history, logging, UI polish | 1–2 weeks |

**Total:** ~4–6 weeks for a strong version.

---

## 🚨 Things to Avoid

- Skipping version check (Phase 4) → conflicts and lost data  
- No mutex/sync around doc update → race conditions  
- Forgetting persistence → state lost on restart  
- No logging → hard to debug multi-user issues  

---

## Next Step

**Do not implement yet.** Review this plan; adjust phases or tech choices if needed. When you’re ready, we implement **Phase 1 only** (basic server + Socket.io + connection logging).

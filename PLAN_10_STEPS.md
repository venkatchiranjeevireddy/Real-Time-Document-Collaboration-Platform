# Next 10 Steps — Phase-by-Phase Plan

**Context:** You already have real-time sync, version concurrency control, Supabase persistence, multi-client updates, mutex safety, history, undo, optional auth, and presence. This plan adds **Login/Identity, Ownership, Roles, Invites, Presence polish, Conflict UX, Audit, Version restore, Rate limit, and Auto-snapshot** — as a proper **website** with pages.

---

## Current vs New

| Already have | New (10 steps) |
|--------------|----------------|
| Auth: optional sign-in form on same page | **STEP 1:** Dedicated login/signup **pages**, session, user on every edit |
| Single shared doc | **STEP 2:** Document **owner** (creator), owner badge, invite right |
| Anyone can edit | **STEP 3:** **Editor vs Viewer** roles, server rejects edit if viewer |
| — | **STEP 4:** **Invite by email** (role), stored; when they login → doc in dashboard |
| Presence: "N users online" + list (socket ids / email) | **STEP 5:** **Online presence panel** (names, join/leave) — mostly done; polish |
| Stale edit → toast + refresh | **STEP 6:** **Conflict feedback UX** — mostly done; wording + auto reload |
| History in DB, history:get | **STEP 7:** **Edit audit trail** in memory/log + **GET /audit** |
| History list, Undo (restore prev) | **STEP 8:** **Version history + restore** (last 20), click to restore |
| — | **STEP 9:** **Rate limit** edits per user per second |
| Save on every edit | **STEP 10:** **Auto-save snapshot** timer (server, every X min) |

---

## STEP 1 — Login & User Identity

**Goal:** Signup/login **pages**, session handling, attach user identity to socket, every edit includes user id/email.

| Task | Details |
|------|--------|
| 1.1 | **Pages:** Dedicated routes: `/login`, `/signup`, `/` (app) or `/doc` (editor). Single-page app with hash routes or separate HTML. |
| 1.2 | **Session:** Use Supabase Auth; store session (e.g. localStorage); on load, restore session and redirect if not logged in (for /doc). |
| 1.3 | **Socket identity:** Handshake already sends `auth.token`; server already calls `db.getUser(token)` and stores `email` in clients. Ensure **every** `document:edit` and `document:updated` payload includes `userId` / `userEmail` (from socket’s client map). |
| 1.4 | **Edit events:** Server: when accepting edit, attach `editedBy: { id, email }` (from clients.get(socket.id)) to `document:updated` and to audit. |

**Deliverables:** Login page, Signup page, App/Doc page (protected). Server always knows who made the edit; payloads include user identity.

**Already have:** Socket auth with token, `getUser`, presence with email. **Gap:** Dedicated pages, routing, and consistently attaching user to every edit event.

---

## STEP 2 — Document Owner Logic

**Goal:** When a document is “created”, mark creator as owner; store owner; show “Owner” badge; owner can invite.

| Task | Details |
|------|--------|
| 2.1 | **Owner storage:** In Supabase `documents` add column `owner_id` (UUID from Supabase Auth). When creating doc (first time or API), set `owner_id = user.id`. In memory: when loading doc, set `documentOwnerId` (and optionally email) from DB. |
| 2.2 | **Creation:** “Create” = first write to a doc (e.g. when version 0 and no row yet) or explicit “Create document” action; set creator as owner. |
| 2.3 | **UI:** Show “Owner: email” or “You are the owner” badge on doc page. |
| 2.4 | **Invite right:** Only owner can invite (STEP 4); server checks `socket.userId === documentOwnerId` for invite action. |

**Deliverables:** Owner stored in DB and server memory; UI shows owner; owner can invite (implemented in STEP 4).

**Schema:** `documents.owner_id` (UUID, nullable for backward compat).

---

## STEP 3 — Editor vs Viewer Roles

**Goal:** Viewer = read-only; Editor = can edit. Server rejects edit if not editor; frontend disables textarea for viewer.

| Task | Details |
|------|--------|
| 3.1 | **Storage:** Table `document_members` or `document_permissions`: `document_id`, `user_id`, `role` ('viewer' | 'editor'). Owner is implicit editor. |
| 3.2 | **Server:** Before accepting `document:edit`, check: user is owner OR has role `editor` for this doc. If not, emit `document:rejected` with reason `not_editor`. |
| 3.3 | **Load role:** When user opens doc, server or API returns their role (from `document_members` or owner). Socket handshake or `document:get` response includes `myRole: 'editor' | 'viewer'`. |
| 3.4 | **Frontend:** If `myRole === 'viewer'`, disable textarea and hide Save / Invite (or show “View only”). |

**Deliverables:** Roles in DB; server enforces editor check; UI read-only for viewers.

**Schema:** `document_members(document_id, user_id, role)` or single doc: `document_permissions` with JSON/array (simpler for single-doc app).

---

## STEP 4 — Invite by Email (In-App)

**Goal:** UI: input email, select role (viewer/editor), click Invite. Server records invite; when that email logs in, they see doc in dashboard. No email sending in v1.

| Task | Details |
|------|--------|
| 4.1 | **Table:** `document_invites`: `document_id`, `email`, `role`, `invited_by`, `created_at`. Optionally `accepted_at` (null until they open doc first time). |
| 4.2 | **API or socket:** `invite:create` { email, role }. Server: verify caller is owner; insert invite. |
| 4.3 | **Dashboard:** When user logs in, fetch list of docs: (a) docs they own, (b) docs they’re member of, (c) docs they’re invited to (by email). Show “My documents” / “Shared with me”. |
| 4.4 | **Accept invite:** When user opens doc from invite (or first time by link), upsert `document_members` (user_id, document_id, role) and optionally set `accepted_at` on invite. |

**Deliverables:** Invite UI (email + role); server stores invite; dashboard shows “my docs” and “shared with me”; opening doc grants membership.

**Schema:** `document_invites`, `document_members` (if not already in STEP 3).

---

## STEP 5 — Online Presence Panel

**Goal:** Show “3 users online” and list (UserA, UserB, UserC) with join/leave updates.

| Task | Details |
|------|--------|
| 5.1 | **Already have:** Presence broadcast, clients map with id/email. |
| 5.2 | **Polish:** Use display name or email in list; ensure join/leave broadcasts; UI panel shows list and count. Optional: “User joined” / “User left” toast. |

**Deliverables:** Presence panel in UI with names/emails and live updates. Mostly done; ensure it’s clear and stable.

---

## STEP 6 — Conflict Feedback UX

**Goal:** When server rejects stale edit, show: “Your edit was based on an old version — document refreshed.” and auto reload latest.

| Task | Details |
|------|--------|
| 6.1 | **Already have:** `document:rejected` with latest doc; client shows toast and calls `setDoc(payload.document.content, payload.document.version)`. |
| 6.2 | **Copy:** Change toast message to: “Your edit was based on an old version — document refreshed.” Ensure textarea is updated with latest content (already done). |

**Deliverables:** Message updated; behavior unchanged (already correct).

---

## STEP 7 — Edit Audit Trail (Server-Side)

**Goal:** On every accepted edit, record: user, old version, new version, timestamp. Expose **GET /audit**.

| Task | Details |
|------|--------|
| 7.1 | **In-memory log:** Array or list: `{ userId, userEmail, oldVersion, newVersion, timestamp }`. Push on each accepted edit. Optionally cap length (e.g. last 500). |
| 7.2 | **GET /audit:** Return JSON list of audit entries (and optionally support `?limit=50`). |

**Deliverables:** Audit log in memory; GET /audit returns recent edit events.

---

## STEP 8 — Version History + Restore

**Goal:** Keep last N (e.g. 20) document snapshots; show version list; click → restore that version.

| Task | Details |
|------|--------|
| 8.1 | **Already have:** `edit_history` in Supabase; `history:get` returns list; Undo restores previous version. |
| 8.2 | **Cap:** When saving history, keep only last 20 (or 50) per document (e.g. delete older rows or limit insert). |
| 8.3 | **Restore:** New event `document:restore` { version }. Server: load that version from history; call `document.restore(content, version)`; broadcast `document:updated`; persist. Only editor/owner can restore. |
| 8.4 | **UI:** History panel: list versions with timestamp; “Restore” button per version (or click row to restore). |

**Deliverables:** Last 20 versions kept; version list in UI; restore by version.

---

## STEP 9 — Rate Limit Edits

**Goal:** Max edits per user per second; reject if exceeded.

| Task | Details |
|------|--------|
| 9.1 | **Server:** Per socket id (or userId), track last N edit timestamps (e.g. last 10). On `document:edit`, if edits in last 1 second >= 5 (example), emit `document:rejected` with reason `rate_limit`. |
| 9.2 | **Config:** `MAX_EDITS_PER_SECOND = 5` (or from env). |

**Deliverables:** Rate limit enforced; client sees reject reason.

---

## STEP 10 — Auto-Save Snapshot Timer

**Goal:** Server timer: every X minutes, take a snapshot of current doc version (e.g. append to history or separate “snapshots” table).

| Task | Details |
|------|--------|
| 10.1 | **Timer:** `setInterval` every X min (e.g. 5). Callback: read current document state; append to `edit_history` (or a `snapshots` table) with a flag “auto_snapshot” so it’s distinguishable. |
| 10.2 | **Optional:** New table `document_snapshots(id, document_id, version, content, created_at)` for periodic snapshots only; or reuse `edit_history` with `source: 'auto'`. |

**Deliverables:** Background job every X min writes current doc state to history/snapshots.

---

## Implementation Order (Phases)

| Phase | Steps | Focus |
|-------|--------|--------|
| **Phase A** | STEP 1 | Login/signup pages, session, user on socket and on every edit |
| **Phase B** | STEP 2 | Document owner (DB + memory), owner badge, creation flow |
| **Phase C** | STEP 3 | Editor vs Viewer (DB, server check, UI read-only) |
| **Phase D** | STEP 4 | Invite by email (table, API, dashboard, accept) |
| **Phase E** | STEP 5 | Presence panel polish (already mostly done) |
| **Phase F** | STEP 6 | Conflict message wording |
| **Phase G** | STEP 7 | Audit log + GET /audit |
| **Phase H** | STEP 8 | Version cap 20, restore by version, UI restore button |
| **Phase I** | STEP 9 | Rate limit edits per user per second |
| **Phase J** | STEP 10 | Server auto-snapshot timer |

---

## Suggested File / Route Layout (Website)

- **`/`** or **`/login`** — Login page (redirect to /doc if already logged in).
- **`/signup`** — Signup page.
- **`/doc`** — Document editor (require auth); optional `?id=...` for multi-doc later.
- **`/dashboard`** — List “My documents” / “Shared with me” (STEP 4).

Static files: `client/login.html`, `client/signup.html`, `client/app.html` (or `doc.html`), `client/dashboard.html`; or single SPA with hash routes `#/login`, `#/signup`, `#/doc`, `#/dashboard`.

---

## Next Action

**Do not implement yet.** Review this plan; adjust order or scope if needed. When ready, we implement **Phase A (STEP 1)** first: login/signup pages, session, and user identity on every edit.

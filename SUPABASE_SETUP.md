# Supabase Setup — What to Run in SQL & Dashboard

Use this for **Phase 5 (documents)** and **STEP 1 (auth with OTP)**.

---

## Login / Sign up — No schema to run

For **login and sign up**, you do **not** run any SQL. Supabase Auth uses built-in tables (`auth.users`, `auth.sessions`, etc.) that already exist when you create a project.

**What you need for login/signup:**

| What | Where |
|------|--------|
| **No SQL** | Nothing to run in SQL Editor for auth. |
| **Email provider** | Supabase Dashboard → **Authentication → Providers** → ensure **Email** is enabled. |
| **Email confirm (optional)** | **Authentication → Settings** → set **Enable Email Confirmations** to **OFF** (we verify via our own OTP). |
| **Env vars** | In `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_USER`, `EMAIL_PASSWORD` (see section 3 below). |

That’s it for auth. No `auth.users` table or other auth schema to create.

---

## Where are users (email, password) stored?

Supabase **Auth** stores every user (email, hashed password, etc.) in a built-in table called **`auth.users`**. You do **not** create this table — Supabase creates it when you create the project.

| What | How it works |
|------|----------------|
| **User storage** | Supabase stores each user in `auth.users` (email, hashed password, id, created_at, etc.). |
| **Sign up (after OTP)** | Our server calls Supabase Admin API `createUser({ email, password, email_confirm: true })`. Supabase inserts the user into `auth.users` and hashes the password. |
| **Sign in** | Our server (or client) calls `signInWithPassword({ email, password })`. Supabase checks email/password against `auth.users` and returns a JWT if the user is valid. |
| **“Is this user true?”** | Yes — Supabase checks the password against the hash in `auth.users` and issues a JWT. We use that JWT on the socket so the server knows who is editing. |

You can see all users in **Supabase Dashboard → Authentication → Users**. That list is the `auth.users` table. No extra SQL or table is needed for storing login/signup users.

---

## 1. Auth (no SQL)

Supabase **Auth** uses built-in tables (`auth.users`, etc.). You do **not** create them — they exist when Auth is enabled.

**Dashboard:**  
- **Authentication → Providers:** ensure **Email** is enabled.  
- **Authentication → Settings:**  
  - **Enable Email Confirmations:** you can set to **OFF** for this app, because we verify email via our own OTP before creating the user.  
  - (Optional) **SMTP:** leave default or set custom; our app sends OTP from the Node server using `EMAIL_USER` / `EMAIL_PASSWORD`, not Supabase SMTP.

---

## 2. SQL to run (Documents + Edit history)

**Use the multi-document schema** so the app can list/create documents per user. The old single-doc schema has no `title` or `owner_id` and will cause errors like `column documents.title does not exist`.

**Run this in Supabase Dashboard → SQL Editor:**

1. Open the file **`supabase-schema-multi-doc.sql`** in this repo.
2. Copy its **entire** contents and paste into the SQL Editor.
3. Click **Run**.

That script drops the old `documents` and `edit_history` tables (if any) and creates the new ones with:
- **documents:** `id` (UUID), `owner_id`, `title`, `content`, `version`, `created_at`, `updated_at`
- **edit_history:** `document_id` (UUID, FK to documents), `version`, `content`, `created_at`

After this, the dashboard “My documents” and “New document” will work.

**If you already ran an older multi-doc schema** (no `document_members` or `document_invites`), run these in order in SQL Editor (they do **not** drop tables):
- **STEP 3:** `supabase-step3-migration.sql` — adds `document_members` (editor/viewer roles).
- **STEP 4:** `supabase-step4-migration.sql` — adds `document_invites` (invite by email).

---

## 3. Env vars for STEP 1 (Auth + OTP)

In your **`.env`** (copy from `.env.example`, never commit `.env`):

| Variable | Where to get it |
|----------|------------------|
| `SUPABASE_URL` | Dashboard → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Dashboard → Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → API → **service_role** (secret; only on server) |
| `EMAIL_USER` | Your Gmail address (e.g. `bvchiranjeevi54@gmail.com`) |
| `EMAIL_PASSWORD` | Gmail **App Password**: Google Account → Security → 2-Step Verification → App passwords → generate for “Mail” |

**Gmail App Password:**  
- Turn on 2-Step Verification first.  
- Then create an App Password; use that 16-char value as `EMAIL_PASSWORD` (no spaces, or keep spaces if your app trims).

---

## 4. Auth settings (optional)

- **Authentication → URL Configuration:** set **Site URL** to your app (e.g. `http://localhost:3000` for dev).  
- **Redirect URLs:** add `http://localhost:3000/doc` and your production URL if you use Supabase redirects later.

---

## 5. Summary

| Step | Action |
|------|--------|
| 1 | Run **supabase-schema-multi-doc.sql** in Supabase → SQL Editor (documents + edit_history). |
| 2 | (Optional) Run **supabase-step10-migration.sql** to add `source` column to `edit_history` for auto-snapshots (STEP 10). |
| 3 | In Dashboard → Authentication → Settings, set “Enable Email Confirmations” to **OFF** if you want (we verify via OTP). |
| 4 | Put `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_USER`, `EMAIL_PASSWORD` in `.env`. |
| 5 | Restart the Node server and use **Sign up** (OTP sent to email) then **Sign in**. |

No separate “users” table in SQL is required — Supabase Auth manages `auth.users` for you.

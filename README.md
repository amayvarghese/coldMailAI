# Cold email outreach dashboard

Paste lead details, generate a personalized cold email with **Groq** (Llama 3.3 70B), send mail, and track status in a **React** dashboard.

**Leads storage:** With **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`**, data lives in **Supabase** (`leads` table). If those are unset, the API falls back to **`backend/logs.json`** (fine for local-only dev).

You can send through **Gmail** (your real `@gmail.com` address) or **Resend** (verified domain + webhooks).

## Architecture

- **Frontend:** Vite + React + Tailwind (`frontend/`)
- **Backend:** Express (`backend/app.js`); local entry `backend/index.js`; **Vercel** serverless entry `api/index.js`
- **Gmail mode:** [Nodemailer](https://nodemailer.com/) + Google **App Password** (SMTP). Replies in Gmail; use **Log reply** on the dashboard to store text in Supabase / `logs.json`.
- **Resend mode:** Resend API + optional webhooks for **opened / clicked / bounced / inbound reply**.
- **Resume:** `RESUME_PUBLIC_URL` or `RESUME_FILE_PATH` plus optional `RESUME_FILENAME`.
- **Webhooks (Resend only):** Verified with **Svix** using `RESEND_WEBHOOK_SECRET`.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the script in **`supabase/migrations/001_create_leads.sql`** (creates `public.leads` with RLS enabled; the **service role** bypasses RLS for server-side access).
3. In **Project Settings → API**, copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** `secret` key → `SUPABASE_SERVICE_ROLE_KEY` (backend / Vercel **only** — never expose in the browser or commit to git).

4. Add those two variables to `backend/.env` locally and to **Vercel → Environment Variables** for production.

## Gmail-only setup

1. Enable **2-Step Verification** on the Google account.
2. Create an **App password**: Google Account → Security → App passwords → Mail / Other → generate.
3. In `backend/.env`:

   ```env
   EMAIL_PROVIDER=gmail
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   GMAIL_DISPLAY_NAME=Amay Varghese
   ```

4. If both Gmail and Resend keys exist, set **`EMAIL_PROVIDER=gmail`** explicitly when you want Gmail.

5. When a lead replies, use **Log reply** on that row to paste the text into storage.

## Resend setup (optional)

1. Expose the API (e.g. `npx localtunnel --port 3001`) or use your Vercel URL.
2. Register `https://<host>/api/webhooks/resend` in Resend with `RESEND_WEBHOOK_SECRET`.
3. Configure inbound + domain tracking as needed.

## Install & run (local)

From the repo root:

```bash
npm install
cp .env.example backend/.env   # then edit backend/.env (add Supabase + mail keys)
```

```bash
# Terminal 1
node backend/index.js

# Terminal 2
cd frontend && npm run dev
```

Vite proxies `/api` to port **3001**. Root build: `npm run build` → `frontend/dist`.

## Deploy on Vercel (one Git repo)

1. Import the GitHub repo; **root** = repo root (see **`vercel.json`**).
2. **Environment variables:** add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, mail settings, **`RESUME_PUBLIC_URL`**, etc.
3. **No Redis required** — Supabase replaces the old Upstash/Redis option for lead storage.
4. **Resend webhooks:** `https://<your-deployment>.vercel.app/api/webhooks/resend`.
5. Same-origin UI → no `VITE_API_URL` needed unless the API is hosted elsewhere.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | `{ provider: 'gmail' \| 'resend', autoTracking: boolean }` |
| `POST` | `/api/preview` | `{ name, company, role }` → Groq `{ subject, body }` |
| `POST` | `/api/leads` | Send email and upsert lead |
| `GET` | `/api/leads` | All leads |
| `POST` | `/api/leads/:email/log-reply` | Body `{ replyContent }` |
| `DELETE` | `/api/leads/:email` | Remove lead |
| `POST` | `/api/webhooks/resend` | Resend webhooks (Resend mode) |

## Notes

- Gmail mode does not auto-track opens/clicks; those columns show **N/A** unless you use Resend.
- You can inspect and edit leads in the **Supabase Table Editor** when using Supabase.

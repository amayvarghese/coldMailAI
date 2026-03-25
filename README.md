# Cold email outreach dashboard

Paste lead details, generate a personalized cold email with **Groq** (Llama 3.3 70B), send mail, and track status in a **React** dashboard. **Local:** data in `backend/logs.json`. **Vercel:** data in **Upstash Redis** (see below).

You can send through **Gmail** (your real `@gmail.com` address) or **Resend** (verified domain + webhooks).

## Architecture

- **Frontend:** Vite + React + Tailwind (`frontend/`)
- **Backend:** Express (`backend/app.js`); local entry `backend/index.js`; **Vercel** serverless entry `api/index.js`
- **Gmail mode:** [Nodemailer](https://nodemailer.com/) + Google **App Password** (SMTP). **From** and **Reply-To** are your Gmail address. Replies only appear in Gmail; use the dashboard **Log reply** action to paste them into `logs.json`.
- **Resend mode:** Resend API + optional webhooks for **opened / clicked / bounced / inbound reply**. Open/click tracking is configured in the Resend domain settings.
- **Resume:** `RESUME_PUBLIC_URL` or `RESUME_FILE_PATH` (under `backend/`) plus optional `RESUME_FILENAME`.
- **Webhooks (Resend only):** Verified with **Svix** using `RESEND_WEBHOOK_SECRET`.

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

4. Remove or comment out Resend variables if you are not using Resend. If both Gmail and Resend keys exist, set **`EMAIL_PROVIDER=gmail`** explicitly.

5. You do **not** need a public tunnel or Resend webhooks for Gmail mode.

6. When a lead replies, open the thread in Gmail, copy the text, and use **Log reply** on that row in the dashboard.

## Resend setup (optional)

If `EMAIL_PROVIDER=resend` (or only Resend is configured), follow steps 5–8 from the original flow:

1. Expose the API (e.g. `npx localtunnel --port 3001`).
2. Register `https://<tunnel>/api/webhooks/resend` in Resend with the signing secret in `RESEND_WEBHOOK_SECRET`.
3. Configure inbound + domain tracking as before.

## Install & run (local)

From the repo root (workspaces install everything):

```bash
npm install
cp .env.example backend/.env   # then edit backend/.env
```

```bash
# Terminal 1
node backend/index.js

# Terminal 2
cd frontend && npm run dev
```

Vite proxies `/api` to port **3001**. Production UI build from root: `npm run build` → `frontend/dist`.

## Deploy on Vercel (one Git repo)

1. Push this repo to GitHub/GitLab/Bitbucket.
2. [Vercel](https://vercel.com) → **Add New Project** → import the repo. Leave the **root** as the repository root (no subdirectory).
3. Vercel reads **`vercel.json`**: builds the frontend and serves **`api/index.js`** for all `/api/*` routes.
4. **Storage (required on Vercel):** the filesystem is read-only. In the Vercel project open **Storage** → **Marketplace** → add **Upstash Redis** (or another Redis with REST). That injects **`UPSTASH_REDIS_REST_URL`** and **`UPSTASH_REDIS_REST_TOKEN`**. Without them, only **local** `logs.json` works; production writes need Redis.
5. **Environment variables:** in the Vercel project → **Settings → Environment Variables**, add everything you use locally (`GROQ_API_KEY`, `EMAIL_PROVIDER`, Gmail or Resend vars, etc.). **Do not** rely on `backend/.env` on Vercel.
6. **Resume attachments:** on Vercel use **`RESUME_PUBLIC_URL`** (HTTPS). Local file paths won’t exist on the server.
7. **Resend webhooks:** use `https://<your-deployment>.vercel.app/api/webhooks/resend`.
8. After deploy, open the production URL: the UI calls **`/api/...`** on the same origin, so you do **not** need `VITE_API_URL` unless the API is hosted elsewhere.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | `{ provider: 'gmail' \| 'resend', autoTracking: boolean }` |
| `POST` | `/api/preview` | `{ name, company, role }` → Groq `{ subject, body }` |
| `POST` | `/api/leads` | Send email (Gmail or Resend) and upsert lead |
| `GET` | `/api/leads` | All leads |
| `POST` | `/api/leads/:email/log-reply` | Body `{ replyContent }` — manual reply log (Gmail workflow) |
| `DELETE` | `/api/leads/:email` | Remove lead |
| `POST` | `/api/webhooks/resend` | Resend webhooks (Resend mode) |

## Notes

- Gmail cannot expose Resend-style **open/click** events; those columns show **N/A** in Gmail mode.
- `replyContent` / `replyContentFull` are filled from webhooks (Resend) or from **Log reply** (Gmail).

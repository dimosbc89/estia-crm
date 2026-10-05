# Estia CRM

A CRM for **Estia Greek Home** (estiagreekhome.online). Use it to handle discovery-call requests, run each month's home-watch visits and add-on jobs, and produce monthly reports.

It's a static web app (HTML/CSS/JS) with no server and no build step. Your data is stored in your browser's `localStorage`.

## Run it

- **On Cloudflare (with login):** a Cloudflare Worker (`worker/index.js`) serves the app from `public/` only to signed-in users. Data goes in the D1 database `estia-crm` and photos and videos in the R2 bucket `estia-crm-media`; both are already created and set in `wrangler.jsonc`. To deploy: Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick this repo and branch. The deploy command is `npx wrangler deploy`. After changing the app, run `npm run build` (refreshes `public/` and `dist/`) and push.
  - Address: **https://crm.estiagreekhome.online** (custom domain in `wrangler.jsonc`; the estiagreekhome.online zone must be in the same Cloudflare account).
  - **Sign in with Google:** create an OAuth client (Google Cloud Console → APIs & Services → Credentials → Web application) with the redirect URI `https://crm.estiagreekhome.online/auth/google/callback`, then add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as secrets on the Worker. Only emails in the `users` table can sign in (currently dimos@ and vassiliki@growagency.online). Add someone: `INSERT INTO users (email, name, salt, pass_hash) VALUES ('name@growagency.online', 'Name', '00', '00');`.
  - Add or reset a password login (fallback): `python3 scripts/add-user.py name@example.com "Name" > user.sql` (it prints the new password), then `npx wrangler d1 execute estia-crm --remote --file user.sql`.
  - Signed-in users can change their password in **Settings → Your account**.

- **As a private page on Claude (recommended):** https://claude.ai/artifact/65q7JBP6ZamqAXPezAYLtp. Data is saved privately to your Claude account, so it's the same on every device you sign in on. After code changes, rebuild with `python3 scripts/build-artifact.py` (writes `dist/estia-crm.html`) and republish that file.

- **Locally:** open `index.html` in a browser, or run `python3 -m http.server` in this folder and go to http://localhost:8000.
- **Online:** you can host it on GitHub Pages: repo **Settings → Pages → Deploy from branch**, then pick the branch and the root folder. Data still stays in each browser, so use one browser and computer as your main CRM, and move between devices with **Settings → Download backup / Restore**.

Click **Load demo data** (on the dashboard or in Settings) to try it out, then **Erase everything** before you start entering real data.

## What's inside

| Screen | Purpose |
|---|---|
| **Dashboard** | To-do list (new requests, calls due, follow-ups, visit reports due, overdue visits, quotes to send, partner applications), upcoming visits, and the key numbers |
| **Requests** | Discovery-call leads with the same fields as the website form. Pipeline: New → Call booked → Call done → Proposal sent → Won / Lost. **Make member** converts a lead into a member |
| **Members** | Owners on Essential / Recommended / Premium (monthly or annual): property, region, keys, insurer, access notes. Each member has a printable **Visit log** for insurers |
| **Monthly work** | **Generate visits from plans** creates 1, 2 or 4 visits per active member, spread through the month. Then mark each one *Visited* → *Report sent* (with a 24-hour check) and record findings. Add-on jobs go Requested → Quoted → Approved → Done, with price, contractor cost and paid status |
| **Visit report** | Open any visit to fill it in on site: arrival and departure times, indoor humidity and temperature, the 8-point checklist (OK / Issue / N/A), problems with severity and recommended action, and photos and videos (photos are resized and stamped with the date and time they were taken). Then copy the WhatsApp text, open the owner's WhatsApp chat, or download a report file with the photos embedded. Photos need the Claude page version |
| **Partners** | Applications from the *Become a partner* page (trade, professional, referral), with vetting status. Approved trades can be assigned to jobs |
| **Reports** | Monthly MRR, onboarding fees, add-on revenue and margin, VAT, active/new/cancelled members, churn, visits completed, reports sent within 24h, issues found, requests by source/region/owner type, lost reasons, and a 6-month trend. Print it or export to CSV |
| **Settings** | Plan prices and visits, VAT (24%), onboarding fee (€100), revenue target, and the lists of services, sources and regions. Backup and restore |

## Getting website requests in

The website forms post to Formspree (`New Estia Inquiry` emails in plain format). Two ways to bring them in:

1. **Paste form email** (one at a time): copy the whole Formspree email and paste it. The CRM reads `name`, `email`, `phone`, `location`, `property_location`, `property_type`, `visit_frequency` and `message`. Partner applications (`form_origin: become-a-partner / …`) go to **Partners**.
2. **Import CSV** (in bulk): export submissions from the Formspree dashboard and import the file. Rows whose email already exists are skipped.

## Data & privacy

All data is stored only in the browser you use. Clearing your browser data erases it, so **download a backup every week** (Settings → Download backup). Nothing is sent to any server.

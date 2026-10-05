/* Estia CRM on Cloudflare Workers.
   - Everything (app files and API) sits behind a login.
   - Data: D1 table `docs` holds the same shard documents the app syncs (settings, members, leads_<year>, visits_<month>…).
   - Photos/videos: R2 bucket, served only to signed-in users. */

const COOKIE = 'estia_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const MAX_LOGIN_ATTEMPTS = 10;          // per IP per 15 minutes
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
const MAX_MEDIA_BYTES = 95 * 1024 * 1024;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000'
};
function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  Object.entries({ ...SECURITY_HEADERS, 'Cache-Control': 'private, no-store', ...extra }).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}
const json = (data, status = 200, headers = {}) => withHeaders(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }));

function getCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function currentUser(req, env) {
  const token = getCookie(req, COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT s.email, s.expires_at, u.name FROM sessions s JOIN users u ON u.email = s.email WHERE s.token_hash = ?')
    .bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { email: row.email, name: row.name };
}

/* ---------------- login page ---------------- */
function loginPage(message = '', email = '') {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Estia CRM</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23c8291d'/><path d='M8 24V13l8-6 8 6v11h-5v-6h-6v6z' fill='%23ffffff'/></svg>">
<style>
:root{--bg:#f7f7f9;--card:#fff;--ink:#0e0d1b;--muted:#595963;--line:#e8e8ec;--brand:#c8291d;--bad:#b23b3b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#12141a;--card:#1b1e26;--ink:#eceef3;--muted:#a3a8b5;--line:#2c313c;--brand:#ff6b61;--bad:#f08c8c;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
form{width:min(380px,100%);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 24px;display:flex;flex-direction:column;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:17px}.mark{width:34px;height:34px;border-radius:8px;background:var(--brand);display:grid;place-items:center}
.mark svg{width:22px;height:22px;fill:#fff}label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;color:var(--muted)}
input{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}input:focus{outline:2px solid var(--brand);outline-offset:1px}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:11px;background:var(--brand);color:#fff;cursor:pointer}
.err{color:var(--bad);font-size:14px;margin:0}.muted{color:var(--muted);font-size:13px;margin:0}
</style></head><body>
<form method="post" action="/login">
  <div class="brand"><span class="mark"><svg viewBox="0 0 32 32"><path d="M8 24V13l8-6 8 6v11h-5v-6h-6v6z"/></svg></span>Estia CRM</div>
  ${message ? `<p class="err" role="alert">${message}</p>` : ''}
  <label>Email<input type="email" name="email" autocomplete="username" required value="${email.replace(/[<>"&]/g, '')}"></label>
  <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p class="muted">You stay signed in on this device for ${SESSION_DAYS} days.</p>
</form></body></html>`;
  return withHeaders(new Response(html, { status: message ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

async function login(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const since = Date.now() - 15 * 60 * 1000;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first();
  const form = await req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  if (n >= MAX_LOGIN_ATTEMPTS) return loginPage('Too many attempts. Wait 15 minutes and try again.', email);
  const user = await env.DB.prepare('SELECT email, salt, pass_hash FROM users WHERE email = ?').bind(email).first();
  const ok = user && safeEqual(await hashPassword(password, user.salt), user.pass_hash);
  if (!ok) {
    await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()).run();
    return loginPage('That email and password don’t match.', email);
  }
  const token = randomHex(32);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), email, Date.now() + SESSION_DAYS * 864e5),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(since)
  ]);
  return withHeaders(new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) } }));
}

async function logout(req, env) {
  const token = getCookie(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return withHeaders(new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': sessionCookie('', 0) } }));
}

/* ---------------- API ---------------- */
async function api(req, env, user, path) {
  const method = req.method;
  // Mutations must come from the app itself (blocks cross-site form posts).
  if (method !== 'GET' && req.headers.get('X-Estia') !== '1') return json({ error: 'forbidden' }, 403);

  if (path === '/api/me') return json(user);

  if (path === '/api/docs' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT key, body FROM docs').all();
    const docs = {};
    results.forEach(r => { docs[r.key] = JSON.parse(r.body); });
    return json({ docs });
  }

  let m = path.match(/^\/api\/docs\/([A-Za-z0-9_-]{1,64})$/);
  if (m) {
    if (method === 'PUT') {
      const body = await req.text();
      try { JSON.parse(body); } catch { return json({ error: 'invalid JSON' }, 400); }
      if (body.length > 1_900_000) return json({ error: 'document too large' }, 413);
      await env.DB.prepare(`INSERT INTO docs (key, body, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(m[1], body, user.email).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM docs WHERE key = ?').bind(m[1]).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/media' && method === 'POST') {
    const type = (req.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!MEDIA_TYPES.has(type)) return json({ error: 'unsupported_type' }, 415);
    const size = Number(req.headers.get('Content-Length') || 0);
    if (size > MAX_MEDIA_BYTES) return json({ error: 'too_large' }, 413);
    const id = randomHex(16);
    const obj = await env.MEDIA.put(id, req.body, { httpMetadata: { contentType: type } });
    await env.DB.prepare('INSERT INTO media (id, content_type, size, uploaded_by) VALUES (?, ?, ?, ?)').bind(id, type, obj.size, user.email).run();
    return json({ id, url: '/api/media/' + id, sizeBytes: obj.size, contentType: type });
  }

  m = path.match(/^\/api\/media\/([a-f0-9]{32})$/);
  if (m) {
    if (method === 'GET') {
      const obj = await env.MEDIA.get(m[1], { range: req.headers, onlyIf: req.headers });
      if (!obj) return json({ error: 'not found' }, 404);
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('ETag', obj.httpEtag);
      headers.set('Accept-Ranges', 'bytes');
      if (!('body' in obj)) return withHeaders(new Response(null, { status: 304, headers }), { 'Cache-Control': 'private, max-age=31536000, immutable' });
      let status = 200;
      if (obj.range && req.headers.has('Range')) {
        const { offset = 0, length = obj.size - offset } = obj.range;
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
        status = 206;
      }
      return withHeaders(new Response(obj.body, { status, headers }), { 'Cache-Control': 'private, max-age=31536000, immutable' });
    }
    if (method === 'DELETE') {
      await env.MEDIA.delete(m[1]);
      await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(m[1]).run();
      return json({ deleted: true });
    }
  }

  if (path === '/api/password' && method === 'POST') {
    const { current, next } = await req.json().catch(() => ({}));
    if (typeof next !== 'string' || next.length < 10) return json({ error: 'The new password must be at least 10 characters.' }, 400);
    const row = await env.DB.prepare('SELECT salt, pass_hash FROM users WHERE email = ?').bind(user.email).first();
    if (!row || !safeEqual(await hashPassword(String(current || ''), row.salt), row.pass_hash)) return json({ error: 'Your current password is not correct.' }, 400);
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE email = ?').bind(salt, await hashPassword(next, salt), user.email),
      // Sign out every other device.
      env.DB.prepare('DELETE FROM sessions WHERE email = ? AND token_hash != ?').bind(user.email, await sha256(getCookie(req, COOKIE)))
    ]);
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/login' && req.method === 'POST') return login(req, env);
    if (path === '/logout') return logout(req, env);

    const user = await currentUser(req, env);
    if (!user) {
      if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
      if (path === '/login') return loginPage();
      return withHeaders(new Response(null, { status: 302, headers: { Location: '/login' } }));
    }
    if (path === '/login') return withHeaders(new Response(null, { status: 302, headers: { Location: '/' } }));
    if (path.startsWith('/api/')) {
      try { return await api(req, env, user, path); }
      catch (e) { console.error(e); return json({ error: 'server error' }, 500); }
    }
    return withHeaders(await env.ASSETS.fetch(req));
  }
};

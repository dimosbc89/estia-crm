/* Estia CRM on Cloudflare Workers.
   - Everything (app files and API) sits behind a login.
   - Data: D1 table `docs` holds the same shard documents the app syncs (settings, members_<n>, leads_<year>, visits_<month>…).
   - Photos/videos: R2 bucket, served only to signed-in users.
   - Member files (past reports, spreadsheets, contracts…): same R2 bucket under members/<memberId>/<fileId>.
     R2 itself is the list of files, so two people uploading at the same time never overwrite each other. */

const COOKIE = 'estia_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const MAX_LOGIN_ATTEMPTS = 10;          // per IP per 15 minutes
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
const MAX_MEDIA_BYTES = 95 * 1024 * 1024;

// Member files: the type comes from the file extension (browsers often send no type for .msg, .numbers…).
// No HTML, SVG, XML or script types: a stored file must never run code on the CRM's own address.
const FILE_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote',
  rtf: 'application/rtf', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', zip: 'application/zip',
  mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4'
};
// These open in a browser tab; everything else downloads.
const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain; charset=utf-8', 'video/mp4', 'audio/mpeg', 'audio/mp4']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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

/* Stream an R2 object to a signed-in user, with range requests (video seeking, large PDFs) and 304s.
   extra(obj) can add headers from the object's metadata. */
async function serveObject(env, req, key, extra = () => ({})) {
  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return json({ error: 'not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  const cache = { 'Cache-Control': 'private, max-age=31536000, immutable', ...extra(obj) };
  if (!('body' in obj)) return withHeaders(new Response(null, { status: 304, headers }), cache);
  let status = 200;
  if (obj.range && req.headers.has('Range')) {
    const r = obj.range;
    const offset = 'suffix' in r ? obj.size - r.suffix : (r.offset || 0);
    const length = 'suffix' in r ? r.suffix : (r.length ?? obj.size - offset);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    status = 206;
  }
  return withHeaders(new Response(obj.body, { status, headers }), cache);
}

/* ---- member files ---- */
function cleanFileName(raw) {
  let name = String(raw || '');
  try { name = decodeURIComponent(name); } catch { /* keep as sent */ }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>]/g, '').trim().slice(0, 180);
  return name || 'file';
}
const fileExt = (name) => (String(name).match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase() || '';
// RFC 6266 / 5987: plain ASCII name for old clients, the real (often Greek) name for everyone else.
function contentDisposition(name, inline) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
function fileInfo(o) {
  const id = o.key.split('/').pop();
  return {
    id, name: o.customMetadata?.name || id, type: o.httpMetadata?.contentType || '', size: o.size,
    uploadedAt: o.customMetadata?.at || o.uploaded.toISOString(), by: o.customMetadata?.by || ''
  };
}
async function listKeys(env, prefix, withMeta) {
  const out = [];
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, cursor, ...(withMeta ? { include: ['httpMetadata', 'customMetadata'] } : {}) });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

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
function loginPage(message = '', email = '', env = {}) {
  const google = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const safeEmail = email.replace(/[<>"&]/g, '');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Estia CRM</title>
<link rel="icon" href="/assets/favicon.svg">
<style>
@font-face{font-family:Manrope;font-weight:400 800;font-display:swap;src:url(/assets/fonts/manrope-latin-variable.woff2) format("woff2")}
@font-face{font-family:Poppins;font-weight:400;font-display:swap;src:url(/assets/fonts/poppins-400-latin.woff2) format("woff2")}
@font-face{font-family:Poppins;font-weight:500;font-display:swap;src:url(/assets/fonts/poppins-500-latin.woff2) format("woff2")}
@font-face{font-family:Poppins;font-weight:600;font-display:swap;src:url(/assets/fonts/poppins-600-latin.woff2) format("woff2")}
:root{--bg:#fff;--warm:#f7f7f9;--card:#fff;--ink:#0e0d1b;--muted:#595963;--line:#e8e8ec;--brand:#c8291d;--accent:#ff4438;--accent-text:#d6301f;--soft:#ffe9e7;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0b0a16;--warm:#0b0a16;--card:#15142a;--ink:#f2f1f8;--muted:#b9b7c9;--line:#2a2942;--brand:#d9372b;--accent:#ff6b61;--accent-text:#ff6b61;--soft:#3a1d22;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}
body{min-height:100vh;display:flex;flex-direction:column;color:var(--ink);font:15px/1.55 Manrope,system-ui,-apple-system,Segoe UI,sans-serif;
  background:radial-gradient(900px 480px at 85% 10%,rgba(255,68,56,.09),transparent 65%),var(--warm)}
.strip{background:#0e0d1b;color:#fff;font-size:13px;letter-spacing:.03em;text-align:center;padding:10px 16px}
main{flex:1;display:grid;place-items:center;padding:40px 16px}
form{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:34px 30px;display:flex;flex-direction:column;gap:16px}
.logo{height:48px;width:auto;align-self:flex-start}
.mark{display:none;align-items:center;gap:10px;font:600 28px/1 Poppins,sans-serif;color:var(--ink);align-self:flex-start}.mark img{width:44px;height:44px;display:block}
@media (prefers-color-scheme:dark){.logo{display:none}.mark{display:inline-flex}}
.eyebrow{color:var(--accent-text);font-weight:700;font-size:12px;letter-spacing:.2em;text-transform:uppercase;margin-top:6px}.eyebrow::before{content:"—— ";color:var(--accent)}
h1{font:500 30px/1.15 Poppins,system-ui,sans-serif;letter-spacing:-.02em;margin:0}h1 em{color:var(--accent);font-weight:400}
label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:var(--muted)}
input{font:inherit;font-size:16px;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
input{border-radius:8px}
input:focus-visible{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px rgba(255,68,56,.12)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:inherit;font-weight:600;border:0;border-radius:100px;padding:14px 26px;background:var(--brand);color:#fff;cursor:pointer;margin-top:4px}
button{display:inline-flex;align-items:center;justify-content:center;gap:8px}
button::after{content:"→";font-weight:400;transition:transform .2s}button:hover::after{transform:translateX(3px)}
button:hover{background:#a92016}
.err{background:var(--soft);border-left:3px solid var(--accent);border-radius:8px;padding:10px 14px;margin:0;font-size:14px}
.muted{color:var(--muted);font-size:13px;margin:0}
.google{display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;font-weight:600;color:var(--ink);border:1px solid var(--line);border-radius:100px;padding:13px 22px;background:var(--card)}
.google:hover{border-color:var(--ink)}
details{display:flex;flex-direction:column;gap:14px}details[open]{display:flex}details>summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}
details label,details button{margin-top:12px}details button{width:100%}
footer{background:#0e0d1b;color:#9c9aab;font-size:13px;text-align:center;padding:18px 16px}
</style></head><body>
<div class="strip">Estia CRM · Property care for owners abroad</div>
<main>
<form method="post" action="/login">
  <img class="logo" src="/assets/estia-lockup-dark.webp" alt="Estia — Trusted Care For Your Greek Home" width="178" height="48">
  <span class="mark" aria-hidden="true"><img src="/assets/apple-touch-icon.png" alt="" width="44" height="44">Estia</span>
  <div class="eyebrow">Team sign-in</div>
  <h1>Welcome <em>back</em></h1>
  ${message ? `<p class="err" role="alert">${message}</p>` : ''}
  ${google ? `<a class="google" href="/auth/google"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Sign in with Google</a>
  <details${message && email ? ' open' : ''}><summary>Use a password instead</summary>` : ''}
  <label>Email<input type="email" name="email" autocomplete="username" ${google ? '' : 'required'} value="${safeEmail}"></label>
  <label>Password<input type="password" name="password" autocomplete="current-password" ${google ? '' : 'required'}></label>
  <button type="submit">Sign in</button>
  ${google ? '</details>' : ''}
  <p class="muted">You stay signed in on this device for ${SESSION_DAYS} days.</p>
</form>
</main>
<footer>© 2026 Estia · estiagreekhome.online</footer>
</body></html>`;
  return withHeaders(new Response(html, { status: message ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

async function login(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const since = Date.now() - 15 * 60 * 1000;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first();
  const form = await req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  if (n >= MAX_LOGIN_ATTEMPTS) return loginPage('Too many attempts. Wait 15 minutes and try again.', email, env);
  const user = await env.DB.prepare('SELECT email, salt, pass_hash FROM users WHERE email = ?').bind(email).first();
  const ok = user && safeEqual(await hashPassword(password, user.salt), user.pass_hash);
  if (!ok) {
    await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()).run();
    return loginPage('That email and password don’t match.', email, env);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(since).run();
  return startSession(env, email);
}

async function startSession(env, email, extraCookies = []) {
  const token = randomHex(32);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), email, Date.now() + SESSION_DAYS * 864e5),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now())
  ]);
  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400));
  extraCookies.forEach(c => headers.append('Set-Cookie', c));
  return withHeaders(new Response(null, { status: 303, headers }));
}

/* ---------------- Sign in with Google (OpenID Connect, authorization code + PKCE) ----------------
   Only people who have a row in the `users` table can get in; Google just proves who they are.
   Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Worker secrets). */
const OAUTH_COOKIE = 'estia_oauth';
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const oauthCookie = (value, maxAge) => `${OAUTH_COOKIE}=${value}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const GOOGLE_ERRORS = {
  not_allowed: 'This Google account doesn’t have access to the Estia CRM. Sign in with your growagency.online account, or ask Dimos to add you.',
  unverified: 'Google hasn’t verified this email address.',
  failed: 'Google sign-in didn’t complete. Please try again.'
};

async function googleStart(req, env) {
  const url = new URL(req.url);
  const state = randomHex(16), verifier = randomHex(32);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/auth/google/callback', response_type: 'code',
    scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    ...(env.GOOGLE_HOSTED_DOMAIN ? { hd: env.GOOGLE_HOSTED_DOMAIN } : {})
  });
  return withHeaders(new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': oauthCookie(`${state}.${verifier}`, 600) } }));
}

async function googleCallback(req, env) {
  const url = new URL(req.url);
  const fail = (code) => withHeaders(new Response(null, { status: 302, headers: { Location: '/login?error=' + code, 'Set-Cookie': oauthCookie('', 0) } }));
  const [state, verifier] = (getCookie(req, OAUTH_COOKIE) || '').split('.');
  const code = url.searchParams.get('code');
  if (!state || !verifier || !code || url.searchParams.get('state') !== state) return fail('failed');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: verifier })
  });
  if (!res.ok) { console.error('google token', res.status, await res.text()); return fail('failed'); }
  const { id_token } = await res.json();
  // The ID token comes straight from Google's token endpoint over TLS, so its claims can be read without
  // re-checking the signature (Google's OpenID Connect guidance); we still check audience, issuer and expiry.
  let claims;
  try { claims = JSON.parse(atob(id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return fail('failed'); }
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.exp * 1000 < Date.now()) return fail('failed');
  if (!claims.email_verified) return fail('unverified');
  const email = String(claims.email || '').toLowerCase();
  const user = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!user) return fail('not_allowed');
  if (claims.name) await env.DB.prepare("UPDATE users SET name = ? WHERE email = ? AND name = ''").bind(claims.name, email).run();
  return startSession(env, email, [oauthCookie('', 0)]);
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
    if (method === 'GET') return serveObject(env, req, m[1]);
    if (method === 'DELETE') {
      await env.MEDIA.delete(m[1]);
      await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(m[1]).run();
      return json({ deleted: true });
    }
  }

  /* Member files: GET lists, POST uploads (raw body + X-File-Name), DELETE removes them all (member deleted). */
  if (path === '/api/files') {
    const memberId = new URL(req.url).searchParams.get('member') || '';
    if (!ID_RE.test(memberId)) return json({ error: 'bad_member' }, 400);
    const prefix = `members/${memberId}/`;
    if (method === 'GET') {
      const files = (await listKeys(env, prefix, true)).map(fileInfo).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      return json({ files });
    }
    if (method === 'POST') {
      const name = cleanFileName(req.headers.get('X-File-Name'));
      const type = FILE_TYPES[fileExt(name)];
      if (!type) return json({ error: 'unsupported_type' }, 415);
      const size = Number(req.headers.get('Content-Length') || 0);
      if (!size) return json({ error: 'empty' }, 400);
      if (size > MAX_MEDIA_BYTES) return json({ error: 'too_large' }, 413);
      const id = randomHex(16), at = new Date().toISOString();
      const obj = await env.MEDIA.put(prefix + id, req.body, { httpMetadata: { contentType: type }, customMetadata: { name, by: user.email, at } });
      return json({ file: { id, name, type, size: obj.size, uploadedAt: at, by: user.email } });
    }
    if (method === 'DELETE') {
      const keys = (await listKeys(env, prefix, false)).map(o => o.key);
      for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000));
      return json({ deleted: keys.length });
    }
  }

  m = path.match(/^\/api\/files\/([A-Za-z0-9_-]{1,64})\/([a-f0-9]{32})$/);
  if (m) {
    const key = `members/${m[1]}/${m[2]}`;
    if (method === 'GET') {
      const download = new URL(req.url).searchParams.has('download');
      return serveObject(env, req, key, (obj) => {
        const { name, type } = fileInfo(obj);
        return { 'Content-Disposition': contentDisposition(name, INLINE_TYPES.has(type) && !download) };
      });
    }
    if (method === 'DELETE') {
      await env.MEDIA.delete(key);
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

    // Brand images (logo, icons) are public so the sign-in page can show them. They contain no CRM data.
    if (path.startsWith('/assets/') && req.method === 'GET') return withHeaders(await env.ASSETS.fetch(req), { 'Cache-Control': 'public, max-age=86400' });
    if (path === '/login' && req.method === 'POST') return login(req, env);
    if (path === '/auth/google' && env.GOOGLE_CLIENT_ID) return googleStart(req, env);
    if (path === '/auth/google/callback' && env.GOOGLE_CLIENT_ID) return googleCallback(req, env);
    if (path === '/logout') return logout(req, env);

    const user = await currentUser(req, env);
    if (!user) {
      if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
      if (path === '/login') return loginPage(GOOGLE_ERRORS[url.searchParams.get('error')] || '', '', env);
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

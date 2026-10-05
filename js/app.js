/* Estia CRM – UI */
(function () {
  const S = window.Store;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const modal = $('#modal');
  const modalForm = $('#modalForm');
  const ST = () => S.settings;

  /* ================= helpers ================= */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const sum = (arr, f) => arr.reduce((a, x) => a + num(f(x)), 0);
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

  function money(v, cents) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: ST().currency || 'EUR', maximumFractionDigits: cents ? 2 : 0 }).format(v || 0); }
    catch { return `${Math.round(v || 0)} ${ST().currency}`; }
  }
  const fmtDate = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
  const monthShort = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' }); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);

  const pill = (status, extra = '') => `<span class="pill s-${slug(status)}${extra}">${esc(status)}</span>`;
  const options = (list, selected, blank) =>
    (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
    list.map(o => `<option ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('') +
    (selected && !list.includes(selected) ? `<option selected>${esc(selected)}</option>` : '');

  const leadOpen = (l) => l.status !== 'Won' && l.status !== 'Lost';
  const member = (id) => S.get('members', id);
  const memberName = (id) => member(id)?.name || '—';
  const waLink = (phone) => phone ? `https://wa.me/${String(phone).replace(/[^\d]/g, '')}` : '';

  function field(name, label, value, type = 'text', extra = '') {
    if (type === 'textarea') return `<label class="field full"><span>${esc(label)}</span><textarea name="${name}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
    if (Array.isArray(type)) return `<label class="field"><span>${esc(label)}</span><select name="${name}" ${extra}>${options(type, value, '— choose —')}</select></label>`;
    if (type === 'checkbox') return `<label class="check"><input type="checkbox" name="${name}" ${value ? 'checked' : ''} ${extra}> ${esc(label)}</label>`;
    return `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value ?? '')}" ${type === 'number' ? 'step="any" min="0"' : ''} ${extra}></label>`;
  }

  function toast(msg) {
    const t = $('#toast');
    const host = modal.open ? modal : document.body;   // an open modal <dialog> sits in the top layer, above everything else
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* Inside a Claude artifact, files go through the viewer's download prompt; elsewhere a normal link. */
  const IN_ARTIFACT = typeof window.claude?.use === 'function';
  // Set by the Cloudflare build (public/index.html): data and media go to our own server behind a login.
  const API = window.ESTIA_API || '';
  const MAX_VIDEO_MB = API ? 95 : 20;
  let downloadsCap = null;
  async function download(name, text, type = 'text/plain') {
    if (/\.csv$/.test(name)) text = '\ufeff' + text;   // so Excel reads Greek characters correctly
    if (IN_ARTIFACT) {
      if (!downloadsCap) { toast('Downloads are not available in this view'); return; }
      try { await downloadsCap.save({ filename: name, data: text }); toast('Saved ' + name); }
      catch (e) { if (e?.code !== 'declined') toast('Could not save the file'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* Print locally; inside an artifact (where printing is blocked) save a standalone page to print. */
  function printView(filename) {
    if (!IN_ARTIFACT) { window.print(); return; }
    const css = [...document.querySelectorAll('style')].map(x => x.textContent).join('\n');
    const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(filename)}</title><style>${css}</style></head><body class="printable"><main>${main.innerHTML}</main></body></html>`;
    download(filename + '.html', html, 'text/html');
  }
  const printLabel = () => IN_ARTIFACT ? 'Download to print' : 'Print / PDF';

  const toCSV = (rows) => rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');

  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim()));
  }

  /* ---- Website form submissions (Formspree "plain" emails / CSV export) ---- */
  // Website field name -> CRM field, for the discovery-call form and the three partner forms.
  const LEAD_KEYS = { name: 'name', email: 'email', phone: 'phone', location: 'ownerLocation', property_location: 'propertyLocation', property_type: 'propertyType', visit_frequency: 'visitFrequency', message: 'message' };
  const PARTNER_KEYS = {
    name: 'name', email: 'email', phone: 'phone', company: 'company', organisation: 'company', partner_track: 'track',
    trade_type: 'trade', profession: 'trade', referral_type: 'trade', specialism: 'specialism',
    location: 'area', coverage: 'area', years: 'years', liability_insurance: 'insurance', licensing: 'licensing', registration: 'licensing',
    rate: 'rate', languages: 'languages', references: 'references', website: 'website', referrer: 'referrer', message: 'message'
  };
  const IGNORE_KEYS = new Set(['_subject', '_next', '_format', '_gotcha', 'form_origin', 'g-recaptcha-response']);
  const normKey = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  /* Turns {website_field: value} into ['lead'|'partner', crmRecord]. */
  function recordFromForm(raw) {
    const origin = String(raw.form_origin || raw.partner_track || '').toLowerCase();
    const isPartner = /partner/.test(origin) || raw.partner_track || raw.trade_type || raw.profession || raw.referral_type;
    const keys = isPartner ? PARTNER_KEYS : LEAD_KEYS;
    const rec = {}, extra = [];
    Object.entries(raw).forEach(([k, v]) => {
      v = String(v ?? '').trim();
      if (!v || IGNORE_KEYS.has(k) || /^(_date|date|created_at|submitted|timestamp)$/.test(k)) return;
      if (keys[k]) rec[keys[k]] = rec[keys[k]] ? rec[keys[k]] + ' · ' + v : v;
      else extra.push(`${k.replace(/_/g, ' ')}: ${v}`);
    });
    if (extra.length) rec.message = [rec.message, extra.join('\n')].filter(Boolean).join('\n\n');
    const when = raw._date || raw.date || raw.created_at || raw.submitted || raw.timestamp;
    const d = when ? new Date(when) : null;
    if (d && !isNaN(d)) rec.createdAt = d.toISOString();
    if (isPartner) {
      rec.track = ST().partnerTracks.find(t => t.toLowerCase().startsWith(String(rec.track || origin.split('/')[1] || '').trim().toLowerCase().split(' ')[0])) || rec.track || 'Trade partner';
      return ['partner', rec];
    }
    rec.source = 'Website form';
    return ['lead', rec];
  }

  function parseFormEmail(text) {
    const raw = {};
    let last = null;
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][\w \-/]{0,40}?)\s*:\s*(.*)$/);
      if (m && !/^https?$/i.test(m[1])) {
        const k = normKey(m[1]);
        const alias = { your_name: 'name', full_name: 'name', your_full_name: 'name', whatsapp_or_phone: 'phone', where_do_you_currently_live: 'location',
          where_is_your_property_in_greece: 'property_location', how_often_do_you_currently_visit: 'visit_frequency', what_prompted_you_to_look_into_this: 'message' }[k] || k;
        raw[alias] = m[2]; last = alias;
      } else if (last && line.trim()) raw[last] += '\n' + line.trim();
    });
    if (!raw.email) { const e = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/); if (e) raw.email = e[0]; }
    return raw;
  }

  function guessRegion(text) {
    const t = String(text || '').toLowerCase();
    const hints = [
      [/riviera|glyfada|voula|vouliagmeni|varkiza|sounio|lagonisi|saronida/, 'Athens Riviera'],
      [/kalamata|pylos|stoupa|kardamyli|navarino|messini/, 'Kalamata & Costa Navarino'],
      [/thessalon|kalamaria|panorama|halki?d?i?k?i?\b/, 'Thessaloniki'],
      [/halkidiki|chalkidiki|kassandra|sithonia/, 'Halkidiki'],
      [/pelion|volos/, 'Pelion'], [/evia|euboea|chalkida/, 'Evia'],
      [/peloponn|mani|argol|nafplio|tripoli|monemvasia/, 'Peloponnese'],
      [/athens|αθήνα|kolonaki|kifisia|marousi|chalandri|piraeus|attica|attiki/, 'Athens'],
      [/crete|heraklion|chania|rhodes|corfu|paros|naxos|mykonos|santorini|syros|tinos|island/, 'Islands']
    ];
    const hit = hints.find(([re]) => re.test(t));
    return hit && ST().regions.includes(hit[1]) ? hit[1] : (t ? 'Other' : '');
  }

  /* ================= modal ================= */
  let onSubmit = null;
  function openModal({ title, body, foot = '', submitLabel = 'Save', onSave, bind, wide }) {
    modalForm.innerHTML = `
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost sm" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot ? `<div class="modal-extra">${foot}</div>` : ''}<span class="spacer"></span>
        <div class="modal-main"><button type="button" class="btn" data-close>${onSave ? 'Cancel' : 'Close'}</button>
        ${onSave ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}</div>
      </div>`;
    modal.style.width = '';
    modal.classList.toggle('wide', !!wide);
    onSubmit = onSave || null;
    $$('[data-close]', modalForm).forEach(b => b.addEventListener('click', closeModal));
    if (bind) bind(modalForm);
    focusableRows(modalForm);
    if (!modal.open) modal.showModal();
    $('.modal-body', modalForm).scrollTop = 0;
    // Focus the first field of a new form; on a phone, opening an existing record must not raise the keyboard.
    const first = $('input:not([type=checkbox]):not([type=hidden]), textarea, select', $('.modal-body', modalForm));
    const touch = matchMedia('(pointer: coarse)').matches;
    if (first && !first.closest('details') && !(touch && first.value)) first.focus();
  }
  function closeModal() { if (modal.open) modal.close(); onSubmit = null; }
  modal.addEventListener('close', () => { const t = $('#toast'); if (t.parentNode === modal) document.body.appendChild(t); });
  /* Rows and list items that open a record can be reached with Tab and opened with Enter / Space. */
  function focusableRows(root) { $$('[data-open]:not(a):not(button)', root).forEach(el => { el.tabIndex = 0; }); }
  modalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!onSubmit) return closeModal();
    const data = Object.fromEntries(new FormData(modalForm).entries());
    $$('input[type=checkbox][name]', modalForm).forEach(cb => { data[cb.name] = cb.checked; });
    if (onSubmit(data, modalForm) !== false) { if (modal.open && onSubmit) closeModal(); render(); }
  });

  function confirmBox(text, onYes, label = 'Delete') {
    openModal({ title: 'Are you sure?', body: `<p>${esc(text)}</p>`, submitLabel: label, onSave: () => { onYes(); } });
  }

  function activityBlock(col, item) {
    const list = (item.activity || []).slice().reverse();
    return `
      <div class="section-title">Notes & activity</div>
      <div class="row" style="margin-bottom:10px"><input type="text" id="noteInput" placeholder="Called, sent proposal, waiting for keys…" style="flex:1"><button type="button" class="btn sm" id="noteAdd">Add note</button></div>
      ${list.length ? `<ul class="activity">${list.map(a => `<li class="${a.note ? 'note' : ''}"><div class="when">${fmtDateTime(a.at)}</div>${esc(a.text)}</li>`).join('')}</ul>` : '<p class="muted small">No notes yet.</p>'}`;
  }
  function bindNotes(root, col, id, reopen) {
    const add = () => { const v = $('#noteInput', root).value; if (!v.trim()) return; S.addNote(col, id, v); reopen(S.get(col, id)); };
    $('#noteAdd', root)?.addEventListener('click', add);
    $('#noteInput', root)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }
  function contactButtons(x) {
    return `${x.email ? `<a class="btn" href="mailto:${esc(x.email)}">Email</a>` : ''}
      ${x.phone ? `<a class="btn" href="${esc(waLink(x.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}`;
  }

  /* ================= state ================= */
  const state = {
    view: 'dashboard',
    leadFilter: { q: '', status: 'Open', source: '' },
    partnerFilter: 'Open',
    memberFilter: { q: '', status: 'Current' },
    workMonth: S.monthKey(),
    reportMonth: S.monthKey()
  };

  const views = {};

  function stat(label, value, hint) {
    return `<div class="card stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint || '')}</div></div>`;
  }
  function barList(pairs, fmt = (v) => v) {
    pairs = pairs.filter(p => p[1]);
    if (!pairs.length) return `<div class="empty">No data for this period.</div>`;
    const max = Math.max(...pairs.map(p => p[1]));
    return `<div class="bars">${pairs.map(([l, v]) => `
      <div class="bar-row" title="${esc(l)}: ${esc(fmt(v))}">
        <span class="lbl">${esc(l)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div>
        <span class="v">${esc(fmt(v))}</span>
      </div>`).join('')}</div>`;
  }
  function monthNav(key, attr) {
    return `<div class="monthnav">
      <button class="btn sm" ${attr}="-1" aria-label="Previous month">‹</button>
      <span class="label">${esc(monthLabel(key))}</span>
      <button class="btn sm" ${attr}="1" aria-label="Next month">›</button>
      ${key !== S.monthKey() ? `<button class="btn sm" ${attr}="0">This month</button>` : ''}
    </div>`;
  }
  function emptyStart(what) {
    return `<div class="empty">No ${what} yet.<br><br>
      <button class="btn primary" data-act="new-lead">Add a request</button>
      <button class="btn" data-act="paste-form">Paste a website form email</button>
      <button class="btn" data-act="demo">Load demo data</button></div>`;
  }

  /* ================= metrics ================= */
  function monthMetrics(mk) {
    const leads = S.all('leads').filter(l => S.monthKey(l.createdAt) === mk);
    const members = S.all('members');
    const active = members.filter(m => S.activeIn(m, mk));
    const started = members.filter(m => (m.startDate || '').slice(0, 7) === mk && m.status !== 'Onboarding');
    const cancelled = members.filter(m => m.status === 'Cancelled' && (m.endDate || '').slice(0, 7) === mk);
    const mrr = sum(active, m => S.memberMRR(m));
    const onboarding = started.filter(m => m.onboardingPaid).length * num(ST().onboardingFee);
    const jobs = S.all('jobs').filter(j => j.month === mk);
    const jobsDone = jobs.filter(j => j.status === 'Done');
    const addOnRevenue = sum(jobsDone, j => j.price);
    const addOnCost = sum(jobsDone, j => j.cost);
    const visits = S.all('visits').filter(v => v.month === mk);
    const visited = visits.filter(v => v.status === 'Visited' || v.status === 'Report sent');
    const reported = visits.filter(v => v.status === 'Report sent');
    const onTime = reported.filter(v => v.reportSentAt && v.date && daysBetween(v.date, v.reportSentAt) <= 1);
    const withIssues = visits.filter(v => (v.issues || '').trim());
    const won = leads.filter(l => l.status === 'Won').length;
    const lost = leads.filter(l => l.status === 'Lost').length;
    const revenue = mrr + onboarding + addOnRevenue;
    return { mk, leads, won, lost, active, started, cancelled, mrr, onboarding, jobs, jobsDone, addOnRevenue, addOnCost,
      visits, visited, reported, onTime, withIssues, revenue, vat: revenue * num(ST().vatRate) / 100 };
  }

  /* ================= dashboard ================= */
  views.dashboard = () => {
    const mk = S.monthKey();
    const m = monthMetrics(mk);
    const today = todayISO();
    const leads = S.all('leads');
    const newLeads = leads.filter(l => l.status === 'New');
    const calls = leads.filter(l => l.status === 'Call booked' && l.callDate).sort((a, b) => a.callDate.localeCompare(b.callDate));
    const followUps = leads.filter(l => leadOpen(l) && l.followUp && l.followUp <= today);
    const todo = [
      ...newLeads.map(l => ({ kind: 'lead', id: l.id, title: l.name, sub: `New request · ${l.propertyLocation || l.source || ''}`, tag: pill('New'), sort: l.createdAt })),
      ...calls.filter(l => l.callDate <= today).map(l => ({ kind: 'lead', id: l.id, title: l.name, sub: 'Discovery call', tag: `<span class="pill s-in-progress">${l.callDate < today ? 'Overdue' : 'Today'}</span>`, sort: l.callDate })),
      ...followUps.map(l => ({ kind: 'lead', id: l.id, title: l.name, sub: `Follow up · ${l.status}`, tag: `<span class="pill ${l.followUp < today ? 's-overdue' : 's-in-progress'}">${l.followUp < today ? 'Overdue' : 'Today'}</span>`, sort: l.followUp })),
      ...S.all('visits').filter(v => v.status === 'Visited').map(v => ({ kind: 'visit', id: v.id, title: memberName(v.memberId), sub: `Send visit report (visited ${fmtDate(v.date)})`, tag: `<span class="pill ${daysBetween(v.date, today) > 1 ? 's-overdue' : 's-in-progress'}">Report due</span>`, sort: v.date })),
      ...S.all('visits').filter(v => v.status === 'Scheduled' && v.date && v.date < today).map(v => ({ kind: 'visit', id: v.id, title: memberName(v.memberId), sub: `Visit planned ${fmtDate(v.date)} not marked done`, tag: pill('Overdue'), sort: v.date })),
      ...S.all('jobs').filter(j => j.status === 'Requested').map(j => ({ kind: 'job', id: j.id, title: j.title, sub: `Send quote · ${memberName(j.memberId)}`, tag: pill('Requested'), sort: j.createdAt })),
      ...S.all('partners').filter(p => p.status === 'New').map(p => ({ kind: 'partner', id: p.id, title: p.name, sub: `Partner application · ${p.track || ''}`, tag: pill('New'), sort: p.createdAt }))
    ].sort((a, b) => String(a.sort).localeCompare(String(b.sort)));

    const upcoming = S.all('visits').filter(v => v.status === 'Scheduled' && v.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
    const pipelineMRR = sum(leads.filter(l => ['Call booked', 'Call done', 'Proposal sent'].includes(l.status)), l => S.plan(l.interestedPlan || 'Recommended')?.monthly || 0);
    const target = num(ST().monthlyRevenueTarget);
    const hour = new Date().getHours();

    return `
      <div class="page-head">
        <div><h1>Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}</h1>
        <div class="sub">${esc(ST().businessName)} · ${esc(monthLabel(mk))}</div></div>
        <div class="row">
          <button class="btn" data-act="paste-form">Paste form email</button>
          <button class="btn" data-act="new-lead">+ New request</button>
        </div>
      </div>
      <div class="stats">
        ${stat('Active members', m.active.length, `${S.all('members').filter(x => x.status === 'Onboarding').length} onboarding`)}
        ${stat('MRR', money(m.mrr), 'ex VAT · annual plans ÷ 12')}
        ${stat('Revenue this month', money(m.revenue), target ? `${pct(m.revenue, target)}% of ${money(target)} target` : 'subscriptions + onboarding + add-ons')}
        ${stat('Visits this month', `${m.visited.length}/${m.visits.length}`, `${m.reported.length} reports sent`)}
        ${stat('Open requests', leads.filter(leadOpen).length, `${newLeads.length} new · pipeline ${money(pipelineMRR)}/mo`)}
      </div>
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h2>To do</h2><span class="muted small">${todo.length}</span></div>
          ${todo.length ? `<ul class="list">${todo.slice(0, 12).map(t => `
            <li class="clickable" data-open="${t.kind}:${t.id}">
              <div><div class="name">${esc(t.title)}</div><div class="muted small">${esc(t.sub)}</div></div>${t.tag}
            </li>`).join('')}</ul>` : (S.all('leads').length || S.all('members').length ? `<div class="empty">All caught up.</div>` : emptyStart('data'))}
        </section>
        <section class="card">
          <div class="card-head"><h2>Upcoming visits</h2><a href="#month" class="small">Monthly work</a></div>
          ${upcoming.length ? `<ul class="list">${upcoming.map(v => { const mm = member(v.memberId); return `
            <li class="clickable" data-open="visit:${v.id}">
              <div><div class="name">${esc(mm?.name || '—')}</div><div class="muted small">${esc(mm?.propertyAddress || mm?.region || '')}</div></div>
              <span class="muted small">${fmtDay(v.date)}</span>
            </li>`; }).join('')}</ul>` : `<div class="empty">No visits scheduled. Open <a href="#month">Monthly work</a> and generate this month's visits.</div>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Discovery calls booked</h2><a href="#leads" class="small">All requests</a></div>
          ${calls.length ? `<ul class="list">${calls.slice(0, 6).map(l => `
            <li class="clickable" data-open="lead:${l.id}"><div><div class="name">${esc(l.name)}</div><div class="muted small">${esc([l.ownerLocation, l.propertyLocation].filter(Boolean).join(' → '))}</div></div>
            <span class="muted small">${fmtDate(l.callDate)}</span></li>`).join('')}</ul>` : `<div class="empty">No calls booked.</div>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Request pipeline</h2><span class="muted small">all time</span></div>
          ${barList(S.LEAD_STATUSES.map(s => [s, leads.filter(l => l.status === s).length]))}
        </section>
      </div>`;
  };

  /* ================= requests (leads) ================= */
  function filteredLeads() {
    const f = state.leadFilter, q = f.q.trim().toLowerCase();
    return S.all('leads').filter(l =>
      (f.status === 'All' || (f.status === 'Open' ? leadOpen(l) : l.status === f.status)) &&
      (!f.source || l.source === f.source) &&
      (!q || [l.name, l.email, l.phone, l.message, l.ownerLocation, l.propertyLocation].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  views.leads = () => {
    const f = state.leadFilter, all = S.all('leads');
    const counts = { All: all.length, Open: all.filter(leadOpen).length };
    S.LEAD_STATUSES.forEach(s => counts[s] = all.filter(l => l.status === s).length);
    const list = filteredLeads(), today = todayISO();
    return `
      <div class="page-head">
        <div><h1>Requests</h1><div class="sub">Discovery-call requests from the website, WhatsApp, email and social.</div></div>
        <div class="row">
          <button class="btn ghost" data-act="import-csv">Import CSV</button>
          <button class="btn ghost" data-act="export-leads">Export CSV</button>
          <button class="btn" data-act="paste-form">Paste form email</button>
          <button class="btn primary" data-act="new-lead">+ New request</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="row">
          <div class="chips">${['Open', ...S.LEAD_STATUSES, 'All'].map(s => `<button class="chip ${f.status === s ? 'on' : ''}" data-lead-status="${esc(s)}" aria-pressed="${f.status === s}">${esc(s)}<span class="c">${counts[s]}</span></button>`).join('')}</div>
          <span class="spacer"></span>
          <input type="search" id="leadSearch" data-search="leadFilter.q" placeholder="Search…" value="${esc(f.q)}" class="filter-search" aria-label="Search requests">
          <select id="leadSource" aria-label="Source">${options(ST().sources, f.source, 'All sources')}</select>
        </div>
      </div>
      <div class="card table-wrap">
        ${list.length ? `<table>
          <thead><tr><th>Received</th><th>Name</th><th>Lives in</th><th>Property</th><th>Source</th><th>Status</th><th>Next step</th></tr></thead>
          <tbody>${list.map(l => {
            const next = l.status === 'Call booked' && l.callDate ? ['Call', l.callDate] : l.followUp && leadOpen(l) ? ['Follow up', l.followUp] : null;
            return `<tr class="clickable" data-open="lead:${l.id}">
              <td class="muted">${fmtDate(l.createdAt)}</td>
              <td><div class="name">${esc(l.name)}</div><div class="muted small">${esc(l.email || l.phone || '')}</div></td>
              <td>${esc(l.ownerLocation || '—')}</td>
              <td>${esc(l.propertyLocation || '—')}${l.propertyType ? `<div class="muted small">${esc(l.propertyType)}</div>` : ''}</td>
              <td>${esc(l.source || '—')}</td>
              <td data-stop><select class="pill-select s-${slug(l.status)}" data-set-status="leads:${l.id}">${options(S.LEAD_STATUSES, l.status)}</select></td>
              <td>${next ? `<span class="${next[1] < today ? 'pill s-overdue' : 'small'}">${next[0]} ${fmtDate(next[1])}</span>` : '<span class="muted">—</span>'}</td>
            </tr>`; }).join('')}</tbody></table>`
        : (all.length ? `<div class="empty">No requests match these filters.</div>` : emptyStart('requests'))}
      </div>`;
  };

  function leadForm(l = {}) {
    const isNew = !l.id, st = ST();
    const body = `
      <div class="fields">
        ${field('name', 'Name *', l.name, 'text', 'required')}
        ${field('createdDate', 'Received', (l.createdAt || new Date().toISOString()).slice(0, 10), 'date')}
        ${field('email', 'Email', l.email, 'email')}
        ${field('phone', 'WhatsApp or phone', l.phone, 'tel')}
        ${field('ownerLocation', 'Where they live', l.ownerLocation, 'text', 'placeholder="e.g. Melbourne, Toronto, London"')}
        ${field('propertyLocation', 'Property in Greece', l.propertyLocation, 'text', 'placeholder="e.g. Glyfada, Kalamata"')}
        ${field('propertyType', 'Property type', l.propertyType, st.propertyTypes)}
        ${field('visitFrequency', 'How often they visit', l.visitFrequency, st.visitFrequencies)}
        ${field('audience', 'Owner type', l.audience, st.audiences)}
        ${field('source', 'Source', l.source || 'Website form', st.sources)}
        ${field('status', 'Status', l.status || 'New', S.LEAD_STATUSES)}
        ${field('interestedPlan', 'Plan discussed', l.interestedPlan, st.plans.map(p => p.name))}
        ${field('callDate', 'Discovery call date', l.callDate, 'date')}
        ${field('followUp', 'Next follow-up', l.followUp, 'date')}
        ${field('lostReason', 'Lost reason', l.lostReason, 'text', 'placeholder="Only if lost: price, outside area, timing…"')}
        ${field('message', 'What prompted them / notes from the form', l.message, 'textarea')}
      </div>
      ${!isNew ? activityBlock('leads', l) : ''}
      ${l.memberId && member(l.memberId) ? `<p class="small" style="margin-top:12px">Member: <a href="#" data-open="member:${l.memberId}">${esc(memberName(l.memberId))}</a></p>` : ''}`;
    openModal({
      title: isNew ? 'New request' : l.name, body,
      foot: isNew ? '' : `<button type="button" class="btn danger" id="del">Delete</button>${contactButtons(l)}
        ${!l.memberId ? `<button type="button" class="btn" id="convert">Make member</button>` : ''}`,
      onSave: (d) => {
        if (!d.name.trim()) { toast('Name is required'); return false; }
        const createdAt = l.createdAt && l.createdAt.slice(0, 10) === d.createdDate ? l.createdAt : (d.createdDate ? new Date(d.createdDate + 'T12:00:00').toISOString() : S.now());
        delete d.createdDate;
        if (d.callDate && (!l.id || l.status === 'New') && d.status === 'New') d.status = 'Call booked';
        S.save('leads', { ...d, id: l.id, createdAt });
        toast(isNew ? 'Request added' : 'Saved');
      },
      bind: (root) => {
        bindNotes(root, 'leads', l.id, leadForm);
        $('#del', root)?.addEventListener('click', () => confirmBox(`Delete the request from ${l.name}?`, () => { S.remove('leads', l.id); toast('Deleted'); }));
        $('#convert', root)?.addEventListener('click', () => {
          const m = S.convertLead(l.id);
          if (!m.region) S.save('members', { id: m.id, region: guessRegion(m.propertyAddress) });
          toast('Member created — set plan & start date');
          location.hash = '#members';
          setTimeout(() => memberForm(member(m.id)), 0);
        });
      }
    });
  }

  function pasteFormDialog() {
    openModal({
      title: 'Add from a website form email',
      body: `<p class="small muted">Open the “New Estia Inquiry” (or partner application) email from Formspree, copy the whole text and paste it below. Discovery-call forms become <b>Requests</b>; partner forms become <b>Partners</b>.</p>
        <textarea name="text" rows="12" placeholder="name: Maria Papadopoulou&#10;email: maria@example.com&#10;phone: +61 …&#10;location: Melbourne&#10;property_location: Glyfada&#10;property_type: Apartment&#10;visit_frequency: Once or twice a year&#10;message: …" style="font-family:ui-monospace,monospace;font-size:13px"></textarea>`,
      submitLabel: 'Add',
      onSave: (d) => {
        const raw = parseFormEmail(d.text || '');
        if (!raw.name && !raw.email) { toast('Could not find a name or email in that text'); return false; }
        const [kind, rec] = recordFromForm(raw);
        if (kind === 'partner') {
          const p = S.save('partners', rec);
          toast('Partner application added');
          location.hash = '#partners'; setTimeout(() => partnerForm(p), 0);
        } else {
          rec.audience = rec.audience || '';
          const l = S.save('leads', rec);
          toast('Request added');
          location.hash = '#leads'; setTimeout(() => leadForm(l), 0);
        }
      }
    });
  }

  function importCSVDialog() {
    openModal({
      title: 'Import from CSV',
      body: `<p class="small muted">Use the CSV export from your Formspree dashboard (Submissions → Export), or any spreadsheet with a header row such as <b>name, email, phone, location, property_location, property_type, visit_frequency, message</b>. Partner-form rows (with <code>form_origin</code> or <code>partner_track</code>) are added to Partners. Rows whose email already exists are skipped.</p>
        <input type="file" id="csvFile" accept=".csv,text/csv">`,
      bind: (root) => {
        $('#csvFile', root).addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const rows = parseCSV(await file.text());
          if (rows.length < 2) { toast('No rows found'); return; }
          const head = rows[0].map(normKey).map(k => ({ your_name: 'name', full_name: 'name', e_mail: 'email', whatsapp_or_phone: 'phone' }[k] || k));
          const seen = new Set([...S.all('leads'), ...S.all('partners')].map(x => (x.email || '').toLowerCase()).filter(Boolean));
          let leads = 0, partners = 0, skipped = 0;
          rows.slice(1).forEach(r => {
            const raw = Object.fromEntries(head.map((k, i) => [k, r[i] ?? '']));
            if (!raw.name && !raw.email) return;
            if (raw.email && seen.has(raw.email.toLowerCase())) { skipped++; return; }
            const [kind, rec] = recordFromForm(raw);
            if (raw.status && S.LEAD_STATUSES.includes(raw.status)) rec.status = raw.status;
            if (raw.source && ST().sources.includes(raw.source)) rec.source = raw.source;
            S.save(kind === 'partner' ? 'partners' : 'leads', rec);
            if (raw.email) seen.add(raw.email.toLowerCase());
            kind === 'partner' ? partners++ : leads++;
          });
          closeModal(); render();
          toast(`Imported ${leads} request${leads === 1 ? '' : 's'}, ${partners} partner${partners === 1 ? '' : 's'}${skipped ? ` · ${skipped} duplicates skipped` : ''}`);
        });
      }
    });
  }

  /* ================= members ================= */
  views.members = () => {
    const f = state.memberFilter, q = f.q.trim().toLowerCase(), mk = S.monthKey();
    const all = S.all('members');
    const list = all.filter(m =>
      (f.status === 'All' || (f.status === 'Current' ? m.status !== 'Cancelled' : m.status === f.status)) &&
      (!q || [m.name, m.email, m.phone, m.propertyAddress, m.region, m.livesIn].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => a.name.localeCompare(b.name));
    const counts = { All: all.length, Current: all.filter(m => m.status !== 'Cancelled').length };
    S.MEMBER_STATUSES.forEach(s => counts[s] = all.filter(m => m.status === s).length);
    return `
      <div class="page-head">
        <div><h1>Members</h1><div class="sub">Owners on a home-watch plan, their property and billing.</div></div>
        <div class="row"><button class="btn ghost" data-act="export-members">Export CSV</button><button class="btn primary" data-act="new-member">+ New member</button></div>
      </div>
      <div class="stats">
        ${stat('Active', counts.Active, '')}
        ${stat('MRR', money(sum(all.filter(m => S.activeIn(m, mk)), m => S.memberMRR(m))), 'ex VAT')}
        ${ST().plans.map(p => stat(p.name, all.filter(m => m.status === 'Active' && m.plan === p.name).length, `${money(p.monthly)}/mo · ${p.visits} visit${p.visits > 1 ? 's' : ''}`)).join('')}
      </div>
      <div class="toolbar"><div class="row">
        <div class="chips">${['Current', ...S.MEMBER_STATUSES, 'All'].map(s => `<button class="chip ${f.status === s ? 'on' : ''}" data-member-status="${esc(s)}" aria-pressed="${f.status === s}">${esc(s)}<span class="c">${counts[s]}</span></button>`).join('')}</div>
        <span class="spacer"></span><input type="search" data-search="memberFilter.q" placeholder="Search members…" value="${esc(f.q)}" aria-label="Search members">
      </div></div>
      <div class="card table-wrap">
        ${list.length ? `<table><thead><tr><th>Member</th><th>Property</th><th>Plan</th><th class="num">Per month</th><th>Since</th><th>Status</th><th>Last visit</th></tr></thead>
        <tbody>${list.map(m => {
          const last = S.all('visits').filter(v => v.memberId === m.id && v.status !== 'Scheduled' && v.status !== 'Skipped').sort((a, b) => b.date.localeCompare(a.date))[0];
          return `<tr class="clickable" data-open="member:${m.id}">
            <td><div class="name">${esc(m.name)}</div><div class="muted small">${esc(m.livesIn || m.email || '')}</div></td>
            <td>${esc(m.propertyAddress || '—')}<div class="muted small">${esc([m.region, m.propertyType].filter(Boolean).join(' · '))}</div></td>
            <td>${esc(m.plan || '—')}<div class="muted small">${esc(m.billing || '')}</div></td>
            <td class="num">${money(S.memberMRR(m))}</td>
            <td class="muted">${fmtDate(m.startDate)}</td>
            <td>${pill(m.status)}</td>
            <td class="muted">${last ? fmtDate(last.date) : '—'}</td></tr>`; }).join('')}</tbody></table>`
        : `<div class="empty">${all.length ? 'No members match.' : 'No members yet. Turn a request into a member with “Make member”, or add one here.'}</div>`}
      </div>`;
  };

  function memberForm(m = {}) {
    const isNew = !m.id, st = ST();
    const visits = isNew ? [] : S.all('visits').filter(v => v.memberId === m.id).sort((a, b) => b.date.localeCompare(a.date));
    const jobs = isNew ? [] : S.all('jobs').filter(j => j.memberId === m.id).sort((a, b) => b.month.localeCompare(a.month));
    const body = `
      <div class="fields">
        ${field('name', 'Name *', m.name, 'text', 'required')}
        ${field('status', 'Status', m.status || 'Onboarding', S.MEMBER_STATUSES)}
        ${field('email', 'Email', m.email, 'email')}
        ${field('phone', 'WhatsApp or phone', m.phone, 'tel')}
        ${field('livesIn', 'Lives in', m.livesIn)}
        ${field('audience', 'Owner type', m.audience, st.audiences)}
        <label class="field full"><span>Property address</span><input type="text" name="propertyAddress" value="${esc(m.propertyAddress)}"></label>
        ${field('region', 'Region', m.region, st.regions)}
        ${field('propertyType', 'Property type', m.propertyType, st.propertyTypes)}
        ${field('plan', 'Plan', m.plan || 'Recommended', st.plans.map(p => p.name))}
        ${field('billing', 'Billing', m.billing || 'Monthly', ['Monthly', 'Annual'])}
        ${field('startDate', 'Start date', m.startDate || todayISO(), 'date')}
        ${field('endDate', 'End date (if cancelled)', m.endDate, 'date')}
        ${field('reportChannel', 'Send reports by', m.reportChannel || 'WhatsApp', ['WhatsApp', 'Email'])}
        ${field('insurer', 'Home insurer / policy', m.insurer)}
        ${field('onboardingPaid', `Onboarding fee paid (${money(st.onboardingFee)})`, m.onboardingPaid, 'checkbox')}
        ${field('keysHeld', 'Keys received', m.keysHeld, 'checkbox')}
        ${field('access', 'Access notes (alarm, building, neighbours)', m.access, 'textarea')}
        ${field('notes', 'Notes', m.notes, 'textarea')}
      </div>
      ${!isNew ? `
        <div class="section-title">Visits (${visits.length})</div>
        ${visits.length ? `<ul class="list card">${visits.slice(0, 12).map(v => `<li class="clickable" data-open="visit:${v.id}"><span>${fmtDay(v.date)}${v.issues ? ` · <span class="muted">${esc(v.issues)}</span>` : ''}</span>${pill(v.status)}</li>`).join('')}</ul>` : '<p class="muted small">No visits yet.</p>'}
        <div class="section-title">Add-on jobs (${jobs.length})</div>
        ${jobs.length ? `<ul class="list card">${jobs.map(j => `<li class="clickable" data-open="job:${j.id}"><span>${esc(j.title)} · <span class="muted">${esc(monthLabel(j.month))}</span></span><span class="row">${money(num(j.price))} ${pill(j.status)}</span></li>`).join('')}</ul>` : '<p class="muted small">No add-on jobs yet.</p>'}` : ''}`;
    openModal({
      title: isNew ? 'New member' : m.name, body, wide: !isNew,
      foot: isNew ? '' : `<button type="button" class="btn danger" id="del">Delete</button>${contactButtons(m)}
        <button type="button" class="btn" id="log">Visit log</button><button type="button" class="btn" id="addJob">+ Add-on job</button><button type="button" class="btn primary" id="logVisit">Log a visit</button>`,
      onSave: (d) => {
        if (!d.name.trim()) { toast('Name is required'); return false; }
        if (d.status === 'Cancelled' && !d.endDate) d.endDate = todayISO();
        S.save('members', { ...d, id: m.id });
        toast(isNew ? 'Member added' : 'Saved');
      },
      bind: (root) => {
        const addr = root.elements.propertyAddress, reg = root.elements.region;
        addr.addEventListener('change', () => { if (!reg.value) reg.value = guessRegion(addr.value); });
        $('#del', root)?.addEventListener('click', () => confirmBox(`Delete ${m.name} and all their visits?`, () => { S.remove('members', m.id); toast('Deleted'); }));
        $('#log', root)?.addEventListener('click', () => { closeModal(); state.logMember = m.id; location.hash = '#visitlog'; });
        $('#addJob', root)?.addEventListener('click', () => jobForm({ memberId: m.id, month: S.monthKey() }));
        $('#logVisit', root)?.addEventListener('click', () => logVisitDialog(m.id));
      }
    });
  }

  /* Printable visit log per member — the "insurance-grade visit log" promised on the plans page. */
  views.visitlog = () => {
    const m = member(state.logMember);
    if (!m) return `<div class="empty">Choose a member first. <a href="#members">Members</a></div>`;
    const year = state.logYear || String(new Date().getFullYear());
    const visits = S.all('visits').filter(v => v.memberId === m.id && (v.date || '').startsWith(year) && v.status !== 'Scheduled').sort((a, b) => a.date.localeCompare(b.date));
    return `
      <div class="page-head no-print">
        <div><h1>Visit log</h1><div class="sub">Printable record of documented visits — useful for insurers.</div></div>
        <div class="row"><a class="btn ghost" href="#members">← Members</a>
          <select id="logYear">${options([0, 1, 2].map(i => String(new Date().getFullYear() - i)), year)}</select>
          <button class="btn primary" data-act="print-log">${printLabel()}</button></div>
      </div>
      <section class="card card-pad">
        <div class="row" style="align-items:flex-start">
          <div><h2>${esc(ST().businessName)} — Property visit log ${esc(year)}</h2>
          <p class="muted" style="margin:6px 0 0">Owner: <b>${esc(m.name)}</b> · Property: <b>${esc(m.propertyAddress || '—')}</b>${m.region ? ` (${esc(m.region)})` : ''}<br>
          Plan: ${esc(m.plan)} · Member since ${fmtDate(m.startDate)}${m.insurer ? ` · Insurer: ${esc(m.insurer)}` : ''}</p></div>
        </div>
        <div class="table-wrap" style="margin-top:14px">${visits.length ? `<table><thead><tr><th>#</th><th>Visit date</th><th>Status</th><th>Report sent</th><th>Time on site</th><th class="num">Photos</th><th>Findings</th></tr></thead>
          <tbody>${visits.map((v, i) => `<tr><td>${i + 1}</td><td>${fmtDay(v.date)}</td><td>${esc(v.status === 'Skipped' ? 'Skipped' : 'Visited')}</td><td>${v.reportSentAt ? fmtDate(v.reportSentAt) : '—'}</td><td>${v.arrivedAt ? esc(v.arrivedAt + (v.leftAt ? '–' + v.leftAt : '')) : '—'}</td><td class="num">${(v.media || []).length || '—'}</td><td class="wrap">${esc(v.issues || 'All clear')}${v.notes ? `<div class="muted small">${esc(v.notes)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">No completed visits in this year.</div>'}</div>
        <p class="muted small" style="margin-top:12px">Generated ${fmtDate(todayISO())}. Timestamped photo reports for each visit are available on request.</p>
      </section>`;
  };

  /* ================= monthly work (visits + add-on jobs) ================= */
  views.month = () => {
    const mk = state.workMonth, today = todayISO();
    const visits = S.all('visits').filter(v => v.month === mk).sort((a, b) => (a.date || '').localeCompare(b.date || '') || memberName(a.memberId).localeCompare(memberName(b.memberId)));
    const jobs = S.all('jobs').filter(j => j.month === mk);
    const active = S.all('members').filter(m => m.status === 'Active' && S.activeIn(m, mk));
    const expected = sum(active, m => S.plan(m.plan)?.visits || 1);
    const missing = Math.max(0, expected - visits.filter(v => active.some(m => m.id === v.memberId)).length);
    const vCount = (s) => visits.filter(v => v.status === s).length;
    return `
      <div class="page-head">
        <div><h1>Monthly work</h1><div class="sub">Plan visits, send reports within 24 hours, and track add-on jobs.</div></div>
        <div class="row">${monthNav(mk, 'data-work-month')}
          <button class="btn" data-act="gen-visits" ${missing ? '' : 'disabled'}>${missing ? `Generate ${missing} visit${missing === 1 ? '' : 's'} from plans` : 'All plan visits created'}</button>
          <button class="btn" data-act="new-visit">Plan a visit</button>
          <button class="btn" data-act="new-job">+ Add-on job</button>
        </div>
      </div>
      <div class="stats">
        ${stat('Visits planned', visits.length, `${expected} required by plans`)}
        ${stat('Visited', vCount('Visited') + vCount('Report sent'), `${vCount('Scheduled')} still scheduled`)}
        ${stat('Reports sent', vCount('Report sent'), `${vCount('Visited')} waiting for report`)}
        ${stat('Add-on jobs', jobs.length, `${money(sum(jobs.filter(j => j.status !== 'Declined'), j => j.price))} quoted/approved`)}
      </div>
      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Visits</h2><span class="muted small">Click a row for details and findings</span></div>
        <div class="table-wrap">${visits.length ? `<table><thead><tr><th>Date</th><th>Member</th><th>Property</th><th>Status</th><th>Findings</th><th></th></tr></thead>
        <tbody>${visits.map(v => { const mm = member(v.memberId); const late = v.status === 'Scheduled' && v.date < today; const repLate = v.status === 'Visited' && daysBetween(v.date, today) > 1; return `
          <tr class="clickable" data-open="visit:${v.id}">
            <td>${late ? `<span class="pill s-overdue">${fmtDay(v.date)}</span>` : fmtDay(v.date)}</td>
            <td class="name">${esc(mm?.name || '—')}</td>
            <td class="muted">${esc(mm?.propertyAddress || mm?.region || '')}</td>
            <td data-stop><select class="pill-select s-${slug(v.status)}" data-set-status="visits:${v.id}">${options(S.VISIT_STATUSES, v.status)}</select></td>
            <td>${v.issues ? `<span class="pill s-in-progress">${esc(v.issues)}</span>` : '<span class="muted">—</span>'}</td>
            <td data-stop class="num">${v.status === 'Scheduled' ? `<button class="btn sm" data-open="visit:${v.id}">Start report</button>` : v.status === 'Visited' ? `<button class="btn sm ${repLate ? 'primary' : ''}" data-visit-step="${v.id}">Mark report sent</button>` : ''}${(v.media || []).length ? ` <span class="muted small">📷 ${(v.media || []).length}</span>` : ''}</td>
          </tr>`; }).join('')}</tbody></table>`
          : `<div class="empty">No visits for ${esc(monthLabel(mk))}. ${active.length ? 'Use “Generate visits from plans” to create them for all active members.' : 'Add members first.'}</div>`}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Add-on jobs</h2><span class="muted small">Maintenance, admin, arrival prep, concierge, vehicle care…</span></div>
        <div class="table-wrap">${jobs.length ? `<table><thead><tr><th>Job</th><th>Member</th><th>Service</th><th>Status</th><th class="num">Price</th><th class="num">Cost</th><th>Paid</th></tr></thead>
        <tbody>${jobs.map(j => `<tr class="clickable" data-open="job:${j.id}">
          <td class="name">${esc(j.title)}</td><td>${esc(memberName(j.memberId))}</td><td class="muted">${esc(j.service || '')}</td>
          <td data-stop><select class="pill-select s-${slug(j.status)}" data-set-status="jobs:${j.id}">${options(S.JOB_STATUSES, j.status)}</select></td>
          <td class="num">${money(num(j.price))}</td><td class="num">${money(num(j.cost))}</td>
          <td>${j.status === 'Done' ? pill(j.paid ? 'Paid' : 'Unpaid') : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`
          : `<div class="empty">No add-on jobs this month.</div>`}</div>
      </section>`;
  };

  const memberOptions = (sel) => `<option value="">— choose member —</option>` + S.all('members').filter(m => m.status !== 'Cancelled' || m.id === sel).sort((a, b) => a.name.localeCompare(b.name)).map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}${m.propertyAddress ? ' — ' + esc(m.propertyAddress) : ''}</option>`).join('');

  function visitForm(v = {}) {
    const isNew = !v.id;
    openModal({
      title: isNew ? 'New visit' : `Visit · ${memberName(v.memberId)}`,
      body: `<div class="fields">
        <label class="field full"><span>Member *</span><select name="memberId" required>${memberOptions(v.memberId)}</select></label>
        ${field('date', 'Visit date *', v.date || todayISO(), 'date', 'required')}
        ${field('status', 'Status', v.status || 'Scheduled', S.VISIT_STATUSES)}
        ${field('reportSentAt', 'Report sent on', v.reportSentAt, 'date')}
        ${field('notes', 'Visit notes', v.notes, 'textarea')}
      </div>`,
      foot: isNew ? '' : `<button type="button" class="btn danger" id="del">Delete</button>${v.issues ? `<button type="button" class="btn" id="mkJob">Create job from issue</button>` : ''}`,
      onSave: (d) => {
        if (!d.memberId || !d.date) { toast('Choose a member and date'); return false; }
        if (d.status === 'Report sent' && !d.reportSentAt) d.reportSentAt = todayISO();
        const saved = S.save('visits', { ...d, id: v.id, month: d.date.slice(0, 7) });
        toast('Saved');
        if (!v.id) setTimeout(() => openVisit(saved.id), 0);
      },
      bind: (root) => {
        $('#del', root)?.addEventListener('click', () => confirmBox('Delete this visit?', () => { S.remove('visits', v.id); toast('Deleted'); }));
        $('#mkJob', root)?.addEventListener('click', () => jobForm({ memberId: v.memberId, month: S.monthKey(), title: v.issues, service: 'Maintenance & Oversight', visitId: v.id }));
      }
    });
  }

  function jobForm(j = {}) {
    const isNew = !j.id;
    const partners = S.all('partners').filter(p => p.status === 'Approved' || p.id === j.partnerId);
    openModal({
      title: isNew ? 'New add-on job' : j.title,
      body: `<div class="fields">
        <label class="field full"><span>Job *</span><input type="text" name="title" required value="${esc(j.title)}" placeholder="e.g. AC service before summer"></label>
        <label class="field"><span>Member</span><select name="memberId">${memberOptions(j.memberId)}</select></label>
        ${field('service', 'Service line', j.service, ST().services)}
        ${field('month', 'Month', j.month || state.workMonth, 'month', 'required')}
        ${field('status', 'Status', j.status || 'Requested', S.JOB_STATUSES)}
        ${field('price', `Price to member (${ST().currency}, ex VAT)`, j.price ?? '', 'number')}
        ${field('cost', `Contractor cost (${ST().currency})`, j.cost ?? '', 'number')}
        <label class="field"><span>Contractor / partner</span><select name="partnerId"><option value="">— none —</option>${partners.map(p => `<option value="${p.id}" ${p.id === j.partnerId ? 'selected' : ''}>${esc(p.name)}${p.trade ? ' · ' + esc(p.trade) : ''}</option>`).join('')}</select></label>
        ${field('approvedAt', 'Owner approved on', j.approvedAt, 'date')}
        ${field('paid', 'Paid', j.paid, 'checkbox')}
        ${field('notes', 'Notes', j.notes, 'textarea')}
      </div>`,
      foot: isNew ? '' : `<button type="button" class="btn danger" id="del">Delete</button>`,
      onSave: (d) => {
        if (!d.title.trim()) { toast('Job title is required'); return false; }
        if (d.status === 'Approved' && !d.approvedAt) d.approvedAt = todayISO();
        S.save('jobs', { ...d, id: j.id, visitId: j.visitId, price: num(d.price), cost: num(d.cost) });
        toast(isNew ? 'Job added' : 'Saved');
      },
      bind: (root) => $('#del', root)?.addEventListener('click', () => confirmBox(`Delete "${j.title}"?`, () => { S.remove('jobs', j.id); toast('Deleted'); }))
    });
  }

  /* ================= partners ================= */
  views.partners = () => {
    const f = state.partnerFilter, all = S.all('partners');
    const isOpen = (p) => p.status !== 'Approved' && p.status !== 'Rejected';
    const list = all.filter(p => f === 'All' || (f === 'Open' ? isOpen(p) : p.status === f)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const counts = { All: all.length, Open: all.filter(isOpen).length };
    S.PARTNER_STATUSES.forEach(s => counts[s] = all.filter(p => p.status === s).length);
    return `
      <div class="page-head">
        <div><h1>Partners</h1><div class="sub">Applications from “Become a partner”: trades, professionals and referral partners.</div></div>
        <div class="row"><button class="btn" data-act="paste-form">Paste form email</button><button class="btn primary" data-act="new-partner">+ New partner</button></div>
      </div>
      <div class="toolbar"><div class="chips">
        ${['Open', ...S.PARTNER_STATUSES, 'All'].map(s => `<button class="chip ${f === s ? 'on' : ''}" data-partner-status="${esc(s)}" aria-pressed="${f === s}">${esc(s)}<span class="c">${counts[s]}</span></button>`).join('')}
      </div></div>
      <div class="card table-wrap">
        ${list.length ? `<table><thead><tr><th>Received</th><th>Name</th><th>Track</th><th>Trade / profession</th><th>Area</th><th>Status</th><th class="num">Jobs</th></tr></thead>
        <tbody>${list.map(p => `<tr class="clickable" data-open="partner:${p.id}">
          <td class="muted">${fmtDate(p.createdAt)}</td>
          <td><div class="name">${esc(p.name)}</div><div class="muted small">${esc(p.company || p.email || '')}</div></td>
          <td>${esc(p.track || '—')}</td><td>${esc(p.trade || '—')}</td><td>${esc(p.area || '—')}</td>
          <td data-stop><select class="pill-select s-${slug(p.status)}" data-set-status="partners:${p.id}">${options(S.PARTNER_STATUSES, p.status)}</select></td>
          <td class="num">${S.all('jobs').filter(j => j.partnerId === p.id).length}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${all.length ? 'Nothing here.' : 'No partner applications yet.'}</div>`}
      </div>`;
  };

  function partnerForm(p = {}) {
    const isNew = !p.id;
    openModal({
      title: isNew ? 'New partner' : p.name, wide: !isNew,
      body: `<div class="fields">
        ${field('name', 'Name *', p.name, 'text', 'required')}
        ${field('company', 'Business / organisation', p.company)}
        ${field('track', 'Track', p.track || 'Trade partner', ST().partnerTracks)}
        ${field('status', 'Status', p.status || 'New', S.PARTNER_STATUSES)}
        ${field('email', 'Email', p.email, 'email')}
        ${field('phone', 'Phone', p.phone, 'tel')}
        ${field('trade', 'Trade / profession / type', p.trade)}
        ${field('area', 'Service area', p.area)}
        ${field('rate', 'Rate / call-out fee', p.rate)}
        ${field('insurance', 'Liability insurance', p.insurance)}
        ${field('licensing', 'Licensing / registration', p.licensing)}
        ${field('languages', 'Languages', p.languages)}
        ${field('years', 'Years operating', p.years)}
        ${field('website', 'Website', p.website)}
        ${field('references', 'References', p.references, 'textarea')}
        ${field('message', 'About them / application text', p.message, 'textarea')}
      </div>${!isNew ? activityBlock('partners', p) : ''}`,
      foot: isNew ? '' : `<button type="button" class="btn danger" id="del">Delete</button>${contactButtons(p)}`,
      onSave: (d) => {
        if (!d.name.trim()) { toast('Name is required'); return false; }
        S.save('partners', { ...d, id: p.id });
        toast('Saved');
      },
      bind: (root) => {
        bindNotes(root, 'partners', p.id, partnerForm);
        $('#del', root)?.addEventListener('click', () => confirmBox(`Delete ${p.name}?`, () => { S.remove('partners', p.id); toast('Deleted'); }));
      }
    });
  }

  /* ================= reports ================= */
  views.reports = () => {
    const mk = state.reportMonth;
    const m = monthMetrics(mk), prev = monthMetrics(S.shiftMonth(mk, -1));
    const trend = Array.from({ length: 6 }, (_, i) => monthMetrics(S.shiftMonth(mk, i - 5)));
    const maxRev = Math.max(1, ...trend.map(t => t.revenue));
    const delta = (a, b, fmt = (v) => v) => (!a && !b) ? '' : `${a - b >= 0 ? '▲' : '▼'} ${fmt(Math.abs(a - b))} vs ${monthShort(prev.mk)}`;
    const st = ST(), target = num(st.monthlyRevenueTarget);
    const decided = m.won + m.lost;
    const count = (list, key, values) => values.map(v => [v, list.filter(x => x[key] === v).length]);
    const regionOf = (l) => guessRegion(l.propertyLocation) || 'Unknown';
    const regions = [...new Set(m.leads.map(regionOf))].map(r => [r, m.leads.filter(l => regionOf(l) === r).length]).sort((a, b) => b[1] - a[1]);
    const lostReasons = Object.entries(m.leads.filter(l => l.status === 'Lost').reduce((acc, l) => { const k = l.lostReason?.trim() || 'Not specified'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}));
    const churn = prev.active.length ? Math.round((m.cancelled.length / prev.active.length) * 1000) / 10 : 0;

    return `
      <div class="report-head-print"><h1>${esc(st.businessName)} — Monthly report</h1><div>${esc(monthLabel(mk))}</div></div>
      <div class="page-head no-print">
        <div><h1>Reports</h1><div class="sub">Monthly performance${IN_ARTIFACT ? '. Download it, then open the file to print or save as PDF.' : '. Print or save as PDF to share.'}</div></div>
        <div class="row">${monthNav(mk, 'data-report-month')}
          <button class="btn ghost" data-act="export-report">Export CSV</button>
          <button class="btn primary" data-act="print-report">${printLabel()}</button></div>
      </div>

      <div class="section-title" style="margin-top:4px">Revenue · ex VAT</div>
      <div class="stats">
        ${stat('Total revenue', money(m.revenue), delta(m.revenue, prev.revenue, money))}
        ${stat('Subscriptions (MRR)', money(m.mrr), `${m.active.length} active members`)}
        ${stat('Onboarding fees', money(m.onboarding), `${m.started.length} new member${m.started.length === 1 ? '' : 's'}`)}
        ${stat('Add-on jobs', money(m.addOnRevenue), `${money(m.addOnRevenue - m.addOnCost)} margin`)}
        ${stat(`VAT ${st.vatRate}%`, money(m.vat), `${money(m.revenue + m.vat)} incl. VAT`)}
      </div>
      ${target ? `<div class="card target" style="margin-bottom:16px">
        <div class="row"><b>Revenue target</b><span class="spacer"></span><span class="num">${money(m.revenue)} / ${money(target)} · ${pct(m.revenue, target)}%</span></div>
        <div class="progress"><span style="width:${Math.min(100, pct(m.revenue, target))}%"></span></div></div>` : ''}

      <div class="section-title">Members & service</div>
      <div class="stats">
        ${stat('Active members', m.active.length, delta(m.active.length, prev.active.length))}
        ${stat('New / cancelled', `+${m.started.length} / −${m.cancelled.length}`, `churn ${churn}%`)}
        ${stat('Visits done', `${m.visited.length}/${m.visits.length}`, `${pct(m.visited.length, m.visits.length)}% completed`)}
        ${stat('Reports within 24h', m.reported.length ? `${pct(m.onTime.length, m.reported.length)}%` : '—', `${m.onTime.length} of ${m.reported.length} reports`)}
        ${stat('Issues found', m.withIssues.length, 'on visits this month')}
      </div>

      <div class="section-title">Requests</div>
      <div class="stats">
        ${stat('Requests received', m.leads.length, delta(m.leads.length, prev.leads.length))}
        ${stat('Won / lost', `${m.won} / ${m.lost}`, decided ? `${pct(m.won, decided)}% win rate` : 'none decided yet')}
        ${stat('Calls booked', m.leads.filter(l => l.callDate).length, 'from this month\'s requests')}
      </div>
      <div class="grid grid-2" style="margin-bottom:16px">
        <section class="card"><div class="card-head"><h2>Requests by source</h2></div>${barList(count(m.leads, 'source', st.sources))}</section>
        <section class="card"><div class="card-head"><h2>Requests by property region</h2></div>${barList(regions)}</section>
        <section class="card"><div class="card-head"><h2>Requests by owner type</h2></div>${barList([...count(m.leads, 'audience', st.audiences), ['Not set', m.leads.filter(l => !l.audience).length]])}</section>
        <section class="card"><div class="card-head"><h2>Lost reasons</h2></div>${barList(lostReasons)}</section>
        <section class="card"><div class="card-head"><h2>Active members by plan</h2></div>${barList(st.plans.map(p => [p.name, m.active.filter(x => x.plan === p.name).length]))}</section>
        <section class="card"><div class="card-head"><h2>Add-on revenue by service</h2></div>${barList(st.services.map(s => [s, sum(m.jobsDone.filter(j => j.service === s), j => j.price)]), money)}</section>
      </div>

      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Revenue — last 6 months</h2><span class="muted small">ex VAT</span></div>
        <div class="trend">${trend.map(t => `<div class="colbar ${t.mk === mk ? 'cur' : ''}" title="${esc(monthLabel(t.mk))}: ${esc(money(t.revenue))}">
          <span class="val">${t.revenue ? money(t.revenue) : ''}</span><div class="b" style="height:${(t.revenue / maxRev) * 80}%"></div></div>`).join('')}</div>
        <div class="trend-labels">${trend.map(t => `<span>${esc(monthShort(t.mk))}</span>`).join('')}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Month</th><th class="num">Requests</th><th class="num">Won</th><th class="num">Members</th><th class="num">MRR</th><th class="num">Add-ons</th><th class="num">Revenue</th><th class="num">Visits</th></tr></thead>
          <tbody>${trend.slice().reverse().map(t => `<tr><td>${esc(monthLabel(t.mk))}</td><td class="num">${t.leads.length}</td><td class="num">${t.won}</td><td class="num">${t.active.length}</td><td class="num">${money(t.mrr)}</td><td class="num">${money(t.addOnRevenue)}</td><td class="num">${money(t.revenue)}</td><td class="num">${t.visited.length}/${t.visits.length}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Issues found on visits — ${esc(monthLabel(mk))}</h2></div>
        ${m.withIssues.length ? `<ul class="list">${m.withIssues.map(v => `<li class="clickable" data-open="visit:${v.id}"><span><b>${esc(memberName(v.memberId))}</b> · ${esc(v.issues)}</span><span class="muted small">${fmtDate(v.date)}</span></li>`).join('')}</ul>` : '<div class="empty">No issues recorded.</div>'}
      </section>`;
  };

  /* ================= settings ================= */
  views.settings = () => {
    const st = ST();
    const lines = (a) => esc(a.join('\n'));
    return `
      <div class="page-head"><div><h1>Settings</h1><div class="sub">Prices and lists, prefilled from estiagreekhome.online.</div></div></div>
      <form class="grid grid-2" id="settingsForm">
        <section class="card card-pad">
          <h2 style="margin-bottom:12px">Business & pricing</h2>
          <div class="fields">
            ${field('businessName', 'Business name', st.businessName)}
            ${field('currency', 'Currency (ISO code)', st.currency, 'text', 'maxlength="3"')}
            ${field('vatRate', 'VAT %', st.vatRate, 'number')}
            ${field('onboardingFee', 'Onboarding fee', st.onboardingFee, 'number')}
            ${field('monthlyRevenueTarget', 'Monthly revenue target', st.monthlyRevenueTarget || '', 'number')}
          </div>
          <div class="section-title">Plans</div>
          <table class="plan-table"><thead><tr><th>Plan</th><th>€ / month</th><th>€ / year</th><th>Visits / mo</th></tr></thead>
          <tbody>${st.plans.map((p, i) => `<tr>
            <td><input type="text" name="plan_${i}_name" value="${esc(p.name)}"></td>
            <td data-label="€ / month"><input type="number" step="any" min="0" name="plan_${i}_monthly" value="${p.monthly}"></td>
            <td data-label="€ / year"><input type="number" step="any" min="0" name="plan_${i}_annual" value="${p.annual}"></td>
            <td data-label="Visits / mo"><input type="number" step="1" min="1" name="plan_${i}_visits" value="${p.visits}"></td></tr>`).join('')}</tbody></table>
          <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Save settings</button></div>
        </section>
        <section class="card card-pad">
          <h2 style="margin-bottom:12px">Lists (one per line)</h2>
          <div class="fields">
            <label class="field"><span>Add-on services</span><textarea name="services" rows="8">${lines(st.services)}</textarea></label>
            <label class="field"><span>Request sources</span><textarea name="sources" rows="8">${lines(st.sources)}</textarea></label>
            <label class="field"><span>Regions</span><textarea name="regions" rows="8">${lines(st.regions)}</textarea></label>
            <label class="field"><span>Owner types</span><textarea name="audiences" rows="8">${lines(st.audiences)}</textarea></label>
            <label class="field full"><span>Visit checklist</span><textarea name="checklist" rows="9">${lines(st.checklist)}</textarea></label>
          </div>
        </section>
      </form>
      <div class="grid grid-2" style="margin-top:16px">
        <section class="card card-pad">
          <h2>Backup & restore</h2>
          <p class="muted small">${API ? 'Your data is saved online in your Cloudflare account and is the same on every device you sign in on. A backup file is still a good idea once a month.' : IN_ARTIFACT ? 'Your data is saved privately to your Claude account and follows you to any device where you open this page. A backup file is still a good idea once a month.' : 'Your data is stored in this browser only. Download a backup every week. To move to another computer, restore the backup there.'}</p>
          <div class="row"><button class="btn primary" data-act="backup">Download backup</button><button class="btn" data-act="restore">Restore from backup</button></div>
          <input type="file" id="restoreFile" accept=".json,application/json" hidden>
        </section>
        ${API ? `<section class="card card-pad">
          <h2>Your account</h2>
          <p class="muted small">Signed in as <b id="meEmail">…</b></p>
          <form id="pwForm" class="fields" autocomplete="off">
            <label class="field"><span>Current password</span><input type="password" id="pwCurrent" autocomplete="current-password" required></label>
            <label class="field"><span>New password (10+ characters)</span><input type="password" id="pwNext" autocomplete="new-password" minlength="10" required></label>
            <div class="row"><button class="btn primary" type="submit">Change password</button><a class="btn" href="/logout">Sign out</a></div>
          </form>
        </section>` : ''}
        <section class="card card-pad">
          <h2>Data</h2>
          <p class="muted small">${S.all('leads').length} requests · ${S.all('members').length} members · ${S.all('visits').length} visits · ${S.all('jobs').length} jobs · ${S.all('partners').length} partners</p>
          <div class="row"><button class="btn" data-act="demo">Load demo data</button><button class="btn danger" data-act="reset">Erase everything</button></div>
        </section>
      </div>`;
  };

  /* ================= render & routing ================= */
  const TITLES = { visit: 'Visit report', dashboard: 'Dashboard', leads: 'Requests', members: 'Members', month: 'Monthly work', partners: 'Partners', reports: 'Reports', settings: 'Settings', visitlog: 'Visit log' };

  function render() {
    const view = views[state.view] ? state.view : 'dashboard';
    main.innerHTML = views[view]();
    $$('#nav a').forEach(a => {
      const on = a.dataset.view === view || (view === 'visitlog' && a.dataset.view === 'members') || (view === 'visit' && a.dataset.view === 'month');
      a.classList.toggle('active', on);
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
    const n = S.all('leads').filter(l => l.status === 'New').length;
    $('#newBadge').hidden = !n; $('#newBadge').textContent = n;
    const pn = S.all('partners').filter(p => p.status === 'New').length;
    $('#partnerBadge').hidden = !pn; $('#partnerBadge').textContent = pn;
    decorateHeading(view);
    revealActive();
    focusableRows(main);
    document.title = `${TITLES[view]} · Estia CRM`;
    bindVisitView();
  }

  /* Site-style headings: a red "—— EYEBROW" line and the last word of the title in red italics. */
  const EYEBROWS = { dashboard: 'Today', leads: 'Pipeline', members: 'Memberships', month: 'On the ground', partners: 'Trades & referrals',
    reports: 'Performance', settings: 'Prices & lists', visit: 'On site', visitlog: 'Records' };
  // One-word page names get a two-word title so they also carry the red italic accent (menu labels and tab titles stay short).
  const TITLE_ACCENT = { leads: 'Discovery requests', members: 'Our members', partners: 'Partner network', reports: 'Monthly reports', settings: 'Workspace settings' };
  function decorateHeading(view) {
    const head = $('.page-head > div:first-child');
    const h1 = head && $('h1', head);
    if (!h1) return;
    if (EYEBROWS[view]) h1.insertAdjacentHTML('beforebegin', `<span class="eyebrow">${esc(EYEBROWS[view])}</span>`);
    if (TITLE_ACCENT[view] && !h1.querySelector('*')) h1.textContent = TITLE_ACCENT[view];
    const words = h1.textContent.trim().split(/\s+/);
    if (words.length > 1 && !h1.querySelector('*')) {
      const last = words.pop();
      h1.innerHTML = `${esc(words.join(' '))} <em>${esc(last)}</em>`;
    }
  }

  /* On phones the menu and the filter chips scroll sideways: bring the current item into view (no-op when nothing overflows). */
  function revealActive() {
    [['#nav', 'a.active'], ['.chips', '.chip.on']].forEach(([wrap, on]) => $$(wrap).forEach(w => {
      const a = $(on, w);
      if (!a || w.scrollWidth <= w.clientWidth) return;
      const wr = w.getBoundingClientRect(), ar = a.getBoundingClientRect();
      w.scrollLeft += ar.left - wr.left - (wr.width - ar.width) / 2;
    }));
  }

  function rerenderKeepingFocus(input) {
    const key = input.dataset.search, pos = input.selectionStart;
    render();
    const el = $(`[data-search="${key}"]`);
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }

  const actions = {
    'new-lead': () => leadForm(),
    'new-member': () => memberForm(),
    'new-partner': () => partnerForm(),
    'new-visit': () => visitForm({ date: state.workMonth === S.monthKey() ? todayISO() : `${state.workMonth}-01` }),
    'new-job': () => jobForm({ month: state.workMonth }),
    'paste-form': pasteFormDialog,
    'import-csv': importCSVDialog,
    'gen-visits': () => { const n = S.generateVisits(state.workMonth); render(); toast(n ? `Created ${n} visit${n === 1 ? '' : 's'}` : 'All visits already planned'); },
    'export-leads': () => {
      const rows = [['Received', 'Name', 'Email', 'Phone', 'Lives in', 'Property', 'Type', 'Visits Greece', 'Owner type', 'Source', 'Status', 'Plan', 'Call date', 'Follow-up', 'Lost reason', 'Message']];
      filteredLeads().forEach(l => rows.push([l.createdAt.slice(0, 10), l.name, l.email, l.phone, l.ownerLocation, l.propertyLocation, l.propertyType, l.visitFrequency, l.audience, l.source, l.status, l.interestedPlan, l.callDate, l.followUp, l.lostReason, l.message]));
      download(`estia-requests-${todayISO()}.csv`, toCSV(rows), 'text/csv');
    },
    'export-members': () => {
      const rows = [['Name', 'Email', 'Phone', 'Lives in', 'Property', 'Region', 'Type', 'Plan', 'Billing', 'Per month', 'Start', 'End', 'Status', 'Keys', 'Onboarding paid']];
      S.all('members').forEach(m => rows.push([m.name, m.email, m.phone, m.livesIn, m.propertyAddress, m.region, m.propertyType, m.plan, m.billing, S.memberMRR(m).toFixed(2), m.startDate, m.endDate, m.status, m.keysHeld ? 'Yes' : 'No', m.onboardingPaid ? 'Yes' : 'No']));
      download(`estia-members-${todayISO()}.csv`, toCSV(rows), 'text/csv');
    },
    'export-report': () => {
      const m = monthMetrics(state.reportMonth);
      const rows = [['Estia monthly report', monthLabel(m.mk)], [],
        ['Revenue ex VAT', m.revenue.toFixed(2)], ['Subscriptions (MRR)', m.mrr.toFixed(2)], ['Onboarding fees', m.onboarding], ['Add-on revenue', m.addOnRevenue], ['Add-on costs', m.addOnCost], [`VAT ${ST().vatRate}%`, m.vat.toFixed(2)], [],
        ['Active members', m.active.length], ['New members', m.started.length], ['Cancelled', m.cancelled.length],
        ['Visits planned', m.visits.length], ['Visits done', m.visited.length], ['Reports sent', m.reported.length], ['Reports within 24h', m.onTime.length], ['Visits with issues', m.withIssues.length], [],
        ['Requests', m.leads.length], ['Won', m.won], ['Lost', m.lost], [],
        ['Request date', 'Name', 'Lives in', 'Property', 'Source', 'Status']];
      m.leads.forEach(l => rows.push([l.createdAt.slice(0, 10), l.name, l.ownerLocation, l.propertyLocation, l.source, l.status]));
      rows.push([], ['Visit date', 'Member', 'Status', 'Report sent', 'Issues']);
      m.visits.forEach(v => rows.push([v.date, memberName(v.memberId), v.status, v.reportSentAt, v.issues]));
      rows.push([], ['Job', 'Member', 'Service', 'Status', 'Price', 'Cost', 'Paid']);
      m.jobs.forEach(j => rows.push([j.title, memberName(j.memberId), j.service, j.status, j.price, j.cost, j.paid ? 'Yes' : 'No']));
      download(`estia-report-${m.mk}.csv`, toCSV(rows), 'text/csv');
    },
    'print-report': () => printView(`estia-report-${state.reportMonth}`),
    'print-log': () => printView(`visit-log-${slug(memberName(state.logMember))}-${state.logYear || new Date().getFullYear()}`),
    backup: () => download(`estia-crm-backup-${todayISO()}.json`, S.exportJSON(), 'application/json'),
    restore: () => $('#restoreFile').click(),
    demo: () => { S.loadDemo(); render(); toast('Demo data loaded'); },
    reset: () => confirmBox('This permanently erases all data in this browser. Download a backup first if unsure.', () => { S.reset(); toast('All data erased'); }, 'Erase everything')
  };

  const openers = {
    lead: (id) => leadForm(S.get('leads', id)),
    member: (id) => memberForm(member(id)),
    visit: (id) => openVisit(id),
    job: (id) => jobForm(S.get('jobs', id)),
    partner: (id) => partnerForm(S.get('partners', id))
  };

  /* ================= visit report (filled in on site, on a phone) ================= */
  const CHECK = { ok: 'OK', issue: 'Issue', na: 'N/A' };
  const SEVERITIES = ['Low', 'Medium', 'Urgent'];
  let assetsCap = null;                      // set at boot inside a Claude artifact (writers only)
  const mediaUrl = (m) => (API ? API + '/media/' : '/_blob/') + m.id;
  const visitTitle = (v) => `${memberName(v.memberId)} · ${fmtDay(v.date)}`;
  const timeNow = () => new Date().toTimeString().slice(0, 5);

  function openVisit(id) {
    state.visitId = id;
    if (location.hash === '#visit') render(); else location.hash = '#visit';
  }

  /* Keep the plain-text issue summary (used by dashboard, reports, visit log) in step with the problem list. */
  function saveVisit(v, patch) {
    const next = { ...v, ...patch };
    if ('problems' in patch || (v.problems || []).length) {
      patch.issues = (next.problems || []).filter(p => p.status !== 'Resolved').map(p => p.text).join('; ');
    }
    S.save('visits', { id: v.id, ...patch });
  }

  function checklistSummary(v) {
    const items = ST().checklist || [];
    const res = v.checklist || {};
    const done = items.filter(i => res[i]?.status).length;
    const issues = items.filter(i => res[i]?.status === 'issue').length;
    return { items, res, done, issues };
  }

  views.visit = () => {
    const v = S.get('visits', state.visitId);
    if (!v) return `<div class="empty">Choose a visit from <a href="#month">Monthly work</a>.</div>`;
    const m = member(v.memberId) || {};
    const { items, res, done } = checklistSummary(v);
    const problems = v.problems || [];
    const media = v.media || [];
    const canUpload = !!assetsCap;
    const probOpts = (sel) => `<option value="">— not linked —</option>` + problems.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.text.slice(0, 40))}</option>`).join('');
    return `
      <div class="page-head">
        <div><h1>Visit report</h1><div class="sub">${esc(m.name || '—')} · ${esc(m.propertyAddress || m.region || '')}</div></div>
        <div class="row"><a class="btn ghost" href="#month">← Monthly work</a><button class="btn" data-act="edit-visit">Edit visit</button><button class="btn primary" data-act="prepare-report">Prepare client report</button></div>
      </div>

      <section class="card card-pad vr-section">
        <div class="vr-grid">
          <label class="field"><span>Visit date</span><input type="date" id="vr-date" data-vr="date" value="${esc(v.date)}"></label>
          <label class="field"><span>Status</span><select id="vr-status" data-vr="status">${options(S.VISIT_STATUSES, v.status)}</select></label>
          <label class="field"><span>Arrived</span><span class="row nowrap"><input type="time" id="vr-arrived" data-vr="arrivedAt" value="${esc(v.arrivedAt || '')}"><button class="btn sm" data-vr-now="arrivedAt">Now</button></span></label>
          <label class="field"><span>Left</span><span class="row nowrap"><input type="time" id="vr-left" data-vr="leftAt" value="${esc(v.leftAt || '')}"><button class="btn sm" data-vr-now="leftAt">Now</button></span></label>
          <label class="field"><span>Indoor humidity (%RH)</span><input type="number" id="vr-humidity" data-vr="humidity" min="0" max="100" step="1" inputmode="numeric" value="${esc(v.humidity ?? '')}" placeholder="e.g. 62"></label>
          <label class="field"><span>Indoor temperature (°C)</span><input type="number" id="vr-temp" data-vr="temperature" step="0.5" inputmode="decimal" value="${esc(v.temperature ?? '')}" placeholder="e.g. 19"></label>
        </div>
        ${num(v.humidity) >= 65 ? `<p class="callout small" style="margin:14px 0 0"><b>High humidity.</b> Above 65 %RH, mould risk rises. Ventilate longer or suggest a dehumidifier to the owner.</p>` : ''}
      </section>

      <section class="card vr-section">
        <div class="card-head"><h2>Checklist</h2><span class="muted small">${done}/${items.length} checked</span></div>
        <ul class="list checklist">${items.map((item, i) => { const r = res[item] || {}; return `
          <li>
            <div class="ck-label">${esc(item)}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</div>
            <div class="seg" role="group" aria-label="${esc(item)}">${Object.entries(CHECK).map(([k, l]) => `<button type="button" class="seg-btn ${r.status === k ? 'on ' + k : ''}" data-check="${i}" data-val="${k}" aria-pressed="${r.status === k}">${l}</button>`).join('')}</div>
          </li>`; }).join('')}</ul>
        <div class="card-pad" style="padding-top:0"><button class="btn sm" data-act="check-all-ok">Mark unchecked items OK</button></div>
      </section>

      <section class="card vr-section">
        <div class="card-head"><h2>Problems found</h2><span class="muted small">${problems.filter(p => p.status !== 'Resolved').length} open</span></div>
        ${problems.length ? `<ul class="list">${problems.map(p => { const pm = media.filter(x => x.problemId === p.id); return `
          <li class="problem">
            <div style="min-width:0;flex:1">
              <div class="row"><span class="pill ${p.severity === 'Urgent' ? 's-overdue' : p.severity === 'Medium' ? 's-in-progress' : 's-muted'}">${esc(p.severity)}</span>${p.status === 'Resolved' ? pill('Resolved', ' s-done') : ''}<b>${esc(p.text)}</b></div>
              ${p.action ? `<div class="muted small">Recommended: ${esc(p.action)}</div>` : ''}
              ${pm.length ? `<div class="thumbs-mini">${pm.map(x => x.type === 'image' ? `<img src="${mediaUrl(x)}" alt="">` : `<span class="pill s-muted">▶ video</span>`).join('')}</div>` : ''}
            </div>
            <div class="row" style="justify-content:flex-end">
              <button class="btn sm" data-prob-resolve="${p.id}">${p.status === 'Resolved' ? 'Reopen' : 'Resolved'}</button>
              <button class="btn sm" data-prob-job="${p.id}">Create job</button>
              <button class="btn sm ghost" data-prob-del="${p.id}" aria-label="Remove problem">✕</button>
            </div>
          </li>`; }).join('')}</ul>` : '<p class="muted small card-pad" style="margin:0">No problems. Add one below if you find something.</p>'}
        <div class="card-pad add-problem">
          <input type="text" id="probText" placeholder="What did you find? e.g. damp patch on bathroom ceiling">
          <select id="probSeverity">${options(SEVERITIES, 'Medium')}</select>
          <input type="text" id="probAction" placeholder="Recommended action (optional)">
          <button class="btn primary" data-act="add-problem">Add problem</button>
        </div>
      </section>

      <section class="card vr-section">
        <div class="card-head"><h2>Photos & videos</h2><span class="muted small">${media.filter(x => x.type === 'image').length} photos · ${media.filter(x => x.type === 'video').length} videos</span></div>
        <div class="card-pad">
          ${canUpload ? `<label class="btn primary upload-btn"><input type="file" id="mediaInput" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden>＋ Add photos / videos</label>
            <p class="muted small" style="margin:8px 0 0">Photos are resized and stamped with the date and time they were taken. Videos: MP4 or MOV, up to ${MAX_VIDEO_MB} MB each${API ? '' : ' (about 15–20 seconds)'}.</p>
            <div id="uploadStatus" class="small" aria-live="polite"></div>`
          : `<p class="muted small" style="margin:0">${IN_ARTIFACT ? 'Only people who can edit this page can add photos.' : 'Photos and videos can be added in the online version of the CRM.'}</p>`}
          ${media.length ? `<div class="media-grid">${media.map(x => `
            <figure class="media-item">
              ${x.type === 'image' ? `<a href="${mediaUrl(x)}" target="_blank" rel="noopener"><img src="${mediaUrl(x)}" alt="${esc(x.caption || 'Visit photo')}" loading="lazy"></a>` : `<video src="${mediaUrl(x)}" controls preload="metadata" playsinline></video>`}
              <figcaption>
                <span class="muted small">${fmtDateTime(x.takenAt)}</span>
                <input type="text" value="${esc(x.caption || '')}" placeholder="Caption" data-media-caption="${x.id}" aria-label="Caption">
                <span class="row nowrap"><select data-media-problem="${x.id}" aria-label="Linked problem">${probOpts(x.problemId)}</select>
                ${canUpload ? `<button class="btn sm ghost danger" data-media-del="${x.id}" aria-label="Delete">✕</button>` : ''}</span>
              </figcaption>
            </figure>`).join('')}</div>` : ''}
        </div>
      </section>

      <section class="card card-pad vr-section">
        <h2 style="margin-bottom:10px">Report</h2>
        <div class="fields">
          <label class="field full"><span>Message to the owner</span><textarea id="vr-summary" data-vr="summary" rows="4" placeholder="${esc(defaultSummary(v))}">${esc(v.summary || '')}</textarea></label>
          <label class="field full"><span>Internal notes (not sent)</span><textarea id="vr-notes" data-vr="notes" rows="2">${esc(v.notes || '')}</textarea></label>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-act="prepare-report">Prepare client report</button>
          ${v.status === 'Report sent' ? `<span class="pill s-report-sent">Report sent ${fmtDate(v.reportSentAt)}</span>` : ''}
        </div>
        ${m.email ? `<p class="muted small" style="margin:10px 0 0">Owner email: <span class="selectable">${esc(m.email)}</span> · reports go by ${esc(m.reportChannel || 'WhatsApp')}</p>` : ''}
      </section>`;
  };

  function defaultSummary(v) {
    const { issues } = checklistSummary(v);
    const open = (v.problems || []).filter(p => p.status !== 'Resolved');
    return open.length || issues ? `We found ${open.length || issues} thing${(open.length || issues) === 1 ? '' : 's'} that need attention. Details and photos below.` : 'All clear. Your home is aired, dry and secure.';
  }

  function reportText(v) {
    const m = member(v.memberId) || {};
    const { items, res } = checklistSummary(v);
    const open = (v.problems || []).filter(p => p.status !== 'Resolved');
    const lines = [
      `${ST().businessName} · Visit report`,
      `${m.propertyAddress || m.region || ''} · ${fmtDay(v.date)}${v.arrivedAt ? ` · ${v.arrivedAt}${v.leftAt ? '–' + v.leftAt : ''}` : ''}`,
      '',
      v.summary || defaultSummary(v),
      ''
    ];
    if (v.humidity || v.temperature) lines.push(`Indoor: ${v.humidity ? v.humidity + ' %RH' : ''}${v.humidity && v.temperature ? ', ' : ''}${v.temperature ? v.temperature + ' °C' : ''}`);
    const ok = items.filter(i => res[i]?.status === 'ok');
    if (ok.length) lines.push(`✅ Checked OK: ${ok.join(', ')}`);
    open.forEach(p => lines.push(`⚠️ ${p.severity}: ${p.text}${p.action ? ' — recommended: ' + p.action : ''}`));
    const n = (v.media || []).length;
    if (n) lines.push('', `📷 ${n} timestamped photo${n === 1 ? '' : 's'}/video${n === 1 ? '' : 's'} attached.`);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* Resize to max 2000px, JPEG, and stamp the capture time in the corner. */
  async function preparePhoto(file) {
    const taken = new Date(file.lastModified || Date.now());
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch {
      bitmap = await new Promise((ok, bad) => { const img = new Image(); img.onload = () => ok(img); img.onerror = bad; img.src = URL.createObjectURL(file); });
    }
    const max = 2000, w0 = bitmap.width, h0 = bitmap.height, k = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(bitmap, 0, 0, w, h);
    const stamp = taken.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const fs = Math.max(14, Math.round(w / 45));
    g.font = `600 ${fs}px system-ui, sans-serif`;
    const tw = g.measureText(stamp).width, pad = fs * 0.5;
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(w - tw - pad * 3, h - fs - pad * 3, tw + pad * 2, fs + pad * 2);
    g.fillStyle = '#fff';
    g.textBaseline = 'top';
    g.fillText(stamp, w - tw - pad * 2, h - fs - pad * 2);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return { blob, takenAt: taken.toISOString() };
  }

  const UPLOAD_ERRORS = {
    too_large: `is over ${MAX_VIDEO_MB} MB. Record a shorter clip or send it by WhatsApp instead.`,
    unsupported_type: 'is a file type that can’t be stored. Use JPG/PNG photos or MP4 videos.',
    quota_or_state: 'could not be stored: the photo storage is full.',
    rate_limited: 'was not uploaded: too many uploads at once. Wait a moment and try again.',
    upstream_auth: 'was not uploaded: please reload the page and sign in again.'
  };

  async function addMedia(files) {
    const v = S.get('visits', state.visitId);
    if (!v || !assetsCap) return;
    const status = $('#uploadStatus');
    const list = [...files];
    const failures = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (status) status.textContent = `Uploading ${i + 1} of ${list.length}…`;
      try {
        const isVideo = /^video\//.test(f.type) || /\.(mov|mp4|webm)$/i.test(f.name);
        let blob = f, type, takenAt = new Date(f.lastModified || Date.now()).toISOString();
        if (isVideo) {
          type = /webm/.test(f.type) ? 'video/webm' : 'video/mp4';   // iPhone .mov (H.264/HEVC) is stored as MP4
          if (f.size > MAX_VIDEO_MB * 1024 * 1024) throw { code: 'too_large' };
        } else {
          ({ blob, takenAt } = await preparePhoto(f));
          type = 'image/jpeg';
        }
        let res;
        try { res = await assetsCap.upload(blob, { type }); }
        catch (e) { if (e?.code === 'store_unavailable') { await new Promise(r => setTimeout(r, 1500)); res = await assetsCap.upload(blob, { type }); } else throw e; }
        const cur = S.get('visits', v.id);
        saveVisit(cur, { media: [...(cur.media || []), { id: res.id, type: isVideo ? 'video' : 'image', name: f.name, takenAt, caption: '' }] });
      } catch (e) {
        console.error(e);
        failures.push(`${f.name} ${UPLOAD_ERRORS[e?.code] || 'could not be uploaded.'}`);
      }
    }
    render();
    const st = $('#uploadStatus');
    if (st) st.textContent = failures.join(' ');
    toast(failures.length ? `${list.length - failures.length} of ${list.length} uploaded` : `${list.length} file${list.length === 1 ? '' : 's'} added`);
  }

  async function blobToDataURL(url) {
    const b = await (await fetch(url)).blob();
    return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  }

  /* The downloaded report carries the brand fonts: reuse the app's @font-face rules (file URLs locally / on Cloudflare, data: URIs in the artifact build). */
  async function reportFontCSS() {
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
      for (const r of rules) {
        if (!(r instanceof CSSFontFaceRule)) continue;
        const m = r.cssText.match(/url\(\s*["']?([^"')]+)["']?\s*\)/); if (!m) continue;
        try {
          const data = m[1].startsWith('data:') ? m[1] : await blobToDataURL(new URL(m[1], sheet.href || location.href).href);
          out.push(r.cssText.replace(m[0], `url("${data}")`));
        } catch { /* falls back to system fonts */ }
      }
    }
    return out.join('\n');
  }

  /* Client report styles, scoped under .cr so the same markup works in the in-app preview and the downloaded file. */
  const REPORT_CSS = `
.cr{font:15px/1.6 Manrope,system-ui,-apple-system,Segoe UI,sans-serif;color:#0e0d1b;background:#fff;max-width:820px;margin:0 auto;padding:32px 20px}
.cr h1{font:500 30px/1.15 Poppins,system-ui,sans-serif;letter-spacing:-.02em;margin:18px 0 0;color:#0e0d1b}.cr h1 em{color:#ff4438;font-weight:400}
.cr h2{font:500 18px Poppins,system-ui,sans-serif;margin:30px 0 12px;letter-spacing:-.01em;color:#0e0d1b}
.cr .cr-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding-bottom:16px;border-bottom:1px solid #e8e8ec}
.cr .cr-logo{height:44px;width:auto;display:block}.cr .cr-head b{font:600 20px Poppins,system-ui,sans-serif}
.cr .cr-eyebrow{color:#d6301f;font-weight:700;letter-spacing:.2em;text-transform:uppercase;font-size:11.5px;white-space:nowrap}.cr .cr-eyebrow::before{content:"—— ";color:#ff4438}
.cr .meta{color:#595963;margin-top:6px}.cr .box{background:#ffe9e7;border-left:3px solid #ff4438;border-radius:8px;font-weight:500;padding:14px 16px;white-space:pre-wrap}
.cr table{width:100%;border-collapse:collapse}.cr td{padding:9px 4px;border-bottom:1px solid #f2f2f5;vertical-align:top;background:none;color:#0e0d1b}
.cr .ok{color:#23784a;font-weight:700}.cr .issue{color:#c8291d;font-weight:700}.cr .na{color:#65656f}
.cr .prob{border:1px solid #e8e8ec;border-left:3px solid #c8291d;border-radius:8px;padding:10px 14px;margin:8px 0}
.cr .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.cr figure{margin:0;break-inside:avoid}.cr figure img,.cr figure video{width:100%;border-radius:12px;display:block;background:#f2f1f8}
.cr figcaption{font-size:13px;color:#595963;margin-top:6px}.cr .foot{margin-top:34px;padding-top:14px;border-top:1px solid #e8e8ec;color:#65656f;font-size:12.5px}
@media print{.cr .grid{grid-template-columns:repeat(2,1fr)}}`;

  /* Builds the client report. src(item) returns the photo/video source to use (live URL or embedded data). */
  function reportBody(v, src, skippedVideos = 0, logo = $('.brand-logo')?.src) {
    const m = member(v.memberId) || {};
    const { items, res } = checklistSummary(v);
    const media = v.media || [];
    const photos = media.filter(x => x.type === 'image' && src(x));
    const videos = media.filter(x => x.type === 'video' && src(x));
    const open = (v.problems || []).filter(p => p.status !== 'Resolved');
    const cap = (x) => `<figcaption>${esc(fmtDateTime(x.takenAt))}${x.caption ? ' · ' + esc(x.caption) : ''}</figcaption>`;
    return `<div class="cr">
<div class="cr-head">${logo ? `<img class="cr-logo" src="${esc(logo)}" alt="${esc(ST().businessName)}">` : `<b>${esc(ST().businessName)}</b>`}<span class="cr-eyebrow">Visit report</span></div>
<h1>Property visit <em>report</em></h1>
<div class="meta">${esc(m.propertyAddress || '')}${m.region ? ' · ' + esc(m.region) : ''}<br>
${esc(fmtDay(v.date))} ${v.date ? esc(v.date.slice(0, 4)) : ''}${v.arrivedAt ? ` · ${esc(v.arrivedAt)}${v.leftAt ? '–' + esc(v.leftAt) : ''}` : ''} · Owner: ${esc(m.name || '')}</div>
<h2>Summary</h2><div class="box">${esc(v.summary || defaultSummary(v))}</div>
${v.humidity || v.temperature ? `<p>Indoor conditions: ${v.humidity ? `<b>${esc(v.humidity)} %RH</b>` : ''}${v.humidity && v.temperature ? ' · ' : ''}${v.temperature ? `<b>${esc(v.temperature)} °C</b>` : ''}</p>` : ''}
${open.length ? `<h2>Needs attention</h2>${open.map(p => `<div class="prob"><b>${esc(p.severity)}:</b> ${esc(p.text)}${p.action ? `<br><span class="meta">Recommended: ${esc(p.action)}</span>` : ''}</div>`).join('')}` : ''}
<h2>Checklist</h2><table>${items.map(i => { const r = res[i] || {}; return `<tr><td>${esc(i)}${r.note ? `<br><span class="meta">${esc(r.note)}</span>` : ''}</td><td class="${r.status || 'na'}" style="text-align:right;white-space:nowrap">${r.status ? CHECK[r.status] : '—'}</td></tr>`; }).join('')}</table>
${photos.length ? `<h2>Photos</h2><div class="grid">${photos.map(x => `<figure><img src="${src(x)}" alt="${esc(x.caption || 'Visit photo')}">${cap(x)}</figure>`).join('')}</div>` : ''}
${videos.length ? `<h2>Videos</h2><div class="grid">${videos.map(x => `<figure><video src="${src(x)}" controls playsinline preload="metadata"></video>${cap(x)}</figure>`).join('')}</div>` : ''}
${skippedVideos ? `<p class="meta">${skippedVideos} more video${skippedVideos === 1 ? '' : 's'} from this visit sent separately.</p>` : ''}
<p class="foot">Report prepared ${esc(fmtDate(todayISO()))}. Photos are timestamped at capture.</p>
</div>`;
  }

  /* Step 1: preview the report in the app, with every way to send it. */
  function prepareClientReport() {
    const v = S.get('visits', state.visitId);
    const m = member(v.memberId) || {};
    const media = v.media || [];
    const warn = [];
    if (!Object.values(v.checklist || {}).some(r => r.status)) warn.push('the checklist is empty');
    if (!media.length) warn.push('no photos yet');
    if (!v.summary) warn.push('no message to the owner (a default sentence will be used)');
    openModal({
      title: 'Client report', wide: true,
      body: `${warn.length ? `<p class="callout small" style="margin:0 0 14px"><b>Before you send:</b> ${esc(warn.join(' · '))}</p>` : ''}
        <style>${REPORT_CSS}</style>
        <div class="report-preview">${reportBody(v, mediaUrl)}</div>`,
      foot: `<button type="button" class="btn primary" id="crDownload">Download report file</button>
        <button type="button" class="btn" id="crCopy">Copy WhatsApp text</button>
        ${m.phone ? `<a class="btn" href="${esc(waLink(m.phone))}?text=${encodeURIComponent(reportText(v))}" target="_blank" rel="noopener">Open WhatsApp</a>` : ''}
        ${v.status !== 'Report sent' ? `<button type="button" class="btn" id="crSent">Mark sent</button>` : ''}`,
      bind: (root) => {
        $('#crDownload', root).addEventListener('click', downloadVisitReport);
        $('#crCopy', root).addEventListener('click', () => actions['copy-report-text']());
        $('#crSent', root)?.addEventListener('click', () => { actions['mark-report-sent'](); closeModal(); });
      }
    });
  }

  /* Step 2: a standalone file with photos (and videos up to ~25 MB in total) embedded, so it opens anywhere. */
  async function downloadVisitReport() {
    const v = S.get('visits', state.visitId);
    const m = member(v.memberId) || {};
    toast('Preparing report…');
    const data = {};
    let videoBytes = 0, skipped = 0, logoData = '';
    try { const l = $('.brand-logo'); if (l) logoData = await blobToDataURL(l.src); } catch { /* report falls back to the business name */ }
    const fontCSS = await reportFontCSS();
    for (const x of v.media || []) {
      try {
        if (x.type === 'video') {
          const b = await (await fetch(mediaUrl(x))).blob();
          if (videoBytes + b.size > 25 * 1024 * 1024) { skipped++; continue; }
          videoBytes += b.size;
          data[x.id] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
        } else data[x.id] = await blobToDataURL(mediaUrl(x));
      } catch { /* missing asset: leave it out */ }
    }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visit report ${esc(v.date)} – ${esc(m.propertyAddress || m.name || '')}</title>
<style>${fontCSS}\nbody{margin:0;background:#fff}${REPORT_CSS}</style></head><body>${reportBody(v, (x) => data[x.id], skipped, logoData)}</body></html>`;
    const place = slug(m.propertyAddress || m.name || 'property').slice(0, 40);
    download(`estia-visit-${v.date}-${place}.html`, html, 'text/html');
  }

  /* Quick start from anywhere: pick the member, the visit opens ready to fill in. */
  function logVisitDialog(memberId) {
    openModal({
      title: 'Log a visit',
      body: `<div class="fields">
        <label class="field full"><span>Member / property *</span><select name="memberId" required>${memberOptions(memberId)}</select></label>
        ${field('date', 'Date of visit', todayISO(), 'date', 'required')}
        ${field('arrivedAt', 'Arrived at', timeNow(), 'time')}
      </div>
      <p class="muted small" style="margin:12px 0 0">If this visit is already planned for this month, it will be used instead of creating a new one.</p>`,
      submitLabel: 'Start visit report',
      onSave: (d) => {
        if (!d.memberId) { toast('Choose a member'); return false; }
        const planned = S.all('visits').find(x => x.memberId === d.memberId && x.status === 'Scheduled' && x.month === d.date.slice(0, 7));
        const v = planned
          ? S.save('visits', { id: planned.id, date: d.date, month: d.date.slice(0, 7), arrivedAt: d.arrivedAt, status: 'Visited' })
          : S.save('visits', { memberId: d.memberId, date: d.date, month: d.date.slice(0, 7), arrivedAt: d.arrivedAt, status: 'Visited' });
        setTimeout(() => openVisit(v.id), 0);
      }
    });
  }

  function bindVisitView() {
    if (state.view !== 'visit') return;
    const v = S.get('visits', state.visitId);
    if (!v) return;
    $('#mediaInput')?.addEventListener('change', (e) => { if (e.target.files.length) addMedia(e.target.files); });
  }

  // Field edits on the visit page save immediately.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (state.view !== 'visit') return;
    const v = S.get('visits', state.visitId);
    if (!v) return;
    if (t.dataset.vr) {
      const key = t.dataset.vr, patch = { [key]: t.value };
      if (key === 'date' && t.value) patch.month = t.value.slice(0, 7);
      if (key === 'status' && t.value === 'Report sent' && !v.reportSentAt) patch.reportSentAt = todayISO();
      saveVisit(v, patch);
      if (['status', 'humidity', 'date'].includes(key)) render();
      else toast('Saved');
    }
    if (t.dataset.mediaCaption) {
      saveVisit(v, { media: (v.media || []).map(x => x.id === t.dataset.mediaCaption ? { ...x, caption: t.value } : x) });
      toast('Saved');
    }
    if (t.dataset.mediaProblem) {
      saveVisit(v, { media: (v.media || []).map(x => x.id === t.dataset.mediaProblem ? { ...x, problemId: t.value } : x) });
      render();
    }
  });

  document.addEventListener('click', (e) => {
    if (state.view !== 'visit') return;
    const v = S.get('visits', state.visitId);
    if (!v) return;
    const t = e.target;
    const now = t.closest('[data-vr-now]');
    if (now) {
      e.preventDefault();
      const patch = { [now.dataset.vrNow]: timeNow() };
      if (now.dataset.vrNow === 'arrivedAt' && v.status === 'Scheduled') patch.status = 'Visited';
      saveVisit(v, patch); render(); return;
    }
    const ck = t.closest('[data-check]');
    if (ck) {
      const item = ST().checklist[+ck.dataset.check];
      const cur = { ...(v.checklist || {}) };
      const prev = cur[item] || {};
      cur[item] = { ...prev, status: prev.status === ck.dataset.val ? '' : ck.dataset.val };
      const patch = { checklist: cur };
      if (v.status === 'Scheduled') patch.status = 'Visited';
      saveVisit(v, patch); render();
      if (ck.dataset.val === 'issue' && cur[item].status === 'issue') {
        const inp = $('#probText'); inp.value = item + ': '; inp.focus(); inp.scrollIntoView({ block: 'center' });
      }
      return;
    }
    const res = t.closest('[data-prob-resolve]');
    if (res) { saveVisit(v, { problems: v.problems.map(p => p.id === res.dataset.probResolve ? { ...p, status: p.status === 'Resolved' ? 'Open' : 'Resolved' } : p) }); render(); return; }
    const del = t.closest('[data-prob-del]');
    if (del) {
      confirmBox('Remove this problem?', () => saveVisit(v, {
        problems: v.problems.filter(p => p.id !== del.dataset.probDel),
        media: (v.media || []).map(x => x.problemId === del.dataset.probDel ? { ...x, problemId: '' } : x)
      }), 'Remove');
      return;
    }
    const job = t.closest('[data-prob-job]');
    if (job) {
      const p = v.problems.find(x => x.id === job.dataset.probJob);
      jobForm({ memberId: v.memberId, month: S.monthKey(), title: p.text, notes: p.action || '', service: 'Maintenance & Oversight', visitId: v.id });
      return;
    }
    const md = t.closest('[data-media-del]');
    if (md) {
      confirmBox('Delete this photo/video permanently?', async () => {
        try { await assetsCap?.delete(md.dataset.mediaDel); } catch (err) { console.error(err); }
        const cur = S.get('visits', v.id);
        saveVisit(cur, { media: (cur.media || []).filter(x => x.id !== md.dataset.mediaDel) });
        render();
      });
    }
  });

  Object.assign(actions, {
    'edit-visit': () => visitForm(S.get('visits', state.visitId)),
    'check-all-ok': () => {
      const v = S.get('visits', state.visitId);
      const cur = { ...(v.checklist || {}) };
      ST().checklist.forEach(i => { if (!cur[i]?.status) cur[i] = { ...(cur[i] || {}), status: 'ok' }; });
      saveVisit(v, { checklist: cur, status: v.status === 'Scheduled' ? 'Visited' : v.status }); render();
    },
    'add-problem': () => {
      const v = S.get('visits', state.visitId);
      const text = $('#probText').value.trim();
      if (!text) { toast('Describe the problem first'); $('#probText').focus(); return; }
      saveVisit(v, { problems: [...(v.problems || []), { id: S.uid(), text, severity: $('#probSeverity').value, action: $('#probAction').value.trim(), status: 'Open', at: S.now() }],
        status: v.status === 'Scheduled' ? 'Visited' : v.status });
      render(); toast('Problem added');
    },
    'copy-report-text': async () => {
      const text = reportText(S.get('visits', state.visitId));
      try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into WhatsApp or email'); }
      catch {
        openModal({ title: 'Copy this text', body: `<textarea id="copyBox" rows="12" style="width:100%">${esc(text)}</textarea>`, bind: (r) => { const b = $('#copyBox', r); b.focus(); b.select(); } });
      }
    },
    'download-visit-report': downloadVisitReport,
    'prepare-report': prepareClientReport,
    'log-visit': () => logVisitDialog(),
    'mark-report-sent': () => { const v = S.get('visits', state.visitId); saveVisit(v, { status: 'Report sent', reportSentAt: todayISO() }); render(); toast('Report marked as sent'); }
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act) { e.preventDefault(); if (!act.disabled) actions[act.dataset.act]?.(); return; }
    const chip = t.closest('[data-lead-status],[data-member-status],[data-partner-status]');
    if (chip) {
      if (chip.dataset.leadStatus) state.leadFilter.status = chip.dataset.leadStatus;
      if (chip.dataset.memberStatus) state.memberFilter.status = chip.dataset.memberStatus;
      if (chip.dataset.partnerStatus) state.partnerFilter = chip.dataset.partnerStatus;
      render(); return;
    }
    const wm = t.closest('[data-work-month]');
    if (wm) { const d = +wm.dataset.workMonth; state.workMonth = d ? S.shiftMonth(state.workMonth, d) : S.monthKey(); render(); return; }
    const rm = t.closest('[data-report-month]');
    if (rm) { const d = +rm.dataset.reportMonth; state.reportMonth = d ? S.shiftMonth(state.reportMonth, d) : S.monthKey(); render(); return; }
    const step = t.closest('[data-visit-step]');
    if (step) {
      const v = S.get('visits', step.dataset.visitStep);
      if (v.status === 'Scheduled') S.save('visits', { id: v.id, status: 'Visited', date: v.date > todayISO() ? todayISO() : v.date, month: (v.date > todayISO() ? todayISO() : v.date).slice(0, 7) });
      else S.save('visits', { id: v.id, status: 'Report sent', reportSentAt: todayISO() });
      render(); return;
    }
    const op = t.closest('[data-open]');
    if (t.closest('[data-stop]') && !(op && op.closest('[data-stop]'))) return;
    if (op) { e.preventDefault(); const [kind, id] = op.dataset.open.split(':'); openers[kind]?.(id); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    const sel = t.closest('[data-set-status]');
    if (sel) {
      const [col, id] = sel.dataset.setStatus.split(':');
      const patch = { id, status: sel.value };
      if (col === 'visits' && sel.value === 'Report sent' && !S.get(col, id).reportSentAt) patch.reportSentAt = todayISO();
      if (col === 'jobs' && sel.value === 'Approved' && !S.get(col, id).approvedAt) patch.approvedAt = todayISO();
      S.save(col, patch); render(); toast(`Marked ${sel.value}`);
      return;
    }
    if (t.id === 'leadSource') { state.leadFilter.source = t.value; render(); }
    if (t.id === 'logYear') { state.logYear = t.value; render(); }
    if (t.id === 'restoreFile' && t.files[0]) {
      t.files[0].text().then(txt => { try { S.importJSON(txt); render(); toast('Backup restored'); } catch (err) { toast(err.message || 'Could not read that file'); } });
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-search]');
    if (!t) return;
    const [obj, key] = t.dataset.search.split('.');
    state[obj][key] = t.value;
    rerenderKeepingFocus(t);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'settingsForm') return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    const lines = (s) => [...new Set(String(s || '').split('\n').map(x => x.trim()).filter(Boolean))];
    const currency = (d.currency || '').trim().toUpperCase() || 'EUR';
    try { new Intl.NumberFormat(undefined, { style: 'currency', currency }); } catch { toast('Unknown currency code'); return; }
    const plans = ST().plans.map((p, i) => ({ name: (d[`plan_${i}_name`] || p.name).trim(), monthly: num(d[`plan_${i}_monthly`]), annual: num(d[`plan_${i}_annual`]), visits: Math.max(1, Math.round(num(d[`plan_${i}_visits`]))) }));
    // Keep members pointing at renamed plans.
    ST().plans.forEach((old, i) => { if (old.name !== plans[i].name) S.all('members').filter(m => m.plan === old.name).forEach(m => S.save('members', { id: m.id, plan: plans[i].name })); });
    S.updateSettings({
      businessName: d.businessName.trim() || 'Estia Greek Home', currency, vatRate: num(d.vatRate), onboardingFee: num(d.onboardingFee),
      monthlyRevenueTarget: num(d.monthlyRevenueTarget), plans,
      services: lines(d.services), sources: lines(d.sources), regions: lines(d.regions), audiences: lines(d.audiences), checklist: lines(d.checklist)
    });
    render(); toast('Settings saved');
  });

  // Keyboard: "n" opens a new request when not typing.
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-open]:not(a):not(button)')) { e.preventDefault(); e.target.click(); return; }
    if (e.key === 'n' && !modal.open && !e.target.closest('input, textarea, select') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); leadForm(); }
  });

  window.addEventListener('hashchange', () => { state.view = location.hash.slice(1) || 'dashboard'; closeModal(); render(); window.scrollTo(0, 0); });
  window.addEventListener('storage', () => render());

  state.view = location.hash.slice(1) || 'dashboard';
  render();

  /* ---- sync status + Claude account storage ---- */
  const syncNote = $('#syncNote');
  const SYNC_TEXT = {
    local: 'Saved in this browser',
    loading: 'Loading your data…',
    saving: 'Saving…',
    synced: API ? 'All changes saved' : 'Saved to your Claude account',
    error: 'Not saved. Check your connection, then reload'
  };
  let lastSync = '';
  const showSync = (st) => {
    syncNote.textContent = SYNC_TEXT[st] || ''; syncNote.className = 'sync ' + st;
    syncNote.title = st === 'error' ? 'Changes are kept on this device and saved again when you reload the page.' : '';
    // The tooltip never shows on a phone: say it once when saving starts failing.
    if (st === 'error' && lastSync !== 'error') toast('Not saved. Changes are kept on this device; check your connection, then reload.');
    lastSync = st;
  };
  S.onSyncStatus(showSync);
  showSync(S.syncStatus);

  if (API) {
    const call = async (path, opts = {}) => {
      const res = await fetch(API + path, { credentials: 'same-origin', ...opts, headers: { 'X-Estia': '1', ...(opts.headers || {}) } });
      if (res.status === 401) { location.href = '/login'; throw new Error('signed out'); }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { code: body.error });
      return body;
    };
    assetsCap = {
      upload: (blob, { type }) => call('/media', { method: 'POST', body: blob, headers: { 'Content-Type': type } }),
      delete: (id) => call('/media/' + id, { method: 'DELETE' })
    };
    // Sign-out link in the announcement strip (the menu row has no room for it).
    const out = document.createElement('a');
    out.href = '/logout'; out.textContent = 'Sign out'; out.className = 'signout';
    $('.topbar .container').appendChild(out);
    (async () => {
      try {
        await S.connectRemote({
          load: async () => (await call('/docs')).docs,
          write: (key, body) => call('/docs/' + key, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
          del: (key) => call('/docs/' + key, { method: 'DELETE' })
        });
        render();
      } catch (e) { console.error(e); showSync('error'); }
    })();
    document.addEventListener('submit', async (e) => {
      if (e.target.id !== 'pwForm') return;
      e.preventDefault();
      try {
        await call('/password', { method: 'POST', body: JSON.stringify({ current: $('#pwCurrent').value, next: $('#pwNext').value }), headers: { 'Content-Type': 'application/json' } });
        e.target.reset(); toast('Password changed. Other devices were signed out.');
      } catch (err) { toast(err.message); }
    });
    const showMe = async () => { const el = $('#meEmail'); if (el) el.textContent = (await call('/me')).email; };
    window.addEventListener('hashchange', () => { if (state.view === 'settings') showMe(); });
    if (state.view === 'settings') showMe();
  } else if (IN_ARTIFACT) {
    (async () => {
      const [dbCap, userCap, dl, assets] = await Promise.all(['db', 'user', 'downloads', 'assets'].map(n => window.claude.use(n)));
      downloadsCap = dl;
      assetsCap = assets;
      if (state.view === 'visit') render();
      const uid = userCap ? await userCap.id() : null;
      if (!dbCap || !uid) { showSync('local'); return; }
      // Each person's CRM lives in their own private subtree: nobody else can read it.
      const col = dbCap.collection('data/users/' + uid);
      try {
        await S.connectRemote({
          load: async () => { const snap = await col.get(); const out = {}; snap.docs.forEach(d => { out[d.id] = d.data(); }); return out; },
          write: (key, body) => col.doc(key).set(body),
          del: (key) => col.doc(key).delete()
        });
        render();
      } catch (e) { console.error(e); showSync('error'); }
    })();
  }
})();

/* Estia CRM – UI */
(function () {
  const S = window.Store;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const modal = $('#modal');
  const modalForm = $('#modalForm');

  /* ---------------- helpers ---------------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };

  function money(v, opts = {}) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: S.settings.currency || 'EUR', maximumFractionDigits: opts.cents ? 2 : 0 }).format(v || 0);
    } catch { return `${Math.round(v || 0)} ${S.settings.currency}`; }
  }
  const fmtDate = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
  const monthShort = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' }); };
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
  const pill = (status) => `<span class="pill s-${slug(status)}">${esc(status)}</span>`;
  const options = (list, selected, blank) =>
    (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
    list.map(o => `<option ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const reqMonth = (r) => S.monthKey(r.createdAt);
  const isOpen = (r) => r.status !== 'Won' && r.status !== 'Lost';

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function download(name, text, type = 'text/plain') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function toCSV(rows) {
    return rows.map(r => r.map(v => {
      const s = String(v ?? '');
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
  }

  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim()));
  }

  /* Pull "Label: value" pairs out of a pasted form-notification email. */
  function parseFormText(text) {
    const out = {};
    const map = [
      [/^(full\s*)?name|^όνομα|^ονοματεπώνυμο/i, 'name'],
      [/e-?mail/i, 'email'],
      [/phone|tel|mobile|τηλ/i, 'phone'],
      [/service|interest|υπηρεσ/i, 'service'],
      [/budget|price|προϋπολ/i, 'budget'],
      [/message|comments?|details|notes|μήνυμα/i, 'message']
    ];
    const lines = text.split(/\r?\n/);
    let lastKey = null;
    lines.forEach(line => {
      const m = line.match(/^\s*([^:]{1,40}):\s*(.*)$/);
      if (m) {
        const hit = map.find(([re]) => re.test(m[1].trim()));
        lastKey = hit ? hit[1] : null;
        if (lastKey) out[lastKey] = m[2].trim();
      } else if (lastKey === 'message' && line.trim()) {
        out.message += '\n' + line.trim();
      }
    });
    if (!out.email) { const e = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/); if (e) out.email = e[0]; }
    if (out.budget) out.budget = num(out.budget.replace(/[^\d.,]/g, ''));
    if (out.service) {
      const match = S.settings.services.find(s => s.toLowerCase() === out.service.toLowerCase() || out.service.toLowerCase().includes(s.toLowerCase()));
      if (match) out.service = match;
    }
    return out;
  }

  /* ---------------- modal ---------------- */
  let onSubmit = null;
  function openModal({ title, body, foot = '', submitLabel = 'Save', onSave, bind, wide }) {
    modalForm.innerHTML = `
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost sm" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot}<span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        ${onSave ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}
      </div>`;
    modal.style.width = wide ? 'min(900px, calc(100vw - 32px))' : '';
    onSubmit = onSave || null;
    $$('[data-close]', modalForm).forEach(b => b.addEventListener('click', closeModal));
    if (bind) bind(modalForm);
    if (!modal.open) modal.showModal();
    const first = $('input:not([type=checkbox]), textarea, select', $('.modal-body', modalForm));
    if (first) first.focus();
  }
  function closeModal() { if (modal.open) modal.close(); onSubmit = null; }
  modalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!onSubmit) return closeModal();
    const data = Object.fromEntries(new FormData(modalForm).entries());
    $$('input[type=checkbox][name]', modalForm).forEach(cb => { data[cb.name] = cb.checked; });
    if (onSubmit(data, modalForm) !== false) { closeModal(); render(); }
  });

  function confirmBox(text, onYes, label = 'Delete') {
    openModal({
      title: 'Are you sure?',
      body: `<p>${esc(text)}</p>`,
      submitLabel: label,
      onSave: () => { onYes(); }
    });
  }

  /* ---------------- state ---------------- */
  const state = {
    view: 'dashboard',
    reqFilter: { q: '', status: 'Open', source: '', service: '' },
    projMonth: S.monthKey(),
    reportMonth: S.monthKey(),
    clientQ: ''
  };

  /* ---------------- views ---------------- */
  const views = {};

  views.dashboard = () => {
    const mk = S.monthKey();
    const reqs = S.requests;
    const monthReqs = reqs.filter(r => reqMonth(r) === mk);
    const newCount = reqs.filter(r => r.status === 'New').length;
    const won = monthReqs.filter(r => r.status === 'Won').length;
    const decided = monthReqs.filter(r => r.status === 'Won' || r.status === 'Lost').length;
    const monthProj = S.projects.filter(p => p.month === mk);
    const revenue = monthProj.reduce((a, p) => a + num(p.value), 0);
    const unpaid = S.projects.filter(p => !p.paid && p.month <= mk).reduce((a, p) => a + num(p.value), 0);
    const pipeline = reqs.filter(r => r.status === 'Quoted' || r.status === 'Contacted').reduce((a, r) => a + num(r.budget), 0);
    const today = todayISO();
    const followUps = reqs.filter(r => isOpen(r) && r.followUp && r.followUp <= today).sort((a, b) => a.followUp.localeCompare(b.followUp));
    const latest = [...reqs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
    const dueSoon = S.projects.filter(p => p.status !== 'Done' && p.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
    const doneCount = monthProj.filter(p => p.status === 'Done').length;

    return `
      <div class="page-head">
        <div><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}</h1>
        <div class="sub">${esc(S.settings.businessName)} · ${esc(monthLabel(mk))}</div></div>
        <div class="row">
          <button class="btn" data-act="new-project">+ Project</button>
          <button class="btn primary" data-act="new-request">+ New request</button>
        </div>
      </div>
      <div class="stats">
        ${stat('New requests', newCount, 'waiting for a first reply')}
        ${stat('Requests this month', monthReqs.length, decided ? `${pct(won, decided)}% won of decided` : 'none decided yet')}
        ${stat('Open pipeline', money(pipeline), 'contacted + quoted')}
        ${stat('Projects this month', `${doneCount}/${monthProj.length}`, 'done / total')}
        ${stat('Revenue this month', money(revenue), S.settings.monthlyRevenueTarget ? `${pct(revenue, S.settings.monthlyRevenueTarget)}% of target` : 'booked project value')}
        ${stat('Unpaid', money(unpaid), 'this month and earlier')}
      </div>
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h2>Follow-ups due</h2><span class="muted small">${followUps.length}</span></div>
          ${followUps.length ? `<ul class="list">${followUps.map(r => `
            <li class="clickable" data-open-request="${r.id}">
              <div><div class="name">${esc(r.name)}</div><div class="muted small">${esc(r.service || '')}</div></div>
              <div class="row">${r.followUp < today ? `<span class="pill s-overdue">Overdue · ${fmtDate(r.followUp)}</span>` : `<span class="pill s-contacted">Today</span>`} ${pill(r.status)}</div>
            </li>`).join('')}</ul>` : `<div class="empty">Nothing to chase today.</div>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Latest requests</h2><a href="#requests" class="small">See all</a></div>
          ${latest.length ? `<ul class="list">${latest.map(r => `
            <li class="clickable" data-open-request="${r.id}">
              <div><div class="name">${esc(r.name)}</div><div class="muted small">${esc(r.source || '')} · ${fmtDate(r.createdAt)}</div></div>
              ${pill(r.status)}
            </li>`).join('')}</ul>` : emptyStart()}
        </section>
        <section class="card">
          <div class="card-head"><h2>Upcoming project deadlines</h2><a href="#projects" class="small">Open board</a></div>
          ${dueSoon.length ? `<ul class="list">${dueSoon.map(p => `
            <li class="clickable" data-open-project="${p.id}">
              <div><div class="name">${esc(p.title)}</div><div class="muted small">${esc(p.clientName || '')}</div></div>
              <div class="row">${p.dueDate < today ? `<span class="pill s-overdue">${fmtDate(p.dueDate)}</span>` : `<span class="muted small">${fmtDate(p.dueDate)}</span>`} ${pill(p.status)}</div>
            </li>`).join('')}</ul>` : `<div class="empty">No deadlines set.</div>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Requests by stage</h2><span class="muted small">all time</span></div>
          ${barList(S.REQUEST_STATUSES.map(s => [s, reqs.filter(r => r.status === s).length]), v => v)}
        </section>
      </div>`;
  };

  function stat(label, value, hint) {
    return `<div class="card stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint || '')}</div></div>`;
  }
  function emptyStart() {
    return `<div class="empty">No requests yet.<br><br>
      <button class="btn primary" data-act="new-request">Add your first request</button>
      <button class="btn" data-act="demo">Load demo data</button></div>`;
  }
  function barList(pairs, fmt) {
    const max = Math.max(1, ...pairs.map(p => p[1]));
    if (!pairs.some(p => p[1])) return `<div class="empty">No data for this period.</div>`;
    return `<div class="bars">${pairs.map(([l, v]) => `
      <div class="bar-row" title="${esc(l)}: ${esc(fmt(v))}">
        <span class="lbl">${esc(l)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div>
        <span class="v">${esc(fmt(v))}</span>
      </div>`).join('')}</div>`;
  }

  /* ---- requests ---- */
  function filteredRequests() {
    const f = state.reqFilter;
    const q = f.q.trim().toLowerCase();
    return S.requests.filter(r =>
      (f.status === 'All' || (f.status === 'Open' ? isOpen(r) : r.status === f.status)) &&
      (!f.source || r.source === f.source) &&
      (!f.service || r.service === f.service) &&
      (!q || [r.name, r.email, r.phone, r.message, r.service].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  views.requests = () => {
    const f = state.reqFilter;
    const counts = { All: S.requests.length, Open: S.requests.filter(isOpen).length };
    S.REQUEST_STATUSES.forEach(s => counts[s] = S.requests.filter(r => r.status === s).length);
    const list = filteredRequests();
    const today = todayISO();
    return `
      <div class="page-head">
        <div><h1>Requests</h1><div class="sub">Every enquiry from the website, email, phone and social, in one place.</div></div>
        <div class="row">
          <button class="btn" data-act="import-csv">Import CSV</button>
          <button class="btn" data-act="export-requests">Export CSV</button>
          <button class="btn primary" data-act="new-request">+ New request</button>
        </div>
      </div>
      <div class="card card-pad" style="margin-bottom:12px">
        <div class="row">
          <div class="chips" id="statusChips">
            ${['Open', ...S.REQUEST_STATUSES, 'All'].map(s => `<button class="chip ${f.status === s ? 'on' : ''}" data-status="${esc(s)}">${esc(s)}<span class="c">${counts[s]}</span></button>`).join('')}
          </div>
          <span class="spacer"></span>
          <input type="search" id="reqSearch" placeholder="Search name, email, message…" value="${esc(f.q)}" style="width:220px">
          <select id="reqSource">${options(S.settings.sources, f.source, 'All sources')}</select>
          <select id="reqService">${options(S.settings.services, f.service, 'All services')}</select>
        </div>
      </div>
      <div class="card table-wrap">
        ${list.length ? `<table>
          <thead><tr><th>Received</th><th>Name</th><th>Service</th><th>Source</th><th class="num">Budget</th><th>Status</th><th>Follow-up</th></tr></thead>
          <tbody>${list.map(r => `
            <tr class="clickable" data-open-request="${r.id}">
              <td class="muted">${fmtDate(r.createdAt)}</td>
              <td><div class="name">${esc(r.name)}</div><div class="muted small">${esc(r.email || r.phone || '')}</div></td>
              <td>${esc(r.service || '—')}</td>
              <td>${esc(r.source || '—')}</td>
              <td class="num">${r.budget ? money(num(r.budget)) : '—'}</td>
              <td data-stop><select class="pill-select s-${slug(r.status)}" data-req-status="${r.id}">${options(S.REQUEST_STATUSES, r.status)}</select></td>
              <td>${r.followUp && isOpen(r) ? (r.followUp <= today ? `<span class="pill s-overdue">${fmtDate(r.followUp)}</span>` : fmtDate(r.followUp)) : '<span class="muted">—</span>'}</td>
            </tr>`).join('')}</tbody></table>`
        : (S.requests.length ? `<div class="empty">No requests match these filters.</div>` : emptyStart())}
      </div>`;
  };

  function requestForm(r = {}) {
    const isNew = !r.id;
    const activity = (r.activity || []).slice().reverse();
    const body = `
      ${isNew ? `<details style="margin-bottom:14px"><summary class="small" style="cursor:pointer;color:var(--brand)">Paste a form notification email to fill the fields automatically</summary>
        <textarea id="pasteBox" placeholder="Name: Maria&#10;Email: maria@example.com&#10;Phone: …&#10;Message: …" style="margin-top:8px"></textarea>
        <button type="button" class="btn sm" id="pasteFill" style="margin-top:6px">Fill fields</button></details>` : ''}
      <div class="fields">
        <label class="field"><span>Name *</span><input type="text" name="name" required value="${esc(r.name)}"></label>
        <label class="field"><span>Received</span><input type="date" name="createdDate" value="${esc((r.createdAt || new Date().toISOString()).slice(0, 10))}"></label>
        <label class="field"><span>Email</span><input type="email" name="email" value="${esc(r.email)}"></label>
        <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(r.phone)}"></label>
        <label class="field"><span>Service</span><select name="service">${options(S.settings.services, r.service, '— choose —')}</select></label>
        <label class="field"><span>Source</span><select name="source">${options(S.settings.sources, r.source || 'Website form')}</select></label>
        <label class="field"><span>Budget / est. value (${esc(S.settings.currency)})</span><input type="number" step="any" min="0" name="budget" value="${esc(r.budget ?? '')}"></label>
        <label class="field"><span>Status</span><select name="status">${options(S.REQUEST_STATUSES, r.status || 'New')}</select></label>
        <label class="field"><span>Next follow-up</span><input type="date" name="followUp" value="${esc(r.followUp || '')}"></label>
        <label class="field"><span>Lost reason</span><input type="text" name="lostReason" value="${esc(r.lostReason || '')}" placeholder="Only if lost (price, timing…)"></label>
        <label class="field full"><span>Message / details</span><textarea name="message" rows="4">${esc(r.message)}</textarea></label>
      </div>
      ${!isNew ? `
        <div class="section-title">Notes & activity</div>
        <div class="row" style="margin-bottom:10px"><input type="text" id="noteInput" placeholder="Called, sent quote, waiting for photos…" style="flex:1"><button type="button" class="btn sm" id="noteAdd">Add note</button></div>
        ${activity.length ? `<ul class="activity">${activity.map(a => `<li class="${a.note ? 'note' : ''}"><div class="when">${fmtDateTime(a.at)}</div>${esc(a.text)}</li>`).join('')}</ul>` : '<p class="muted small">No notes yet.</p>'}
        ${r.projectId && S.getProject(r.projectId) ? `<p class="small" style="margin-top:12px">Linked project: <a href="#projects" data-open-project="${r.projectId}">${esc(S.getProject(r.projectId).title)}</a></p>` : ''}
      ` : ''}`;
    const foot = isNew ? '' : `
      <button type="button" class="btn danger" id="delReq">Delete</button>
      ${r.email ? `<a class="btn" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Re: your request – ' + S.settings.businessName)}">Email</a>` : ''}
      ${r.phone ? `<a class="btn" href="https://wa.me/${esc(String(r.phone).replace(/[^\d]/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${!r.projectId ? `<button type="button" class="btn" id="convert">Convert to project</button>` : ''}`;

    openModal({
      title: isNew ? 'New request' : r.name,
      body, foot,
      onSave: (d) => {
        if (!d.name.trim()) { toast('Name is required'); return false; }
        const createdAt = d.createdDate
          ? (r.createdAt && r.createdAt.slice(0, 10) === d.createdDate ? r.createdAt : new Date(d.createdDate + 'T12:00:00').toISOString())
          : (r.createdAt || S.now());
        delete d.createdDate;
        S.saveRequest({ ...d, id: r.id, budget: d.budget === '' ? '' : num(d.budget), createdAt });
        toast(isNew ? 'Request added' : 'Saved');
      },
      bind: (root) => {
        $('#pasteFill', root)?.addEventListener('click', () => {
          const parsed = parseFormText($('#pasteBox', root).value);
          Object.entries(parsed).forEach(([k, v]) => { const el = root.elements[k]; if (el && v !== undefined) el.value = v; });
          toast(Object.keys(parsed).length ? `Filled ${Object.keys(parsed).length} fields` : 'No fields recognised');
        });
        $('#noteAdd', root)?.addEventListener('click', () => {
          const v = $('#noteInput', root).value;
          if (!v.trim()) return;
          S.addRequestNote(r.id, v);
          requestForm(S.getRequest(r.id));
        });
        $('#noteInput', root)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#noteAdd', root).click(); } });
        $('#delReq', root)?.addEventListener('click', () => confirmBox(`Delete the request from ${r.name}?`, () => { S.deleteRequest(r.id); toast('Request deleted'); }));
        $('#convert', root)?.addEventListener('click', () => convertDialog(r));
        $('[data-open-project]', root)?.addEventListener('click', (e) => { e.preventDefault(); projectForm(S.getProject(r.projectId)); });
      }
    });
  }

  function convertDialog(r) {
    openModal({
      title: 'Convert to project',
      body: `<p>Creates a project for <b>${esc(r.name)}</b> and marks the request as <b>Won</b>.</p>
        <div class="fields"><label class="field"><span>Project month</span><input type="month" name="month" value="${S.monthKey()}" required></label></div>`,
      submitLabel: 'Create project',
      onSave: (d) => {
        const p = S.convertRequestToProject(r.id, d.month);
        toast('Project created');
        setTimeout(() => { state.projMonth = p.month; location.hash = '#projects'; projectForm(p); }, 0);
      }
    });
  }

  function importCSVDialog() {
    openModal({
      title: 'Import requests from CSV',
      body: `<p class="small muted">First row must be headers. Recognised columns: <b>name, email, phone, service, source, budget, message, date, status</b> (other columns are added to the message). Works with exports from Google Forms, WordPress form plugins, spreadsheets, etc.</p>
        <input type="file" id="csvFile" accept=".csv,text/csv">`,
      bind: (root) => {
        $('#csvFile', root).addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const rows = parseCSV(await file.text());
          if (rows.length < 2) { toast('No rows found'); return; }
          const head = rows[0].map(h => h.trim().toLowerCase());
          const find = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
          const col = {
            name: find('name', 'όνομα'), email: find('email', 'e-mail'), phone: find('phone', 'tel', 'τηλ'),
            service: find('service', 'interest', 'υπηρεσ'), source: find('source'), budget: find('budget', 'price'),
            message: find('message', 'comment', 'details', 'μήνυμα'), date: find('date', 'timestamp', 'submitted', 'ημερ'), status: find('status')
          };
          const used = new Set(Object.values(col).filter(i => i >= 0));
          let n = 0;
          rows.slice(1).forEach(row => {
            const g = (k) => col[k] >= 0 ? (row[col[k]] || '').trim() : '';
            const name = g('name') || g('email');
            if (!name) return;
            const extra = head.map((h, i) => used.has(i) || !row[i]?.trim() ? null : `${rows[0][i]}: ${row[i].trim()}`).filter(Boolean).join('\n');
            const d = g('date') ? new Date(g('date')) : null;
            const status = S.REQUEST_STATUSES.find(s => s.toLowerCase() === g('status').toLowerCase()) || 'New';
            S.saveRequest({
              name, email: g('email'), phone: g('phone'),
              service: S.settings.services.find(s => s.toLowerCase() === g('service').toLowerCase()) || g('service'),
              source: g('source') || 'Website form', budget: g('budget') ? num(g('budget').replace(/[^\d.,]/g, '')) : '',
              message: [g('message'), extra].filter(Boolean).join('\n'), status,
              createdAt: d && !isNaN(d) ? d.toISOString() : S.now()
            });
            n++;
          });
          closeModal(); render(); toast(`Imported ${n} request${n === 1 ? '' : 's'}`);
        });
      }
    });
  }

  /* ---- projects ---- */
  views.projects = () => {
    const mk = state.projMonth;
    const list = S.projects.filter(p => p.month === mk);
    const value = list.reduce((a, p) => a + num(p.value), 0);
    const cost = list.reduce((a, p) => a + num(p.cost), 0);
    const paid = list.filter(p => p.paid).reduce((a, p) => a + num(p.value), 0);
    const recurring = list.filter(p => p.recurring).length;
    const today = todayISO();
    return `
      <div class="page-head">
        <div><h1>Monthly projects</h1><div class="sub">Plan, track and get paid for each month's work.</div></div>
        <div class="row">
          <div class="monthnav">
            <button class="btn sm" data-month="-1" aria-label="Previous month">‹</button>
            <span class="label">${esc(monthLabel(mk))}</span>
            <button class="btn sm" data-month="1" aria-label="Next month">›</button>
            ${mk !== S.monthKey() ? `<button class="btn sm" data-month="0">This month</button>` : ''}
          </div>
          <button class="btn" data-act="roll" ${recurring ? '' : 'disabled'} title="Copy recurring projects into next month">Copy ${recurring} recurring → next month</button>
          <button class="btn primary" data-act="new-project">+ New project</button>
        </div>
      </div>
      <div class="stats">
        ${stat('Projects', list.length, `${list.filter(p => p.status === 'Done').length} done`)}
        ${stat('Value', money(value), '')}
        ${stat('Costs', money(cost), '')}
        ${stat('Profit', money(value - cost), value ? `${pct(value - cost, value)}% margin` : '')}
        ${stat('Paid', money(paid), `${money(value - paid)} outstanding`)}
      </div>
      <div class="board">
        ${S.PROJECT_STATUSES.map(st => {
          const items = list.filter(p => p.status === st);
          return `<div class="col" data-col="${esc(st)}">
            <div class="col-head">${pill(st)}<span class="muted small">${items.length}</span></div>
            ${items.map(p => {
              const tasks = p.tasks || [];
              const done = tasks.filter(t => t.done).length;
              return `<div class="pcard" draggable="true" data-open-project="${p.id}" data-drag="${p.id}">
                <div class="t">${esc(p.title)}</div>
                <div class="meta">${esc(p.clientName || '')}${p.service ? ' · ' + esc(p.service) : ''}</div>
                ${tasks.length ? `<div class="progress" title="${done}/${tasks.length} tasks"><span style="width:${pct(done, tasks.length)}%"></span></div><div class="meta">${done}/${tasks.length} tasks</div>` : ''}
                <div class="foot">
                  <span class="num" style="font-weight:600">${money(num(p.value))}</span>
                  <span class="row" style="gap:4px">
                    ${p.recurring ? '<span class="pill s-muted" title="Recurring monthly">↻</span>' : ''}
                    ${p.dueDate ? `<span class="pill ${p.dueDate < today && p.status !== 'Done' ? 's-overdue' : 's-muted'}">${fmtDate(p.dueDate)}</span>` : ''}
                    <span class="pill ${p.paid ? 's-paid' : 's-unpaid'}">${p.paid ? 'Paid' : 'Unpaid'}</span>
                  </span>
                </div>
              </div>`;
            }).join('') || '<div class="muted small" style="padding:4px">—</div>'}
          </div>`;
        }).join('')}
      </div>
      <p class="muted small" style="margin-top:10px">Tip: drag cards between columns to change their status.</p>`;
  };

  function clientNames() {
    return [...new Set([...S.requests.map(r => r.name), ...S.projects.map(p => p.clientName)].filter(Boolean))].sort();
  }

  function projectForm(p = {}) {
    const isNew = !p.id;
    let tasks = structuredClone(p.tasks || []);
    const taskHTML = () => tasks.map(t => `
      <li class="${t.done ? 'done' : ''}" data-task="${t.id}">
        <input type="checkbox" ${t.done ? 'checked' : ''} data-task-done aria-label="Done">
        <input type="text" value="${esc(t.text)}" data-task-text>
        <button type="button" class="btn ghost sm" data-task-del aria-label="Remove task">✕</button>
      </li>`).join('');
    const body = `
      <div class="fields">
        <label class="field full"><span>Project title *</span><input type="text" name="title" required value="${esc(p.title)}"></label>
        <label class="field"><span>Client</span><input type="text" name="clientName" list="clientList" value="${esc(p.clientName)}"></label>
        <label class="field"><span>Client email</span><input type="email" name="clientEmail" value="${esc(p.clientEmail)}"></label>
        <label class="field"><span>Service</span><select name="service">${options(S.settings.services, p.service, '— choose —')}</select></label>
        <label class="field"><span>Month</span><input type="month" name="month" required value="${esc(p.month || state.projMonth)}"></label>
        <label class="field"><span>Status</span><select name="status">${options(S.PROJECT_STATUSES, p.status || 'Planned')}</select></label>
        <label class="field"><span>Due date</span><input type="date" name="dueDate" value="${esc(p.dueDate || '')}"></label>
        <label class="field"><span>Value / fee (${esc(S.settings.currency)})</span><input type="number" step="any" min="0" name="value" value="${esc(p.value ?? '')}"></label>
        <label class="field"><span>Costs (${esc(S.settings.currency)})</span><input type="number" step="any" min="0" name="cost" value="${esc(p.cost ?? '')}"></label>
        <label class="check"><input type="checkbox" name="paid" ${p.paid ? 'checked' : ''}> Paid</label>
        <label class="check"><input type="checkbox" name="recurring" ${p.recurring ? 'checked' : ''}> Recurring every month</label>
        <label class="field full"><span>Notes</span><textarea name="notes" rows="3">${esc(p.notes)}</textarea></label>
      </div>
      <datalist id="clientList">${clientNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="section-title">Tasks</div>
      <ul class="tasks" id="taskList">${taskHTML()}</ul>
      <div class="row" style="margin-top:6px"><input type="text" id="taskNew" placeholder="Add a task and press Enter" style="flex:1"><button type="button" class="btn sm" id="taskAdd">Add</button></div>`;
    openModal({
      title: isNew ? 'New project' : p.title,
      body,
      foot: isNew ? '' : `<button type="button" class="btn danger" id="delProj">Delete</button><button type="button" class="btn" id="dupProj">Duplicate</button>`,
      onSave: (d) => {
        if (!d.title.trim()) { toast('Title is required'); return false; }
        $$('#taskList li', modalForm).forEach(li => {
          const t = tasks.find(x => x.id === li.dataset.task);
          if (t) t.text = $('[data-task-text]', li).value;
        });
        S.saveProject({ ...d, id: p.id, value: num(d.value), cost: num(d.cost), tasks: tasks.filter(t => t.text.trim()) });
        toast(isNew ? 'Project added' : 'Saved');
      },
      bind: (root) => {
        const list = $('#taskList', root);
        const add = () => {
          const inp = $('#taskNew', root);
          if (!inp.value.trim()) return;
          tasks.push({ id: S.uid(), text: inp.value.trim(), done: false });
          inp.value = '';
          syncText(); list.innerHTML = taskHTML();
        };
        const syncText = () => $$('li', list).forEach(li => { const t = tasks.find(x => x.id === li.dataset.task); if (t) t.text = $('[data-task-text]', li).value; });
        $('#taskAdd', root).addEventListener('click', add);
        $('#taskNew', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        list.addEventListener('change', (e) => {
          const li = e.target.closest('li');
          if (e.target.matches('[data-task-done]')) {
            const t = tasks.find(x => x.id === li.dataset.task);
            t.done = e.target.checked; li.classList.toggle('done', t.done);
          }
        });
        list.addEventListener('click', (e) => {
          if (!e.target.matches('[data-task-del]')) return;
          syncText();
          tasks = tasks.filter(x => x.id !== e.target.closest('li').dataset.task);
          list.innerHTML = taskHTML();
        });
        $('#delProj', root)?.addEventListener('click', () => confirmBox(`Delete "${p.title}"?`, () => { S.deleteProject(p.id); toast('Project deleted'); }));
        $('#dupProj', root)?.addEventListener('click', () => {
          const { id, createdAt, updatedAt, seriesId, requestId, ...rest } = p;
          projectForm({ ...rest, title: p.title + ' (copy)', paid: false, status: 'Planned', tasks: (p.tasks || []).map(t => ({ ...t, id: S.uid(), done: false })) });
        });
      }
    });
  }

  /* ---- clients ---- */
  function buildClients() {
    const map = new Map();
    const key = (email, name) => (email || '').trim().toLowerCase() || (name || '').trim().toLowerCase();
    const get = (email, name, phone) => {
      const k = key(email, name);
      if (!k) return null;
      if (!map.has(k)) map.set(k, { key: k, name: name || email, email: email || '', phone: phone || '', requests: [], projects: [], value: 0, paid: 0, last: '' });
      const c = map.get(k);
      if (!c.phone && phone) c.phone = phone;
      if (!c.email && email) c.email = email;
      return c;
    };
    S.requests.forEach(r => {
      const c = get(r.email, r.name, r.phone); if (!c) return;
      c.requests.push(r); if (r.createdAt > c.last) c.last = r.createdAt;
    });
    // Projects match a client by email, else by exact name.
    S.projects.forEach(p => {
      let c = p.clientEmail ? map.get(p.clientEmail.trim().toLowerCase()) : [...map.values()].find(x => x.name === p.clientName);
      if (!c) c = get(p.clientEmail, p.clientName, p.clientPhone);
      if (!c) return;
      c.projects.push(p); c.value += num(p.value); if (p.paid) c.paid += num(p.value);
      const at = p.updatedAt || p.createdAt || '';
      if (at > c.last) c.last = at;
    });
    return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
  }

  views.clients = () => {
    const q = state.clientQ.trim().toLowerCase();
    const list = buildClients().filter(c => !q || [c.name, c.email, c.phone].join(' ').toLowerCase().includes(q));
    return `
      <div class="page-head">
        <div><h1>Clients</h1><div class="sub">Built automatically from requests and projects.</div></div>
        <div class="row"><input type="search" id="clientSearch" placeholder="Search clients…" value="${esc(state.clientQ)}"><button class="btn" data-act="export-clients">Export CSV</button></div>
      </div>
      <div class="card table-wrap">
        ${list.length ? `<table><thead><tr><th>Client</th><th>Phone</th><th class="num">Requests</th><th class="num">Projects</th><th class="num">Lifetime value</th><th class="num">Unpaid</th><th>Last activity</th></tr></thead>
        <tbody>${list.map(c => `<tr class="clickable" data-open-client="${esc(c.key)}">
          <td><div class="name">${esc(c.name)}</div><div class="muted small">${esc(c.email)}</div></td>
          <td>${esc(c.phone || '—')}</td>
          <td class="num">${c.requests.length}</td>
          <td class="num">${c.projects.length}</td>
          <td class="num">${money(c.value)}</td>
          <td class="num">${c.value - c.paid ? `<span class="pill s-unpaid">${money(c.value - c.paid)}</span>` : '—'}</td>
          <td class="muted">${fmtDate(c.last)}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${S.requests.length || S.projects.length ? 'No clients match.' : 'Clients appear here once you add requests or projects.'}</div>`}
      </div>`;
  };

  function clientDialog(key) {
    const c = buildClients().find(x => x.key === key);
    if (!c) return;
    openModal({
      title: c.name, wide: true,
      body: `
        <p>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''} ${c.phone ? ' · ' + esc(c.phone) : ''}</p>
        <div class="stats">${stat('Lifetime value', money(c.value), '')}${stat('Paid', money(c.paid), '')}${stat('Projects', c.projects.length, '')}</div>
        <div class="section-title">Requests</div>
        ${c.requests.length ? `<ul class="list card">${c.requests.map(r => `<li class="clickable" data-open-request="${r.id}"><span>${esc(r.service || 'Request')} · <span class="muted">${fmtDate(r.createdAt)}</span></span>${pill(r.status)}</li>`).join('')}</ul>` : '<p class="muted">None</p>'}
        <div class="section-title">Projects</div>
        ${c.projects.length ? `<ul class="list card">${c.projects.sort((a, b) => b.month.localeCompare(a.month)).map(p => `<li class="clickable" data-open-project="${p.id}"><span>${esc(p.title)} · <span class="muted">${esc(monthLabel(p.month))}</span></span><span class="row">${money(num(p.value))} ${pill(p.status)}</span></li>`).join('')}</ul>` : '<p class="muted">None</p>'}`
    });
  }

  /* ---- reports ---- */
  function monthStats(mk) {
    const reqs = S.requests.filter(r => reqMonth(r) === mk);
    const projs = S.projects.filter(p => p.month === mk);
    const won = reqs.filter(r => r.status === 'Won').length;
    const lost = reqs.filter(r => r.status === 'Lost').length;
    const revenue = projs.reduce((a, p) => a + num(p.value), 0);
    const cost = projs.reduce((a, p) => a + num(p.cost), 0);
    const paid = projs.filter(p => p.paid).reduce((a, p) => a + num(p.value), 0);
    return { mk, reqs, projs, won, lost, revenue, cost, profit: revenue - cost, paid, unpaid: revenue - paid, done: projs.filter(p => p.status === 'Done').length };
  }

  views.reports = () => {
    const mk = state.reportMonth;
    const m = monthStats(mk);
    const prev = monthStats(S.shiftMonth(mk, -1));
    const trend = Array.from({ length: 6 }, (_, i) => monthStats(S.shiftMonth(mk, i - 5)));
    const maxRev = Math.max(1, ...trend.map(t => t.revenue));
    const delta = (a, b, fmt = (v) => v) => {
      if (!b && !a) return '';
      const d = a - b;
      return `${d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs ${monthShort(prev.mk)}`;
    };
    const target = num(S.settings.monthlyRevenueTarget);
    const bySource = S.settings.sources.map(s => [s, m.reqs.filter(r => r.source === s).length]).filter(x => x[1]);
    const bySvcReq = S.settings.services.map(s => [s, m.reqs.filter(r => r.service === s).length]).filter(x => x[1]);
    const bySvcRev = S.settings.services.map(s => [s, m.projs.filter(p => p.service === s).reduce((a, p) => a + num(p.value), 0)]).filter(x => x[1]);
    const lostReasons = Object.entries(m.reqs.filter(r => r.status === 'Lost').reduce((acc, r) => { const k = r.lostReason?.trim() || 'Not specified'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}));
    const decided = m.won + m.lost;

    return `
      <div class="report-head-print"><h1>${esc(S.settings.businessName)} — Monthly report</h1><div>${esc(monthLabel(mk))}</div></div>
      <div class="page-head no-print">
        <div><h1>Reports</h1><div class="sub">Monthly performance — print or save as PDF to share.</div></div>
        <div class="row">
          <div class="monthnav">
            <button class="btn sm" data-rmonth="-1" aria-label="Previous month">‹</button>
            <span class="label">${esc(monthLabel(mk))}</span>
            <button class="btn sm" data-rmonth="1" aria-label="Next month">›</button>
          </div>
          <button class="btn" data-act="export-report">Export CSV</button>
          <button class="btn primary" data-act="print">Print / PDF</button>
        </div>
      </div>
      <div class="stats">
        ${stat('Requests received', m.reqs.length, delta(m.reqs.length, prev.reqs.length))}
        ${stat('Win rate', decided ? pct(m.won, decided) + '%' : '—', `${m.won} won · ${m.lost} lost`)}
        ${stat('Projects', m.projs.length, `${m.done} completed`)}
        ${stat('Revenue', money(m.revenue), delta(m.revenue, prev.revenue, money))}
        ${stat('Profit', money(m.profit), m.revenue ? `${pct(m.profit, m.revenue)}% margin` : '')}
        ${stat('Unpaid', money(m.unpaid), `${money(m.paid)} collected`)}
      </div>
      ${target ? `<div class="card target" style="margin-bottom:16px">
        <div class="row"><b>Revenue target</b><span class="spacer"></span><span class="num">${money(m.revenue)} / ${money(target)} · ${pct(m.revenue, target)}%</span></div>
        <div class="progress"><span style="width:${Math.min(100, pct(m.revenue, target))}%"></span></div></div>` : ''}
      <div class="grid grid-2" style="margin-bottom:16px">
        <section class="card"><div class="card-head"><h2>Requests by source</h2></div>${barList(bySource, v => v)}</section>
        <section class="card"><div class="card-head"><h2>Requests by service</h2></div>${barList(bySvcReq, v => v)}</section>
        <section class="card"><div class="card-head"><h2>Revenue by service</h2></div>${barList(bySvcRev, money)}</section>
        <section class="card"><div class="card-head"><h2>Lost reasons</h2></div>${barList(lostReasons, v => v)}</section>
      </div>
      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Revenue — last 6 months</h2><span class="muted small">project value per month</span></div>
        <div class="trend">${trend.map(t => `<div class="colbar ${t.mk === mk ? 'cur' : ''}" title="${esc(monthLabel(t.mk))}: ${esc(money(t.revenue))}">
          <span class="val">${t.revenue ? money(t.revenue) : ''}</span><div class="b" style="height:${(t.revenue / maxRev) * 80}%"></div></div>`).join('')}</div>
        <div class="trend-labels">${trend.map(t => `<span>${esc(monthShort(t.mk))}</span>`).join('')}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Month</th><th class="num">Requests</th><th class="num">Won</th><th class="num">Projects</th><th class="num">Revenue</th><th class="num">Costs</th><th class="num">Profit</th><th class="num">Unpaid</th></tr></thead>
          <tbody>${trend.slice().reverse().map(t => `<tr><td>${esc(monthLabel(t.mk))}</td><td class="num">${t.reqs.length}</td><td class="num">${t.won}</td><td class="num">${t.projs.length}</td><td class="num">${money(t.revenue)}</td><td class="num">${money(t.cost)}</td><td class="num">${money(t.profit)}</td><td class="num">${money(t.unpaid)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Projects in ${esc(monthLabel(mk))}</h2></div>
        ${m.projs.length ? `<div class="table-wrap"><table><thead><tr><th>Project</th><th>Client</th><th>Service</th><th>Status</th><th class="num">Value</th><th class="num">Costs</th><th>Paid</th></tr></thead>
        <tbody>${m.projs.map(p => `<tr class="clickable" data-open-project="${p.id}"><td class="name">${esc(p.title)}</td><td>${esc(p.clientName || '')}</td><td>${esc(p.service || '')}</td><td>${pill(p.status)}</td><td class="num">${money(num(p.value))}</td><td class="num">${money(num(p.cost))}</td><td>${p.paid ? pill('Paid') : pill('Unpaid')}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No projects this month.</div>'}
      </section>`;
  };

  /* ---- settings ---- */
  views.settings = () => {
    const st = S.settings;
    return `
      <div class="page-head"><div><h1>Settings</h1><div class="sub">Tailor the CRM to your business.</div></div></div>
      <div class="grid grid-2">
        <form class="card card-pad" id="settingsForm">
          <h2 style="margin-bottom:12px">Business</h2>
          <div class="fields">
            <label class="field full"><span>Business name</span><input type="text" name="businessName" value="${esc(st.businessName)}"></label>
            <label class="field"><span>Currency (ISO code)</span><input type="text" name="currency" maxlength="3" value="${esc(st.currency)}"></label>
            <label class="field"><span>Monthly revenue target</span><input type="number" min="0" step="any" name="monthlyRevenueTarget" value="${esc(st.monthlyRevenueTarget || '')}"></label>
            <label class="field full"><span>Services (one per line)</span><textarea name="services" rows="7">${esc(st.services.join('\n'))}</textarea></label>
            <label class="field full"><span>Request sources (one per line)</span><textarea name="sources" rows="6">${esc(st.sources.join('\n'))}</textarea></label>
          </div>
          <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save settings</button></div>
        </form>
        <div class="grid" style="align-content:start">
          <section class="card card-pad">
            <h2>Backup & restore</h2>
            <p class="muted small">All data is stored in this browser only. Download a backup weekly, and restore it on another computer to move your data.</p>
            <div class="row"><button class="btn primary" data-act="backup">Download backup</button><button class="btn" data-act="restore">Restore from backup</button></div>
            <input type="file" id="restoreFile" accept=".json,application/json" hidden>
          </section>
          <section class="card card-pad">
            <h2>Data</h2>
            <p class="muted small">${S.requests.length} requests · ${S.projects.length} projects</p>
            <div class="row"><button class="btn" data-act="demo">Load demo data</button><button class="btn danger" data-act="reset">Erase everything</button></div>
          </section>
        </div>
      </div>`;
  };

  /* ---------------- render & routing ---------------- */
  function render() {
    const view = views[state.view] ? state.view : 'dashboard';
    main.innerHTML = views[view]();
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    const n = S.requests.filter(r => r.status === 'New').length;
    const badge = $('#newBadge');
    badge.hidden = !n; badge.textContent = n;
    $('#brandName').textContent = S.settings.businessName || 'Estia CRM';
    document.title = `${view[0].toUpperCase() + view.slice(1)} · ${S.settings.businessName || 'Estia CRM'}`;
    bindView();
  }

  function bindView() {
    $('#reqSearch')?.addEventListener('input', (e) => {
      state.reqFilter.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = $('#reqSearch'); inp.focus(); inp.setSelectionRange(pos, pos);
    });
    $('#reqSource')?.addEventListener('change', (e) => { state.reqFilter.source = e.target.value; render(); });
    $('#reqService')?.addEventListener('change', (e) => { state.reqFilter.service = e.target.value; render(); });
    $('#clientSearch')?.addEventListener('input', (e) => {
      state.clientQ = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = $('#clientSearch'); inp.focus(); inp.setSelectionRange(pos, pos);
    });
    $('#settingsForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      const lines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];
      const currency = d.currency.trim().toUpperCase() || 'EUR';
      try { new Intl.NumberFormat(undefined, { style: 'currency', currency }); } catch { toast('Unknown currency code'); return; }
      S.updateSettings({
        businessName: d.businessName.trim() || 'Estia CRM', currency,
        monthlyRevenueTarget: num(d.monthlyRevenueTarget),
        services: lines(d.services), sources: lines(d.sources)
      });
      render(); toast('Settings saved');
    });
    $('#restoreFile')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { S.importJSON(await f.text()); render(); toast('Backup restored'); }
      catch (err) { toast(err.message || 'Could not read that file'); }
    });

    // Drag & drop on project board
    $$('[data-drag]').forEach(card => card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.dataset.drag)));
    $$('[data-col]').forEach(col => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain');
        if (id) { S.saveProject({ id, status: col.dataset.col }); render(); }
      });
    });
  }

  const actions = {
    'new-request': () => requestForm(),
    'new-project': () => projectForm(),
    'import-csv': importCSVDialog,
    'export-requests': () => {
      const rows = [['Received', 'Name', 'Email', 'Phone', 'Service', 'Source', 'Budget', 'Status', 'Follow-up', 'Lost reason', 'Message']];
      filteredRequests().forEach(r => rows.push([r.createdAt.slice(0, 10), r.name, r.email, r.phone, r.service, r.source, r.budget, r.status, r.followUp, r.lostReason, r.message]));
      download(`requests-${todayISO()}.csv`, toCSV(rows), 'text/csv');
    },
    'export-clients': () => {
      const rows = [['Name', 'Email', 'Phone', 'Requests', 'Projects', 'Lifetime value', 'Paid', 'Last activity']];
      buildClients().forEach(c => rows.push([c.name, c.email, c.phone, c.requests.length, c.projects.length, c.value, c.paid, c.last.slice(0, 10)]));
      download(`clients-${todayISO()}.csv`, toCSV(rows), 'text/csv');
    },
    'export-report': () => {
      const m = monthStats(state.reportMonth);
      const rows = [['Report', monthLabel(m.mk)], [],
        ['Requests received', m.reqs.length], ['Won', m.won], ['Lost', m.lost], ['Projects', m.projs.length], ['Completed', m.done],
        ['Revenue', m.revenue], ['Costs', m.cost], ['Profit', m.profit], ['Paid', m.paid], ['Unpaid', m.unpaid], [],
        ['Project', 'Client', 'Service', 'Status', 'Value', 'Costs', 'Paid']];
      m.projs.forEach(p => rows.push([p.title, p.clientName, p.service, p.status, num(p.value), num(p.cost), p.paid ? 'Yes' : 'No']));
      rows.push([], ['Request date', 'Name', 'Service', 'Source', 'Status', 'Budget']);
      m.reqs.forEach(r => rows.push([r.createdAt.slice(0, 10), r.name, r.service, r.source, r.status, r.budget]));
      download(`report-${m.mk}.csv`, toCSV(rows), 'text/csv');
    },
    print: () => window.print(),
    roll: () => {
      const { count, toMonth } = S.rollRecurring(state.projMonth);
      toast(count ? `Copied ${count} project${count === 1 ? '' : 's'} to ${monthLabel(toMonth)}` : `Already copied to ${monthLabel(toMonth)}`);
      if (count) state.projMonth = toMonth;
      render();
    },
    backup: () => download(`estia-crm-backup-${todayISO()}.json`, S.exportJSON(), 'application/json'),
    restore: () => $('#restoreFile').click(),
    demo: () => { S.loadDemo(); render(); toast('Demo data loaded'); },
    reset: () => confirmBox('This permanently erases all requests, projects and settings in this browser. Download a backup first if unsure.', () => { S.reset(); toast('All data erased'); }, 'Erase everything')
  };

  document.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act && !act.disabled) { e.preventDefault(); actions[act.dataset.act]?.(); return; }
    const chip = t.closest('[data-status]');
    if (chip) { state.reqFilter.status = chip.dataset.status; render(); return; }
    const mbtn = t.closest('[data-month]');
    if (mbtn) { const d = +mbtn.dataset.month; state.projMonth = d ? S.shiftMonth(state.projMonth, d) : S.monthKey(); render(); return; }
    const rbtn = t.closest('[data-rmonth]');
    if (rbtn) { state.reportMonth = S.shiftMonth(state.reportMonth, +rbtn.dataset.rmonth); render(); return; }
    if (t.closest('[data-stop]')) return;
    const or = t.closest('[data-open-request]');
    if (or) { e.preventDefault(); requestForm(S.getRequest(or.dataset.openRequest)); return; }
    const op = t.closest('[data-open-project]');
    if (op) { e.preventDefault(); projectForm(S.getProject(op.dataset.openProject)); return; }
    const oc = t.closest('[data-open-client]');
    if (oc) { clientDialog(oc.dataset.openClient); }
  });

  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-req-status]');
    if (sel) { S.saveRequest({ id: sel.dataset.reqStatus, status: sel.value }); render(); toast(`Marked ${sel.value}`); }
  });

  // Keyboard: "n" for new request when not typing.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !modal.open && !e.target.closest('input, textarea, select') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); requestForm(); }
  });

  window.addEventListener('hashchange', () => { state.view = location.hash.slice(1) || 'dashboard'; closeModal(); render(); });
  window.addEventListener('storage', () => location.reload());

  state.view = location.hash.slice(1) || 'dashboard';
  render();
})();

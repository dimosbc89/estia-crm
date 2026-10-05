/* Estia CRM – data layer. Everything lives in localStorage under one key. */
(function () {
  const KEY = 'estia-crm:v2';

  const LEAD_STATUSES = ['New', 'Call booked', 'Call done', 'Proposal sent', 'Won', 'Lost'];
  const MEMBER_STATUSES = ['Onboarding', 'Active', 'Paused', 'Cancelled'];
  const VISIT_STATUSES = ['Scheduled', 'Visited', 'Report sent', 'Skipped'];
  const JOB_STATUSES = ['Requested', 'Quoted', 'Approved', 'In progress', 'Done', 'Declined'];
  const PARTNER_STATUSES = ['New', 'Call done', 'Vetting', 'Approved', 'Rejected'];

  // Mirrors estiagreekhome.online (plans page, contact form, partner forms).
  const DEFAULT_SETTINGS = {
    businessName: 'Estia Greek Home',
    currency: 'EUR',
    vatRate: 24,
    onboardingFee: 100,
    monthlyRevenueTarget: 0,
    plans: [
      { name: 'Essential', monthly: 79, annual: 948, visits: 1 },
      { name: 'Recommended', monthly: 119, annual: 1428, visits: 2 },
      { name: 'Premium', monthly: 199, annual: 2388, visits: 4 }
    ],
    services: [
      'Maintenance & Oversight',
      'Bills, Admin & Building',
      'Renovation Oversight',
      'Airbnb & STR',
      'Arrival & Departure',
      'Concierge & Lifestyle',
      'Vehicle Care'
    ],
    sources: ['Website form', 'WhatsApp', 'Email', 'Phone', 'Instagram', 'Facebook', 'Referral', 'Partner', 'Other'],
    audiences: ['Greek abroad', 'International owner', 'Investor'],
    regions: ['Athens', 'Athens Riviera', 'Thessaloniki', 'Peloponnese', 'Kalamata & Costa Navarino', 'Halkidiki', 'Pelion', 'Evia', 'Islands', 'Other'],
    propertyTypes: ['Apartment', 'House', 'Villa', 'Multiple units'],
    visitFrequencies: ['Monthly', 'Quarterly', 'Once or twice a year', 'Rarely'],
    partnerTracks: ['Trade partner', 'Professional partner', 'Referral / community partner']
  };

  const COLLECTIONS = ['leads', 'members', 'visits', 'jobs', 'partners'];

  function empty() {
    const d = { settings: structuredClone(DEFAULT_SETTINGS) };
    COLLECTIONS.forEach(c => d[c] = []);
    return d;
  }

  function normalise(data) {
    const d = empty();
    d.settings = Object.assign(d.settings, data.settings || {});
    COLLECTIONS.forEach(c => { if (Array.isArray(data[c])) d[c] = data[c]; });
    return d;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalise(JSON.parse(raw)) : empty();
    } catch (e) {
      console.error('Could not read saved data', e);
      return empty();
    }
  }

  let db = load();

  function save() {
    scheduleFlush();
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { console.error('Could not save', e); return false; }
  }

  /* ---- optional remote sync (Claude artifact db) ----
     Data is split into shard documents so none gets near the per-document size cap:
     settings, members, partners, leads_<year>, visits_<month>, jobs_<month>. */
  let remote = null, flushTimer = null, flushing = false, lastWritten = {};
  const listeners = new Set();
  let syncStatus = 'local';
  const setStatus = (s) => { syncStatus = s; listeners.forEach(fn => fn(s)); };

  function shards() {
    const out = { settings: { settings: db.settings }, members: { items: db.members }, partners: { items: db.partners } };
    const put = (key, item) => { (out[key] ||= { items: [] }).items.push(item); };
    db.leads.forEach(l => put('leads_' + String(l.createdAt || '').slice(0, 4), l));
    db.visits.forEach(v => put('visits_' + (v.month || 'none'), v));
    db.jobs.forEach(j => put('jobs_' + (j.month || 'none'), j));
    return out;
  }

  function scheduleFlush() {
    if (!remote) return;
    clearTimeout(flushTimer);
    setStatus('saving');
    flushTimer = setTimeout(flush, 700);
  }

  async function flush() {
    if (!remote) return;
    if (flushing) { scheduleFlush(); return; }
    flushing = true;
    try {
      const now = shards();
      for (const [key, body] of Object.entries(now)) {
        const json = JSON.stringify(body);
        if (lastWritten[key] === json) continue;
        await remote.write(key, body);
        lastWritten[key] = json;
      }
      for (const key of Object.keys(lastWritten)) {
        if (!(key in now)) { await remote.del(key); delete lastWritten[key]; }
      }
      setStatus('synced');
    } catch (e) {
      console.error('Sync failed', e);
      setStatus('error');
    } finally { flushing = false; }
  }

  // Drop undefined keys so they don't overwrite defaults in Object.assign.
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const monthKey = (d = new Date()) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
  };
  const shiftMonth = (key, delta) => {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  };
  const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };

  const DEFAULTS = {
    leads: () => ({ status: 'New', source: 'Website form', activity: [] }),
    members: () => ({ status: 'Onboarding', plan: 'Recommended', billing: 'Monthly', reportChannel: 'WhatsApp', startDate: new Date().toISOString().slice(0, 10) }),
    visits: () => ({ status: 'Scheduled', issues: '' }),
    jobs: () => ({ status: 'Requested', price: 0, cost: 0, paid: false }),
    partners: () => ({ status: 'New', activity: [] })
  };

  const Store = {
    LEAD_STATUSES, MEMBER_STATUSES, VISIT_STATUSES, JOB_STATUSES, PARTNER_STATUSES, DEFAULT_SETTINGS,
    uid, now, monthKey, shiftMonth, daysInMonth,

    get settings() { return db.settings; },
    all(col) { return db[col]; },
    get(col, id) { return db[col].find(x => x.id === id); },

    save(col, data) {
      let item = data.id && this.get(col, data.id);
      if (item) {
        if (data.status && item.status && data.status !== item.status && item.activity) {
          item.activity.push({ at: now(), text: `Status: ${item.status} → ${data.status}` });
        }
        Object.assign(item, clean(data), { updatedAt: now() });
      } else {
        item = Object.assign({ id: uid(), createdAt: now() }, DEFAULTS[col](), clean(data));
        db[col].push(item);
      }
      save();
      return item;
    },

    remove(col, id) {
      db[col] = db[col].filter(x => x.id !== id);
      if (col === 'members') {
        db.visits = db.visits.filter(v => v.memberId !== id);
        db.jobs.forEach(j => { if (j.memberId === id) j.memberId = ''; });
        db.leads.forEach(l => { if (l.memberId === id) delete l.memberId; });
      }
      if (col === 'partners') db.jobs.forEach(j => { if (j.partnerId === id) j.partnerId = ''; });
      save();
    },

    addNote(col, id, text) {
      const x = this.get(col, id);
      if (!x || !text.trim()) return;
      (x.activity ||= []).push({ at: now(), text: text.trim(), note: true });
      save();
    },

    updateSettings(patch) { Object.assign(db.settings, patch); save(); },

    plan(name) { return db.settings.plans.find(p => p.name === name); },

    /* Monthly recurring revenue (ex VAT) for one member; annual plans spread over 12 months. */
    memberMRR(m) {
      const p = this.plan(m.plan);
      if (!p) return 0;
      return m.billing === 'Annual' ? p.annual / 12 : p.monthly;
    },

    /* Was this member billable in the given month? */
    activeIn(m, mk) {
      if (m.status === 'Onboarding' || m.status === 'Paused') return false;
      const start = (m.startDate || m.createdAt || '').slice(0, 7);
      if (start && start > mk) return false;
      if (m.status === 'Cancelled') {
        const end = (m.endDate || m.updatedAt || '').slice(0, 7);
        if (!end || end < mk) return false;
      }
      return true;
    },

    convertLead(leadId) {
      const l = this.get('leads', leadId);
      if (!l) return null;
      const m = this.save('members', {
        name: l.name, email: l.email || '', phone: l.phone || '',
        livesIn: l.ownerLocation || '', propertyAddress: l.propertyLocation || '',
        propertyType: l.propertyType || '', audience: l.audience || '',
        plan: l.interestedPlan || 'Recommended', leadId: l.id, notes: l.message || ''
      });
      this.save('leads', { id: l.id, status: 'Won', memberId: m.id });
      return m;
    },

    /* Create this month's scheduled visits for every active member, per their plan. Skips existing ones. */
    generateVisits(mk) {
      let n = 0;
      const dim = daysInMonth(mk);
      db.members.filter(m => m.status === 'Active' && this.activeIn(m, mk)).forEach(m => {
        const want = this.plan(m.plan)?.visits || 1;
        const have = db.visits.filter(v => v.memberId === m.id && v.month === mk).length;
        for (let i = have; i < want; i++) {
          // Spread visits evenly through the month.
          const day = Math.min(dim, Math.max(1, Math.round(((i + 0.5) * dim) / want)));
          db.visits.push({ id: uid(), createdAt: now(), memberId: m.id, month: mk, date: `${mk}-${String(day).padStart(2, '0')}`, status: 'Scheduled', issues: '' });
          n++;
        }
      });
      save();
      return n;
    },

    /* ---- sync ---- */
    get syncStatus() { return syncStatus; },
    onSyncStatus(fn) { listeners.add(fn); },
    /* adapter: {load(): Promise<{key: body}>, write(key, body), del(key)} */
    async connectRemote(adapter) {
      setStatus('loading');
      const docs = await adapter.load();
      const keys = Object.keys(docs);
      remote = adapter;
      if (keys.length) {
        const d = { settings: docs.settings?.settings || {} };
        COLLECTIONS.forEach(c => d[c] = []);
        keys.forEach(k => {
          const col = k.split('_')[0];
          if (COLLECTIONS.includes(col) && Array.isArray(docs[k].items)) d[col].push(...docs[k].items);
        });
        db = normalise(d);
        keys.forEach(k => { lastWritten[k] = JSON.stringify(docs[k]); });
        try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
        setStatus('synced');
      } else {
        await flush();   // first run: push whatever this browser already has
      }
      return keys.length > 0;
    },

    /* ---- backup ---- */
    exportJSON() { return JSON.stringify(db, null, 2); },
    importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.leads) || !Array.isArray(data.members)) throw new Error('This file is not an Estia CRM backup.');
      db = normalise(data);
      save();
    },
    reset() { db = empty(); save(); },

    loadDemo() {
      const m0 = monthKey(), m1 = shiftMonth(m0, -1), m2 = shiftMonth(m0, -2), m3 = shiftMonth(m0, -3);
      const at = (mk, d) => `${mk}-${String(d).padStart(2, '0')}T10:00:00.000Z`;
      const lead = (o) => db.leads.push(Object.assign({ id: uid(), activity: [], source: 'Website form', status: 'New' }, o));
      lead({ name: 'Helen Stavrou', email: 'helen@example.com', phone: '+61 400 000 001', ownerLocation: 'Melbourne', propertyLocation: 'Kalamata', propertyType: 'House', visitFrequency: 'Once or twice a year', audience: 'Greek abroad', message: 'My late father\'s house has been empty since spring. Worried about humidity.', createdAt: at(m0, 2) });
      lead({ name: 'James Carter', email: 'james@example.com', phone: '+44 7700 900002', ownerLocation: 'London', propertyLocation: 'Glyfada', propertyType: 'Apartment', visitFrequency: 'Quarterly', audience: 'International owner', status: 'Call booked', callDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10), message: 'Bought last year, insurance asked about vacancy.', createdAt: at(m0, 1) });
      lead({ name: 'Nick Pappas', email: 'nick@example.com', phone: '+1 312 555 0103', ownerLocation: 'Chicago', propertyLocation: 'Thessaloniki', propertyType: 'Apartment', visitFrequency: 'Rarely', audience: 'Greek abroad', status: 'Proposal sent', interestedPlan: 'Essential', followUp: new Date().toISOString().slice(0, 10), createdAt: at(m1, 22) });
      lead({ name: 'Sofia Laine', email: 'sofia@example.com', source: 'Instagram', ownerLocation: 'Helsinki', propertyLocation: 'Pelion', propertyType: 'Villa', audience: 'International owner', status: 'Lost', lostReason: 'Outside coverage / price', createdAt: at(m1, 9) });
      lead({ name: 'Mark Rossi', email: 'mark@example.com', source: 'Referral', ownerLocation: 'Toronto', propertyLocation: 'Athens Riviera', propertyType: 'Multiple units', audience: 'Investor', status: 'Won', createdAt: at(m2, 14) });

      const mem = (o) => { const m = Object.assign({ id: uid(), createdAt: now(), status: 'Active', billing: 'Monthly', reportChannel: 'WhatsApp', onboardingPaid: true }, o); db.members.push(m); return m; };
      const a = mem({ name: 'Anna Georgiou', email: 'anna@example.com', phone: '+61 400 000 010', livesIn: 'Sydney', propertyAddress: 'Kolonaki, Athens', region: 'Athens', propertyType: 'Apartment', audience: 'Greek abroad', plan: 'Recommended', startDate: `${m3}-05`, keysHeld: true });
      const b = mem({ name: 'Mark Rossi', email: 'mark@example.com', phone: '+1 416 555 0199', livesIn: 'Toronto', propertyAddress: 'Vouliagmeni villa', region: 'Athens Riviera', propertyType: 'Villa', audience: 'Investor', plan: 'Premium', billing: 'Annual', startDate: `${m2}-20`, keysHeld: true, reportChannel: 'Email' });
      const c = mem({ name: 'Claire Dubois', email: 'claire@example.com', livesIn: 'Lyon', propertyAddress: 'Stoupa', region: 'Kalamata & Costa Navarino', propertyType: 'House', audience: 'International owner', plan: 'Essential', startDate: `${m1}-03`, keysHeld: true });
      mem({ name: 'Peter Nikolaou', email: 'peter@example.com', livesIn: 'Boston', propertyAddress: 'Kalamaria, Thessaloniki', region: 'Thessaloniki', propertyType: 'Apartment', audience: 'Greek abroad', plan: 'Essential', status: 'Onboarding', startDate: `${m0}-15`, onboardingPaid: false });

      const visit = (memberId, mk, day, status, issues = '') => db.visits.push({ id: uid(), createdAt: now(), memberId, month: mk, date: `${mk}-${String(day).padStart(2, '0')}`, status, issues,
        reportSentAt: status === 'Report sent' ? `${mk}-${String(day).padStart(2, '0')}` : '' });
      [m2, m1].forEach(mk => { visit(a.id, mk, 8, 'Report sent'); visit(a.id, mk, 22, 'Report sent', mk === m1 ? 'Small leak under kitchen sink' : ''); });
      [8, 15, 22, 28].forEach((d, i) => visit(b.id, m1, d, 'Report sent', i === 2 ? 'Pool pump noisy' : ''));
      visit(c.id, m1, 18, 'Report sent');
      visit(a.id, m0, 8, 'Report sent'); visit(a.id, m0, 22, 'Scheduled');
      [8, 15].forEach(d => visit(b.id, m0, d, 'Visited')); [22, 28].forEach(d => visit(b.id, m0, d, 'Scheduled'));
      visit(c.id, m0, 16, 'Scheduled');

      const pid = uid();
      db.partners.push({ id: pid, createdAt: at(m1, 2), track: 'Trade partner', name: 'Yannis Plumbing', company: 'Yannis K. Plumbing', email: 'yannis@example.com', phone: '+30 690 000 0020', trade: 'Plumber (υδραυλικός)', area: 'Central Athens, Glyfada', rate: '€50 call-out + €35/hr', insurance: 'Yes — current and active', status: 'Approved', activity: [] });
      db.partners.push({ id: uid(), createdAt: at(m0, 3), track: 'Referral / community partner', name: 'Greek Community Club Melbourne', email: 'club@example.com', area: 'Melbourne', status: 'New', activity: [] });

      const job = (o) => db.jobs.push(Object.assign({ id: uid(), createdAt: now(), paid: false, cost: 0 }, o));
      job({ memberId: a.id, service: 'Maintenance & Oversight', title: 'Fix leak under kitchen sink', month: m1, status: 'Done', price: 140, cost: 90, paid: true, partnerId: pid });
      job({ memberId: b.id, service: 'Maintenance & Oversight', title: 'Pool pump service', month: m0, status: 'Approved', price: 220, cost: 160 });
      job({ memberId: b.id, service: 'Arrival & Departure', title: 'Pre-arrival clean + fridge stock', month: m0, status: 'Quoted', price: 180, cost: 110 });
      job({ memberId: c.id, service: 'Bills, Admin & Building', title: 'Building meeting representation', month: m1, status: 'Done', price: 60, cost: 0, paid: true });
      save();
    }
  };

  window.Store = Store;
})();

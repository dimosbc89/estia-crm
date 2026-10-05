/* Estia CRM – data layer. Everything lives in localStorage under one key. */
(function () {
  const KEY = 'estia-crm:v1';

  const REQUEST_STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'];
  const PROJECT_STATUSES = ['Planned', 'In progress', 'Review', 'Done'];

  const DEFAULT_SETTINGS = {
    businessName: 'Estia Greek Home',
    currency: 'EUR',
    monthlyRevenueTarget: 0,
    services: [
      'Property management',
      'Short-term rental management',
      'Renovation',
      'Cleaning & maintenance',
      'Interior design',
      'Consultation'
    ],
    sources: ['Website form', 'Email', 'Phone', 'WhatsApp', 'Instagram', 'Facebook', 'Referral', 'Other']
  };

  function empty() {
    return { settings: structuredClone(DEFAULT_SETTINGS), requests: [], projects: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const data = JSON.parse(raw);
      return {
        settings: Object.assign(structuredClone(DEFAULT_SETTINGS), data.settings || {}),
        requests: Array.isArray(data.requests) ? data.requests : [],
        projects: Array.isArray(data.projects) ? data.projects : []
      };
    } catch (e) {
      console.error('Could not read saved data', e);
      return empty();
    }
  }

  let db = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.error('Could not save', e);
      return false;
    }
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

  const Store = {
    REQUEST_STATUSES,
    PROJECT_STATUSES,
    uid, now, monthKey, shiftMonth,

    get settings() { return db.settings; },
    get requests() { return db.requests; },
    get projects() { return db.projects; },

    updateSettings(patch) { Object.assign(db.settings, patch); save(); },

    /* ---- requests ---- */
    getRequest(id) { return db.requests.find(r => r.id === id); },
    saveRequest(data) {
      let r = data.id && this.getRequest(data.id);
      if (r) {
        if (data.status && data.status !== r.status) {
          (r.activity ||= []).push({ at: now(), text: `Status: ${r.status} → ${data.status}` });
        }
        Object.assign(r, clean(data), { updatedAt: now() });
      } else {
        r = Object.assign({
          id: uid(), createdAt: now(), status: 'New', activity: []
        }, clean(data));
        db.requests.push(r);
      }
      save();
      return r;
    },
    addRequestNote(id, text) {
      const r = this.getRequest(id);
      if (!r || !text.trim()) return;
      (r.activity ||= []).push({ at: now(), text: text.trim(), note: true });
      save();
    },
    deleteRequest(id) {
      db.requests = db.requests.filter(r => r.id !== id);
      save();
    },

    /* ---- projects ---- */
    getProject(id) { return db.projects.find(p => p.id === id); },
    saveProject(data) {
      let p = data.id && this.getProject(data.id);
      if (p) {
        Object.assign(p, clean(data), { updatedAt: now() });
      } else {
        p = Object.assign({
          id: uid(), createdAt: now(), status: 'Planned', tasks: [], paid: false, recurring: false
        }, clean(data));
        db.projects.push(p);
      }
      save();
      return p;
    },
    deleteProject(id) {
      db.projects = db.projects.filter(p => p.id !== id);
      db.requests.forEach(r => { if (r.projectId === id) delete r.projectId; });
      save();
    },
    convertRequestToProject(reqId, month) {
      const r = this.getRequest(reqId);
      if (!r) return null;
      const p = this.saveProject({
        title: `${r.service || 'Project'} – ${r.name}`,
        clientName: r.name, clientEmail: r.email || '', clientPhone: r.phone || '',
        service: r.service || '', month: month || monthKey(),
        value: Number(r.budget) || 0, cost: 0, requestId: r.id,
        notes: r.message || ''
      });
      this.saveRequest({ id: r.id, status: 'Won', projectId: p.id });
      return p;
    },
    /* Copy recurring projects from one month into the next (skips ones already copied). */
    rollRecurring(fromMonth) {
      const toMonth = shiftMonth(fromMonth, 1);
      const existing = new Set(db.projects.filter(p => p.month === toMonth && p.seriesId).map(p => p.seriesId));
      let n = 0;
      db.projects.filter(p => p.month === fromMonth && p.recurring).forEach(p => {
        const seriesId = p.seriesId || p.id;
        if (!p.seriesId) p.seriesId = seriesId;
        if (existing.has(seriesId)) return;
        db.projects.push({
          ...structuredClone(p),
          id: uid(), createdAt: now(), updatedAt: undefined,
          month: toMonth, status: 'Planned', paid: false, dueDate: '',
          seriesId, tasks: (p.tasks || []).map(t => ({ ...t, id: uid(), done: false }))
        });
        n++;
      });
      save();
      return { count: n, toMonth };
    },

    /* ---- backup ---- */
    exportJSON() { return JSON.stringify(db, null, 2); },
    importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.requests) || !Array.isArray(data.projects)) {
        throw new Error('This file is not an Estia CRM backup.');
      }
      db = {
        settings: Object.assign(structuredClone(DEFAULT_SETTINGS), data.settings || {}),
        requests: data.requests, projects: data.projects
      };
      save();
    },
    reset() { db = empty(); save(); },

    loadDemo() {
      const m0 = monthKey(), m1 = shiftMonth(m0, -1), m2 = shiftMonth(m0, -2);
      const day = (mk, d) => `${mk}-${String(d).padStart(2, '0')}T10:00:00.000Z`;
      const S = db.settings.services;
      const reqs = [
        ['Maria Papadopoulou', 'maria@example.com', '+30 690 000 0001', 'Website form', S[0], 450, 'Looking for full management of a 2-bed apartment in Athens.', 'New', day(m0, 3)],
        ['John Miller', 'john@example.com', '+44 7700 900001', 'Email', S[1], 300, 'Airbnb management for our villa in Paros, May–Oct.', 'Contacted', day(m0, 2)],
        ['Eleni K.', 'eleni@example.com', '', 'Instagram', S[3], 120, 'Monthly deep cleaning for a holiday home.', 'Quoted', day(m0, 1)],
        ['Nikos Georgiou', 'nikos@example.com', '+30 690 000 0004', 'Referral', S[2], 8500, 'Bathroom and kitchen renovation.', 'Won', day(m1, 12)],
        ['Sophie Laurent', 'sophie@example.com', '', 'Website form', S[4], 2200, 'Interior refresh for a rental studio.', 'Lost', day(m1, 8)],
        ['Anna Schmidt', 'anna@example.com', '', 'Facebook', S[1], 350, 'Need help listing our apartment.', 'Won', day(m2, 20)],
        ['Giorgos Dimitriou', 'giorgos@example.com', '+30 690 000 0007', 'Phone', S[5], 150, 'Advice before buying a property in Crete.', 'New', day(m0, 4)]
      ];
      reqs.forEach(([name, email, phone, source, service, budget, message, status, createdAt]) => {
        db.requests.push({ id: uid(), name, email, phone, source, service, budget, message, status, createdAt,
          followUp: status === 'Contacted' || status === 'Quoted' ? new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) : '',
          activity: [] });
      });
      const proj = (o) => db.projects.push(Object.assign({ id: uid(), createdAt: now(), tasks: [], paid: false, recurring: false, cost: 0 }, o));
      const tasks = (...t) => t.map(([text, done]) => ({ id: uid(), text, done: !!done }));
      [m2, m1, m0].forEach((mk, i) => {
        proj({ title: 'Villa Paros – rental management', clientName: 'Anna Schmidt', clientEmail: 'anna@example.com', service: S[1], month: mk, status: i < 2 ? 'Done' : 'In progress', value: 350, cost: 60, paid: i < 2, recurring: true, seriesId: 'demo-series-1',
          tasks: tasks(['Guest check-ins', i < 2], ['Monthly owner statement', i < 2], ['Linen change', true]) });
      });
      proj({ title: 'Renovation – Georgiou apartment', clientName: 'Nikos Georgiou', clientEmail: 'nikos@example.com', service: S[2], month: m1, status: 'Done', value: 8500, cost: 5900, paid: true,
        tasks: tasks(['Demolition', true], ['Plumbing', true], ['Tiling', true]) });
      proj({ title: 'Renovation – snag list', clientName: 'Nikos Georgiou', clientEmail: 'nikos@example.com', service: S[2], month: m0, status: 'Review', value: 600, cost: 200, paid: false, dueDate: `${m0}-20`,
        tasks: tasks(['Fix grout', true], ['Repaint hallway', false]) });
      proj({ title: 'Kolonaki flat – management', clientName: 'Maria Papadopoulou', clientEmail: 'maria@example.com', service: S[0], month: m0, status: 'Planned', value: 450, cost: 50, paid: false, recurring: true, dueDate: `${m0}-28`,
        tasks: tasks(['Inspection visit'], ['Collect rent'], ['Send owner report']) });
      save();
    }
  };

  window.Store = Store;
})();

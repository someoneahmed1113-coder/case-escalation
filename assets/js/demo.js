// وضع العرض التجريبي: يحاكي قاعدة البيانات داخل المتصفح لمعاينة المنصة قبل ربطها بـ Supabase.
// لا يُستخدم في التشغيل الفعلي.
(function () {
  'use strict';
  const KEY = 'escalation-demo-v1';
  const ME = { id: 'demo-user', email: 'demo@nbhc.sa', full_name: 'منسق تجريبي', phone: '0504479769' };
  const PL = { hospital: 'المستشفى', path_leader: 'قائد المسار للتخصص', hospitals_admin: 'إدارة المستشفيات', other: 'جهة أخرى' };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const tok = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const now = () => new Date().toISOString();
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  let mem = null;

  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
    if (!mem) mem = seed();
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* يعمل في الذاكرة فقط */ } }
  function ev(request_id, kind, detail, actor) { mem.events.push({ id: mem.events.length + 1, request_id, kind, detail, actor, at: now() }); }

  function seed() {
    const db = { serial: 3, signedIn: false, requests: [], responses: [], events: [] };
    const mk = (serial, h, f) => {
      const r = { id: uid(), serial, created_at: ago(h), updated_at: ago(h), started_at: ago(h + 0.5), supervisor_phone: '0504479769', supervisor_name: 'منسق تجريبي',
        coordinator_name: null, coordinator_signature: null, coordinator_signed_at: null, c937_contacted: null, ...f };
      db.requests.push(r);
      db.events.push({ id: db.events.length + 1, request_id: r.id, kind: 'created', detail: 'إنشاء الطلب', actor: 'منسق تجريبي', at: r.created_at });
      return r;
    };
    const a = mk(1, 30, { referral_no: 'مثال-10231', case_type: 'طارئة', specialty: 'عظام', hospital_name: 'مستشفى (مثال)', outcome: 'تم حل التحدي',
      c937_contacted: true, c937_at: ago(29), c937_code: 'A-17', c937_direction: 'التوجيه بالتنسيق مع المستشفى المرجعي (مثال)', support_request: 'تسريع قبول الحالة (مثال)' });
    const b = mk(2, 6, { referral_no: 'مثال-10288', case_type: 'إنقاذ حياة', specialty: 'جراحة أعصاب', hospital_name: 'مستشفى (مثال)', outcome: 'بانتظار توجيه',
      support_request: 'دعم من قائد المسار لتأمين سرير (مثال)' });
    mk(3, 1, { referral_no: 'مثال-10302', case_type: 'طارئة', specialty: 'قلب', hospital_name: 'مستشفى (مثال)', outcome: 'تحت الإجراء' });
    db.responses.push({ id: uid(), request_id: a.id, party_type: 'hospital', party_label: 'مستشفى (مثال)', token: tok(), created_at: ago(28), opened_at: ago(27),
      submitted_at: ago(26), medical_opinion: 'نص تجريبي للرأي الطبي.', action_taken: 'نص تجريبي للإجراء المتخذ.', responder_name: 'طبيب (مثال)', responder_title: 'استشاري', signature: null });
    db.responses.push({ id: uid(), request_id: b.id, party_type: 'hospital', party_label: 'مستشفى (مثال)', token: tok(), created_at: ago(5), opened_at: ago(4) });
    return db;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const delay = (v) => new Promise((r) => setTimeout(() => r(clone(v)), 120));

  window.DemoApi = {
    async session() { return load().signedIn ? { user: ME } : null; },
    async signIn() { load().signedIn = true; save(); return { user: ME }; },
    async signOut() { load().signedIn = false; save(); },
    async changePassword() { return true; },
    async me() { return load().signedIn ? ME : null; },
    async listRequests() {
      const db = load();
      return delay(db.requests.slice().sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((r) => ({ ...r, responses: db.responses.filter((p) => p.request_id === r.id) })));
    },
    async getRequest(id) {
      const db = load();
      const req = db.requests.find((r) => r.id === id);
      if (!req) throw new Error('الطلب غير موجود');
      return delay({ req, responses: db.responses.filter((p) => p.request_id === id), events: db.events.filter((e) => e.request_id === id) });
    },
    async createRequest(f) {
      const db = load();
      const r = { outcome: 'تحت الإجراء', ...f, id: uid(), serial: ++db.serial, created_at: now(), updated_at: now() };
      if (r.coordinator_signature) r.coordinator_signed_at = now();
      db.requests.push(r); ev(r.id, 'created', 'إنشاء الطلب', ME.full_name);
      if (r.coordinator_signature) ev(r.id, 'signed', 'توقيع التنسيق الطبي', ME.full_name);
      save(); return delay(r);
    },
    async updateRequest(id, f) {
      const db = load();
      const r = db.requests.find((x) => x.id === id);
      const before = { ...r };
      Object.assign(r, f, { updated_at: now() });
      if (before.coordinator_signature) { r.coordinator_signature = before.coordinator_signature; r.coordinator_name = before.coordinator_name; r.coordinator_signed_at = before.coordinator_signed_at; }
      else if (r.coordinator_signature) { r.coordinator_signed_at = now(); ev(id, 'signed', 'توقيع التنسيق الطبي', ME.full_name); }
      if (before.outcome !== r.outcome) ev(id, 'outcome', r.outcome, ME.full_name);
      save(); return delay(r);
    },
    async createResponse(f) {
      const db = load();
      const p = { ...f, id: uid(), token: tok(), created_at: now() };
      db.responses.push(p); ev(f.request_id, 'link', 'إرسال رابط إلى ' + PL[f.party_type] + ': ' + f.party_label, ME.full_name);
      save(); return delay(p);
    },
    async revokeResponse(id) {
      const db = load();
      const p = db.responses.find((x) => x.id === id);
      if (p.submitted_at) throw new Error('لا يمكن إلغاء رد تم توقيعه');
      p.revoked_at = now(); ev(p.request_id, 'revoked', 'إلغاء رابط ' + p.party_label, ME.full_name); save();
    },
    async addNote(request_id, detail) { load(); ev(request_id, 'note', detail, ME.full_name); save(); },
    async getForm(token) {
      const db = load();
      const p = db.responses.find((x) => x.token === token);
      if (!p || p.revoked_at) throw new Error('الرابط غير صالح أو تم إلغاؤه');
      if (!p.opened_at) { p.opened_at = now(); ev(p.request_id, 'opened', 'فتح الرابط: ' + p.party_label, null); save(); }
      const req = db.requests.find((r) => r.id === p.request_id);
      const pick = (o) => ({ type: o.party_type, type_label: PL[o.party_type], label: o.party_label, medical_opinion: o.medical_opinion, action_taken: o.action_taken,
        statement: o.statement, responder_name: o.responder_name, responder_title: o.responder_title, signature: o.signature, submitted_at: o.submitted_at });
      return delay({ party: pick(p), request: req, others: db.responses.filter((o) => o.request_id === p.request_id && o.id !== p.id && o.submitted_at).map(pick) });
    },
    async submitForm(token, f) {
      const db = load();
      const p = db.responses.find((x) => x.token === token);
      if (!p || p.revoked_at) throw new Error('الرابط غير صالح أو تم إلغاؤه');
      if (p.submitted_at) throw new Error('تم إرسال هذا الرد مسبقاً ولا يمكن تعديله');
      Object.assign(p, f, { submitted_at: now() });
      ev(p.request_id, 'submitted', 'توقيع وإرسال رد ' + PL[p.party_type] + ': ' + p.party_label, f.responder_name);
      save(); return p.submitted_at;
    },
    subscribe(onChange) {
      const h = (e) => { if (e.key === KEY) { mem = null; onChange(); } };
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  };
})();

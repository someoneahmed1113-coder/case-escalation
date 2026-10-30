// منصة تصعيد الحالات — الدوال المشتركة بين الصفحات
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const DEMO = cfg.DEMO || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;

  const OUTCOMES = [
    { v: 'تحت الإجراء', cls: 's-progress' },
    { v: 'بانتظار توجيه', cls: 's-awaiting' },
    { v: 'تم التوجيه', cls: 's-directed' },
    { v: 'تم حل التحدي', cls: 's-solved' },
    { v: 'تم انتهاء التصعيد', cls: 's-closed' },
  ];
  const PARTIES = {
    hospital: 'المستشفى',
    path_leader: 'قائد المسار للتخصص',
    hospitals_admin: 'إدارة المستشفيات',
    other: 'جهة أخرى',
  };
  const SPECIALTIES = ['عظام', 'جراحة عامة', 'جراحة أعصاب', 'جراحة أوعية دموية', 'جراحة قلب', 'قلب', 'باطنية', 'أطفال', 'حديثي الولادة',
    'نساء وولادة', 'عناية مركزة', 'عناية قلب', 'حروق', 'أورام', 'مسالك بولية', 'عيون', 'أنف وأذن وحنجرة', 'كلى', 'جهاز هضمي', 'صدرية', 'نفسية'];
  const DEFAULT_SUPERVISOR_PHONE = '0504479769';

  // ───────── أدوات عامة ─────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    let h = d.getHours();
    const ap = h < 12 ? 'ص' : 'م';
    h = h % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${ap}`;
  }
  const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)} - ${fmtTime(iso)}` : '');
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
  const serialLabel = (n) => String(n).padStart(4, '0');
  const outcomeClass = (v) => (OUTCOMES.find((o) => o.v === v) || OUTCOMES[0]).cls;
  const pill = (v) => `<span class="pill ${outcomeClass(v)}">${esc(v)}</span>`;

  function toast(msg, isErr) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3200);
  }

  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مرة أخرى';
    return m;
  }

  // يحوّل الجوال السعودي إلى الصيغة الدولية لرابط واتساب
  function intlPhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('05') && d.length === 10) d = '966' + d.slice(1);
    else if (d.startsWith('5') && d.length === 9) d = '966' + d;
    return d;
  }
  function waLink(phone, text) {
    const p = intlPhone(phone);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('تم نسخ الرابط'); }
    catch (e) { window.prompt('انسخ الرابط:', text); }
  }
  function respondUrl(token) {
    return new URL('respond.html?t=' + encodeURIComponent(token), location.href).href;
  }
  function inviteText(req, party) {
    const what = party.party_type === 'hospital' ? 'الرأي الطبي والإجراء المتخذ' : 'الإفادة';
    return [
      'السلام عليكم ورحمة الله وبركاته',
      `نموذج تصعيد حالة رقم ${serialLabel(req.serial)}${req.specialty ? ' - تخصص ' + req.specialty : ''}${req.case_type ? ' (' + req.case_type + ')' : ''}`,
      `نأمل التكرم بتعبئة ${what} والتوقيع عبر الرابط التالي:`,
      respondUrl(party.token),
      '',
      'إدارة التنسيق الطبي - تجمع الحدود الشمالية الصحي',
    ].join('\n');
  }

  // ───────── خانة التوقيع (تكبر عند الضغط) ─────────
  function openSignaturePad({ title = 'التوقيع', subtitle = '' } = {}) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'sigmodal';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.innerHTML = `
        <div class="sigpanel">
          <header><div><b>${esc(title)}</b>${subtitle ? `<br><small>${esc(subtitle)}</small>` : ''}</div>
            <button type="button" class="btn btn-ghost btn-sm" data-a="cancel">إغلاق</button></header>
          <div class="sigpad"><div class="ph">وقّع هنا بإصبعك أو بالقلم</div><div class="baseline"></div><div class="x">×</div><canvas></canvas></div>
          <footer><button type="button" class="btn btn-ghost" data-a="clear">مسح وإعادة</button>
            <div><button type="button" class="btn btn-ghost" data-a="cancel">إلغاء</button>
            <button type="button" class="btn btn-primary" data-a="ok" disabled>اعتماد التوقيع</button></div></footer>
        </div>`;
      document.body.appendChild(m);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const pad = $('.sigpad', m), cv = $('canvas', pad), ctx = cv.getContext('2d'), ph = $('.ph', pad), ok = $('[data-a="ok"]', m);
      let strokes = [], cur = null, dpr = 1;

      function resize() {
        dpr = Math.max(1, window.devicePixelRatio || 1);
        const r = pad.getBoundingClientRect();
        cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
        redraw();
      }
      function drawStroke(s) {
        const pts = s.pts; if (!pts.length) return;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0E2F55';
        if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x * cv.width, pts[0].y * cv.height, 1.6 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#0E2F55'; ctx.fill(); return; }
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          ctx.lineWidth = (b.w || 2.6) * dpr;
          ctx.beginPath();
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (i === 1) ctx.moveTo(a.x * cv.width, a.y * cv.height); else { const p = pts[i - 2]; ctx.moveTo(((p.x + a.x) / 2) * cv.width, ((p.y + a.y) / 2) * cv.height); }
          ctx.quadraticCurveTo(a.x * cv.width, a.y * cv.height, mx * cv.width, my * cv.height);
          ctx.stroke();
        }
      }
      function redraw() { ctx.clearRect(0, 0, cv.width, cv.height); strokes.forEach(drawStroke); }
      function pos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: e.timeStamp }; }

      cv.addEventListener('pointerdown', (e) => {
        e.preventDefault(); cv.setPointerCapture(e.pointerId);
        cur = { pts: [pos(e)] }; strokes.push(cur); ph.hidden = true; ok.disabled = false; redraw();
      });
      cv.addEventListener('pointermove', (e) => {
        if (!cur) return; e.preventDefault();
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
          const p = pos(ev), last = cur.pts[cur.pts.length - 1];
          const r = cv.getBoundingClientRect();
          const dist = Math.hypot((p.x - last.x) * r.width, (p.y - last.y) * r.height);
          const speed = dist / Math.max(1, p.t - last.t);
          const target = Math.max(1.4, Math.min(3.6, 3.6 - speed * 0.9));
          p.w = (last.w || 2.6) * 0.7 + target * 0.3;
          if (dist > 0.6) cur.pts.push(p);
        }
        redraw();
      });
      const end = () => { cur = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

      function exportPng() {
        // قص الهوامش الفارغة وتصدير بخلفية شفافة
        const w = cv.width, h = cv.height, data = ctx.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 <= x0) return null;
        const m = 12 * dpr; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(h, y1 + m);
        const scale = Math.min(1, 700 / (x1 - x0));
        const out = document.createElement('canvas');
        out.width = Math.round((x1 - x0) * scale); out.height = Math.round((y1 - y0) * scale);
        out.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      }
      function close(val) {
        window.removeEventListener('resize', resize); document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevOverflow; m.remove(); resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      m.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'cancel') close(null);
        if (a.dataset.a === 'clear') { strokes = []; redraw(); ph.hidden = false; ok.disabled = true; }
        if (a.dataset.a === 'ok') close(exportPng());
      });
      window.addEventListener('resize', resize); document.addEventListener('keydown', onKey);
      requestAnimationFrame(resize);
      try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* اختياري */ }
    });
  }

  // يربط زر خانة التوقيع: يعرض التوقيع الحالي ويفتح اللوحة الكبيرة عند الضغط
  function bindSignatureBox(btn, { title, subtitle, getValue, setValue, locked }) {
    function render() {
      const v = getValue();
      btn.classList.toggle('has', !!v);
      btn.disabled = !!locked;
      btn.innerHTML = v
        ? `<img src="${v}" alt="التوقيع">${locked ? '' : '<span class="redo">إعادة التوقيع</span>'}`
        : `<span>اضغط هنا للتوقيع</span>`;
    }
    btn.addEventListener('click', async () => {
      if (locked) return;
      const v = await openSignaturePad({ title, subtitle });
      if (v) { setValue(v); render(); }
    });
    render();
    return { render };
  }

  // ───────── نسخة PDF (طباعة) على نمط النموذج الورقي ─────────
  function renderPrintSheet(req, responses) {
    const submitted = (responses || []).filter((r) => r.submitted_at);
    const hosp = submitted.filter((r) => r.party_type === 'hospital');
    const others = submitted.filter((r) => r.party_type !== 'hospital');
    const row = (label, val, sub) => `<tr><th>${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</th><td>${val || '<span style="color:#999">—</span>'}</td></tr>`;
    const by = (r) => `${esc(r.responder_name)}${r.responder_title ? ' - ' + esc(r.responder_title) : ''} <span class="sub">${esc(r.party_label)} | ${fmtDateTime(r.submitted_at)}</span>`;
    const c937 = req.c937_contacted == null ? '' : req.c937_contacted
      ? `تم التواصل${req.c937_at ? ' | ' + fmtDateTime(req.c937_at) : ''}${req.c937_code ? ' | رمز الكود: ' + esc(req.c937_code) : ''}${req.c937_direction ? '\nالتوجيه: ' + esc(req.c937_direction) : ''}`
      : 'لم يتم التواصل';

    let hospRows = '';
    if (hosp.length) hosp.forEach((r) => {
      hospRows += row('الإدارة الطبية / الطبيب المعالج', esc(r.medical_opinion) + `\n<span class="sub">${by(r)}</span>`);
      hospRows += row('الإجراء المتخذ', esc(r.action_taken));
    });
    else { hospRows = row('الإدارة الطبية / الطبيب المعالج', '') + row('الإجراء المتخذ', ''); }

    let otherRows = '';
    others.forEach((r) => { otherRows += row(PARTIES[r.party_type], esc(r.statement) + `\n<span class="sub">${by(r)}</span>`, r.party_type === 'other' ? r.party_label : ''); });
    if (!others.length) otherRows = row('إدارة المستشفيات', '', 'قائد المسار للتخصص / إدارات أخرى');

    const sigs = [];
    sigs.push({ role: 'التنسيق الطبي بالتجمع', name: req.coordinator_name, img: req.coordinator_signature, at: req.coordinator_signed_at });
    submitted.forEach((r) => sigs.push({ role: r.party_type === 'hospital' ? 'الطبيب المعالج - ' + r.party_label : PARTIES[r.party_type] + (r.party_type === 'other' ? ' - ' + r.party_label : ''), name: r.responder_name, img: r.signature, at: r.submitted_at }));

    return `
      <div class="ps-head">
        <div class="t"><h1>نموذج تصعيد الحالات</h1><p>الحالات التي تواجه تحديات وتحتاج إلى الدعم والتوجيه</p></div>
        <div class="ref">رقم الطلب<br><b class="num">${serialLabel(req.serial)}</b></div>
        <img src="assets/img/logo.webp" alt="تجمع الحدود الشمالية الصحي">
      </div>
      <div class="ps-org">الحالات الطبية والتنسيق الطبي بتجمع الحدود الشمالية الصحي</div>
      <div class="ps-band">إدارة التنسيق الطبي بالتجمع: بيانات الحالة</div>
      <table class="ps-table">
        ${row('وقت بداية إجراءات الحالة', `التاريخ والوقت: ${fmtDateTime(req.started_at) || '—'}\nرقم الإحالة: <span class="num">${esc(req.referral_no) || '—'}</span>  |  تصنيف الحالة: ${esc(req.case_type) || '—'}`)}
        ${row('التخصص المطلوب', esc(req.specialty))}
        ${row('توجيه مركز اتصال الطوارئ بالوزارة 1937', c937)}
        ${row('مشرف التنسيق الطبي بالتجمع', `${esc(req.supervisor_name)}${req.supervisor_phone ? '  <span class="num">' + esc(req.supervisor_phone) + '</span>' : ''}`)}
      </table>
      <div class="ps-band">المستشفى المعني بالحالة التي تواجه تحدي:</div>
      <table class="ps-table">
        ${row('اسم المستشفى', esc(req.hospital_name))}
        ${hospRows}
      </table>
      <div class="ps-band">متابعة التحديث على الحالة:</div>
      <table class="ps-table">
        ${otherRows}
        ${row('الدعم / التوجيه', esc(req.support_request))}
        ${row('نتيجة حالة التصعيد', esc(req.outcome))}
      </table>
      <div class="ps-sigs">
        ${sigs.map((s) => `<div class="ps-sig"><span class="role">${esc(s.role)}</span>${s.img ? `<img src="${s.img}" alt="">` : '<div class="blank"></div>'}<span>${esc(s.name || '')}</span><span class="sub" style="color:#666">${fmtDateTime(s.at)}</span></div>`).join('')}
      </div>
      <div class="ps-notes"><b>ملاحظة:</b><ul>
        <li>يتم تعبئة النموذج إلكترونياً.</li>
        <li>يستخدم هذا النموذج من أجل إجراءات التوثيق وحفظ حقوق المريض ومتابعة حالات التأخير.</li>
        <li>عدم إدراج بيانات شخصية غير لازمة والاكتفاء برقم الإحالة والبيانات وفق سياسة الخصوصية المعتمدة.</li>
        <li>في حال طلب التقارير والوثائق اللازمة للحالة من خلال مشرف التنسيق المناوب بالتجمع / <span class="num">${DEFAULT_SUPERVISOR_PHONE}</span></li>
      </ul></div>
      <div class="ps-foot"><span>إدارة التنسيق الطبي بالتجمع | نموذج إلكتروني للتوثيق والمتابعة</span><span>تاريخ الإصدار: <span class="num">${fmtDateTime(new Date().toISOString())}</span></span></div>`;
  }

  function printSheet(req, responses) {
    let el = $('.print-sheet');
    if (!el) { el = document.createElement('div'); el.className = 'print-sheet'; document.body.appendChild(el); }
    el.innerHTML = renderPrintSheet(req, responses);
    const prevTitle = document.title;
    document.title = `نموذج تصعيد الحالات - ${serialLabel(req.serial)}`;
    const imgs = $$('img', el).filter((i) => !i.complete);
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(() => {
      window.print();
      setTimeout(() => { document.title = prevTitle; }, 500);
    });
  }

  // ───────── طبقة البيانات ─────────
  let sb = null;
  if (!DEMO) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };

  const api = DEMO ? window.DemoApi : {
    async session() { return unwrap(await sb.auth.getSession()).session; },
    async signIn(email, password) { return unwrap(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const s = await this.session(); if (!s) return null;
      const rows = unwrap(await sb.from('staff').select('full_name, phone, active').eq('user_id', s.user.id));
      return rows[0] ? { id: s.user.id, email: s.user.email, ...rows[0] } : { id: s.user.id, email: s.user.email, notStaff: true };
    },
    async listRequests() {
      return unwrap(await sb.from('requests')
        .select('id, serial, created_at, started_at, referral_no, case_type, specialty, hospital_name, outcome, updated_at, responses(party_type, party_label, opened_at, submitted_at, revoked_at)')
        .order('created_at', { ascending: false }).limit(1000));
    },
    async getRequest(id) {
      const req = unwrap(await sb.from('requests').select('*').eq('id', id).single());
      const responses = unwrap(await sb.from('responses').select('*').eq('request_id', id).order('created_at'));
      const events = unwrap(await sb.from('request_events').select('*').eq('request_id', id).order('at'));
      return { req, responses, events };
    },
    async createRequest(fields) { return unwrap(await sb.from('requests').insert(fields).select('*').single()); },
    async updateRequest(id, fields) { return unwrap(await sb.from('requests').update(fields).eq('id', id).select('*').single()); },
    async createResponse(fields) { return unwrap(await sb.from('responses').insert(fields).select('*').single()); },
    async revokeResponse(id) { return unwrap(await sb.from('responses').update({ revoked_at: new Date().toISOString() }).eq('id', id)); },
    async addNote(request_id, detail) { return unwrap(await sb.from('request_events').insert({ request_id, kind: 'note', detail })); },
    async getForm(token) { return unwrap(await sb.rpc('get_response_form', { p_token: token })); },
    async submitForm(token, f) {
      return unwrap(await sb.rpc('submit_response', {
        p_token: token, p_responder_name: f.responder_name, p_responder_title: f.responder_title,
        p_medical_opinion: f.medical_opinion, p_action_taken: f.action_taken, p_statement: f.statement, p_signature: f.signature,
      }));
    },
    subscribe(onChange) {
      const ch = sb.channel('changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'responses' }, onChange)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'request_events' }, onChange)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };

  window.App = {
    DEMO, OUTCOMES, PARTIES, SPECIALTIES, DEFAULT_SUPERVISOR_PHONE,
    $, $$, esc, fmtDate, fmtTime, fmtDateTime, toLocalInput, fromLocalInput, serialLabel, outcomeClass, pill,
    toast, errText, waLink, copyText, respondUrl, inviteText,
    openSignaturePad, bindSignatureBox, renderPrintSheet, printSheet, api,
  };
})();

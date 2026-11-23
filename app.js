'use strict';

/* =========================================================
   مكتب المدير — نظام إدارة أعمال المدير والشركات التابعة
   البيانات محفوظة في المتصفح (localStorage) على الجهاز ده.
   ========================================================= */

const STORE_KEY = 'execsys_v1';
const TZ = 'Africa/Cairo';

const DEFAULT_COMPANIES = [
  { id: 'law', name: 'مكتب المحاماة', color: '#1e5aa8' },
  { id: 'amathel', name: 'شركة أماثل العقارية', color: '#b8860b' },
  { id: 'personal', name: 'شخصي للمدير', color: '#6a4c93' },
];

const PRIORITIES = [
  { v: 'normal', l: 'عادي' },
  { v: 'important', l: 'مهم' },
  { v: 'urgent', l: 'عاجل 🔥' },
];

/* ---------------- helpers ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => {
  const u = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(b) - u(a)) / 86400000);
};
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function fmtDate(s) {
  if (!s) return '';
  const d = parseD(s);
  return `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
function fmtTime(t) {
  if (!t) return '';
  let [h, mi] = t.split(':').map(Number);
  const ap = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h}:${pad(mi)} ${ap}`;
}
function relDay(s) {
  if (!s) return '';
  const n = daysBetween(todayStr(), s);
  const dw = (k) => (k >= 3 && k <= 10 ? 'أيام' : 'يوماً');
  if (n === 0) return 'اليوم';
  if (n === 1) return 'غداً';
  if (n === -1) return 'أمس';
  if (n === 2) return 'بعد غد';
  if (n === -2) return 'أول أمس';
  if (n > 2) return `بعد ${n} ${dw(n)}`;
  return `منذ ${-n} ${dw(-n)}`;
}
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const money = (v) => (v ? Number(v).toLocaleString('ar-EG') + ' ج.م' : '');

/* ---------------- modules ---------------- */
const MODULES = {
  meetings: {
    label: 'الاجتماعات والمواعيد', one: 'موعد', icon: '📅', dateField: 'date', timeField: 'time', warnDays: 1,
    done: ['تم', 'ملغى'],
    fields: [
      { k: 'title', l: 'الموضوع', req: 1, list: 1 },
      { k: 'type', l: 'النوع', t: 'select', opts: ['اجتماع', 'موعد', 'مكالمة', 'زيارة', 'عن بُعد (Zoom/Meet)'], list: 1 },
      { k: 'date', l: 'التاريخ', t: 'date', req: 1, list: 1 },
      { k: 'time', l: 'الساعة', t: 'time', list: 1 },
      { k: 'with', l: 'مع من', list: 1 },
      { k: 'location', l: 'المكان / الرابط' },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['مجدول', 'مؤكد', 'تم', 'مؤجل', 'ملغى'], list: 1 },
      { k: 'notes', l: 'ملاحظات / أجندة الاجتماع', t: 'textarea' },
    ],
    msg: (i) => `تذكير: ${i.type || 'اجتماع'} "${i.title}"\nيوم ${fmtDate(i.date)}${i.time ? ' الساعة ' + fmtTime(i.time) : ''}${i.with ? '\nمع: ' + i.with : ''}${i.location ? '\nالمكان: ' + i.location : ''}`,
  },
  cases: {
    label: 'القضايا والجلسات', one: 'قضية', icon: '⚖️', dateField: 'nextHearing', warnDays: 3,
    done: ['صدر الحكم', 'مشطوبة', 'منتهية'],
    fields: [
      { k: 'caseNo', l: 'رقم القضية / السنة', list: 1 },
      { k: 'title', l: 'موضوع القضية', req: 1, list: 1 },
      { k: 'client', l: 'الموكل', list: 1 },
      { k: 'opponent', l: 'الخصم' },
      { k: 'court', l: 'المحكمة', list: 1 },
      { k: 'circuit', l: 'الدائرة' },
      { k: 'nextHearing', l: 'الجلسة القادمة', t: 'date', list: 1 },
      { k: 'lawyer', l: 'المحامي المسؤول', list: 1 },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['متداولة', 'محجوزة للحكم', 'خبير', 'استئناف', 'صدر الحكم', 'مشطوبة', 'منتهية'], list: 1 },
      { k: 'notes', l: 'آخر قرار / المطلوب للجلسة القادمة', t: 'textarea' },
    ],
    msg: (i) => `تذكير جلسة: ${i.caseNo ? 'قضية رقم ' + i.caseNo + ' - ' : ''}${i.title}${i.court ? '\nالمحكمة: ' + i.court : ''}${i.circuit ? ' - الدائرة ' + i.circuit : ''}${i.nextHearing ? '\nالجلسة: ' + fmtDate(i.nextHearing) : ''}${i.lawyer ? '\nالمحامي: ' + i.lawyer : ''}${i.notes ? '\nالمطلوب: ' + i.notes : ''}`,
  },
  travel: {
    label: 'الرحلات', one: 'رحلة', icon: '✈️', dateField: 'departDate', warnDays: 3,
    done: ['عاد', 'ملغاة'],
    fields: [
      { k: 'destination', l: 'الوجهة', req: 1, list: 1 },
      { k: 'purpose', l: 'الغرض', list: 1 },
      { k: 'departDate', l: 'تاريخ السفر', t: 'date', req: 1, list: 1 },
      { k: 'returnDate', l: 'تاريخ العودة', t: 'date', list: 1 },
      { k: 'flight', l: 'الطيران / رقم الرحلة' },
      { k: 'hotel', l: 'الفندق' },
      { k: 'visa', l: 'التأشيرة', t: 'select', opts: ['غير مطلوبة', 'قيد الإجراء', 'جاهزة'], list: 1 },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['قيد التحضير', 'الحجز مؤكد', 'في السفر', 'عاد', 'ملغاة'], list: 1 },
      { k: 'notes', l: 'ملاحظات (مستندات، مواعيد هناك...)', t: 'textarea' },
    ],
    msg: (i) => `رحلة إلى ${i.destination}${i.purpose ? ' (' + i.purpose + ')' : ''}\nالسفر: ${fmtDate(i.departDate)}${i.returnDate ? '\nالعودة: ' + fmtDate(i.returnDate) : ''}${i.flight ? '\nالطيران: ' + i.flight : ''}${i.hotel ? '\nالفندق: ' + i.hotel : ''}`,
  },
  contracts: {
    label: 'العقود', one: 'عقد', icon: '📝', dateField: 'endDate', warnDays: 30,
    done: ['منتهي', 'ملغى'],
    fields: [
      { k: 'title', l: 'اسم العقد', req: 1, list: 1 },
      { k: 'party', l: 'الطرف الثاني', list: 1 },
      { k: 'type', l: 'النوع', t: 'select', opts: ['بيع', 'إيجار', 'خدمات', 'توكيل', 'شراكة', 'أتعاب محاماة', 'أخرى'], list: 1 },
      { k: 'value', l: 'القيمة (ج.م)', t: 'number', list: 1 },
      { k: 'startDate', l: 'تاريخ البداية', t: 'date' },
      { k: 'endDate', l: 'تاريخ الانتهاء', t: 'date', list: 1 },
      { k: 'renewal', l: 'التجديد', t: 'select', opts: ['يدوي', 'تلقائي', 'بدون تجديد'] },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['مسودة', 'قيد المراجعة', 'بانتظار التوقيع', 'ساري', 'منتهي', 'ملغى'], list: 1 },
      { k: 'notes', l: 'ملاحظات / مكان النسخة الأصلية', t: 'textarea' },
    ],
    msg: (i) => `بخصوص عقد "${i.title}"${i.party ? ' مع ' + i.party : ''}${i.endDate ? '\nينتهي في: ' + fmtDate(i.endDate) : ''}\nالحالة: ${i.status || ''}${i.value ? '\nالقيمة: ' + money(i.value) : ''}`,
  },
  approvals: {
    label: 'الموافقات', one: 'طلب موافقة', icon: '✍️', dateField: 'dueDate', warnDays: 1,
    done: ['تمت الموافقة', 'مرفوض'],
    fields: [
      { k: 'title', l: 'الطلب', req: 1, list: 1 },
      { k: 'requestedBy', l: 'مقدم من', list: 1 },
      { k: 'reqDate', l: 'تاريخ الطلب', t: 'date' },
      { k: 'dueDate', l: 'مطلوب قبل', t: 'date', list: 1 },
      { k: 'amount', l: 'المبلغ (إن وجد)', t: 'number', list: 1 },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['بانتظار المدير', 'يحتاج تعديلاً', 'تمت الموافقة', 'مرفوض'], list: 1 },
      { k: 'notes', l: 'التفاصيل / رد المدير', t: 'textarea' },
    ],
    msg: (i) => `طلب موافقة: ${i.title}${i.requestedBy ? '\nمقدم من: ' + i.requestedBy : ''}${i.amount ? '\nالمبلغ: ' + money(i.amount) : ''}${i.dueDate ? '\nمطلوب قبل: ' + fmtDate(i.dueDate) : ''}${i.notes ? '\n' + i.notes : ''}`,
  },
  tasks: {
    label: 'التنبيهات والمهام', one: 'تنبيه', icon: '🔔', dateField: 'dueDate', timeField: 'time', warnDays: 1,
    done: ['منجزة', 'ملغاة'],
    fields: [
      { k: 'title', l: 'المهمة / التنبيه', req: 1, list: 1 },
      { k: 'dueDate', l: 'الموعد', t: 'date', list: 1 },
      { k: 'time', l: 'الساعة', t: 'time', list: 1 },
      { k: 'assignee', l: 'المسؤول', list: 1 },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['مفتوحة', 'جارية', 'منجزة', 'ملغاة'], list: 1 },
      { k: 'notes', l: 'تفاصيل', t: 'textarea' },
    ],
    msg: (i) => `تنبيه: ${i.title}${i.dueDate ? '\nالموعد: ' + fmtDate(i.dueDate) : ''}${i.time ? ' الساعة ' + fmtTime(i.time) : ''}${i.notes ? '\n' + i.notes : ''}`,
  },
  calls: {
    label: 'المكالمات والزوار', one: 'مكالمة / زيارة', icon: '📞', titleKey: 'caller', dateField: 'date', timeField: 'time', warnDays: 0,
    done: ['تم الرد', 'لا تحتاج رداً'],
    defaults: () => ({ date: todayStr(), time: nowHM(), forWhom: 'المدير', kind: 'مكالمة واردة' }),
    fields: [
      { k: 'caller', l: 'اسم المتصل / الزائر', req: 1, list: 1 },
      { k: 'kind', l: 'النوع', t: 'select', opts: ['مكالمة واردة', 'زيارة', 'رسالة واتساب', 'بريد إلكتروني', 'مكالمة صادرة'], list: 1 },
      { k: 'phone', l: 'رقم الهاتف (بمفتاح الدولة 20...)', t: 'tel', list: 1 },
      { k: 'date', l: 'التاريخ', t: 'date', req: 1, list: 1 },
      { k: 'time', l: 'الساعة', t: 'time', list: 1 },
      { k: 'forWhom', l: 'المطلوب', list: 1 },
      { k: 'status', l: 'الحالة', t: 'select', opts: ['بانتظار الرد', 'تم الرد', 'لا تحتاج رداً'], list: 1 },
      { k: 'notes', l: 'الرسالة / الموضوع', t: 'textarea' },
    ],
    msg: (i) => `رسالة: ${i.kind || 'مكالمة'} من ${i.caller}${i.phone ? '\nرقم الهاتف: ' + i.phone : ''}${i.date ? '\n' + fmtDate(i.date) : ''}${i.time ? ' الساعة ' + fmtTime(i.time) : ''}${i.notes ? '\nالموضوع: ' + i.notes : ''}${i.status === 'بانتظار الرد' ? '\n⚠️ بانتظار الرد' : ''}`,
  },
  contacts: {
    label: 'جهات الاتصال', one: 'جهة اتصال', icon: '👥', titleKey: 'name', noPriority: true, done: [],
    fields: [
      { k: 'name', l: 'الاسم', req: 1, list: 1 },
      { k: 'role', l: 'الصفة / الجهة', list: 1 },
      { k: 'phone', l: 'الجوال / واتساب (بمفتاح الدولة 20...)', t: 'tel', list: 1 },
      { k: 'email', l: 'البريد الإلكتروني', t: 'email', list: 1 },
      { k: 'notes', l: 'ملاحظات', t: 'textarea' },
    ],
    msg: (i) => '',
  },
};

/* ---------------- old value migration ---------------- */
const OLD2NEW = {
  'اتلغى': 'ملغى', 'اتأكد': 'مؤكد', 'اتأجل': 'مؤجل', 'اتحكم فيها': 'صدر الحكم', 'رجع': 'عاد', 'اتلغت': 'ملغاة',
  'مش محتاج': 'غير مطلوبة', 'تحت الإجراء': 'قيد الإجراء', 'بنحضّر': 'قيد التحضير', 'الحجز اتأكد': 'الحجز مؤكد', 'مسافر': 'في السفر',
  'مفيش تجديد': 'بدون تجديد', 'تحت المراجعة': 'قيد المراجعة', 'مستني توقيع': 'بانتظار التوقيع', 'اتوافق': 'تمت الموافقة', 'اترفض': 'مرفوض',
  'مستني المدير': 'بانتظار المدير', 'محتاج تعديل': 'يحتاج تعديلاً', 'خلص': 'منجزة', 'مفتوح': 'مفتوحة', 'جاري': 'جارية',
  'اترد عليها': 'تم الرد', 'مش محتاجة رد': 'لا تحتاج رداً', 'محتاج يترد عليه': 'بانتظار الرد', 'أونلاين (Zoom/Meet)': 'عن بُعد (Zoom/Meet)',
  'ميعاد': 'موعد', 'إيميل': 'بريد إلكتروني',
};
function normItem(mod, i) {
  for (const f of MODULES[mod].fields) {
    if (f.t !== 'select' || !i[f.k] || f.opts.includes(i[f.k])) continue;
    const m = OLD2NEW[i[f.k]];
    if (m && f.opts.includes(m)) i[f.k] = m;
    else if (i[f.k] === 'اتلغى' && f.opts.includes('ملغاة')) i[f.k] = 'ملغاة';
  }
  return i;
}

/* ---------------- storage ----------------
   وضعين:
   - cloud: لما الصفحة تتفتح كـ Artifact على claude.ai — البيانات في قاعدة بيانات أونلاين
            ومتزامنة على كل الأجهزة (claude.use("db")).
   - local: لما تتفتح كملف على الجهاز — البيانات في localStorage.
------------------------------------------- */
function emptyItems() { const o = {}; for (const k in MODULES) o[k] = []; return o; }
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
function loadLocal() {
  try {
    const d = JSON.parse(lsGet(STORE_KEY));
    if (d && Array.isArray(d.companies)) {
      d.items = d.items || {};
      for (const k in MODULES) d.items[k] = (d.items[k] || []).map((i) => normItem(k, i));
      d.attachments = Array.isArray(d.attachments) ? d.attachments : [];
      return d;
    }
  } catch (e) { /* ignore broken data */ }
  return { companies: structuredClone(DEFAULT_COMPANIES), items: emptyItems(), attachments: [] };
}
let DB = { companies: structuredClone(DEFAULT_COMPANIES), items: emptyItems(), attachments: [] };
const Store = { mode: 'local', db: null, ready: false };
function saveLocal() { lsSet(STORE_KEY, JSON.stringify(DB)); }

const VALID_ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const cleanId = (id) => (VALID_ID.test(String(id || '')) && id !== '.' && id !== '..' ? String(id) : uid());

function dbErrMsg(e) {
  const c = e && e.code;
  if (c === 'quota_exceeded') return 'المساحة ممتلئة — احذف بعض العناصر القديمة وحاول مرة أخرى';
  if (c === 'invalid_argument' || c === 'not_granted') return 'ليست لديك صلاحية التعديل هنا';
  if (c === 'revoked') return 'تم سحب الصلاحية — أعد فتح الصفحة';
  return 'حدثت مشكلة أثناء الحفظ — تحقّق من الاتصال وحاول مرة أخرى';
}
async function safe(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { console.error(e); toast(dbErrMsg(e)); return false; }
}

async function putItem(mod, obj) {
  obj = { ...obj, id: cleanId(obj.id) };
  if (Store.mode === 'cloud') {
    const { id, ...body } = obj;
    await Store.db.collection(mod).doc(id).set(body);
  } else {
    const arr = DB.items[mod];
    const ix = arr.findIndex((x) => x.id === obj.id);
    if (ix < 0) arr.push(obj); else arr[ix] = obj;
    saveLocal(); render();
  }
}
async function removeItem(mod, id) {
  if (Store.mode === 'cloud') await Store.db.collection(mod).doc(id).delete();
  else { DB.items[mod] = DB.items[mod].filter((x) => x.id !== id); saveLocal(); render(); }
}
async function putCompanies(list) {
  if (Store.mode === 'cloud') await Store.db.doc('config/main').set({ companies: list });
  else { DB.companies = list; saveLocal(); render(); }
}
async function replaceAll(data) {
  if (Store.mode !== 'cloud') { DB = { ...data, attachments: DB.attachments || [] }; saveLocal(); render(); return; }
  await putCompanies(data.companies);
  for (const mod in MODULES) {
    const keep = new Set(data.items[mod].map((i) => cleanId(i.id)));
    for (const old of DB.items[mod]) if (!keep.has(old.id)) await removeItem(mod, old.id);
    for (const it of data.items[mod]) await putItem(mod, it);
  }
}

function setStatus() {
  const el = $('#syncStatus');
  if (!el) return;
  if (!Store.ready) { el.textContent = '⏳ جارٍ التحميل...'; el.className = 'sync'; return; }
  if (Store.mode === 'cloud') {
    el.textContent = Store.stale ? '⚠️ تعذّر الاتصال' : '☁️ متزامن عبر الإنترنت';
    el.className = 'sync ' + (Store.stale ? 'warn' : 'ok');
  } else { el.textContent = '💾 على هذا الجهاز فقط'; el.className = 'sync'; }
}

async function initStore() {
  let dbApi = null;
  try { if (window.claude && window.claude.use) dbApi = await window.claude.use('db'); } catch { dbApi = null; }
  if (!dbApi) {
    Store.mode = 'local'; DB = loadLocal(); Store.ready = true;
    render(); afterReady(); return;
  }
  Store.mode = 'cloud'; Store.db = dbApi;
  const pending = new Set(['config', 'attachments', ...Object.keys(MODULES)]);
  const timer = setTimeout(() => { if (pending.size) { Store.stale = true; setStatus(); } }, 10000);
  const settle = (k, snap) => {
    if (snap && snap.metadata.fromCache) return;
    pending.delete(k);
    if (!pending.size) {
      clearTimeout(timer); Store.stale = false;
      if (!Store.ready) { Store.ready = true; render(); afterReady(); } else setStatus();
    }
  };
  const onErr = (k) => (e) => { console.error(k, e); Store.stale = true; settle(k); setStatus(); };
  dbApi.doc('config/main').onSnapshot((s) => {
    const d = s.exists ? s.data() : null;
    DB.companies = d && Array.isArray(d.companies) && d.companies.length
      ? d.companies.map((c) => ({ ...c })) : structuredClone(DEFAULT_COMPANIES);
    settle('config', s); render();
  }, onErr('config'));
  dbApi.collection('attachments').onSnapshot((s) => {
    DB.attachments = s.docs.map((d) => ({ ...d.data(), id: d.id }));
    settle('attachments', s); render();
  }, onErr('attachments'));
  Files.api();
  for (const mod in MODULES) {
    dbApi.collection(mod).onSnapshot((s) => {
      DB.items[mod] = s.docs.map((d) => normItem(mod, { ...d.data(), id: d.id }));
      settle(mod, s); render();
    }, onErr(mod));
  }
}

const state = { view: 'lobby', section: 'overview', company: 'all', q: '', filter: 'open', calMonth: '', calDay: '' };

const company = (id) => DB.companies.find((c) => c.id === id) || { id, name: '—', color: '#888' };
const titleOf = (mod, i) => i[MODULES[mod].titleKey || 'title'] || i.destination || '';
const isDone = (mod, i) => MODULES[mod].done.includes(i.status);

function filtered(mod, ignoreSearch) {
  let list = DB.items[mod];
  if (state.company !== 'all') list = list.filter((i) => i.company === state.company);
  const q = state.q.trim().toLowerCase();
  if (q && !ignoreSearch) list = list.filter((i) => Object.values(i).some((v) => String(v).toLowerCase().includes(q)));
  return list;
}

function alertLevel(mod, i) {
  if (isDone(mod, i)) return 'done';
  if (i.priority === 'urgent') return 'urgent';
  const m = MODULES[mod];
  const d = m.dateField && i[m.dateField];
  if (d) {
    const n = daysBetween(todayStr(), d);
    if (n < 0) return 'overdue';
    if (n <= (m.warnDays ?? 2)) return 'soon';
  }
  return '';
}

function sortItems(mod, list) {
  const m = MODULES[mod];
  return [...list].sort((a, b) => {
    const da = isDone(mod, a), db = isDone(mod, b);
    if (da !== db) return da ? 1 : -1;
    if (!m.dateField) return titleOf(mod, a).localeCompare(titleOf(mod, b), 'ar');
    const ka = (a[m.dateField] || '9999') + (a[m.timeField] || '');
    const kb = (b[m.dateField] || '9999') + (b[m.timeField] || '');
    return ka.localeCompare(kb);
  });
}

/* ---------------- links: WhatsApp / Gmail / Calendar ---------------- */
function itemMessage(mod, i) {
  const head = `[${company(i.company).name}]`;
  return `${head}\n${MODULES[mod].msg(i)}`;
}
function waLink(text, phone) {
  const p = (phone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function gmailLink(subject, body, to) {
  return `https://mail.google.com/mail/?view=cm&fs=1${to ? '&to=' + encodeURIComponent(to) : ''}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function calLink(mod, i) {
  const m = MODULES[mod];
  const d = i[m.dateField];
  if (!d) return '';
  const compact = d.replace(/-/g, '');
  let dates;
  const t = m.timeField && i[m.timeField];
  if (t) {
    const [h, mi] = t.split(':').map(Number);
    const endH = h + 1;
    dates = `${compact}T${pad(h)}${pad(mi)}00/${endH > 23 ? compact + 'T235900' : compact + 'T' + pad(endH) + pad(mi) + '00'}`;
  } else if (mod === 'travel' && i.returnDate) {
    dates = `${compact}/${addDays(i.returnDate, 1).replace(/-/g, '')}`;
  } else {
    dates = `${compact}/${addDays(d, 1).replace(/-/g, '')}`;
  }
  const title = `${m.icon} ${titleOf(mod, i)} — ${company(i.company).name}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&ctz=${TZ}&details=${encodeURIComponent(m.msg(i))}${i.location ? '&location=' + encodeURIComponent(i.location) : ''}`;
}

/* ---------------- icons ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  scale: '<path d="M12 3v18M8 21h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  plane: '<path d="M2 16.5 22 9l-2.5-2.5-7 2.5L6 4 4 5l4 6-4 1.5-2-1.5-1 1 2.5 3z"/><path d="M3 21h18"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  approve: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.830l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  brief: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
  wa: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-.8.8a4 4 0 0 1-2.3-2.3l.8-.8-1-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  calplus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  danger: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const MOD_SVG = { meetings: 'calendar', cases: 'scale', travel: 'plane', contracts: 'file', approvals: 'approve', tasks: 'bell', calls: 'phone', contacts: 'users' };
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function hijri(s) {
  try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseD(s)); }
  catch { return ''; }
}
function longDate(s) {
  const d = parseD(s);
  return `${DAYS[d.getDay()]}، ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-ic]').forEach((el) => { el.outerHTML = ic(el.dataset.ic); });
}

/* ---------------- rendering ---------------- */
const CO_ICON = { law: 'scale', amathel: 'building', personal: 'person' };
const coIcon = (c) => CO_ICON[c.id] || 'building';
const ALL_CO = { id: 'all', name: 'جميع الشركات', color: '#145550' };
const spaceCo = () => (state.company === 'all' ? ALL_CO : company(state.company));
const monogram = (name) => (name.replace(/^(شركة|مكتب)\s+/, '').trim().charAt(0) || '•');

function itemsOf(mod, cid) { return cid === 'all' ? DB.items[mod] : DB.items[mod].filter((i) => i.company === cid); }
function openCount(mod) {
  if (mod === 'contacts') return filtered(mod, true).length;
  return filtered(mod, true).filter((i) => !isDone(mod, i)).length;
}
function hotCount(mod) {
  return filtered(mod, true).filter((i) => ['urgent', 'overdue'].includes(alertLevel(mod, i))).length;
}

function coTag(id) {
  const c = company(id);
  return `<span class="co-tag"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>`;
}
function prBadge(p) {
  const pr = PRIORITIES.find((x) => x.v === p) || PRIORITIES[0];
  const label = pr.v === 'urgent' ? 'عاجل' : pr.l;
  return `<span class="badge p-${pr.v}">${pr.v === 'urgent' ? ic('alert', 'sm') : ''}${label}</span>`;
}

function rowActions(mod, i) {
  const a = [];
  if (mod === 'contacts') {
    if (i.phone) a.push(`<a class="icon-btn wa" title="واتساب" href="${waLink('', i.phone)}" target="_blank" rel="noopener">${ic('wa')}</a>`);
    if (i.email) a.push(`<a class="icon-btn mail" title="البريد الإلكتروني" href="${gmailLink('', '', i.email)}" target="_blank" rel="noopener">${ic('mail')}</a>`);
  } else {
    const msg = itemMessage(mod, i);
    if (mod === 'calls' && i.phone) a.push(`<a class="icon-btn wa" title="راسله على واتساب" href="${waLink('', i.phone)}" target="_blank" rel="noopener">${ic('chat')}</a>`);
    a.push(`<a class="icon-btn wa" title="إرسال عبر واتساب" href="${waLink(msg)}" target="_blank" rel="noopener">${ic('wa')}</a>`);
    a.push(`<a class="icon-btn mail" title="إرسال بريد Gmail" href="${gmailLink(`${MODULES[mod].icon} ${titleOf(mod, i)} — ${company(i.company).name}`, msg)}" target="_blank" rel="noopener">${ic('mail')}</a>`);
    const cl = calLink(mod, i);
    if (cl) a.push(`<a class="icon-btn gcal" title="إضافة إلى Google Calendar" href="${cl}" target="_blank" rel="noopener">${ic('calplus')}</a>`);
    a.push(`<button class="icon-btn" title="نسخ النص" data-act="copy" data-mod="${mod}" data-id="${i.id}">${ic('copy')}</button>`);
  }
  a.push(`<button class="icon-btn" title="تعديل" data-act="edit" data-mod="${mod}" data-id="${i.id}">${ic('edit')}</button>`);
  a.push(`<button class="icon-btn del" title="حذف" data-act="del" data-mod="${mod}" data-id="${i.id}">${ic('trash')}</button>`);
  return `<div class="row-actions">${a.join('')}</div>`;
}

/* ---------- shared bits ---------- */
function allEvents() {
  const out = [];
  for (const mod in MODULES) {
    const m = MODULES[mod];
    if (!m.dateField) continue;
    for (const i of filtered(mod, true)) {
      if (isDone(mod, i)) continue;
      out.push({ mod, i, date: i[m.dateField] || '', time: (m.timeField && i[m.timeField]) || '' });
    }
  }
  return out;
}
function eventsOf(cid) {
  const keep = state.company;
  state.company = cid;
  const ev = allEvents();
  state.company = keep;
  return ev;
}
const byDate = (a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00'));

function dateTile(s) {
  if (!s) return '<div class="datetile"><div class="d">—</div><div class="m">بدون</div></div>';
  const d = parseD(s);
  return `<div class="datetile"><div class="d">${d.getDate()}</div><div class="m">${MONTHS[d.getMonth()]}</div></div>`;
}
function evRow(e, extra) {
  const m = MODULES[e.mod];
  const lvl = alertLevel(e.mod, e.i);
  const bits = [`${ic(MOD_SVG[e.mod])} ${m.one}`];
  if (e.date) bits.push(esc(relDay(e.date)));
  if (e.time) bits.push(`${ic('clock')} ${esc(fmtTime(e.time))}`);
  if (extra) bits.push(esc(extra));
  if (state.company === 'all') bits.push(coTag(e.i.company));
  return `<div class="ev ${lvl}" data-act="edit" data-mod="${e.mod}" data-id="${e.i.id}" role="button" tabindex="0">
    ${dateTile(e.date)}
    <div class="body"><div class="t"><span class="tt">${esc(titleOf(e.mod, e.i))}</span>${e.i.priority === 'urgent' ? prBadge('urgent') : ''}</div>
    <div class="meta">${bits.map((b) => `<span>${b}</span>`).join('')}</div></div></div>`;
}

function pulse(cid) {
  const t = todayStr();
  const ev = eventsOf(cid);
  const now = nowHM();
  const agendaEv = ev.filter((e) => e.mod !== 'contracts' && e.mod !== 'calls' && e.date);
  return {
    today: agendaEv.filter((e) => e.date === t),
    hot: ev.filter((e) => e.mod !== 'calls' && (e.i.priority === 'urgent' || (e.date && e.date < t))),
    hearings: ev.filter((e) => e.mod === 'cases' && e.date >= t && e.date <= addDays(t, 7)),
    approvals: ev.filter((e) => e.mod === 'approvals'),
    calls: ev.filter((e) => e.mod === 'calls' && e.i.status === 'بانتظار الرد'),
    contracts: ev.filter((e) => e.mod === 'contracts' && e.date && e.date <= addDays(t, 30)),
    next: agendaEv.filter((e) => e.date > t || (e.date === t && (!e.time || e.time >= now))).sort(byDate)[0],
    open: Object.keys(MODULES).filter((k) => k !== 'contacts').reduce((s, k) => s + itemsOf(k, cid).filter((i) => !isDone(k, i)).length, 0),
  };
}
function sentence(p) {
  const parts = [];
  if (p.today.length) parts.push(`${p.today.length} ${p.today.length === 1 ? 'موعد' : 'مواعيد'} اليوم`);
  if (p.hearings.length) parts.push(`${p.hearings.length} ${p.hearings.length === 1 ? 'جلسة' : 'جلسات'} هذا الأسبوع`);
  if (p.approvals.length) parts.push(`${p.approvals.length} ${p.approvals.length === 1 ? 'موافقة' : 'موافقات'} بانتظار المدير`);
  if (p.calls.length) parts.push(`${p.calls.length} ${p.calls.length === 1 ? 'مكالمة' : 'مكالمات'} بانتظار الرد`);
  if (p.hot.length) parts.push(`${p.hot.length} ${p.hot.length === 1 ? 'عنصر يحتاج' : 'عناصر تحتاج'} إلى متابعة`);
  return parts.length ? parts.join(' · ') : 'كل شيء على ما يرام، لا يوجد ما هو عاجل';
}

/* ---------- lobby: choose a company ---------- */
function renderLobby() {
  const t = todayStr();
  const hour = new Date().getHours();
  const greetWord = hour < 12 ? 'صباح' : 'مساء';
  const h = hijri(t);
  const total = pulse('all');
  const door = (c, idx) => {
    const p = pulse(c.id);
    const nx = p.next;
    return `<button class="door" data-company="${esc(c.id)}" style="--c:${esc(c.color)};--i:${idx}">
      <span class="door-art">${ic(coIcon(c))}</span>
      <span class="door-mark">${ic(coIcon(c))}</span>
      <span class="door-name">${esc(c.name)}</span>
      <span class="door-next">${nx
        ? `<span class="lbl">القادم</span><b>${esc(titleOf(nx.mod, nx.i))}</b><small>${esc(relDay(nx.date))}${nx.time ? ' · ' + esc(fmtTime(nx.time)) : ''}</small>`
        : '<span class="lbl">القادم</span><b class="muted">لا توجد مواعيد قادمة</b><small>&nbsp;</small>'}</span>
      <span class="door-stats">
        <span><b>${p.today.length}</b>اليوم</span>
        <span><b>${p.open}</b>مفتوح</span>
        <span class="${p.hot.length ? 'hot' : ''}"><b>${p.hot.length}</b>للمتابعة</span>
      </span>
      <span class="door-go">دخول ${ic('arrowL')}</span>
    </button>`;
  };
  return `<section class="lobby">
    <div class="lobby-hero">
      <div class="eyebrow"><span class="clock" id="clock">${ic('clock', 'sm')}<b>${esc(fmtTime(nowHM()))}</b></span><span>${longDate(t)}</span>${h ? `<span>${esc(h)}</span>` : ''}</div>
      <h1 class="greet">${greetWord} <span>الخير</span></h1>
      <p class="lede">اختر الشركة التي تريد العمل عليها الآن.</p>
      <div class="lobby-pulse">
        <span class="pulse-dot ${total.hot.length ? 'hot' : ''}"></span>
        <span>${esc(sentence(total))}</span>
        <button class="link-btn" data-company="all">عرض جميع الشركات معاً ${ic('arrowL', 'sm')}</button>
      </div>
    </div>
    <div class="doors">${DB.companies.map(door).join('')}
      <button class="door door-all" data-company="all" style="--c:#145550;--i:${DB.companies.length}">
        <span class="door-art">${ic('home')}</span>
        <span class="door-mark">${ic('week')}</span>
        <span class="door-name">جميع الشركات</span>
        <span class="door-next"><span class="lbl">نظرة شاملة</span><b>الأجندة كاملة في مكان واحد</b><small>${esc(sentence(total))}</small></span>
        <span class="door-go">دخول ${ic('arrowL')}</span>
      </button>
    </div>
  </section>`;
}

/* ---------- company space ---------- */
const SHORT = { meetings: 'المواعيد', cases: 'القضايا', travel: 'الرحلات', contracts: 'العقود', approvals: 'الموافقات', tasks: 'المهام', calls: 'المكالمات', contacts: 'جهات الاتصال' };
function sectionList() {
  return [['overview', 'home', 'نظرة عامة'], ['calendar', 'week', 'التقويم'], ['attachments', 'clip', 'المرفقات'], ...Object.keys(MODULES).map((k) => [k, MOD_SVG[k], SHORT[k] || MODULES[k].label])];
}
function renderSpace() {
  const c = spaceCo();
  const p = pulse(state.company);
  const sec = state.section || 'overview';
  const others = [ALL_CO, ...DB.companies].filter((x) => x.id !== c.id);
  const body = sec === 'overview' ? renderOverview(p) : sec === 'calendar' ? renderCalendar() : sec === 'attachments' ? renderAttachments() : renderSection(sec);
  return `<section class="space" style="--c:${esc(c.color)}">
    <header class="space-head">
      <button class="back-round" data-view="lobby" title="العودة إلى الشركات" aria-label="العودة إلى الشركات">${ic('arrowR')}</button>
      <div class="space-title">
        <span class="space-mark">${ic(c.id === 'all' ? 'week' : coIcon(c))}</span>
        <div class="space-name"><h1>${esc(c.name)}</h1><p>${esc(sentence(p))}</p></div>
      </div>
      <div class="space-stats">
        <span class="stat-pill"><b>${p.today.length}</b>اليوم</span>
        <span class="stat-pill"><b>${p.open}</b>مفتوح</span>
        <span class="stat-pill ${p.hot.length ? 'is-hot' : ''}"><b>${p.hot.length}</b>للمتابعة</span>
        <span class="stat-pill"><b>${p.approvals.length}</b>بانتظار المدير</span>
      </div>
      <div class="space-actions">
        <label class="switcher" title="الانتقال إلى شركة أخرى">${ic('building', 'sm')}<select class="switch-select" aria-label="الانتقال إلى شركة أخرى">
          <option value="" selected disabled>انتقال إلى…</option>
          ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}
        </select></label>
        <button class="btn on-dark icon-only" data-act="brief" title="ملخص اليوم" aria-label="ملخص اليوم">${ic('brief')}</button>
        <button class="btn on-dark solid" data-act="add">${ic('plus')}<span>${sec === 'attachments' ? 'رفع مرفقات' : MODULES[sec] ? 'إضافة ' + MODULES[sec].one : 'إضافة'}</span></button>
      </div>
    </header>
    <nav class="sections" aria-label="الأقسام">${sectionList().map(([k, icon, l]) => {
      const n = k === 'attachments' ? attOf(state.company).length : MODULES[k] ? openCount(k) : 0;
      const hot = MODULES[k] && k !== 'contacts' && hotCount(k) > 0;
      return `<button class="sec-tab ${sec === k ? 'active' : ''}" data-section="${k}">${ic(icon)}<span>${l}</span>${n ? `<span class="n ${hot ? 'hot' : ''}">${n}</span>` : ''}</button>`;
    }).join('')}</nav>
    <div class="space-body">${body}</div>
  </section>`;
}

function agendaItem(e) {
  const m = MODULES[e.mod];
  const i = e.i;
  const lvl = alertLevel(e.mod, i);
  const meta = [];
  if (i.with) meta.push(`مع ${i.with}`);
  if (e.mod === 'cases') { if (i.court) meta.push(i.court); if (i.caseNo) meta.push(`رقم ${i.caseNo}`); }
  if (e.mod === 'travel' && i.purpose) meta.push(i.purpose);
  if (i.location) meta.push(i.location);
  if (i.requestedBy) meta.push(`من ${i.requestedBy}`);
  if (i.assignee) meta.push(i.assignee);
  return `<article class="ag ${lvl}" data-act="edit" data-mod="${e.mod}" data-id="${i.id}" role="button" tabindex="0">
    <div class="ag-time">${e.time ? `<b>${esc(fmtTime(e.time).replace(/ [صم]$/, ''))}</b><small>${fmtTime(e.time).slice(-1) === 'ص' ? 'صباحاً' : 'مساءً'}</small>` : '<b class="allday">طوال اليوم</b>'}</div>
    <div class="ag-line"><span class="ag-dot">${ic(MOD_SVG[e.mod])}</span></div>
    <div class="ag-body">
      <div class="ag-kind">${m.one}${state.company === 'all' ? ` · ${coTag(i.company)}` : ''}</div>
      <h4>${esc(titleOf(e.mod, i))}</h4>
      ${meta.length ? `<p>${esc(meta.join(' · '))}</p>` : ''}
    </div>
    <div class="ag-flags">${i.priority === 'urgent' ? prBadge('urgent') : i.priority === 'important' ? prBadge('important') : ''}${i.status ? `<span class="badge">${esc(i.status)}</span>` : ''}</div>
  </article>`;
}
function miniRow(e, extra) {
  return `<div class="mini ${alertLevel(e.mod, e.i)}" data-act="edit" data-mod="${e.mod}" data-id="${e.i.id}" role="button" tabindex="0">
    <span class="mini-ic">${ic(MOD_SVG[e.mod])}</span>
    <div class="mini-body"><b>${esc(titleOf(e.mod, e.i))}</b><small>${esc([e.date ? relDay(e.date) : '', extra || ''].filter(Boolean).join(' · '))}${state.company === 'all' ? ' · ' + esc(company(e.i.company).name) : ''}</small></div>
  </div>`;
}
function noteCard(icon, title, list, emptyMsg, extraFn, cls = '') {
  return `<section class="note-card ${cls}"><h3>${ic(icon)}<span>${title}</span>${list.length ? `<span class="pill">${list.length}</span>` : ''}</h3>
    ${list.length ? list.slice(0, 5).map((e) => miniRow(e, extraFn && extraFn(e))).join('') : `<p class="calm">${ic('check', 'sm')}${emptyMsg}</p>`}</section>`;
}

function dayItemsHtml(g) {
  if (g.date !== todayStr()) return g.items.map(agendaItem).join('');
  const now = nowHM();
  let placed = false;
  const parts = [];
  for (const e of g.items) {
    if (!placed && e.time && e.time >= now) { parts.push(nowLine(now)); placed = true; }
    parts.push(agendaItem(e));
  }
  if (!placed) parts.push(nowLine(now));
  return parts.join('');
}
const nowLine = (now) => `<div class="now-line" aria-label="الوقت الحالي"><span>الآن · ${esc(fmtTime(now))}</span></div>`;

function renderOverview(p) {
  const t = todayStr();
  const ev = allEvents().filter((e) => e.mod !== 'contracts' && e.mod !== 'calls' && e.date && e.date >= t && e.date <= addDays(t, 13)).sort(byDate);
  const groups = [];
  for (const e of ev) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e); else groups.push({ date: e.date, items: [e] });
  }
  const dayName = (s) => { const n = daysBetween(t, s); return n === 0 ? 'اليوم' : n === 1 ? 'غداً' : DAYS[parseD(s).getDay()]; };
  const agenda = groups.length
    ? groups.map((g) => `<div class="day ${g.date === t ? 'is-today' : ''}">
        <div class="day-label"><b>${dayName(g.date)}</b><span>${parseD(g.date).getDate()} ${MONTHS[parseD(g.date).getMonth()]}</span></div>
        <div class="day-items">${dayItemsHtml(g)}</div></div>`).join('')
    : `<div class="agenda-empty"><span class="big">${ic('calendar')}</span><b>لا توجد مواعيد خلال الأسبوعين القادمين</b><span>أضف موعداً أو جلسة وستظهر هنا مرتبة حسب اليوم والساعة</span><button class="btn primary" data-act="add" data-mod="meetings">${ic('plus')}موعد جديد</button></div>`;
  return `<div class="overview">
    <div class="agenda-col">
      <div class="col-head"><h2>الأجندة</h2><span>الأسبوعان القادمان</span></div>
      <div class="agenda">${agenda}</div>
    </div>
    <aside class="side-col">
      ${noteCard('alert', 'تحتاج إلى متابعة', p.hot.sort(byDate), 'لا توجد عناصر متأخرة أو عاجلة', null, 'hot')}
      ${noteCard('approve', 'بانتظار موافقة المدير', p.approvals.sort(byDate), 'لا توجد موافقات معلّقة', (e) => (e.i.amount ? money(e.i.amount) : ''))}
      ${noteCard('phone', 'مكالمات بانتظار الرد', p.calls.sort(byDate), 'لا توجد مكالمات معلّقة', (e) => e.i.notes || '')}
      ${noteCard('file', 'عقود تقترب من الانتهاء', p.contracts.sort(byDate), 'لا توجد عقود تنتهي قريباً', (e) => e.i.party || '')}
    </aside>
  </div>`;
}

/* ---------- module section as cards ---------- */
function fmtVal(f, v) {
  if (f.t === 'date') return esc(fmtDate(v));
  if (f.t === 'time') return esc(fmtTime(v));
  if (f.t === 'number') return esc(money(v));
  if (f.k === 'phone') return `<a href="${waLink('', v)}" target="_blank" rel="noopener" dir="ltr">${esc(v)}</a>`;
  if (f.k === 'email') return `<a href="${gmailLink('', '', v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
  return esc(v);
}
function itemCard(mod, i) {
  const m = MODULES[mod];
  const lvl = alertLevel(mod, i);
  const date = m.dateField && i[m.dateField];
  const time = m.timeField && i[m.timeField];
  const skip = ['status', m.dateField, m.timeField, m.titleKey || 'title', mod === 'travel' ? 'destination' : ''];
  const facts = m.fields.filter((f) => f.t !== 'textarea' && !skip.includes(f.k) && i[f.k]);
  const done = isDone(mod, i);
  return `<article class="card ${lvl}">
    <div class="card-top">
      ${mod === 'contacts' ? `<span class="avatar" style="--c:${esc(company(i.company).color)}">${esc((i.name || '?').trim().charAt(0))}</span>` : dateTile(date)}
      <div class="card-main">
        <h4 data-act="edit" data-mod="${mod}" data-id="${i.id}" title="${esc(titleOf(mod, i))}">${esc(titleOf(mod, i))}</h4>
        <div class="card-sub">${date ? `<span>${esc(relDay(date))}</span>` : ''}${time ? `<span>${ic('clock', 'sm')}${esc(fmtTime(time))}</span>` : ''}${state.company === 'all' ? coTag(i.company) : ''}</div>
        <div class="card-badges">${i.status ? `<span class="badge ${done ? 'st-done' : ''}">${esc(i.status)}</span>` : ''}${!m.noPriority && i.priority && i.priority !== 'normal' ? prBadge(i.priority) : ''}</div>
      </div>
    </div>
    ${facts.length ? `<dl class="facts">${facts.map((f) => `<div><dt>${esc(f.l.replace(/\s*\(.*\)$/, ''))}</dt><dd>${fmtVal(f, i[f.k])}</dd></div>`).join('')}</dl>` : ''}
    ${i.notes ? `<p class="card-notes">${esc(i.notes)}</p>` : ''}
    <div class="card-foot">
      ${m.done.length && !done ? `<button class="done-btn" data-act="done" data-mod="${mod}" data-id="${i.id}">${ic('check', 'sm')}${esc(m.done[0])}</button>` : '<span></span>'}
      ${rowActions(mod, i)}
    </div>
  </article>`;
}
function renderSection(mod) {
  const m = MODULES[mod];
  const all = sortItems(mod, filtered(mod));
  const open = all.filter((i) => !isDone(mod, i)).length;
  const FILTERS = [
    ['open', 'المفتوحة', (i) => !isDone(mod, i)],
    ['hot', 'العاجل والمتأخر', (i) => ['urgent', 'overdue'].includes(alertLevel(mod, i))],
    ['done', 'المنجزة', (i) => isDone(mod, i)],
    ['all', 'الكل', () => true],
  ];
  const useTabs = mod !== 'contacts' && all.length > 0;
  const fl = FILTERS.find((x) => x[0] === state.filter) || FILTERS[0];
  const rows = useTabs ? all.filter(fl[2]) : all;
  const head = `<div class="sec-head"><div><h2>${m.label}</h2><p>${mod === 'contacts' ? `${all.length} جهة اتصال` : `${open} مفتوح من أصل ${all.length}`}</p></div>
    <div class="sec-tools">${useTabs ? `<div class="tabs">${FILTERS.map(([k, l, fn]) => `<button class="tab ${fl[0] === k ? 'active' : ''}" data-filter="${k}">${l}<span class="pill">${all.filter(fn).length}</span></button>`).join('')}</div>` : ''}
    <button class="btn" data-act="csv" data-mod="${mod}">${ic('download')}Excel</button></div></div>`;
  if (!all.length) {
    return head + `<div class="agenda-empty"><span class="big">${ic(MOD_SVG[mod])}</span><b>لا توجد ${m.label} بعد</b><span>ابدأ بإضافة أول ${m.one}</span><button class="btn primary" data-act="add" data-mod="${mod}">${ic('plus')}إضافة ${m.one}</button></div>`;
  }
  if (!rows.length) return head + `<div class="agenda-empty"><span class="big">${ic('check')}</span><b>لا توجد عناصر</b><span>لا توجد ${m.label} ضمن هذا الفلتر</span></div>`;
  return head + `<div class="cards">${rows.map((i) => itemCard(mod, i)).join('')}</div>`;
}

/* ---------- search ---------- */
function renderSearch() {
  const groups = Object.keys(MODULES).map((mod) => [mod, sortItems(mod, filtered(mod))]).filter(([, r]) => r.length);
  const attHits = attOf(state.company).map((a) => [a, attMatches(a, state.q.trim())]).filter(([, m]) => m.ok);
  const total = groups.reduce((s, [, r]) => s + r.length, 0) + attHits.length;
  return `<section class="results">
    <div class="sec-head"><div><h2>نتائج البحث عن "${esc(state.q)}"</h2><p>${total} نتيجة${state.company !== 'all' ? ' في ' + esc(spaceCo().name) : ' في جميع الشركات'}</p></div>
      <div class="sec-tools"><button class="btn" data-act="clearSearch">${ic('x')}مسح البحث</button></div></div>
    ${attHits.length ? `<h3 class="group-title">${ic('clip')}المرفقات<span class="pill">${attHits.length}</span></h3><div class="files">${attHits.map(([a, m]) => attCard(a, m)).join('')}</div>` : ''}
    ${groups.length ? groups.map(([mod, r]) => `<h3 class="group-title">${ic(MOD_SVG[mod])}${MODULES[mod].label}<span class="pill">${r.length}</span></h3><div class="cards">${r.map((i) => itemCard(mod, i)).join('')}</div>`).join('')
      : attHits.length ? '' : `<div class="agenda-empty"><span class="big">${ic('search')}</span><b>لا توجد نتائج</b><span>جرّب كلمة أخرى</span></div>`}
  </section>`;
}

/* ---------- daily / weekly brief ---------- */
function buildBrief(range = 'day') {
  const t = todayStr();
  const tm = addDays(t, 1);
  const end = addDays(t, 6);
  const multi = state.company === 'all';
  const cf = (id) => (multi ? ` (${company(id).name})` : '');
  const L = range === 'week'
    ? [`📅 تقرير الأسبوع: من ${fmtDate(t)} إلى ${fmtDate(end)}`]
    : [`📋 ملخص يوم ${fmtDate(t)}`];
  if (!multi) L.push(company(state.company).name);
  const head = L.length;
  const sec = (title, arr) => { if (arr.length) L.push('', title, ...arr); };
  const ev = allEvents();
  const line = (e) => `• ${e.time ? fmtTime(e.time) + ' | ' : ''}${titleOf(e.mod, e.i)}${e.i.with ? ' مع ' + e.i.with : ''}${e.mod === 'cases' && e.i.court ? ' — ' + e.i.court : ''}${e.date && e.date !== t ? ' — ' + relDay(e.date) : ''}${cf(e.i.company)}`;
  const lineW = (e) => `• ${fmtDate(e.date)}${e.time ? ' ' + fmtTime(e.time) : ''} | ${titleOf(e.mod, e.i)}${e.i.with ? ' مع ' + e.i.with : ''}${e.mod === 'cases' && e.i.court ? ' — ' + e.i.court : ''}${cf(e.i.company)}`;
  const byDate = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  const pick = (fn) => ev.filter(fn).sort(byDate);
  const callLine = (e) => `• ${e.i.caller}${e.i.kind ? ' (' + e.i.kind + ')' : ''}${e.i.phone ? ' — ' + e.i.phone : ''}${e.i.notes ? ': ' + e.i.notes : ''}${cf(e.i.company)}`;
  const apprLine = (e) => `• ${titleOf('approvals', e.i)}${e.i.amount ? ' — ' + money(e.i.amount) : ''}${e.i.requestedBy ? ' (من ' + e.i.requestedBy + ')' : ''}${cf(e.i.company)}`;
  const contrLine = (e) => `• ${titleOf('contracts', e.i)}${e.i.party ? ' مع ' + e.i.party : ''} — ${fmtDate(e.date)}${cf(e.i.company)}`;
  const callsPending = (e) => e.mod === 'calls' && e.i.status === 'بانتظار الرد';

  if (range === 'week') {
    sec('🚨 العاجل والمتأخر:', pick((e) => e.mod !== 'calls' && (e.i.priority === 'urgent' || (e.date && e.date < t))).map(lineW));
    sec('📅 الاجتماعات والمواعيد:', pick((e) => e.mod === 'meetings' && e.date >= t && e.date <= end).map(lineW));
    sec('⚖️ الجلسات:', pick((e) => e.mod === 'cases' && e.date >= t && e.date <= end).map(lineW));
    sec('✈️ الرحلات:', pick((e) => e.mod === 'travel' && e.date >= t && e.date <= end).map(lineW));
    sec('🔔 المهام المطلوبة:', pick((e) => e.mod === 'tasks' && e.date && e.date <= end).map(lineW));
  } else {
    sec('🚨 عاجل:', pick((e) => e.mod !== 'calls' && e.i.priority === 'urgent').map(line));
    sec('📅 مواعيد اليوم:', pick((e) => e.mod === 'meetings' && e.date === t).map(line));
    sec('⚖️ جلسات اليوم والغد:', pick((e) => e.mod === 'cases' && (e.date === t || e.date === tm)).map(line));
    sec('📅 مواعيد الغد:', pick((e) => e.mod === 'meetings' && e.date === tm).map(line));
    sec('✈️ رحلات خلال 3 أيام:', pick((e) => e.mod === 'travel' && e.date >= t && e.date <= addDays(t, 3)).map(line));
    sec('🔔 مهام مطلوبة اليوم أو متأخرة:', pick((e) => e.mod === 'tasks' && e.date && e.date <= t).map(line));
  }
  sec('📞 مكالمات بانتظار الرد:', pick(callsPending).map(callLine));
  sec('✍️ موافقات بانتظار سيادتكم:', pick((e) => e.mod === 'approvals').map(apprLine));
  sec('📝 عقود تنتهي خلال 30 يوماً:', pick((e) => e.mod === 'contracts' && e.date && e.date <= addDays(t, 30)).map(contrLine));
  if (L.length <= head) L.push('', range === 'week' ? 'الأسبوع هادئ، لا توجد عناصر مسجلة' : 'لا يوجد ما هو عاجل اليوم');
  return L.join('\n');
}

function openBrief(range = 'day') {
  const text = buildBrief(range);
  const subject = range === 'week' ? `تقرير الأسبوع — ${fmtDate(todayStr())}` : `ملخص يوم ${fmtDate(todayStr())}`;
  dlgOnSave = null;
  $('#dlgForm').innerHTML = `<div class="dlg-head"><span class="chipic">${ic('brief')}</span><div style="flex:1"><h3>${range === 'week' ? 'تقرير الأسبوع' : 'ملخص اليوم'}</h3><div class="small">يمكنك تعديل النص قبل إرساله إلى المدير</div></div>
      <div class="tabs" style="margin:0"><button type="button" class="tab ${range === 'day' ? 'active' : ''}" data-act="brief" data-range="day">اليوم</button><button type="button" class="tab ${range === 'week' ? 'active' : ''}" data-act="brief" data-range="week">الأسبوع</button></div><button value="cancel" class="dlg-x" formnovalidate title="إغلاق" aria-label="إغلاق">${ic('x')}</button></div>
    <div class="dlg-body"><textarea class="brief-box" id="briefText">${esc(text)}</textarea></div>
    <div class="dlg-actions">
      <a class="btn wa" id="briefWa" href="${waLink(text)}" target="_blank" rel="noopener">${ic('wa')}إرسال عبر واتساب</a>
      <a class="btn" id="briefMail" href="${gmailLink(subject, text)}" target="_blank" rel="noopener">${ic('mail')}إرسال عبر Gmail</a>
      <button type="button" class="btn" data-act="copyBrief">${ic('copy')}نسخ</button>
      <button value="cancel" class="btn" formnovalidate>إغلاق</button>
    </div>`;
  // لو عدّلت النص قبل الإرسال، اللينكات تتحدث
  $('#briefText').addEventListener('input', (e) => {
    $('#briefWa').href = waLink(e.target.value);
    $('#briefMail').href = gmailLink(subject, e.target.value);
  });
  if (!$('#dlg').open) $('#dlg').showModal();
}

/* ---------- calendar ---------- */
function renderCalendar() {
  const t = todayStr();
  if (!state.calMonth) state.calMonth = t.slice(0, 7);
  if (!state.calDay) state.calDay = t;
  const [y, mo] = state.calMonth.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const offset = (first.getDay() + 1) % 7; // الأسبوع بيبدأ السبت
  const rows = offset + daysInMonth > 35 ? 6 : 5;
  const start = new Date(y, mo - 1, 1 - offset);
  const byDay = {};
  for (const e of allEvents()) if (e.date) (byDay[e.date] = byDay[e.date] || []).push(e);
  for (const k in byDay) byDay[k].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const heads = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  let cells = '';
  for (let n = 0; n < rows * 7; n++) {
    const d = new Date(start); d.setDate(start.getDate() + n);
    const ds = ymd(d);
    const list = byDay[ds] || [];
    const cls = [d.getMonth() !== mo - 1 ? 'out' : '', ds === t ? 'today' : '', ds === state.calDay ? 'sel' : ''].join(' ');
    cells += `<div class="cal-cell ${cls}" data-cal-day="${ds}">
      <div class="cal-num">${d.getDate()}</div>
      <div class="cal-evs">${list.slice(0, 3).map((e) => `<div class="cal-ev ${alertLevel(e.mod, e.i)}" style="--c:${esc(company(e.i.company).color)}" data-act="edit" data-mod="${e.mod}" data-id="${e.i.id}" title="${esc(titleOf(e.mod, e.i))}">${e.time ? `<b>${esc(fmtTime(e.time))}</b> ` : ''}${esc(titleOf(e.mod, e.i))}</div>`).join('')}${list.length > 3 ? `<div class="cal-more">+${list.length - 3} أخرى</div>` : ''}</div>
      ${list.length ? `<div class="cal-dots">${list.slice(0, 4).map((e) => `<span style="background:${esc(company(e.i.company).color)}"></span>`).join('')}</div>` : ''}
    </div>`;
  }
  const dayList = byDay[state.calDay] || [];
  return `<div class="page-head"><div><h2>${ic('week')}التقويم</h2><div class="sub">المواعيد والجلسات والرحلات والعقود والمهام في مكان واحد</div></div>
    <div class="top-actions cal-nav"><button class="btn" data-cal="prev" aria-label="الشهر السابق">${ic('chevR')}</button><div class="cal-title">${MONTHS[mo - 1]} ${y}</div><button class="btn" data-cal="next" aria-label="الشهر التالي">${ic('chevL')}</button><button class="btn" data-cal="today">اليوم</button></div></div>
    <div class="cal"><div class="cal-head">${heads.map((h) => `<div>${h}</div>`).join('')}</div><div class="cal-grid">${cells}</div></div>
    <div class="panel cal-day"><h3><span class="t">${ic('calendar')}${longDate(state.calDay)}</span><button class="btn sm primary" data-act="addOn" data-date="${state.calDay}">${ic('plus')}موعد في هذا اليوم</button></h3>
    ${dayList.length ? dayList.map((e) => evRow(e)).join('') : `<div class="none">${ic('check')}لا توجد عناصر مسجلة في هذا اليوم</div>`}</div>`;
}

/* ---------- settings ---------- */
function renderSettings() {
  const total = Object.values(DB.items).reduce((s, a) => s + a.length, 0);
  return `<div class="page-head"><div><h2>${ic('settings')}الإعدادات والنسخ الاحتياطي</h2><div class="sub">الشركات التابعة للمدير، وحفظ البيانات</div></div></div>
  <div class="set-section"><h3>${ic('building')}الشركات</h3>
    ${DB.companies.map((c) => `<div class="co-row">
      <input type="color" value="${esc(c.color)}" data-co-color="${esc(c.id)}">
      <input type="text" value="${esc(c.name)}" data-co-name="${esc(c.id)}">
      <button class="btn sm danger" data-act="delCo" data-id="${esc(c.id)}">${ic('trash', 'sm')}حذف</button></div>`).join('')}
    <div class="btns"><button class="btn" data-act="addCo">${ic('plus')}إضافة شركة</button></div>
  </div>
  <div class="set-section"><h3>${ic('save')}النسخ الاحتياطي</h3>
    <p class="note">${Store.mode === 'cloud'
      ? `البيانات (${total} عنصراً) محفوظة عبر الإنترنت ومتزامنة على جميع أجهزتك. ومع ذلك يُنصح <b>بتنزيل نسخة احتياطية كل أسبوع</b> وحفظها على Google Drive.`
      : `البيانات (${total} عنصراً) محفوظة في المتصفح على هذا الجهاز فقط. <b>احرص على تنزيل نسخة احتياطية كل أسبوع</b> وحفظها على Google Drive، ويمكنك استعادتها على أي جهاز آخر أو على النسخة الإلكترونية.`}</p>
    <p class="note">ملاحظة: النسخة الاحتياطية تحفظ بيانات المرفقات وأسماءها ومحتواها المستخرج، أما الملفات نفسها فتبقى محفوظة في النظام. احتفظ بنسخ أصلية من المستندات المهمة.</p>
    <div class="btns"><button class="btn primary" data-act="export">${ic('download')}تنزيل نسخة احتياطية</button>
    <button class="btn" data-act="import">${ic('upload')}استعادة من نسخة احتياطية</button></div>
  </div>
  <div class="set-section"><h3>${ic('danger')}منطقة خطر</h3>
    <p class="note">سيؤدي هذا إلى حذف جميع المواعيد والقضايا والعقود وكل البيانات. نزّل نسخة احتياطية أولاً.</p>
    <div class="btns"><button class="btn danger" data-act="wipe">${ic('trash')}حذف جميع البيانات</button></div>
  </div>`;
}

/* ---------- main render ---------- */
function render() {
  setStatus();
  document.body.dataset.screen = state.view;
  if (!Store.ready) { $('#view').innerHTML = `<div class="agenda-empty"><span class="big">${ic('clock')}</span><b>جارٍ تحميل البيانات...</b></div>`; return; }
  const prevBody = document.querySelector('.space-body');
  const keep = { view: $('#view').scrollTop, body: prevBody ? prevBody.scrollTop : 0 };
  let html;
  if (state.q.trim() && state.view !== 'settings') html = renderSearch();
  else if (state.view === 'settings') html = `<section class="plain">${renderSettings()}</section>`;
  else if (state.view === 'space') html = renderSpace();
  else html = renderLobby();
  $('#view').innerHTML = html;
  if (document.querySelector('img[data-lazy-att]')) hydrateAttThumbs();
  // ما تفقدش مكانك في الصفحة لما البيانات تتحدث، إلا لو انتقلت لشاشة تانية
  if (state.nav) {
    state.nav = false; $('#view').scrollTop = 0;
    const first = $('#view').firstElementChild;
    if (first) first.classList.add('enter');
  }
  else {
    $('#view').scrollTop = keep.view;
    const body = document.querySelector('.space-body');
    if (body) body.scrollTop = keep.body;
  }
}

/* ---------------- forms ---------------- */
let dlgOnSave = null;

const PEOPLE_KEYS = ['with', 'client', 'opponent', 'lawyer', 'requestedBy', 'assignee', 'caller', 'party', 'forWhom'];
function peopleOptions() {
  const set = new Set(DB.items.contacts.map((c) => c.name).filter(Boolean));
  for (const mod in MODULES) for (const i of DB.items[mod]) for (const k of PEOPLE_KEYS) if (i[k]) set.add(i[k]);
  return [...set].slice(0, 300).map((n) => `<option value="${esc(n)}"></option>`).join('');
}

function inputHtml(f, val) {
  const name = `name="${f.k}"`;
  const req = f.req ? 'required' : '';
  const v = esc(val ?? '');
  if (f.t === 'select') return `<select ${name} ${req}><option value=""></option>${f.opts.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (f.t === 'company') return `<select ${name} required>${DB.companies.map((c) => `<option value="${esc(c.id)}" ${c.id === val ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  if (f.t === 'priority') return `<select ${name}>${PRIORITIES.map((p) => `<option value="${p.v}" ${p.v === val ? 'selected' : ''}>${p.l}</option>`).join('')}</select>`;
  if (f.t === 'textarea') return `<textarea ${name} ${req}>${v}</textarea>`;
  const people = PEOPLE_KEYS.includes(f.k) ? 'list="dl-people" autocomplete="off"' : '';
  return `<input type="${f.t || 'text'}" ${name} value="${v}" ${req} ${people} ${f.t === 'tel' ? 'dir="ltr"' : ''}>`;
}

function openForm(mod, id, preset) {
  const m = MODULES[mod];
  if (!DB.companies.length) { toast('أضف شركة أولاً من الإعدادات'); return; }
  const existing = id && DB.items[mod].find((x) => x.id === id);
  const statusF = m.fields.find((f) => f.k === 'status');
  const it = existing || {
    company: state.company !== 'all' ? state.company : (mod === 'cases' ? 'law' : DB.companies[0].id),
    priority: 'normal',
    status: statusF ? statusF.opts[0] : '',
    ...(m.defaults ? m.defaults() : {}),
    ...(preset || {}),
  };
  const fields = [{ k: 'company', l: 'الشركة', t: 'company' }, ...m.fields];
  if (!m.noPriority) fields.splice(1, 0, { k: 'priority', l: 'الأولوية', t: 'priority' });
  $('#dlgForm').innerHTML = `<div class="dlg-head"><span class="chipic">${ic(MOD_SVG[mod])}</span><div style="flex:1"><h3>${existing ? 'تعديل' : 'إضافة'} ${m.one}</h3><div class="small">${m.label}</div></div><button value="cancel" class="dlg-x" formnovalidate title="إغلاق" aria-label="إغلاق">${ic('x')}</button></div>
    <div class="dlg-body"><div class="grid">${fields.map((f) => `<div class="fld ${f.t === 'textarea' ? 'full' : ''}"><label>${f.l}${f.req ? ' <span class="req">*</span>' : ''}</label>${inputHtml(f, it[f.k])}</div>`).join('')}</div><datalist id="dl-people">${peopleOptions()}</datalist></div>
    <div class="dlg-actions"><button value="save" class="btn primary">${ic('check')}حفظ</button><button value="cancel" class="btn" formnovalidate>إلغاء</button></div>`;
  dlgOnSave = (fd) => {
    const obj = existing ? { ...existing } : { id: uid(), created: new Date().toISOString() };
    for (const f of fields) obj[f.k] = (fd.get(f.k) || '').toString().trim();
    obj.updated = new Date().toISOString();
    safe(() => putItem(mod, obj), existing ? 'تم التعديل ✔️' : 'تمت الإضافة ✔️');
  };
  $('#dlg').showModal();
  $('#dlgForm').querySelector('input,select,textarea')?.focus();
}

// الضغط برة النافذة يقفلها
['#dlg', '#dlg2'].forEach((sel) => $(sel).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }));

$('#dlgForm').addEventListener('submit', (e) => {
  const v = e.submitter && e.submitter.value;
  if (v === 'save' && dlgOnSave) dlgOnSave(new FormData(e.target));
  dlgOnSave = null;
});

/* ---------------- export / import ---------------- */
let downloadsApi;
async function download(name, content, type) {
  const blob = new Blob([content], { type });
  if (window.claude && window.claude.use) {
    if (downloadsApi === undefined) { try { downloadsApi = await window.claude.use('downloads'); } catch { downloadsApi = null; } }
    if (downloadsApi) {
      try { await downloadsApi.save({ filename: name, data: blob }); return true; }
      catch (e) { if (e && e.code !== 'declined') toast('التنزيل غير متاح هنا حالياً'); return false; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
function exportCsv(mod) {
  const m = MODULES[mod];
  const cols = [{ k: 'company', l: 'الشركة' }, ...m.fields, ...(m.noPriority ? [] : [{ k: 'priority', l: 'الأولوية' }])];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = sortItems(mod, filtered(mod)).map((i) => cols.map((f) => {
    if (f.k === 'company') return q(company(i.company).name);
    if (f.k === 'priority') return q((PRIORITIES.find((p) => p.v === i.priority) || PRIORITIES[0]).l);
    return q(i[f.k]);
  }).join(','));
  download(`${m.label}-${todayStr()}.csv`, '﻿' + [cols.map((f) => q(f.l)).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}


/* ---------------- toast / modal / copy ---------------- */
let toastT;
function toast(msg) {
  const el = $('#toast');
  const bad = /مشكلة|تعذّر|لا يمكن|ليست لديك|غير متاح|ليس نسخة|ممتلئة/.test(msg);
  el.className = bad ? 'is-bad' : '';
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2800);
}

// بديل confirm/prompt (مش شغالين جوه claude.ai)
function ask(msg, opts = {}) {
  const { input = false, value = '', okText = 'موافق', danger = false, textarea = false } = opts;
  return new Promise((resolve) => {
    const d = $('#dlg2');
    d.innerHTML = `<form method="dialog" class="ask">
      <p>${esc(msg)}</p>
      <div class="ask-body">
      ${input ? `<input id="askInput" class="ask-input" value="${esc(value)}" autocomplete="off">` : ''}
      ${textarea ? `<textarea id="askText" class="brief-box" readonly>${esc(value)}</textarea>` : ''}
      </div>
      <div class="dlg-actions">
        <button value="ok" class="btn ${danger ? 'danger-solid' : 'primary'}">${okText}</button>
        ${textarea ? '' : '<button value="cancel" class="btn" formnovalidate>إلغاء</button>'}
      </div></form>`;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(input ? (ok ? ($('#askInput').value || '') : null) : ok);
    };
    d.querySelector('form').addEventListener('submit', (e) => finish(!!e.submitter && e.submitter.value === 'ok'));
    d.onclose = () => finish(false);
    d.showModal();
    const f = $('#askInput') || $('#askText');
    if (f) { f.focus(); f.select(); }
  });
}

function clearQ() { state.q = ''; const el = $('#search'); if (el) el.value = ''; }

function copyText(t) {
  const fallback = () => ask('انسخ هذا النص (Ctrl+C):', { textarea: true, value: t, okText: 'إغلاق' });
  try {
    navigator.clipboard.writeText(t).then(() => toast('تم النسخ ✔️'), fallback);
  } catch { fallback(); }
}

/* =========================================================
   المرفقات — أرشيف ملفات لكل شركة
   - أونلاين: الملفات في مخزن الملفات (assets)، والبيانات في قاعدة البيانات (collection: attachments)
   - على الجهاز: الملفات في IndexedDB، والبيانات مع باقي البيانات
   - PDF والصور بتترفع زي ما هي؛ أي نوع تاني (Word, Excel, ZIP...) بيتغلف في JSON
   ========================================================= */
const ATT_CATS = ['عقود', 'مستندات قانونية', 'أحكام وقضايا', 'توكيلات', 'مراسلات', 'فواتير وإيصالات', 'مستندات مالية', 'هويات وأوراق شخصية', 'تقارير', 'صور', 'عروض أسعار', 'أخرى'];
const ATT_TYPES = { pdf: 'PDF', image: 'صور', doc: 'مستندات Word', sheet: 'جداول Excel', text: 'نصوص', other: 'أخرى' };
const NATIVE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_NATIVE = 20 * 1024 * 1024;
const MAX_WRAPPED = 14 * 1024 * 1024;
const CONTENT_CAP = 60000;
const attState = { q: '', cat: 'all', year: 'all', type: 'all', sort: 'new', from: '', to: '', party: 'all', tag: 'all', text: 'all', size: 'all', adv: false, view: (lsGet('execsys_attview') || 'grid'), tsort: 'date', tdir: 'desc', ai: null, aiBusy: false };

function attKind(a) {
  const t = (a.fileType || '').toLowerCase(), n = (a.fileName || '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|bmp)$/.test(n)) return 'image';
  if (/\.(docx?|rtf|odt)$/.test(n) || t.includes('word')) return 'doc';
  if (/\.(xlsx?|csv|ods)$/.test(n) || t.includes('sheet') || t.includes('excel')) return 'sheet';
  if (t.startsWith('text/') || /\.(txt|md|json)$/.test(n)) return 'text';
  return 'other';
}
const extOf = (n) => ((n || '').split('.').pop() || '').slice(0, 5).toUpperCase();
function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' بايت';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' ك.ب';
  return (b / 1048576).toFixed(1) + ' م.ب';
}
// تطبيع النص العربي للبحث: بدون تشكيل، أ/إ/آ = ا، ة = ه، ى = ي
function normAr(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, ' ');
}

/* ---------- file storage ---------- */
const Files = {
  _api: undefined,
  async api() {
    if (this._api !== undefined) return this._api;
    try { this._api = (window.claude && window.claude.use && Store.mode === 'cloud') ? await window.claude.use('assets') : null; }
    catch { this._api = null; }
    return this._api;
  },
  canUpload() { return Store.mode !== 'cloud' || this._api; },
  async put(file) {
    const type = (file.type || '').toLowerCase();
    const native = NATIVE_TYPES.includes(type);
    if (native && file.size > MAX_NATIVE) throw { code: 'too_large' };
    if (!native && file.size > MAX_WRAPPED) throw { code: 'too_large' };
    if (Store.mode === 'cloud') {
      const api = await this.api();
      if (!api) throw { code: 'not_granted' };
      if (native) { const r = await api.upload(file, { type }); return { assetId: r.id, wrapped: false }; }
      const b64 = await toBase64(file);
      const wrapped = new Blob([JSON.stringify({ name: file.name, type: type || 'application/octet-stream', b64 })], { type: 'application/json' });
      const r = await api.upload(wrapped, { type: 'application/json' });
      return { assetId: r.id, wrapped: true };
    }
    const key = 'f_' + uid();
    await idbPut(key, file);
    return { assetId: key, wrapped: false, local: true };
  },
  async blob(a) {
    if (a.local || (a.assetId || '').startsWith('f_')) {
      const b = await idbGet(a.assetId);
      if (!b) throw { code: 'missing' };
      return b;
    }
    const res = await fetch('/_blob/' + a.assetId);
    if (!res.ok) throw { code: 'missing' };
    if (!a.wrapped) return await res.blob();
    const j = await res.json();
    return fromBase64(j.b64, j.type || a.fileType);
  },
  async url(a) {
    if (!a.local && !(a.assetId || '').startsWith('f_') && !a.wrapped) return '/_blob/' + a.assetId;
    return URL.createObjectURL(await this.blob(a));
  },
  async remove(a) {
    try {
      if (a.local || (a.assetId || '').startsWith('f_')) await idbDel(a.assetId);
      else { const api = await this.api(); if (api) await api.delete(a.assetId); }
    } catch (e) { console.warn('file delete', e); }
  },
};
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
function fromBase64(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}
let _idb;
function idbOpen() {
  if (_idb) return _idb;
  _idb = new Promise((res, rej) => {
    const r = indexedDB.open('execsys_files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _idb;
}
async function idbTx(mode, fn) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('f', mode);
    const req = fn(tx.objectStore('f'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const idbPut = (k, v) => idbTx('readwrite', (s) => s.put(v, k));
const idbGet = (k) => idbTx('readonly', (s) => s.get(k));
const idbDel = (k) => idbTx('readwrite', (s) => s.delete(k));

/* ---------- text extraction (for searching by content) ---------- */
const LIB = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  zip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};
const _scripts = {};
function loadScript(src) {
  if (!_scripts[src]) {
    _scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }
  return _scripts[src];
}
async function pdfLib() {
  await loadScript(LIB.pdf);
  await loadScript(LIB.pdfWorker);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
  return window.pdfjsLib;
}
async function pdfDoc(blob) {
  const lib = await pdfLib();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
}
const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, CONTENT_CAP);
const stripXml = (x) => x.replace(/<\/w:p>|<\/a:p>|<\/si>|<\/row>/g, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
async function extractText(file) {
  const k = attKind({ fileType: file.type, fileName: file.name });
  const n = (file.name || '').toLowerCase();
  try {
    if (k === 'pdf') {
      const doc = await pdfDoc(file);
      let out = '';
      for (let p = 1; p <= Math.min(doc.numPages, 80) && out.length < CONTENT_CAP; p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        out += tc.items.map((i) => i.str).join(' ') + '\n';
      }
      return cleanText(out);
    }
    if (n.endsWith('.docx') || n.endsWith('.xlsx') || n.endsWith('.pptx')) {
      await loadScript(LIB.zip);
      const zip = await window.JSZip.loadAsync(file);
      const parts = n.endsWith('.docx') ? ['word/document.xml']
        : n.endsWith('.xlsx') ? ['xl/sharedStrings.xml']
          : Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
      let out = '';
      for (const f of parts) if (zip.file(f)) out += stripXml(await zip.file(f).async('string')) + '\n';
      return cleanText(out);
    }
    if (k === 'text' || n.endsWith('.csv')) return cleanText(await file.text());
  } catch (e) { console.warn('extract', e); }
  return '';
}

/* ---------- AI reading for images & scanned PDFs (online only) ---------- */
let _sample;
async function sampleApi() {
  if (_sample !== undefined) return _sample;
  try { _sample = (window.claude && window.claude.use) ? await window.claude.use('sample') : null; } catch { _sample = null; }
  return _sample;
}
async function pdfPageImages(blob, max = 3) {
  const doc = await pdfDoc(blob);
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)));
  }
  return out;
}
async function aiRead(a) {
  const s = await sampleApi();
  if (!s) { toast('القراءة الذكية متاحة في النسخة الإلكترونية فقط'); return; }
  const caps = await s.limits().catch(() => null);
  if (!caps || !caps.images) { toast('القراءة الذكية للصور غير متاحة هنا'); return; }
  toast('جارٍ قراءة المحتوى…');
  try {
    const blob = await Files.blob(a);
    const imgs = attKind(a) === 'pdf' ? await pdfPageImages(blob, Math.min(3, caps.images.maxCount || 3)) : [blob];
    const prompt = 'هذه صورة/صفحات من مستند ضمن أرشيف مكتب. استخرج كل النص المكتوب فيها كما هو قدر الإمكان، ثم أضف في سطر أخير يبدأ بـ "ملخص:" وصفاً قصيراً لنوع المستند وأهم ما فيه (الأطراف، التواريخ، المبالغ، الأرقام المرجعية). اكتب بالعربية، ولا تضف أي تعليق آخر.';
    const r = await s(prompt, { images: imgs.slice(0, caps.images.maxCount || 3), modelTier: 'default' });
    const text = cleanText(r.text);
    if (!text) { toast('لم يتم العثور على نص'); return; }
    await safe(() => putAtt({ ...a, content: text, aiRead: true, updated: new Date().toISOString() }), 'تمت قراءة المحتوى وحفظه ✔️');
    const cur = DB.attachments.find((x) => x.id === a.id);
    if ($('#dlg').open && cur) openAttPreview(cur.id);
  } catch (e) {
    console.error(e);
    toast(e && e.code === 'not_granted' ? 'تم رفض الإذن بالقراءة الذكية' : 'تعذّرت قراءة المحتوى');
  }
}

/* ---------- data ---------- */
async function putAtt(obj) {
  obj = { ...obj, id: cleanId(obj.id) };
  if (Store.mode === 'cloud') {
    const { id, ...body } = obj;
    await Store.db.collection('attachments').doc(id).set(body);
  } else {
    obj.content = (obj.content || '').slice(0, 20000);
    const ix = DB.attachments.findIndex((x) => x.id === obj.id);
    if (ix < 0) DB.attachments.push(obj); else DB.attachments[ix] = obj;
    saveLocal(); render();
  }
}
async function removeAtt(a) {
  await Files.remove(a);
  if (Store.mode === 'cloud') await Store.db.collection('attachments').doc(a.id).delete();
  else { DB.attachments = DB.attachments.filter((x) => x.id !== a.id); saveLocal(); render(); }
}
const attOf = (cid) => (DB.attachments || []).filter((a) => cid === 'all' || a.company === cid);
const attYear = (a) => (a.docDate || a.created || '').slice(0, 4) || '—';

/* ---------- smart search ---------- */
// يفهم من جملة البحث: السنة أو الفترة، نوع الملف، التصنيف، "قبل 10 سنين"... والباقي كلمات بحث
const TYPE_WORDS = { pdf: 'pdf', 'بي دي اف': 'pdf', صوره: 'image', صور: 'image', image: 'image', jpg: 'image', png: 'image', ورد: 'doc', وورد: 'doc', word: 'doc', docx: 'doc', اكسل: 'sheet', اكسيل: 'sheet', excel: 'sheet', xlsx: 'sheet', شيت: 'sheet', جدول: 'sheet' };
const CAT_WORDS = [
  [['عقد', 'عقود', 'اتفاقيه', 'اتفاقيات'], 'عقود'], [['فاتوره', 'فواتير', 'ايصال', 'ايصالات', 'وصل'], 'فواتير وإيصالات'],
  [['توكيل', 'توكيلات', 'وكاله'], 'توكيلات'], [['حكم', 'احكام', 'قضيه', 'قضايا', 'دعوي'], 'أحكام وقضايا'],
  [['خطاب', 'خطابات', 'مراسله', 'مراسلات', 'جواب'], 'مراسلات'], [['تقرير', 'تقارير'], 'تقارير'],
  [['بطاقه', 'هويه', 'جواز', 'باسبور', 'رخصه'], 'هويات وأوراق شخصية'], [['عرض سعر', 'عروض', 'عرض'], 'عروض أسعار'],
  [['ميزانيه', 'كشف حساب', 'مالي', 'ماليه'], 'مستندات مالية'],
];
function parseQuery(q) {
  let s = ' ' + normAr(q) + ' ';
  const now = new Date().getFullYear();
  const out = { years: null, type: null, cat: null, words: [], understood: [] };
  let m;
  if ((m = s.match(/(?:من|بين)\s*((?:19|20)\d\d)\s*(?:الي|لـ|ل|و|-)\s*((?:19|20)\d\d)/)) || (m = s.match(/((?:19|20)\d\d)\s*-\s*((?:19|20)\d\d)/))) {
    const a = +m[1], b = +m[2];
    out.years = [Math.min(a, b), Math.max(a, b)]; s = s.replace(m[0], ' ');
    out.understood.push(`من ${out.years[0]} إلى ${out.years[1]}`);
  } else if ((m = s.match(/قبل\s*(\d{1,2})\s*(?:سنين|سنوات|سنه|سنة|عام|اعوام)/))) {
    const y = now - +m[1]; out.years = [y - 1, y + 1]; s = s.replace(m[0], ' ');
    out.understood.push(`حوالي ${y}`);
  } else if (/(السنه|العام)\s*(الماضيه|الماضي|اللي فاتت)/.test(s)) {
    out.years = [now - 1, now - 1]; s = s.replace(/(السنه|العام)\s*(الماضيه|الماضي|اللي فاتت)/, ' '); out.understood.push(`سنة ${now - 1}`);
  } else if (/(هذا العام|هذه السنه|السنه دي|السنه الحاليه)/.test(s)) {
    out.years = [now, now]; s = s.replace(/(هذا العام|هذه السنه|السنه دي|السنه الحاليه)/, ' '); out.understood.push(`سنة ${now}`);
  } else if ((m = s.match(/(?:^|\s)((?:19|20)\d\d)(?=\s)/))) {
    out.years = [+m[1], +m[1]]; s = s.replace(m[1], ' '); out.understood.push(`سنة ${m[1]}`);
  }
  for (const [w, t] of Object.entries(TYPE_WORDS)) {
    const re = new RegExp(`(^|\\s)${w}(?=\\s)`);
    if (re.test(s)) { out.type = t; s = s.replace(re, ' '); out.understood.push(`النوع ${ATT_TYPES[t]}`); break; }
  }
  for (const [ws, c] of CAT_WORDS) {
    if (ws.some((w) => s.includes(' ' + w + ' ') || s.includes(' ال' + w + ' '))) { out.cat = c; out.understood.push(`تصنيف ${c}`); break; }
  }
  const STOP = new Set(['في', 'عن', 'من', 'الى', 'علي', 'على', 'ملف', 'ملفات', 'مرفق', 'مرفقات', 'اللي', 'الي', 'بتاع', 'بتاعه', 'بتاعت', 'خاص', 'الخاص', 'ده', 'دي', 'كل', 'او', 'و']);
  out.words = s.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  return out;
}
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const _attIdx = new Map();
function attIndex(a) {
  const key = a.id + '|' + (a.updated || '');
  let ix = _attIdx.get(key);
  if (!ix) {
    const title = normAr([a.title, a.fileName].join(' '));
    const meta = normAr([a.party, a.refNo, a.tags, a.category, a.notes].join(' '));
    const body = normAr(a.content || '');
    const tokens = new Set((title + ' ' + meta + ' ' + body.slice(0, 8000)).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2));
    ix = { title, meta, body, tokens: [...tokens] };
    _attIdx.set(key, ix);
  }
  return ix;
}
// بيرجّع {ok, score, snippet, words}
function attMatches(a, q, parsed) {
  if (!q) return { ok: true, score: 0 };
  const p = parsed || parseQuery(q);
  const y = +attYear(a);
  if (p.years && !(y >= p.years[0] && y <= p.years[1])) return { ok: false };
  if (p.type && attKind(a) !== p.type) return { ok: false };
  const ix = attIndex(a);
  let score = p.cat && a.category === p.cat ? 4 : 0;
  const hitWords = [];
  let bodyWord = null;
  for (const w of p.words) {
    if (ix.title.includes(w)) { score += 6; hitWords.push(w); continue; }
    if (ix.meta.includes(w)) { score += 4; hitWords.push(w); continue; }
    if (ix.body.includes(w)) { score += 2; hitWords.push(w); bodyWord = bodyWord || w; continue; }
    // تسامح مع الأخطاء الإملائية
    const max = w.length >= 6 ? 2 : w.length >= 4 ? 1 : 0;
    const near = max ? ix.tokens.find((t) => t[0] === w[0] && lev(w, t, max) <= max) : null;
    if (near) { score += 1; hitWords.push(near); if (!ix.title.includes(near) && !ix.meta.includes(near)) bodyWord = bodyWord || near; continue; }
    if (!(p.cat && CAT_WORDS.some(([ws]) => ws.includes(w)))) return { ok: false };
  }
  if (!p.words.length && !p.years && !p.type && !p.cat) return { ok: true, score: 0 };
  let snippet = '';
  if (bodyWord && a.content) {
    const at = ix.body.indexOf(bodyWord);
    const start = Math.max(0, at - 60);
    snippet = (start > 0 ? '… ' : '') + a.content.slice(start, at + 140) + ' …';
  }
  return { ok: true, score, snippet, words: hitWords };
}
function hl(text, words) {
  let h = esc(text);
  if (!words || !words.length) return h;
  for (const w of [...new Set(words)]) {
    if (w.length < 2) continue;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('').map((ch) => (ch === 'ا' ? '[اأإآٱ]' : ch === 'ه' ? '[هة]' : ch === 'ي' ? '[يىئ]' : ch === 'و' ? '[وؤ]' : ch)).join('[\\u064B-\\u0652\\u0640]*'), 'gi');
    h = h.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return h;
}

/* ---------- AI search (online) ---------- */
async function aiSearch(q) {
  const s = await sampleApi();
  if (!s) { toast('البحث بالذكاء الاصطناعي متاح في النسخة الإلكترونية فقط'); return; }
  const all = attOf(state.company);
  if (!all.length) return;
  // نرتّب المرشحين بالبحث العادي أولاً ونبعت أقرب 250
  const p = parseQuery(q);
  const ranked = all.map((a) => [a, attMatches(a, q, { ...p, years: null, type: null }).score || 0])
    .sort((x, y) => y[1] - x[1]).slice(0, 250).map((x) => x[0]);
  const lines = ranked.map((a) => JSON.stringify({ id: a.id, t: a.title, c: a.category, d: a.docDate, p: a.party || undefined, r: a.refNo || undefined, k: a.tags || undefined, x: (a.content || '').slice(0, 220) || undefined }));
  attState.aiBusy = true; render();
  try {
    const res = await s.json(
      `أنت مساعد أرشيف في مكتب. هذه قائمة مرفقات (كل سطر JSON: id، t العنوان، c التصنيف، d تاريخ المستند، p الجهة، r الرقم المرجعي، k كلمات مفتاحية، x مقتطف من المحتوى).\n` +
      `اليوم ${todayStr()}.\nطلب المستخدم: «${q}»\n\n` +
      `اختر المرفقات التي تطابق الطلب ورتّبها من الأكثر صلة، بحد أقصى 20. أعد JSON فقط بالشكل: {"ids":["..."],"note":"جملة قصيرة بالعربية تشرح ما وجدته"}\n` +
      `مثال: {"ids":["a1","b2"],"note":"وجدت عقدين لإيجار المقر من 2016"}\n\nالقائمة:\n${lines.join('\n')}`,
      { modelTier: 'default' },
    );
    const ids = Array.isArray(res && res.ids) ? res.ids.filter((id) => all.some((a) => a.id === id)) : [];
    attState.ai = { q, ids, note: String((res && res.note) || '') };
  } catch (e) {
    console.error(e);
    toast(e && e.code === 'not_granted' ? 'تم رفض الإذن بالبحث الذكي' : 'تعذّر البحث بالذكاء الاصطناعي');
  }
  attState.aiBusy = false; render();
}

/* ---------- screen ---------- */
function attIcon(kind) { return { pdf: 'file', image: 'image', doc: 'file', sheet: 'grid', text: 'file', other: 'clip' }[kind] || 'clip'; }
const isLocalAtt = (a) => a.local || (a.assetId || '').startsWith('f_');
function attThumb(a, kind) {
  return kind === 'image'
    ? `<img ${isLocalAtt(a) ? '' : `src="/_blob/${esc(a.assetId)}"`} data-lazy-att="${esc(a.id)}" alt="" loading="lazy">`
    : `<span class="ft-ic">${ic(attIcon(kind))}</span>`;
}
function attCard(a, match) {
  const kind = attKind(a);
  const words = match && match.words;
  return `<article class="file k-${kind}">
    <button class="file-thumb" data-att="preview" data-id="${esc(a.id)}" aria-label="معاينة ${esc(a.title)}">
      ${attThumb(a, kind)}
      <span class="ft-type">${esc(extOf(a.fileName) || ATT_TYPES[kind])}</span>
      <span class="ft-hover">${ic('eye')}معاينة</span>
    </button>
    <div class="file-body">
      <span class="file-cat">${esc(a.category || 'أخرى')}</span>
      <h4 data-att="preview" data-id="${esc(a.id)}" title="${esc(a.title)}">${hl(a.title || a.fileName, words)}</h4>
      <div class="file-meta"><span>${ic('calendar', 'sm')}${esc(a.docDate ? fmtDate(a.docDate) : '—')}</span><span>${esc(fmtSize(a.size))}</span></div>
      ${a.party || a.refNo || state.company === 'all' ? `<div class="file-sub">${state.company === 'all' ? coTag(a.company) : ''}${a.party ? `<span>${ic('person', 'sm')}${hl(a.party, words)}</span>` : ''}${a.refNo ? `<span class="ref">#${hl(a.refNo, words)}</span>` : ''}</div>` : ''}
      ${match && match.snippet ? `<p class="file-snip">${hl(match.snippet, words)}</p>` : ''}
    </div>
    <div class="file-actions">
      <span class="file-flag">${a.content ? `${ic('check', 'sm')}مقروء` : ''}</span>
      <div>
        <button class="icon-btn" data-att="download" data-id="${esc(a.id)}" title="تنزيل">${ic('download')}</button>
        <button class="icon-btn" data-att="edit" data-id="${esc(a.id)}" title="تعديل البيانات">${ic('edit')}</button>
        <button class="icon-btn del" data-att="del" data-id="${esc(a.id)}" title="حذف">${ic('trash')}</button>
      </div>
    </div>
  </article>`;
}
function attTable(rows) {
  const col = (k, l) => `<th><button class="th-sort ${attState.tsort === k ? 'on' : ''}" data-attsort="${k}">${l}${attState.tsort === k ? (attState.tdir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
  return `<div class="table-wrap att-table"><table>
    <thead><tr>${col('title', 'الاسم')}${col('category', 'التصنيف')}${col('date', 'تاريخ المستند')}${col('party', 'الجهة')}<th>الرقم المرجعي</th>${state.company === 'all' ? '<th>الشركة</th>' : ''}${col('size', 'الحجم')}<th></th></tr></thead>
    <tbody>${rows.map(([a, m]) => {
      const kind = attKind(a);
      const w = m && m.words;
      return `<tr>
        <td class="t-name"><button class="t-ic k-${kind}" data-att="preview" data-id="${esc(a.id)}" title="معاينة">${ic(attIcon(kind))}<i>${esc(extOf(a.fileName))}</i></button>
          <div><b data-att="preview" data-id="${esc(a.id)}">${hl(a.title || a.fileName, w)}</b><small>${esc(a.fileName)}</small>${m && m.snippet ? `<p class="file-snip">${hl(m.snippet, w)}</p>` : ''}</div></td>
        <td><span class="file-cat">${esc(a.category || 'أخرى')}</span></td>
        <td class="nowrap">${esc(a.docDate ? fmtDate(a.docDate) : '—')}</td>
        <td>${a.party ? hl(a.party, w) : '<span class="muted">—</span>'}</td>
        <td class="nowrap">${a.refNo ? hl(a.refNo, w) : '<span class="muted">—</span>'}</td>
        ${state.company === 'all' ? `<td>${coTag(a.company)}</td>` : ''}
        <td class="nowrap">${esc(fmtSize(a.size))}</td>
        <td class="actions"><div class="row-actions">
          <button class="icon-btn" data-att="preview" data-id="${esc(a.id)}" title="معاينة">${ic('eye')}</button>
          <button class="icon-btn" data-att="download" data-id="${esc(a.id)}" title="تنزيل">${ic('download')}</button>
          <button class="icon-btn" data-att="edit" data-id="${esc(a.id)}" title="تعديل البيانات">${ic('edit')}</button>
          <button class="icon-btn del" data-att="del" data-id="${esc(a.id)}" title="حذف">${ic('trash')}</button>
        </div></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function attFilterPass(a) {
  const f = attState;
  if (f.cat !== 'all' && (a.category || 'أخرى') !== f.cat) return false;
  if (f.year !== 'all' && attYear(a) !== f.year) return false;
  if (f.type !== 'all' && attKind(a) !== f.type) return false;
  const d = a.docDate || (a.created || '').slice(0, 10);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  if (f.party !== 'all' && (a.party || '') !== f.party) return false;
  if (f.tag !== 'all' && !String(a.tags || '').split(/[،,]/).map((t) => t.trim()).includes(f.tag)) return false;
  if (f.text === 'yes' && !a.content) return false;
  if (f.text === 'no' && a.content) return false;
  const mb = (a.size || 0) / 1048576;
  if (f.size === 's' && mb >= 1) return false;
  if (f.size === 'm' && (mb < 1 || mb > 10)) return false;
  if (f.size === 'l' && mb <= 10) return false;
  return true;
}
const ATT_DEFAULTS = { cat: 'all', year: 'all', type: 'all', from: '', to: '', party: 'all', tag: 'all', text: 'all', size: 'all' };
function attActiveChips() {
  const f = attState, out = [];
  if (f.year !== 'all') out.push(['year', `سنة ${f.year}`]);
  if (f.type !== 'all') out.push(['type', ATT_TYPES[f.type]]);
  if (f.from) out.push(['from', `من ${fmtDate(f.from)}`]);
  if (f.to) out.push(['to', `إلى ${fmtDate(f.to)}`]);
  if (f.party !== 'all') out.push(['party', `الجهة: ${f.party}`]);
  if (f.tag !== 'all') out.push(['tag', `#${f.tag}`]);
  if (f.text !== 'all') out.push(['text', f.text === 'yes' ? 'مقروء المحتوى' : 'بدون محتوى مقروء']);
  if (f.size !== 'all') out.push(['size', { s: 'أقل من 1 م.ب', m: '1–10 م.ب', l: 'أكبر من 10 م.ب' }[f.size]]);
  return out;
}

function renderAttachments() {
  const all = attOf(state.company);
  const q = attState.q.trim();
  const parsed = q ? parseQuery(q) : null;
  const years = [...new Set(all.map(attYear))].sort((a, b) => b.localeCompare(a));
  const parties = [...new Set(all.map((a) => a.party).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const tags = [...new Set(all.flatMap((a) => String(a.tags || '').split(/[،,]/).map((t) => t.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'ar'));
  const catCounts = {};
  for (const a of all) catCounts[a.category || 'أخرى'] = (catCounts[a.category || 'أخرى'] || 0) + 1;

  let rows = [];
  const ai = attState.ai && attState.ai.q === q && q ? attState.ai : null;
  if (ai) rows = ai.ids.map((id) => all.find((a) => a.id === id)).filter((a) => a && attFilterPass(a)).map((a) => [a, attMatches(a, q, parsed)]);
  else {
    for (const a of all) {
      if (!attFilterPass(a)) continue;
      const m = attMatches(a, q, parsed);
      if (m.ok) rows.push([a, m]);
    }
    const key = (a) => a.docDate || (a.created || '').slice(0, 10);
    const sort = attState.view === 'table' ? attState.tsort : attState.sort;
    const dir = attState.view === 'table' ? (attState.tdir === 'asc' ? 1 : -1) : 1;
    const cmp = {
      rel: (x, y) => (y[1].score || 0) - (x[1].score || 0) || key(y[0]).localeCompare(key(x[0])),
      new: (x, y) => key(y[0]).localeCompare(key(x[0])),
      old: (x, y) => key(x[0]).localeCompare(key(y[0])),
      name: (x, y) => (x[0].title || '').localeCompare(y[0].title || '', 'ar'),
      title: (x, y) => dir * (x[0].title || '').localeCompare(y[0].title || '', 'ar'),
      category: (x, y) => dir * (x[0].category || '').localeCompare(y[0].category || '', 'ar'),
      date: (x, y) => dir * key(x[0]).localeCompare(key(y[0])),
      party: (x, y) => dir * (x[0].party || '').localeCompare(y[0].party || '', 'ar'),
      size: (x, y) => dir * ((x[0].size || 0) - (y[0].size || 0)),
    };
    rows.sort(cmp[q && attState.sort === 'rel' && attState.view !== 'table' ? 'rel' : sort] || cmp.new);
  }
  const totalSize = all.reduce((s, a) => s + (a.size || 0), 0);
  const canUp = Files.canUpload();
  const chips = attActiveChips();
  const advOpen = attState.adv;

  const head = `<div class="sec-head"><div><h2>المرفقات</h2><p>${all.length} ${all.length === 1 ? 'ملف' : 'ملفات'} · ${fmtSize(totalSize) || '0'}${state.company !== 'all' ? ' · ' + esc(spaceCo().name) : ''}</p></div>
    <div class="sec-tools">
      <div class="seg" role="group" aria-label="طريقة العرض">
        <button class="${attState.view === 'grid' ? 'on' : ''}" data-attview="grid" title="عرض بطاقات">${ic('grid')}<span>بطاقات</span></button>
        <button class="${attState.view === 'table' ? 'on' : ''}" data-attview="table" title="عرض جدول">${ic('file')}<span>جدول</span></button>
      </div>
      ${canUp ? `<button class="btn primary" data-att="pick">${ic('upload')}رفع مرفقات</button>` : ''}
    </div></div>`;

  if (!all.length) {
    return head + `<div class="att-drop agenda-empty" data-att-drop>
      <span class="big">${ic('clip')}</span><b>لا توجد مرفقات بعد</b>
      <span>اسحب الملفات وأفلتها هنا، أو اضغط زر الرفع. يمكنك رفع PDF والصور وملفات Word وExcel وغيرها.</span>
      ${canUp ? `<button class="btn primary" data-att="pick">${ic('upload')}رفع مرفقات</button>` : '<span>الرفع متاح لمالك النظام والمحررين فقط.</span>'}</div>`;
  }

  const sel = (key, label, opts) => `<label class="adv-f"><span>${label}</span><select data-attf="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(attState[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const tools = `<div class="att-search-box">
      <label class="att-search">${ic('search')}<input id="attSearch" type="search" value="${esc(attState.q)}" placeholder="ابحث بأي شيء: «عقد إيجار المقر 2016» أو «فاتورة كهرباء قبل 3 سنين» أو رقم أو اسم جهة…" autocomplete="off"></label>
      ${Store.mode === 'cloud' ? `<button class="btn ai-btn ${attState.aiBusy ? 'busy' : ''}" data-attai title="ابحث بالمعنى باستخدام الذكاء الاصطناعي" ${q ? '' : 'disabled'}>${ic('brief')}<span>${attState.aiBusy ? 'جارٍ البحث…' : 'بحث ذكي'}</span></button>` : ''}
      <button class="btn ${advOpen || chips.length ? 'on' : ''}" data-attadv>${ic('settings')}<span>فلاتر</span>${chips.length ? `<b class="cnt">${chips.length}</b>` : ''}</button>
      <select class="att-sel" data-attf="sort" aria-label="الترتيب" ${attState.view === 'table' ? 'hidden' : ''}>
        ${q ? `<option value="rel" ${attState.sort === 'rel' ? 'selected' : ''}>الأكثر صلة</option>` : ''}
        <option value="new" ${attState.sort === 'new' ? 'selected' : ''}>الأحدث أولاً</option>
        <option value="old" ${attState.sort === 'old' ? 'selected' : ''}>الأقدم أولاً</option>
        <option value="name" ${attState.sort === 'name' ? 'selected' : ''}>حسب الاسم</option>
      </select>
    </div>
    ${advOpen ? `<div class="adv">
      ${sel('year', 'السنة', [['all', 'كل السنوات'], ...years.map((y) => [y, y])])}
      ${sel('type', 'نوع الملف', [['all', 'كل الأنواع'], ...Object.entries(ATT_TYPES)])}
      <label class="adv-f"><span>من تاريخ</span><input type="date" data-attf="from" value="${esc(attState.from)}"></label>
      <label class="adv-f"><span>إلى تاريخ</span><input type="date" data-attf="to" value="${esc(attState.to)}"></label>
      ${sel('party', 'الجهة', [['all', 'كل الجهات'], ...parties.map((p) => [p, p])])}
      ${sel('tag', 'كلمة مفتاحية', [['all', 'الكل'], ...tags.map((t) => [t, t])])}
      ${sel('text', 'المحتوى', [['all', 'الكل'], ['yes', 'مقروء (قابل للبحث)'], ['no', 'غير مقروء']])}
      ${sel('size', 'الحجم', [['all', 'أي حجم'], ['s', 'أقل من 1 م.ب'], ['m', 'من 1 إلى 10 م.ب'], ['l', 'أكبر من 10 م.ب']])}
    </div>` : ''}
    <div class="att-cats"><button class="att-cat ${attState.cat === 'all' ? 'active' : ''}" data-attcat="all">الكل<span>${all.length}</span></button>${ATT_CATS.filter((c) => catCounts[c]).concat(Object.keys(catCounts).filter((c) => !ATT_CATS.includes(c))).map((c) => `<button class="att-cat ${attState.cat === c ? 'active' : ''}" data-attcat="${esc(c)}">${esc(c)}<span>${catCounts[c]}</span></button>`).join('')}</div>
    ${chips.length || (parsed && parsed.understood.length && !ai) ? `<div class="chips-row">
      ${parsed && parsed.understood.length && !ai ? `<span class="understood">${ic('brief', 'sm')}فهمت: ${esc(parsed.understood.join(' · '))}</span>` : ''}
      ${chips.map(([k, l]) => `<button class="f-chip" data-attclear="${k}">${esc(l)}${ic('x', 'sm')}</button>`).join('')}
      ${chips.length ? '<button class="link-btn" data-attclear="*">مسح كل الفلاتر</button>' : ''}
    </div>` : ''}
    ${ai ? `<div class="ai-banner">${ic('brief')}<div><b>نتائج البحث الذكي</b><span>${esc(ai.note || `عن «${ai.q}»`)}</span></div><button class="btn sm" data-attaiclear>عرض نتائج البحث العادي</button></div>` : ''}`;

  let list = '';
  if (!rows.length) {
    list = `<div class="agenda-empty"><span class="big">${ic('search')}</span><b>لا توجد نتائج</b><span>${q && Store.mode === 'cloud' && !ai ? 'جرّب «بحث ذكي» ليبحث بالمعنى، أو ' : 'جرّب '}كلمة أخرى أو غيّر الفلاتر</span></div>`;
  } else if (attState.view === 'table') {
    list = attTable(rows);
  } else if (ai || attState.sort === 'name' || (q && attState.sort === 'rel')) {
    list = `<div class="files">${rows.map(([a, m]) => attCard(a, m)).join('')}</div>`;
  } else {
    const groups = [];
    for (const r of rows) { const y = attYear(r[0]); const g = groups[groups.length - 1]; if (g && g.y === y) g.items.push(r); else groups.push({ y, items: [r] }); }
    list = groups.map((g) => `<section class="att-year"><h3><span>${esc(g.y)}</span><small>${g.items.length} ${g.items.length === 1 ? 'ملف' : 'ملفات'}</small></h3>
      <div class="files">${g.items.map(([a, m]) => attCard(a, m)).join('')}</div></section>`).join('');
  }
  const count = q || chips.length || attState.cat !== 'all' ? `<p class="att-count">${rows.length} من ${all.length}</p>` : '';
  return head + `<div class="att-wrap" data-att-drop>${tools}${count}${list}</div>`;
}
// الصور المحفوظة على الجهاز محتاجة رابط مؤقت
async function hydrateAttThumbs() {
  for (const img of document.querySelectorAll('img[data-lazy-att]')) {
    if (img.getAttribute('src')) continue;
    const a = DB.attachments.find((x) => x.id === img.dataset.lazyAtt);
    if (a) Files.url(a).then((u) => { img.src = u; }).catch(() => {});
  }
}

/* ---------- upload ---------- */
function pickFiles() {
  if (!Files.canUpload()) { toast('الرفع متاح لمالك النظام والمحررين فقط'); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true;
  inp.onchange = () => { if (inp.files.length) openUpload([...inp.files]); };
  inp.click();
}
function openUpload(files) {
  if (!files.length) return;
  const cid = state.company !== 'all' ? state.company : DB.companies[0] && DB.companies[0].id;
  const today = todayStr();
  dlgOnSave = null;
  $('#dlgForm').innerHTML = `<div class="dlg-head"><span class="chipic">${ic('upload')}</span><div style="flex:1"><h3>رفع ${files.length} ${files.length === 1 ? 'ملف' : 'ملفات'}</h3><div class="small">البيانات المشتركة تُطبّق على كل الملفات، ويمكنك تعديل اسم كل ملف</div></div>
      <button value="cancel" class="dlg-x" formnovalidate title="إغلاق" aria-label="إغلاق">${ic('x')}</button></div>
    <div class="dlg-body">
      <div class="up-list">${files.map((f, i) => `<div class="up-row"><span class="up-ic k-${attKind({ fileType: f.type, fileName: f.name })}">${ic(attIcon(attKind({ fileType: f.type, fileName: f.name })))}</span>
        <input name="t_${i}" value="${esc(f.name.replace(/\.[^.]+$/, ''))}" aria-label="اسم الملف"><small>${esc(fmtSize(f.size))}</small></div>`).join('')}</div>
      <div class="grid">
        <div class="fld"><label>الشركة</label><select name="company">${DB.companies.map((c) => `<option value="${esc(c.id)}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>التصنيف</label><select name="category">${ATT_CATS.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="fld"><label>تاريخ المستند</label><input type="date" name="docDate" value="${today}"></div>
        <div class="fld"><label>الجهة / الطرف المعني</label><input name="party" list="dl-people" autocomplete="off"></div>
        <div class="fld"><label>الرقم المرجعي</label><input name="refNo" placeholder="رقم العقد أو القضية أو الفاتورة"></div>
        <div class="fld"><label>كلمات مفتاحية (مفصولة بفاصلة)</label><input name="tags" placeholder="مثال: إيجار، المقر الرئيسي"></div>
        <div class="fld full"><label>ملاحظات</label><textarea name="notes"></textarea></div>
      </div>
      <datalist id="dl-people">${peopleOptions()}</datalist>
      <p class="note" style="margin-top:12px">سيتم استخراج النص من ملفات PDF وWord وExcel تلقائياً لتتمكن من البحث داخل محتواها.</p>
    </div>
    <div class="dlg-actions"><button value="save" class="btn primary">${ic('upload')}رفع وحفظ</button><button value="cancel" class="btn" formnovalidate>إلغاء</button></div>`;
  dlgOnSave = (fd) => uploadAll(files, fd);
  $('#dlg').showModal();
}
async function uploadAll(files, fd) {
  const base = {};
  for (const k of ['company', 'category', 'docDate', 'party', 'refNo', 'tags', 'notes']) base[k] = (fd.get(k) || '').toString().trim();
  const bar = $('#upbar');
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const title = (fd.get('t_' + i) || f.name).toString().trim() || f.name;
    bar.innerHTML = `<b>جارٍ رفع ${i + 1} من ${files.length}</b><span>${esc(title)}</span><i style="--p:${Math.round((i / files.length) * 100)}%"></i>`;
    bar.classList.add('show');
    try {
      const stored = await Files.put(f);
      bar.querySelector('span').textContent = `${title} — استخراج النص…`;
      const content = await extractText(f);
      await putAtt({
        id: uid(), ...base, title, fileName: f.name, fileType: f.type || '', size: f.size,
        ...stored, content, created: new Date().toISOString(), updated: new Date().toISOString(),
      });
      ok++;
    } catch (e) {
      console.error(e);
      const msg = e && e.code === 'too_large' ? 'حجم الملف أكبر من المسموح (20 م.ب للـ PDF والصور، 14 م.ب لباقي الأنواع)'
        : e && e.code === 'not_granted' ? 'الرفع متاح لمالك النظام والمحررين فقط'
          : e && e.code === 'quota_or_state' ? 'مساحة التخزين ممتلئة' : 'تعذّر رفع الملف';
      toast(`${f.name}: ${msg}`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  bar.classList.remove('show');
  if (ok) toast(`تم رفع ${ok} ${ok === 1 ? 'ملف' : 'ملفات'} ✔️`);
}

/* ---------- preview / edit / download ---------- */
async function openAttPreview(id) {
  const a = DB.attachments.find((x) => x.id === id);
  if (!a) return;
  const kind = attKind(a);
  dlgOnSave = null;
  const canAi = Store.mode === 'cloud' && (kind === 'image' || kind === 'pdf');
  $('#dlgForm').innerHTML = `<div class="dlg-head"><span class="chipic">${ic(attIcon(kind))}</span><div style="flex:1;min-width:0"><h3 class="clip1">${esc(a.title)}</h3><div class="small">${esc(a.fileName)} · ${esc(fmtSize(a.size))}</div></div>
      <button value="cancel" class="dlg-x" formnovalidate title="إغلاق" aria-label="إغلاق">${ic('x')}</button></div>
    <div class="dlg-body prev-body">
      <div class="viewer" id="viewer"><div class="viewer-msg">${ic('clock')} جارٍ التحميل…</div></div>
      <aside class="prev-meta">
        <dl>
          <div><dt>الشركة</dt><dd>${coTag(a.company)}</dd></div>
          <div><dt>التصنيف</dt><dd>${esc(a.category || '—')}</dd></div>
          <div><dt>تاريخ المستند</dt><dd>${esc(a.docDate ? fmtDate(a.docDate) : '—')}</dd></div>
          ${a.party ? `<div><dt>الجهة</dt><dd>${esc(a.party)}</dd></div>` : ''}
          ${a.refNo ? `<div><dt>الرقم المرجعي</dt><dd>${esc(a.refNo)}</dd></div>` : ''}
          ${a.tags ? `<div><dt>كلمات مفتاحية</dt><dd>${esc(a.tags)}</dd></div>` : ''}
          ${a.notes ? `<div><dt>ملاحظات</dt><dd>${esc(a.notes)}</dd></div>` : ''}
        </dl>
        <div class="prev-content"><b>المحتوى المستخرج</b>${a.content ? `<p>${esc(a.content.slice(0, 1500))}${a.content.length > 1500 ? '…' : ''}</p>` : '<p class="muted">لا يوجد نص مستخرج لهذا الملف بعد.</p>'}</div>
      </aside>
    </div>
    <div class="dlg-actions">
      <button type="button" class="btn primary" data-att="download" data-id="${esc(a.id)}">${ic('download')}تنزيل</button>
      <button type="button" class="btn" data-att="edit" data-id="${esc(a.id)}">${ic('edit')}تعديل البيانات</button>
      ${canAi ? `<button type="button" class="btn" data-att="ai" data-id="${esc(a.id)}">${ic('brief')}${a.content ? 'إعادة قراءة المحتوى' : 'قراءة المحتوى بالذكاء الاصطناعي'}</button>` : ''}
      <button value="cancel" class="btn" formnovalidate>إغلاق</button>
    </div>`;
  if (!$('#dlg').open) $('#dlg').showModal();
  const v = $('#viewer');
  try {
    if (kind === 'image') {
      v.innerHTML = `<img src="${esc(await Files.url(a))}" alt="${esc(a.title)}">`;
    } else if (kind === 'pdf') {
      const blob = await Files.blob(a);
      const doc = await pdfDoc(blob);
      v.innerHTML = `<div class="pdf-pages"></div>${doc.numPages > 6 ? `<p class="viewer-msg">تم عرض أول 6 صفحات من ${doc.numPages} — نزّل الملف لعرضه كاملاً</p>` : ''}`;
      const host = v.querySelector('.pdf-pages');
      const width = Math.min(v.clientWidth - 24, 900);
      for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
        const page = await doc.getPage(p);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = (width / vp0.width) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height; c.style.width = width + 'px';
        host.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } else if (a.content) {
      v.innerHTML = `<pre class="text-view">${esc(a.content.slice(0, 20000))}</pre>`;
    } else {
      v.innerHTML = `<div class="viewer-msg big-type">${ic(attIcon(kind))}<b>${esc(extOf(a.fileName) || 'ملف')}</b><span>لا تتوفر معاينة لهذا النوع — استخدم زر التنزيل لفتحه</span></div>`;
    }
  } catch (e) {
    console.error(e);
    v.innerHTML = `<div class="viewer-msg">${ic('alert')} تعذّر عرض الملف — جرّب تنزيله</div>`;
  }
}
function openAttEdit(id) {
  const a = DB.attachments.find((x) => x.id === id);
  if (!a) return;
  dlgOnSave = null;
  const cats = ATT_CATS.includes(a.category) || !a.category ? ATT_CATS : [a.category, ...ATT_CATS];
  $('#dlgForm').innerHTML = `<div class="dlg-head"><span class="chipic">${ic('edit')}</span><div style="flex:1;min-width:0"><h3>بيانات المرفق</h3><div class="small clip1">${esc(a.fileName)}</div></div>
      <button value="cancel" class="dlg-x" formnovalidate title="إغلاق" aria-label="إغلاق">${ic('x')}</button></div>
    <div class="dlg-body"><div class="grid">
      <div class="fld full"><label>اسم المرفق <span class="req">*</span></label><input name="title" required value="${esc(a.title)}"></div>
      <div class="fld"><label>الشركة</label><select name="company">${DB.companies.map((c) => `<option value="${esc(c.id)}" ${c.id === a.company ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="fld"><label>التصنيف</label><select name="category">${cats.map((c) => `<option ${c === a.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="fld"><label>تاريخ المستند</label><input type="date" name="docDate" value="${esc(a.docDate || '')}"></div>
      <div class="fld"><label>الجهة / الطرف المعني</label><input name="party" list="dl-people" autocomplete="off" value="${esc(a.party || '')}"></div>
      <div class="fld"><label>الرقم المرجعي</label><input name="refNo" value="${esc(a.refNo || '')}"></div>
      <div class="fld"><label>كلمات مفتاحية</label><input name="tags" value="${esc(a.tags || '')}"></div>
      <div class="fld full"><label>ملاحظات</label><textarea name="notes">${esc(a.notes || '')}</textarea></div>
      <div class="fld full"><label>محتوى المستند (يُستخدم في البحث — يمكنك كتابته أو تعديله)</label><textarea name="content" style="min-height:140px">${esc(a.content || '')}</textarea></div>
    </div><datalist id="dl-people">${peopleOptions()}</datalist></div>
    <div class="dlg-actions"><button value="save" class="btn primary">${ic('check')}حفظ</button><button value="cancel" class="btn" formnovalidate>إلغاء</button></div>`;
  dlgOnSave = (fd) => {
    const o = { ...a };
    for (const k of ['title', 'company', 'category', 'docDate', 'party', 'refNo', 'tags', 'notes']) o[k] = (fd.get(k) || '').toString().trim();
    o.content = cleanText(fd.get('content') || '');
    o.updated = new Date().toISOString();
    safe(() => putAtt(o), 'تم الحفظ ✔️');
  };
  if (!$('#dlg').open) $('#dlg').showModal();
}
async function downloadAtt(id) {
  const a = DB.attachments.find((x) => x.id === id);
  if (!a) return;
  try {
    toast('جارٍ تجهيز الملف…');
    const blob = await Files.blob(a);
    const ok = await download(a.fileName || (a.title + '.' + (extOf(a.fileName) || 'bin').toLowerCase()), blob, blob.type || a.fileType);
    if (ok) toast('تم التنزيل ✔️');
  } catch (e) { console.error(e); toast('تعذّر تنزيل الملف'); }
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const cat = e.target.closest('[data-attcat]');
  if (cat) { attState.cat = cat.dataset.attcat; render(); return; }
  const v = e.target.closest('[data-attview]');
  if (v) { attState.view = v.dataset.attview; lsSet('execsys_attview', attState.view); render(); return; }
  const so = e.target.closest('[data-attsort]');
  if (so) {
    const k = so.dataset.attsort;
    if (attState.tsort === k) attState.tdir = attState.tdir === 'asc' ? 'desc' : 'asc';
    else { attState.tsort = k; attState.tdir = k === 'date' || k === 'size' ? 'desc' : 'asc'; }
    render(); return;
  }
  const cl = e.target.closest('[data-attclear]');
  if (cl) {
    const k = cl.dataset.attclear;
    if (k === '*') Object.assign(attState, ATT_DEFAULTS); else attState[k] = ATT_DEFAULTS[k];
    render(); return;
  }
  if (e.target.closest('[data-attadv]')) { attState.adv = !attState.adv; render(); return; }
  if (e.target.closest('[data-attaiclear]')) { attState.ai = null; render(); return; }
  if (e.target.closest('[data-attai]')) { if (attState.q.trim() && !attState.aiBusy) aiSearch(attState.q.trim()); return; }
  const el = e.target.closest('[data-att]');
  if (!el) return;
  e.preventDefault();
  const id = el.dataset.id;
  switch (el.dataset.att) {
    case 'pick': pickFiles(); break;
    case 'preview': openAttPreview(id); break;
    case 'download': downloadAtt(id); break;
    case 'edit': openAttEdit(id); break;
    case 'ai': { const a = DB.attachments.find((x) => x.id === id); if (a) aiRead(a); break; }
    case 'del': {
      const a = DB.attachments.find((x) => x.id === id);
      if (a && await ask(`هل تريد حذف المرفق "${a.title}" نهائياً؟ سيتم حذف الملف نفسه.`, { okText: 'حذف', danger: true })) {
        if ($('#dlg').open) $('#dlg').close();
        await safe(() => removeAtt(a), 'تم حذف المرفق');
      }
      break;
    }
  }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset && e.target.dataset.attf;
  if (f) { attState[f] = e.target.value; render(); }
});
let attSearchT;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'attSearch') return;
  clearTimeout(attSearchT);
  const v = e.target.value;
  attSearchT = setTimeout(() => {
    if (v.trim() && attState.sort === 'new') attState.sort = 'rel';
    if (!v.trim() && attState.sort === 'rel') attState.sort = 'new';
    attState.q = v;
    render();
    const inp = $('#attSearch');
    if (inp) { inp.focus(); inp.setSelectionRange(v.length, v.length); }
  }, 250);
});
// سحب وإفلات الملفات
document.addEventListener('dragover', (e) => {
  if (state.view === 'space' && state.section === 'attachments' && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dragging');
  }
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dragging');
  if (state.view === 'space' && state.section === 'attachments' && e.dataTransfer && e.dataTransfer.files.length) {
    e.preventDefault();
    if (!Files.canUpload()) { toast('الرفع متاح لمالك النظام والمحررين فقط'); return; }
    openUpload([...e.dataTransfer.files]);
  }
});


/* ---------------- events ---------------- */
document.addEventListener('click', async (e) => {
  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) {
    state.view = viewBtn.dataset.view; state.filter = 'open';
    if (state.view === 'lobby') { state.company = 'all'; clearQ(); }
    state.nav = true; render(); return;
  }

  const secBtn = e.target.closest('[data-section]');
  if (secBtn) { state.section = secBtn.dataset.section; state.filter = 'open'; state.nav = true; render(); return; }

  const fBtn = e.target.closest('[data-filter]');
  if (fBtn) { state.filter = fBtn.dataset.filter; state.nav = true; render(); return; }

  const calBtn = e.target.closest('[data-cal]');
  if (calBtn) {
    const [y, m] = (state.calMonth || todayStr().slice(0, 7)).split('-').map(Number);
    if (calBtn.dataset.cal === 'today') { state.calMonth = todayStr().slice(0, 7); state.calDay = todayStr(); }
    else { const d = new Date(y, m - 1 + (calBtn.dataset.cal === 'next' ? 1 : -1), 1); state.calMonth = ymd(d).slice(0, 7); }
    render(); return;
  }

  const coBtn = e.target.closest('[data-company]');
  if (coBtn) {
    state.company = coBtn.dataset.company; state.view = 'space'; state.section = 'overview'; state.filter = 'open';
    clearQ(); state.nav = true; render(); return;
  }

  const el = e.target.closest('[data-act]');
  if (!el) {
    const day = e.target.closest('[data-cal-day]');
    if (day) { state.calDay = day.dataset.calDay; state.calMonth = state.calDay.slice(0, 7); render(); }
    return;
  }
  const { act, mod, id } = el.dataset;
  if (!Store.ready && !['brief', 'copyBrief'].includes(act)) { toast('انتظر حتى يكتمل تحميل البيانات'); return; }
  switch (act) {
    case 'add': {
      if (!mod && state.view === 'space' && state.section === 'attachments' && !state.q.trim()) { pickFiles(); break; }
      const target = mod || (state.view === 'space' && MODULES[state.section] ? state.section : 'meetings');
      openForm(target);
      break;
    }
    case 'edit': openForm(mod, id); break;
    case 'addOn': openForm('meetings', null, { date: el.dataset.date }); break;
    case 'done': {
      const it = DB.items[mod].find((x) => x.id === id);
      if (it) await safe(() => putItem(mod, { ...it, status: MODULES[mod].done[0], updated: new Date().toISOString() }), `تم التحديث: ${MODULES[mod].done[0]} ✔️`);
      break;
    }
    case 'del': {
      const it = DB.items[mod].find((x) => x.id === id);
      if (it && await ask(`هل تريد حذف "${titleOf(mod, it)}"؟`, { okText: 'حذف', danger: true })) {
        await safe(() => removeItem(mod, id), 'تم الحذف');
      }
      break;
    }
    case 'copy': {
      const it = DB.items[mod].find((x) => x.id === id);
      if (it) copyText(itemMessage(mod, it));
      break;
    }
    case 'brief': openBrief(el.dataset.range || 'day'); break;
    case 'clearSearch': clearQ(); render(); break;
    case 'copyBrief': copyText($('#briefText').value); break;
    case 'csv': exportCsv(mod); break;
    case 'export': {
      const ok = await download(`backup-exec-office-${todayStr()}.json`, JSON.stringify(DB, null, 2), 'application/json');
      if (ok) { lsSet(STORE_KEY + '_lastBackup', todayStr()); toast('تم تنزيل النسخة الاحتياطية ✔️'); }
      break;
    }
    case 'import': $('#importFile').click(); break;
    case 'addCo': {
      const name = await ask('اسم الشركة الجديدة:', { input: true, okText: 'إضافة' });
      if (name && name.trim()) {
        await safe(() => putCompanies([...DB.companies, { id: uid(), name: name.trim(), color: '#2b9348' }]), 'تمت إضافة الشركة ✔️');
      }
      break;
    }
    case 'delCo': {
      const used = Object.values(DB.items).some((arr) => arr.some((i) => i.company === id));
      if (used) { toast('لا يمكن حذف هذه الشركة لوجود بيانات مرتبطة بها — احذفها أو انقلها أولاً'); break; }
      if (await ask(`هل تريد حذف "${company(id).name}"؟`, { okText: 'حذف', danger: true })) {
        if (state.company === id) state.company = 'all';
        await safe(() => putCompanies(DB.companies.filter((c) => c.id !== id)), 'تم الحذف');
      }
      break;
    }
    case 'wipe':
      if (await ask('سيتم حذف كل شيء! هل نزّلت نسخة احتياطية أولاً؟', { okText: 'نعم، متابعة', danger: true })
        && await ask('تأكيد أخير — حذف جميع البيانات؟', { okText: 'حذف الكل', danger: true })) {
        toast('جارٍ الحذف...');
        await safe(async () => {
          for (const a of [...(DB.attachments || [])]) await removeAtt(a);
          await replaceAll({ companies: structuredClone(DEFAULT_COMPANIES), items: emptyItems() });
        }, 'تم حذف جميع البيانات');
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.classList && e.target.classList.contains('switch-select') && e.target.value) {
    state.company = e.target.value; state.view = 'space'; state.section = 'overview'; state.filter = 'open';
    state.nav = true; clearQ(); render(); return;
  }
  const n = e.target.dataset.coName, c = e.target.dataset.coColor;
  if (!n && !c) return;
  const list = DB.companies.map((x) => ({ ...x }));
  const co = list.find((x) => x.id === (n || c));
  if (!co) return;
  if (n) { if (!e.target.value.trim()) return; co.name = e.target.value.trim(); }
  if (c) co.color = e.target.value;
  safe(() => putCompanies(list), 'تم الحفظ ✔️');
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let d;
  try {
    d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.companies) || typeof d.items !== 'object') throw new Error('bad');
  } catch { toast('هذا الملف ليس نسخة احتياطية صالحة'); return; }
  if (!await ask('ستحلّ الاستعادة محل جميع البيانات الحالية. هل تريد المتابعة؟', { okText: 'استعادة', danger: true })) return;
  for (const k in MODULES) d.items[k] = Array.isArray(d.items[k]) ? d.items[k] : [];
  state.company = 'all';
  toast('جارٍ استعادة البيانات...');
  await safe(async () => {
    await replaceAll({ companies: d.companies, items: d.items });
    if (Array.isArray(d.attachments)) for (const a of d.attachments) await putAtt(a);
  }, 'تمت استعادة البيانات ✔️');
});

let searchT;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    state.q = e.target.value;
    render();
  }, 200);
});

// اختصار: N = إضافة جديد
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.getAttribute('role') === 'button') { document.activeElement.click(); return; }
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#dlg').open && !$('#dlg2').open && Store.ready) {
    e.preventDefault();
    openForm(state.view === 'space' && MODULES[state.section] ? state.section : 'meetings');
  }
});

/* ---------------- start ---------------- */
function afterReady() {
  const d = pulse('all');
  const parts = [];
  if (d.hot.length) parts.push(`🚨 ${d.hot.length} عناصر عاجلة أو متأخرة`);
  if (d.today.length) parts.push(`📅 ${d.today.length} مواعيد اليوم`);
  if (parts.length) setTimeout(() => toast(parts.join(' — ')), 400);
  const last = lsGet(STORE_KEY + '_lastBackup');
  const total = Object.values(DB.items).reduce((s, a) => s + a.length, 0);
  if (total > 0 && (!last || daysBetween(last, todayStr()) >= 7)) {
    setTimeout(() => toast('💾 مضى أسبوع دون نسخة احتياطية — يمكنك تنزيلها من الإعدادات'), 3600);
  }
}
hydrateIcons();
// الساعة في شاشة الشركات بتتحدث لوحدها
setInterval(() => { const c = document.querySelector('#clock b'); if (c) c.textContent = fmtTime(nowHM()); }, 20000);
render();
initStore();

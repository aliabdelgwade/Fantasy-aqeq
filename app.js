// ================= Aqeq League — الواجهة (GitHub Pages + Firebase) =================
import { firebaseConfig, ADMIN_UID, RULES } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc as fsSetDoc, deleteDoc as fsDeleteDoc, updateDoc, onSnapshot, query, orderBy, where, limit, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {
  SC, num, breakdown, sumObj, matchPts, totalPts, roundMatches, roundPts, legalFormation, timeline, teamTotals, netTransfers, priceChanges, CHIPS, CHIP_MAX, HIT, STAGES, PRESET, gwLabel, isOff,
} from './game.js?v=20261123a';
import { KO, KO_NAMES, TWO_LEG, agg, standings, winner, resolveKo } from './cup.js?v=20261123a';

// ---------- سجل التعديلات: كل حفظ أو حذف من المشرفين ينكتب في logs ----------
const NO_LOG = /^(logs|leagues|totw)\/|\/(picks|preds|votes|comments)\//;
function logLabel(path, data) {
  const [c, id] = path.split('/');
  const nm = (x) => (x && x.name) || '';
  if (c === 'players') return 'لاعب: ' + (nm(data) || nm(S.byId && S.byId.get(id)) || id);
  if (c === 'matches') { const m = data && data.a ? data : (S.matches || []).find((x) => x.id === id) || {}; return path.includes('/photos/') ? `صورة مباراة: ${m.a || ''} × ${m.b || ''}` : `مباراة: ${m.a || ''} × ${m.b || ''}`; }
  if (c === 'clubs') return 'فريق: ' + (nm(data) || id);
  if (c === 'cup') return 'البطولة';
  if (c === 'gameweeks') return 'الجولة ' + id;
  if (c === 'teams') return 'فريق فانتازي: ' + (nm(data) || nm(S.teams && S.teams.get(id)) || id);
  if (c === 'site') return 'الإعلان وإعدادات الموقع';
  return path;
}
function writeLog(act, path, data) {
  if (!S.admin || NO_LOG.test(path) || !S.uid) return;
  const u = S.auth && S.auth.currentUser;
  fsSetDoc(doc(S.db, 'logs', Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    { uid: S.uid, by: ((u && (u.displayName || u.email)) || 'مشرف').slice(0, 60), act, path: path.slice(0, 200), label: logLabel(path, data).slice(0, 120), at: Date.now() }).catch(() => {});
}
async function setDoc(ref, data, opt) { const r = await (opt ? fsSetDoc(ref, data, opt) : fsSetDoc(ref, data)); writeLog('set', ref.path, data); return r; }
async function deleteDoc(ref) { const lbl = ref.path; const r = await fsDeleteDoc(ref); writeLog('del', lbl, null); return r; }

const POS = {
  gk: { one: 'حارس', many: 'حراس', slot: 'حارس' },
  def: { one: 'مدافع', many: 'مدافعون', slot: 'مدافعون' },
  mid: { one: 'وسط', many: 'وسط', slot: 'وسط' },
  fwd: { one: 'مهاجم', many: 'مهاجمون', slot: 'مهاجمون' },
};
const ORDER = ['gk', 'def', 'mid', 'fwd'];

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const money = (n) => '$' + (Math.round(n * 10) / 10).toFixed(1);

const S = {
  rules: null, admin: false, players: [], byId: new Map(),
  formation: '2-1-1', slots: {}, bench: [], filter: 'all', query: '', target: null,
  uid: null, hasTeam: false, db: null, auth: null, profile: null, sel: null,
  gws: [], openGw: null, allPicks: {}, teams: new Map(), picksT: 0, base: null, used: { wc: 0, fh: 0, bb: 0, tc: 0 }, ft: 1,
  captain: null, vice: null, chip: null, loadedFor: null, cup: { groups: [], ko: {} }, clubs: new Map(),
};

// ---------- أدوات ----------
function errText(e) {
  const c = e && e.code || '';
  if (c.includes('permission-denied')) return 'ليست لديك صلاحية، أو أن البيانات غير صحيحة';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return 'تم إلغاء تسجيل الدخول';
  if (c.includes('too-many-requests')) return 'محاولات كثيرة، حاولي لاحقًا';
  if (c.includes('operation-not-allowed') || c.includes('admin-restricted')) return 'فعّلي الدخول بـ Google في Firebase → Authentication → Sign-in method';
  if (c.includes('unauthorized-domain')) return 'أضيفي نطاق الموقع في Firebase → Authentication → Settings → Authorized domains';
  if (c.includes('invalid-argument') || c.includes('resource-exhausted')) return 'البيانات أو الصورة كبيرة جدًا';
  if (c.includes('unavailable') || c.includes('network')) return 'تعذّر الاتصال، تحقق من الإنترنت';
  return 'حدث خطأ، حاول مرة أخرى';
}
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('click', (e) => {
  if (e.target === o || e.target.closest('[data-close]')) o.classList.remove('open');
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach((o) => o.classList.remove('open')); });

function photoUrl(p) { return p && typeof p.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.photo) ? p.photo : null; }
function avatar(p, cls) {
  const box = el('div', cls); const u = photoUrl(p);
  if (u) { const i = new Image(); i.src = u; i.alt = p.name; i.loading = 'lazy'; box.appendChild(i); }
  else box.appendChild(el('span', 'ini', (p?.name || '?').trim().charAt(0)));
  return box;
}

// ---------- حالة الفريق ----------
function emptySlots(formation) {
  const f = S.rules.formations[formation]; const s = {};
  ORDER.forEach((k) => { s[k] = Array(f[k]).fill(null); });
  return s;
}
const picked = () => [...ORDER.flatMap((k) => S.slots[k]), ...S.bench].filter(Boolean);
const isPicked = (id) => picked().includes(id);
const cost = () => picked().reduce((s, id) => s + (S.byId.get(id)?.price || 0), 0);
const squadValue = (ids) => ids.reduce((s, id) => s + (S.byId.get(id)?.price || 0), 0);
const budgetCap = () => (S.base ? Math.max(S.rules.budget, squadValue(S.base.squad)) : S.rules.budget);
const totalSlots = () => S.rules.starters + S.rules.bench;
const clubCount = (club) => picked().filter((id) => S.byId.get(id)?.club === club).length;

function canAfford(p) {
  if (cost() + p.price > budgetCap() + 1e-9) { toast('الميزانية لا تكفي لهذا اللاعب', true); return false; }
  if (clubCount(p.club) >= S.rules.maxPerClub) { toast(`الحد الأقصى ${S.rules.maxPerClub} لاعبين من ${p.club}`, true); return false; }
  return true;
}

function addToTeam(id) {
  const p = S.byId.get(id); if (!p || isPicked(id)) return;
  const t = S.target;
  if (t && t.pos === 'bench') {
    if (S.bench[t.i] !== null) return;
    if (!canAfford(p)) return;
    S.bench[t.i] = id;
  } else if (t && t.pos === p.position && S.slots[t.pos][t.i] === null) {
    if (!canAfford(p)) return;
    S.slots[t.pos][t.i] = id;
  } else {
    const i = S.slots[p.position].indexOf(null);
    const b = S.bench.indexOf(null);
    if (i < 0 && b < 0) { toast(`لا يوجد مكان لـ${POS[p.position].one}`, true); return; }
    if (!canAfford(p)) return;
    if (i >= 0) S.slots[p.position][i] = id; else { S.bench[b] = id; toast('امتلأ المركز، انتقل اللاعب إلى الدكة'); }
  }
  S.target = null;
  if (S.filter !== 'all') setFilter('all');
  renderTeam(); renderList();
}
function removeFromTeam(id) {
  ORDER.forEach((k) => { S.slots[k] = S.slots[k].map((x) => (x === id ? null : x)); });
  S.bench = S.bench.map((x) => (x === id ? null : x));
  if (S.captain === id) S.captain = null;
  if (S.vice === id) S.vice = null;
  renderTeam(); renderList();
}
function setFormation(f) {
  const old = S.slots; S.formation = f; S.slots = emptySlots(f);
  const overflow = [];
  ORDER.forEach((k) => old[k]?.forEach((id) => {
    if (!id) return;
    const i = S.slots[k].indexOf(null);
    if (i >= 0) S.slots[k][i] = id; else overflow.push(id);
  }));
  overflow.forEach((id) => {
    const b = S.bench.indexOf(null);
    if (b >= 0) S.bench[b] = id;
    else toast(`أُزيل ${S.byId.get(id)?.name || 'لاعب'} لعدم وجود مكان`, true);
  });
  renderTeam(); renderList();
}
function applyTeam(t) {
  S.formation = S.rules.formations[t.formation] ? t.formation : Object.keys(S.rules.formations)[0];
  S.slots = emptySlots(S.formation); S.bench = Array(S.rules.bench).fill(null);
  t.starters.forEach((id) => {
    const p = S.byId.get(id); if (!p) return;
    const i = S.slots[p.position]?.indexOf(null); if (i >= 0) S.slots[p.position][i] = id;
  });
  t.bench.forEach((id, i) => { if (S.byId.get(id) && i < S.bench.length) S.bench[i] = id; });
  S.captain = t.captain && S.byId.has(t.captain) ? t.captain : null;
  S.vice = t.vice && S.byId.has(t.vice) ? t.vice : null;
  $('#formation').value = S.formation;
}

// ---------- رسم الملعب ----------
function slotEl(id, pos, i, label) {
  const p = id ? S.byId.get(id) : null;
  const wrap = el('div', 'sw');
  const b = el('button', 'slot ' + (p ? 'filled' : 'empty')); b.type = 'button';
  if (p) {
    b.appendChild(avatar(p, 'pic'));
    b.appendChild(el('div', 'lbl', p.name));
    b.appendChild(el('div', 'sub', `${money(p.price)} · ${p.points}`));
    b.title = 'اضغط لإزالة اللاعب';
    if (isOff(S.openGw, p.club)) { b.classList.add('off'); b.appendChild(el('div', 'offb', 'لا يلعب')); }
    b.onclick = () => removeFromTeam(id);
    wrap.appendChild(b);
    if (pos !== 'bench') {
      const cv = el('div', 'cv');
      const c = el('button', 'cvb' + (S.captain === id ? ' on cap' : ''), 'C'); c.type = 'button'; c.title = 'كابتن (نقاطه ×2)';
      const v = el('button', 'cvb' + (S.vice === id ? ' on' : ''), 'V'); v.type = 'button'; v.title = 'نائب الكابتن';
      c.onclick = () => { if (S.vice === id) S.vice = null; S.captain = S.captain === id ? null : id; renderTeam(); };
      v.onclick = () => { if (S.captain === id) S.captain = null; S.vice = S.vice === id ? null : id; renderTeam(); };
      cv.append(c, v); wrap.appendChild(cv);
    }
  } else {
    if (S.target && S.target.pos === pos && S.target.i === i) b.classList.add('target');
    b.appendChild(el('div', 'pic', '+'));
    b.appendChild(el('div', 'lbl', label));
    b.appendChild(el('div', 'sub', '—'));
    b.onclick = () => {
      S.target = { pos, i };
      setFilter(pos === 'bench' ? 'all' : pos);
      renderTeam();
      if (window.innerWidth < 900) $('.players').scrollIntoView({ behavior: 'smooth' });
    };
    wrap.appendChild(b);
  }
  return wrap;
}

// معلومات التحويلات للجولة المفتوحة (تتحدث مع كل تغيير)
function transferInfo() {
  const squad = picked();
  const prev = S.base ? S.base.squad : null;
  const t = prev ? squad.filter((id) => !prev.includes(id)).length : 0;
  const free = !prev || S.chip === 'wc' || S.chip === 'fh';
  const hit = free ? 0 : Math.max(0, t - S.ft) * HIT;
  return { t, free, hit, ft: S.ft, prev };
}
function renderTeam() {
  // الكابتن والنائب لازم يكونوا من الأساسيين
  const st = ORDER.flatMap((k) => S.slots[k]);
  if (S.captain && !st.includes(S.captain)) S.captain = null;
  if (S.vice && !st.includes(S.vice)) S.vice = null;
  const rows = $('#rows'); rows.innerHTML = '';
  ORDER.forEach((k) => {
    const row = el('div', 'row');
    S.slots[k].forEach((id, i) => row.appendChild(slotEl(id, k, i, POS[k].slot)));
    rows.appendChild(row);
  });
  const bench = $('#benchSlots'); bench.innerHTML = '';
  S.bench.forEach((id, i) => bench.appendChild(slotEl(id, 'bench', i, 'بديل')));

  const left = budgetCap() - cost();
  $('#sBudget').textContent = money(left);
  $('#sBudget').classList.toggle('neg', left < 0);
  $('#sCount').textContent = `${picked().length}/${totalSlots()}`;
  $('#sPoints').textContent = myTotal();

  const ti = $('#tInfo');
  if (!S.openGw) { ti.textContent = ''; }
  else {
    const x = transferInfo();
    ti.innerHTML = '';
    ti.append(el('span', null, `تحويلات هذه الجولة: ${x.t}`), el('span', null, `مجانية متاحة: ${x.ft}`),
      el('span', x.hit ? 'bad' : 'ok', x.free && x.prev ? 'بدون خصم (رقاقة)' : `الخصم: ${x.hit ? '−' + x.hit : '0'}`));
  }
}
function myTotal() {
  if (!S.uid || !S.gws.length) return 0;
  const mine = S.allPicks[S.uid]; if (!mine) return 0;
  return teamTotals(S.gws, mine, S.byId, S.rules.formations, Date.now()).total;
}

// ---------- قائمة اللاعبين ----------
function setFilter(f) {
  S.filter = f;
  document.querySelectorAll('#filters .f').forEach((b) => b.classList.toggle('active', b.dataset.pos === f));
  renderList();
}
function renderList() {
  const box = $('#plist'); box.innerHTML = '';
  const q = S.query.trim().toLowerCase();
  const list = S.players.filter((p) => (S.filter === 'all' || p.position === S.filter) &&
    (!q || p.name.toLowerCase().includes(q) || p.club.toLowerCase().includes(q)));
  if (!S.players.length) {
    box.appendChild(el('div', 'empty-msg', S.admin ? 'لا يوجد لاعبون بعد. اضغط "+ إضافة لاعب" لإضافة أول لاعب.' : 'لم تتم إضافة لاعبين بعد.'));
    return;
  }
  if (!list.length) { box.appendChild(el('div', 'empty-msg', 'لا يوجد لاعبون مطابقون.')); return; }
  list.forEach((p, n) => {
    const on = isPicked(p.id);
    const row = el('div', 'pitem' + (on ? ' picked' : '')); row.style.animationDelay = Math.min(n * 25, 400) + 'ms';
    const av = avatar(p, 'av'); av.onclick = () => openProfile(p.id);
    const meta = el('div', 'meta'); meta.onclick = () => openProfile(p.id);
    const nm = el('div', 'nm', p.name); nm.appendChild(el('span', 'pos ' + p.position, POS[p.position].one));
    const cl = el('div', 'cl'); const clg = S.clubs.get(p.club);
    if (clg && clg.logo) { const li = new Image(); li.src = clg.logo; li.className = 'cl-logo'; cl.appendChild(li); }
    cl.appendChild(document.createTextNode(p.club)); meta.append(nm, cl);
    if (isOff(S.openGw, p.club)) meta.appendChild(el('div', 'offtag', '⛔ فريقه لا يلعب هذه الجولة'));
    const price = el('div', 'num'); price.append(el('b', null, money(p.price)), document.createTextNode('السعر'));
    const pts = el('div', 'num'); pts.append(el('b', null, String(p.points)), document.createTextNode('نقاط'));
    row.append(av, meta, price, pts);
    if (S.admin) { const e = el('button', 'edit', 'تعديل'); e.onclick = () => openPlayerForm(p.id); row.appendChild(e); }
    const btn = el('button', 'pick' + (on ? ' rm' : ''), on ? '−' : '+');
    btn.title = on ? 'إزالة من فريقي' : 'إضافة إلى فريقي';
    btn.onclick = () => (on ? removeFromTeam(p.id) : addToTeam(p.id));
    row.appendChild(btn);
    box.appendChild(row);
  });
}
// ================= نظام النقاط =================
const POS_PL = { gk: 'الحراس', def: 'المدافعين', mid: 'لاعبي الوسط', fwd: 'المهاجمين' };
const LBL = {
  min: 'دقائق اللعب', goals: 'الأهداف', assists: 'التمريرات الحاسمة', cs: 'الشباك النظيفة', saves: 'التصديات',
  bonus: 'نقاط البونص', yc: 'البطاقات الصفراء', rc: 'البطاقات الحمراء', pm: 'ركلات جزاء ضائعة', ps: 'تصدي لضربات جزاء', og: 'أهداف عكسية', gc: 'أهداف مستقبلة',
};

const signed = (n) => (n > 0 ? '+' + n : String(n));

function pStats(p) {
  const ms = (p.matches || []).filter((m) => num(m.min) > 0).sort((a, b) => a.round - b.round);
  const pts = totalPts(p), n = ms.length;
  const last3 = ms.slice(-3);
  return {
    n, pts, ppm: n ? pts / n : 0,
    form: last3.length ? last3.reduce((s, m) => s + matchPts(p.position, m), 0) / last3.length : 0,
  };
}
function selPct(id) { return S.sel && S.sel.total ? ((S.sel.counts[id] || 0) / S.sel.total) * 100 : 0; }
function ranks(p) {
  const peers = S.players.filter((x) => x.position === p.position);
  const st = new Map(peers.map((x) => [x.id, { price: x.price, ...pStats(x), sel: selPct(x.id) }]));
  const me = st.get(p.id);
  const rank = (k) => 1 + peers.filter((x) => st.get(x.id)[k] > me[k]).length;
  return { n: peers.length, me, price: rank('price'), ppm: rank('ppm'), form: rank('form'), sel: rank('sel') };
}
async function ensureTeams() {
  if (!S.db) return;
  if (!S.admin) { if (S.table && S.table.sel) S.sel = S.table.sel; return; }
  try { await loadPicks(false); if ($('#profileModal').classList.contains('open')) renderProfile(); }
  catch { /* نسبة الاختيار اختيارية */ }
}
// تحميل الفرق واختياراتها. آخر استدعاء هو الذي يحدد النتيجة (لا تُكتب نتيجة قديمة فوق جديدة)
let picksP = null, picksSeq = 0;
function loadPicks(force) {
  if (!S.db) return Promise.resolve();
  if (!S.admin) return loadMineOnce(); // الزائر ما يقرا كل الفرق (توفير القراءات)، يقرا ملخص الترتيب فقط
  if (!force && S.picksT && Date.now() - S.picksT < 30000 && picksP) return picksP;
  const my = ++picksSeq; const gws = S.gws.slice();
  picksP = (async () => {
    const [ts, ...ps] = await Promise.all([getDocs(collection(S.db, 'teams')),
      ...gws.map((g) => getDocs(collection(S.db, 'gameweeks', String(g.n), 'picks')))]);
    if (my !== picksSeq) return picksP; // جاء استدعاء أحدث، ننتظر نتيجته
    S.teams = new Map(ts.docs.map((d) => [d.id, d.data()]));
    const all = {};
    ps.forEach((sn, i) => sn.docs.forEach((d) => { (all[d.id] = all[d.id] || {})[gws[i].n] = d.data(); }));
    S.allPicks = all; S.picksT = Date.now(); S.picksFor = gws.map((g) => g.n);
    const counts = {}; let total = 0;
    Object.keys(all).forEach((uid) => {
      if (!S.teams.has(uid)) return;
      const ns = Object.keys(all[uid]).map(Number); if (!ns.length) return;
      const l = all[uid][Math.max(...ns)]; total++;
      [...l.starters, ...l.bench].forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    });
    S.sel = { t: Date.now(), total, counts };
  })();
  return picksP;
}
async function patchPlayer(id, patch) {
  await setDoc(doc(S.db, 'players', id), { ...patch, updatedAt: Date.now() }, { merge: true });
}

// ================= بروفايل اللاعب =================
const DIFF_COL = { 1: ['#1f8a4c', '#fff'], 2: ['#7ee08a', '#0f2a14'], 3: ['#d4d8e0', '#1d2433'], 4: ['#f29b4b', '#2b1600'], 5: ['#e5484d', '#fff'] };
const homeTxt = (h) => (h ? 'ملعبنا' : 'خارج');
const initialOf = (s) => (s || '?').trim().charAt(0) || '?';

function openProfile(id) {
  if (!S.byId.get(id)) return;
  S.profile = { id, tab: 'matches', desc: false };
  renderProfile(); openModal('#profileModal'); ensureTeams();
}
function renderProfile() {
  const P = S.profile, p = P && S.byId.get(P.id);
  if (!p) { closeModal('#profileModal'); return; }
  const modal = $('#profileModal .pf-modal'), body = $('#profileBody');
  const st = modal.scrollTop;
  body.innerHTML = '';
  body.append(pfHeader(p), pfButtons(p), pfStatsGrid(p), pfFormFixtures(p), pfTabs(), pfPane(p), pfActions(p));
  modal.scrollTop = st;
}

function pfHeader(p) {
  const h = el('div', 'pf-head');
  const back = el('button', 'pf-back', '→'); back.type = 'button'; back.setAttribute('data-close', ''); back.setAttribute('aria-label', 'رجوع');
  const parts = (p.name || '').trim().split(/\s+/);
  const first = parts.length > 1 ? parts.shift() : '';
  const info = el('div', 'pf-info');
  info.appendChild(el('div', 'pf-pos', POS[p.position].one));
  if (first) info.appendChild(el('div', 'pf-first', first));
  info.appendChild(el('div', 'pf-last', parts.join(' ')));
  info.appendChild(el('div', 'pf-club', p.club));
  h.append(back, info, avatar(p, 'pf-photo'));
  return h;
}
function pfButtons(p) {
  const f = document.createDocumentFragment();
  const row = el('div', 'pf-btns');
  const b = el('button', 'pf-btn', S.profile.desc ? 'ملف اللاعب ▴' : 'ملف اللاعب ▾'); b.type = 'button';
  b.onclick = () => { S.profile.desc = !S.profile.desc; renderProfile(); };
  row.appendChild(b); f.appendChild(row);
  if (S.profile.desc) f.appendChild(el('div', 'pf-desc', p.desc || 'لا يوجد وصف لهذا اللاعب.'));
  return f;
}
function pfStatsGrid(p) {
  const r = ranks(p), me = r.me, haveSel = !!S.sel;
  const cells = [
    ['السعر', money(p.price), r.price],
    ['نقاط/مباراة', me.ppm.toFixed(1), r.ppm],
    ['الفورم', me.form.toFixed(1), r.form],
    ['الاختيار', haveSel ? me.sel.toFixed(1) + '%' : '…', haveSel ? r.sel : null],
  ];
  const card = el('div', 'pf-card'), g = el('div', 'pf-grid');
  cells.forEach(([lab, val, rk]) => {
    const c = el('div', 'pf-cell');
    c.append(el('div', 'pf-lab', lab), el('div', 'pf-val', val), el('div', 'pf-rank', rk ? `${rk} من ${r.n}` : ' '));
    g.appendChild(c);
  });
  card.append(g, el('div', 'pf-foot', 'الترتيب بين ' + POS_PL[p.position]));
  return card;
}
// شعار الفريق الخصم (من تبويب الفرق) أو أول حرف
function crestEl(name) {
  const c = el('div', 'pf-crest'); const l = name ? (S.clubs.get(name) || {}).logo : null;
  if (l) { const i = new Image(); i.src = l; i.alt = ''; c.appendChild(i); c.classList.add('img'); } else c.textContent = initialOf(name || '؟');
  return c;
}
function pfFormFixtures(p) {
  const card = el('div', 'pf-card pf-two');
  // الفورم: آخر مباراة
  const f = el('div', 'pf-col pf-formcol'); f.appendChild(el('h4', null, 'الفورم'));
  const last = [...(p.matches || [])].sort((a, b) => b.round - a.round)[0];
  if (last) {
    const it = el('div', 'pf-item');
    it.append(el('div', 'pf-rd', 'ج' + last.round), crestEl(last.opp),
      el('div', 'pf-opp', last.opp), el('div', 'pf-h', homeTxt(last.home)),
      el('div', 'pf-ptschip', matchPts(p.position, last) + ' نقطة'));
    f.appendChild(it);
  } else f.appendChild(el('div', 'pf-none', 'لا توجد مباريات بعد'));
  // المباريات القادمة
  const x = el('div', 'pf-col pf-fixcol'); x.appendChild(el('h4', null, 'المباريات القادمة'));
  const fx = [...(p.fixtures || [])].sort((a, b) => a.round - b.round).slice(0, 3);
  if (fx.length) {
    const row = el('div', 'pf-fixrow');
    fx.forEach((m) => {
      const it = el('div', 'pf-item');
      const [bg, fg] = DIFF_COL[m.diff] || DIFF_COL[3];
      const d = el('div', 'pf-diff', String(m.diff || 3)); d.style.background = bg; d.style.color = fg;
      it.append(el('div', 'pf-rd', 'ج' + m.round), crestEl(m.opp),
        el('div', 'pf-opp', m.opp), el('div', 'pf-h', homeTxt(m.home)), d);
      row.appendChild(it);
    });
    x.appendChild(row);
  } else x.appendChild(el('div', 'pf-none', 'لا توجد مباريات قادمة'));
  if (S.admin) {
    const a = el('button', 'pf-link', '+ إدارة المباريات القادمة'); a.type = 'button';
    a.onclick = () => openFixtureForm(p.id); x.appendChild(a);
  }
  card.append(f, x);
  return card;
}
function pfTabs() {
  const t = el('div', 'pf-tabs');
  [['matches', 'المباريات'], ['stats', 'الإحصائيات'], ['history', 'السجل']].forEach(([k, l]) => {
    const b = el('button', 'pf-tab' + (S.profile.tab === k ? ' active' : ''), l); b.type = 'button';
    b.onclick = () => { S.profile.tab = k; renderProfile(); };
    t.appendChild(b);
  });
  return t;
}
function pfPane(p) {
  const w = el('div', 'pf-pane');
  if (S.profile.tab === 'stats') pfStatsPane(p, w); else if (S.profile.tab === 'history') pfHistoryPane(p, w); else pfMatchesPane(p, w);
  return w;
}
function summaryLine(pos, m) {
  if (num(m.min) <= 0) return 'لم يشارك';
  const a = [`⏱ ${m.min}د`];
  if (m.g) a.push(`⚽ ${m.g}`);
  if (m.a) a.push(`🅰️ ${m.a}`);
  if (num(m.ga) === 0 && pos !== 'fwd') a.push('🧱 شباك نظيفة');
  if (pos === 'gk' && m.sv) a.push(`🧤 ${m.sv}`);
  if (m.bo) a.push(`⭐ +${m.bo}`);
  if (m.yc) a.push('🟨' + (m.yc > 1 ? '×' + m.yc : ''));
  if (m.rc) a.push('🟥');
  if (m.pm) a.push('ركلة جزاء ضائعة');
  if (m.ps) a.push(`🧤 تصدى لجزاء${m.ps > 1 ? ' ×' + m.ps : ''}`);
  if (m.og) a.push('هدف عكسي');
  return a.join('  ·  ');
}
function pfMatchesPane(p, w) {
  if (S.admin) w.appendChild(el('p', 'hint', 'نتائج المباريات تُدخل من تبويب «المباريات».'));
  const ms = [...(p.matches || [])].sort((a, b) => b.round - a.round);
  if (!ms.length) { w.appendChild(el('div', 'empty-msg', 'لا توجد مباريات مسجّلة بعد.')); return; }
  ms.forEach((m) => {
    const pts = matchPts(p.position, m);
    const row = el('div', 'pf-match');
    const mid = el('div', 'pf-mmid');
    mid.append(el('div', 'pf-mt', `ج${m.round} · ضد ${m.opp} (${homeTxt(m.home)}) ${m.gf}-${m.ga}`), el('div', 'pf-ms', summaryLine(p.position, m)));
    const chip = el('div', 'pf-mpts ' + (pts > 0 ? 'up' : pts < 0 ? 'down' : ''), String(pts));
    row.append(mid, chip);
    if (S.admin) { const e = el('button', 'pf-edit', '✎'); e.type = 'button'; e.title = 'تعديل'; e.onclick = () => openMatchForm(p.id, m.round); row.appendChild(e); }
    w.appendChild(row);
  });
}
function pfStatsPane(p, w) {
  const ms = (p.matches || []), tot = { min: 0, goals: 0, assists: 0, cs: 0, saves: 0, bonus: 0, yc: 0, rc: 0, pm: 0, ps: 0, og: 0, gc: 0 };
  const pts = { ...tot }, val = { ...tot };
  ms.forEach((m) => {
    const b = breakdown(p.position, m), played = num(m.min) > 0;
    Object.keys(pts).forEach((k) => { pts[k] += b[k]; });
    if (!played) return;
    val.min += num(m.min); val.goals += num(m.g); val.assists += num(m.a);
    if (num(m.ga) === 0) val.cs += 1;
    val.saves += num(m.sv); val.bonus += num(m.bo); val.yc += num(m.yc); val.rc += num(m.rc);
    val.pm += num(m.pm); val.ps += num(m.ps); val.og += num(m.og); val.gc += num(m.ga);
  });
  const keys = ['min', 'goals', 'assists', 'cs', 'ps', 'bonus', 'yc', 'rc', 'pm', 'og'];
  const t = el('table', 'pf-table');
  const h = el('tr'); ['الإحصائية', 'العدد', 'النقاط'].forEach((x) => h.appendChild(el('th', null, x))); t.appendChild(h);
  keys.forEach((k) => {
    const r = el('tr'); r.append(el('td', null, LBL[k]), el('td', 'n', String(val[k])), el('td', 'n ' + (pts[k] > 0 ? 'up' : pts[k] < 0 ? 'down' : ''), signed(pts[k])));
    t.appendChild(r);
  });
  const r = el('tr', 'tot'); r.append(el('td', null, 'المجموع'), el('td', 'n', String(pStats(p).n) + ' مباراة'), el('td', 'n', String(totalPts(p))));
  t.appendChild(r); w.appendChild(t);

  const d = el('details', 'pf-rules'); d.appendChild(el('summary', null, 'كيف تُحسب النقاط؟'));
  const ul = el('ul');
  [
    'من يشارك في المباراة: 2 نقطة (بغض النظر عن الدقائق)',
    'هدف: 5 نقاط لكل المراكز',
    'تمريرة حاسمة: 4 نقاط لكل المراكز',
    'شباك نظيفة: حارس أو مدافع 4 نقاط (الوسط والمهاجم لا يحصلون عليها)',
    'أفضل لاعب في المباراة: نقطتان',
    'بطاقة صفراء -1 · حمراء -3 · هدف عكسي -3 · ركلة جزاء ضائعة -2',
  ].forEach((x) => ul.appendChild(el('li', null, x)));
  d.appendChild(ul); w.appendChild(d);
}
function pfHistoryPane(p, w) {
  const ms = [...(p.matches || [])].sort((a, b) => a.round - b.round);
  if (!ms.length) { w.appendChild(el('div', 'empty-msg', 'لا توجد مباريات مسجّلة بعد.')); return; }
  const pts = ms.map((m) => matchPts(p.position, m)), max = Math.max(1, ...pts.map(Math.abs));
  const chart = el('div', 'pf-bars');
  ms.forEach((m, i) => {
    const c = el('div', 'pf-bar'), v = pts[i];
    const bar = el('i'); bar.style.height = Math.max(6, (Math.abs(v) / max) * 100) + '%'; if (v < 0) bar.classList.add('neg');
    c.append(el('b', null, String(v)), bar, el('span', null, 'ج' + m.round));
    chart.appendChild(c);
  });
  w.appendChild(chart);
  const played = ms.filter((m) => num(m.min) > 0), best = Math.max(...pts), worst = Math.min(...pts);
  const tags = el('div', 'info-tags');
  tags.append(el('span', 'tag', 'المجموع ' + totalPts(p)), el('span', 'tag', 'المتوسط ' + (played.length ? (totalPts(p) / played.length).toFixed(1) : '0.0')),
    el('span', 'tag', 'الأفضل ' + best), el('span', 'tag', 'الأسوأ ' + worst));
  w.appendChild(tags);
}
function pfActions(p) {
  const a = el('div', 'actions pf-actions');
  const on = isPicked(p.id);
  const t = el('button', 'btn ' + (on ? 'ghost' : 'primary'), on ? 'إزالة من فريقي' : 'إضافة إلى فريقي'); t.type = 'button';
  t.onclick = () => { closeModal('#profileModal'); on ? removeFromTeam(p.id) : addToTeam(p.id); };
  a.appendChild(t);
  if (S.admin) {
    const e = el('button', 'btn ghost', 'تعديل بيانات اللاعب'); e.type = 'button';
    e.onclick = () => { closeModal('#profileModal'); openPlayerForm(p.id); }; a.appendChild(e);
  }
  return a;
}

// ---------- نموذج نتيجة المباراة (للمشرف) ----------
let mfPid = null, mfOrig = null;
const mfIds = ['#mfRound', '#mfOpp', '#mfHome', '#mfGf', '#mfGa', '#mfMin', '#mfG', '#mfA', '#mfSv', '#mfBo', '#mfYc', '#mfRc', '#mfPm', '#mfOg'];
function readMatchForm() {
  const n = (id, max) => Math.min(max, Math.max(0, Math.round(Number($(id).value) || 0)));
  return {
    round: n('#mfRound', 99), opp: $('#mfOpp').value.trim().slice(0, 30), home: $('#mfHome').value === '1',
    gf: n('#mfGf', 99), ga: n('#mfGa', 99), min: n('#mfMin', 120), g: n('#mfG', 20), a: n('#mfA', 20),
    sv: n('#mfSv', 60), bo: n('#mfBo', 2), yc: n('#mfYc', 2), rc: n('#mfRc', 1), pm: n('#mfPm', 5), ps: n('#mfPs', 5), og: n('#mfOg', 5),
  };
}
function mfPreview() {
  const p = S.byId.get(mfPid); if (!p) return;
  const m = readMatchForm(), b = breakdown(p.position, m), box = $('#mfLive');
  box.innerHTML = '';
  box.appendChild(el('div', 'live-total', 'نقاط هذه المباراة: ' + sumObj(b)));
  const chips = el('div', 'live-chips');
  Object.keys(b).forEach((k) => { if (b[k]) chips.appendChild(el('span', 'tag', `${LBL[k]} ${signed(b[k])}`)); });
  box.appendChild(chips);
  $('#mfSvWrap').hidden = true;
}
function openMatchForm(pid, round) {
  if (!S.admin) return;
  const p = S.byId.get(pid); if (!p) return;
  mfPid = pid; mfOrig = round;
  const m = round != null ? (p.matches || []).find((x) => x.round === round) : null;
  $('#mfTitle').textContent = (m ? 'تعديل مباراة' : 'إضافة مباراة') + ' — ' + p.name;
  const nextRound = Math.max(0, ...(p.matches || []).map((x) => x.round)) + 1;
  const fx = !m ? [...(p.fixtures || [])].sort((a, b) => a.round - b.round)[0] : null;
  $('#mfRound').value = m ? m.round : (fx ? fx.round : nextRound);
  $('#mfOpp').value = m ? m.opp : (fx ? fx.opp : '');
  $('#mfHome').value = (m ? m.home : (fx ? fx.home : true)) ? '1' : '0';
  const v = { '#mfGf': 'gf', '#mfGa': 'ga', '#mfMin': 'min', '#mfG': 'g', '#mfA': 'a', '#mfSv': 'sv', '#mfBo': 'bo', '#mfYc': 'yc', '#mfRc': 'rc', '#mfPm': 'pm', '#mfPs': 'ps', '#mfOg': 'og' };
  Object.entries(v).forEach(([id, k]) => { $(id).value = m ? m[k] : (k === 'min' ? 60 : 0); });
  $('#mfErr').textContent = ''; $('#mfSave').disabled = false;
  $('#mfDelete').hidden = !m; $('#mfDelete').textContent = 'حذف المباراة'; $('#mfDelete').dataset.armed = '';
  mfPreview(); openModal('#matchModal');
}
mfIds.forEach((id) => $(id).addEventListener('input', mfPreview));
$('#mfRound').addEventListener('change', () => {
  const p = S.byId.get(mfPid); if (!p || mfOrig != null || $('#mfOpp').value.trim()) return;
  const fx = (p.fixtures || []).find((f) => f.round === Number($('#mfRound').value));
  if (fx) { $('#mfOpp').value = fx.opp; $('#mfHome').value = fx.home ? '1' : '0'; }
});
$('#matchForm').onsubmit = async (e) => {
  e.preventDefault();
  const p = S.byId.get(mfPid); if (!p || !S.admin) return;
  const m = readMatchForm(), err = (t) => { $('#mfErr').textContent = t; };
  if (m.round < 1) return err('اكتب رقم الجولة');
  if (!m.opp) return err('اكتب اسم الفريق الخصم');
  if (m.min === 0 && (m.g || m.a || m.sv || m.bo || m.yc || m.rc || m.pm || m.ps || m.og)) return err('اللاعب لم يشارك (الدقائق صفر) ولا يمكن تسجيل إحصائيات له');
  const orig = (p.matches || []).find((x) => x.round === mfOrig);
  const ms = (p.matches || []).filter((x) => x.round !== mfOrig);
  if (ms.some((x) => x.round === m.round)) return err('هذه الجولة مسجّلة من قبل، عدّليها من القائمة');
  if (orig && orig.fx) m.fx = orig.fx;
  ms.push(m); ms.sort((a, b) => a.round - b.round);
  const fixtures = (p.fixtures || []).filter((f) => f.round !== m.round);
  $('#mfSave').disabled = true;
  try {
    await patchPlayer(p.id, { matches: ms, fixtures, points: totalPts({ position: p.position, matches: ms }) });
    closeModal('#matchModal'); toast('تم حفظ المباراة، ونقاط اللاعب تحدّثت');
  } catch (er) { $('#mfSave').disabled = false; err(errText(er)); }
};
$('#mfDelete').onclick = async () => {
  const b = $('#mfDelete'), p = S.byId.get(mfPid); if (!p) return;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'اضغطي مرة أخرى للتأكيد'; return; }
  const ms = (p.matches || []).filter((x) => x.round !== mfOrig);
  try {
    await patchPlayer(p.id, { matches: ms, points: totalPts({ position: p.position, matches: ms }) });
    closeModal('#matchModal'); toast('تم حذف المباراة');
  } catch (er) { $('#mfErr').textContent = errText(er); }
};

// ---------- نموذج المباريات القادمة (للمشرف) ----------
let fxPid = null;
function fxTargets(p) { return $('#fxClub').checked ? S.players.filter((x) => x.club === p.club) : [p]; }
function renderFixtureList() {
  const p = S.byId.get(fxPid); const box = $('#fxList'); box.innerHTML = '';
  if (!p) return;
  const list = [...(p.fixtures || [])].sort((a, b) => a.round - b.round);
  if (!list.length) { box.appendChild(el('div', 'empty-msg', 'لا توجد مباريات قادمة.')); return; }
  list.forEach((f) => {
    const r = el('div', 'fx-row');
    const [bg, fg] = DIFF_COL[f.diff] || DIFF_COL[3];
    const d = el('span', 'pf-diff', String(f.diff)); d.style.background = bg; d.style.color = fg;
    const del = el('button', 'pf-edit', '✕'); del.type = 'button'; del.title = 'حذف';
    del.onclick = async () => {
      try {
        await Promise.all(fxTargets(p).map((t) => patchPlayer(t.id, { fixtures: (t.fixtures || []).filter((x) => x.round !== f.round) })));
        toast('تم حذف المباراة القادمة');
      } catch (er) { $('#fxErr').textContent = errText(er); }
    };
    r.append(el('span', 'fx-t', `ج${f.round} · ضد ${f.opp} (${homeTxt(f.home)})`), d, del);
    box.appendChild(r);
  });
}
function openFixtureForm(pid) {
  if (!S.admin) return;
  const p = S.byId.get(pid); if (!p) return;
  fxPid = pid;
  $('#fxTitle').textContent = 'المباريات القادمة — ' + p.name;
  $('#fxClubLbl').textContent = 'تطبيق على كل لاعبي فريق: ' + p.club;
  $('#fxClub').checked = true;
  const next = Math.max(0, ...(p.matches || []).map((x) => x.round), ...(p.fixtures || []).map((x) => x.round)) + 1;
  $('#fxRound').value = next; $('#fxOpp').value = ''; $('#fxHome').value = '1'; $('#fxDiff').value = '3';
  $('#fxErr').textContent = ''; renderFixtureList(); openModal('#fixtureModal');
}
$('#fixtureForm').onsubmit = async (e) => {
  e.preventDefault();
  const p = S.byId.get(fxPid); if (!p || !S.admin) return;
  const round = Math.round(Number($('#fxRound').value) || 0), opp = $('#fxOpp').value.trim().slice(0, 30);
  const home = $('#fxHome').value === '1', diff = Math.min(5, Math.max(1, Math.round(Number($('#fxDiff').value) || 3)));
  if (round < 1 || round > 99) { $('#fxErr').textContent = 'اكتب رقم جولة صحيح'; return; }
  if (!opp) { $('#fxErr').textContent = 'اكتب اسم الفريق الخصم'; return; }
  const targets = fxTargets(p).filter((t) => !(t.matches || []).some((m) => m.round === round));
  if (!targets.length) { $('#fxErr').textContent = 'هذه الجولة لُعبت وسُجّلت نتيجتها'; return; }
  $('#fxErr').textContent = '';
  try {
    await Promise.all(targets.map((t) => patchPlayer(t.id, {
      fixtures: [...(t.fixtures || []).filter((f) => f.round !== round), { round, opp, home, diff }].sort((a, b) => a.round - b.round),
    })));
    $('#fxOpp').value = ''; $('#fxRound').value = round + 1; toast('تمت إضافة المباراة القادمة');
  } catch (er) { $('#fxErr').textContent = errText(er); }
};

// ---------- حفظ الفريق ----------
$('#saveTeam').onclick = async () => {
  const name = $('#teamName').value.trim();
  if (!name) { toast('اكتب اسم فريقك أولًا', true); $('#teamName').focus(); return; }
  if (picked().length < totalSlots()) { toast(`أكمل فريقك: ${S.rules.starters} أساسيين و${S.rules.bench} بديل`, true); return; }
  if (!S.openGw) { toast('لا توجد جولة مفتوحة الآن، الموعد النهائي انتهى أو لم يحدد المشرف جولة', true); return; }
  if (!S.captain || !S.vice) { toast('اختر الكابتن (C) والنائب (V) من الأساسيين', true); return; }
  if (!S.uid) { toast('سجّل الدخول بـ Google لحفظ فريقك'); googleLogin(); return; }
  if (cost() > budgetCap() + 1e-9) { toast('الفريق يتجاوز الميزانية', true); return; }
  if (S.chip && (S.used[S.chip] || 0) >= CHIP_MAX[S.chip]) { toast('هذه الرقاقة مستخدمة بالكامل', true); return; }
  const n = S.openGw.n;
  const btn = $('#saveTeam'); btn.disabled = true;
  try {
    const now = Date.now();
    const old = S.teams.get(S.uid);
    await setDoc(doc(S.db, 'teams', S.uid), { name, createdAt: old?.createdAt || now, updatedAt: now, ...gInfo() });
    await setDoc(doc(S.db, 'gameweeks', String(n), 'picks', S.uid), {
      formation: S.formation, starters: ORDER.flatMap((k) => S.slots[k]), bench: S.bench,
      captain: S.captain, vice: S.vice, chip: S.chip || null, updatedAt: now,
    });
    S.hasTeam = true;
    if (S.admin) await loadPicks(true); else { mineT = 0; await loadMine(); computeBase(); }
    renderGwBar(); renderChips(); renderTeam();
    toast(`تم حفظ فريقك (${gwLabel(S.openGw)}) ✅`);
  } catch (e) { toast(errText(e), true); }
  finally { btn.disabled = false; }
};
$('#resetTeam').onclick = () => {
  S.slots = emptySlots(S.formation); S.bench = Array(S.rules.bench).fill(null); S.target = null;
  S.captain = null; S.vice = null; S.chip = null;
  renderChips(); renderTeam(); renderList();
};
$('#formation').onchange = (e) => setFormation(e.target.value);
$('#filters').onclick = (e) => { const b = e.target.closest('.f'); if (b) { S.target = null; setFilter(b.dataset.pos); renderTeam(); } };
$('#search').oninput = (e) => { S.query = e.target.value; renderList(); };

// ---------- الترتيب ----------
const fmtDate = (ms) => new Date(ms).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const pname = (id) => S.byId.get(id)?.name || '—';
async function renderStandings() {
  renderPotw(); drawStTabs();
  if (stView === 'leagues') { $('#standings').hidden = true; $('#leagues').hidden = false; renderLeagues(); return; }
  $('#standings').hidden = false; $('#leagues').hidden = true;
  const box = $('#standings'); box.innerHTML = '';
  box.appendChild(el('div', 'empty-msg', 'جارٍ التحميل…'));
  let rows;
  try {
    if (S.admin) { rows = await computeTable(true); publishTable(rows); }
    else rows = tableRows();
  } catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'empty-msg', errText(e))); return; }
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'empty-msg', 'لا توجد فرق بعد. كن أول من يحفظ فريقه!')); return; }
  const tbl = el('table'); const head = el('tr');
  ['#', 'الفريق', 'آخر جولة', 'المجموع'].forEach((h) => head.appendChild(el('th', null, h)));
  if (S.admin) head.appendChild(el('th', null, ''));
  tbl.appendChild(head);
  rows.forEach((r, i) => {
    const tr = el('tr', (S.uid === r.uid ? 'mine ' : '') + (i === 0 && r.tt.total > 0 ? 'top1' : '') + ' clickable');
    const lastTxt = r.last ? String(r.last.net) + (r.last.chip ? ' · ' + CHIPS[r.last.chip] : '') : '—';
    tr.append(el('td', 'rank', i === 0 && r.tt.total > 0 ? '🏆' : String(i + 1)), el('td', null, r.t.name + (S.uid === r.uid ? ' (فريقي)' : '')),
      el('td', null, lastTxt), el('td', 'pts', String(r.tt.total)));
    tr.onclick = () => openTeamModal(r);
    if (S.admin) {
      const td = el('td'); const d = el('button', 'del-team', 'حذف'); let armed = false;
      d.onclick = async (ev) => {
        ev.stopPropagation();
        if (!armed) { armed = true; d.textContent = 'تأكيد الحذف؟'; return; }
        try {
          await Promise.all(S.gws.map((g) => deleteDoc(doc(S.db, 'gameweeks', String(g.n), 'picks', r.uid)).catch(() => {})));
          await deleteDoc(doc(S.db, 'teams', r.uid)); toast('تم حذف الفريق'); renderStandings();
        } catch (e) { toast(errText(e), true); }
      };
      td.appendChild(d); tr.appendChild(td);
    }
    tbl.appendChild(tr);
  });
  box.appendChild(tbl);
}
async function openTeamModal(r) {
  if (!S.allPicks[r.uid] || !r.tt.perGw || r.light) {
    $('#teamBody').innerHTML = ''; $('#tmTitle').textContent = r.t.name; $('#teamBody').appendChild(el('div', 'empty-msg', 'جاري التحميل…')); openModal('#teamModal');
    try { await fetchUserPicks(r.uid); } catch (e) { $('#teamBody').innerHTML = ''; $('#teamBody').appendChild(el('div', 'err', errText(e))); return; }
    const tt = teamTotals(S.gws, S.allPicks[r.uid] || {}, S.byId, S.rules.formations, Date.now());
    r = { ...r, tt, light: false };
  }
  const body = $('#teamBody'); body.innerHTML = '';
  $('#tmTitle').textContent = r.t.name;
  const tinfo = (S.teams.get(r.uid)) || r.t;
  if (tinfo.gName || tinfo.gPhoto) {
    const ow = el('div', 'tm-owner');
    const av = el('span', 'tm-gav');
    if (tinfo.gPhoto) { const im = new Image(); im.src = tinfo.gPhoto; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.onerror = () => { av.textContent = initialOf(tinfo.gName || '؟'); }; av.appendChild(im); } else av.textContent = initialOf(tinfo.gName || '؟');
    ow.append(av, el('span', null, tinfo.gName || ''));
    $('#tmTitle').appendChild(ow);
  }
  body.appendChild(el('div', 'tm-total', `المجموع: ${r.tt.total} نقطة`));
  // التشكيلة: صاحب الفريق والمشرف يشوفون الأحدث، والبقية بعد انتهاء الموعد النهائي (حتى لا يُنسخ الفريق)
  const canSee = S.admin || S.uid === r.uid;
  const vis = canSee ? S.gws : S.gws.filter((g) => g.deadline <= Date.now());
  const last = [...timeline(vis, S.allPicks[r.uid] || {}).rows].reverse().find((x) => !x.none);
  if (last) {
    const g = S.gws.find((x) => x.n === last.n);
    body.appendChild(el('div', 'tm-h', `التشكيلة — ${gwLabel(g)}${last.chip ? ' · ' + CHIPS[last.chip] : ''}`));
    body.appendChild(lineupEl(last.pick));
  } else body.appendChild(el('div', 'empty-msg', canSee ? 'لم يحفظ تشكيلة بعد.' : 'تظهر التشكيلة بعد انتهاء الموعد النهائي للجولة.'));
  const ns = Object.keys(r.tt.perGw).map(Number).sort((a, b) => b - a);
  if (!ns.length) body.appendChild(el('div', 'empty-msg', 'لا توجد جولات منتهية الموعد بعد.'));
  ns.forEach((n) => {
    const g = r.tt.perGw[n]; const card = el('div', 'tm-gw');
    card.appendChild(el('div', 'tm-h', `${gwLabel(S.gws.find((x) => x.n === n) || { n })} — ${g.net} نقطة` + (g.hit ? ` (خصم ${g.hit}−)` : '') + (g.chip ? ` · ${CHIPS[g.chip]}` : '') + (g.carried ? ' · لم يحفظ تغييرًا' : '')));
    g.score.items.forEach((it) => {
      const line = el('div', 'tm-p' + (it.played ? '' : ' dim'));
      line.append(el('span', null, pname(it.id) + (g.score.captain === it.id ? (g.chip === 'tc' ? ' (TC)' : ' (C)') : '')), el('b', null, String(it.pts)));
      card.appendChild(line);
    });
    g.score.subs.forEach((x) => card.appendChild(el('div', 'tm-note', `بديل تلقائي: دخل ${pname(x.in)} مكان ${pname(x.out)}`)));
    if (g.score.benchOut.length) card.appendChild(el('div', 'tm-note', `الدكة: ${g.score.benchOut.map(pname).join('، ')} (${g.score.benchPts})`));
    body.appendChild(card);
  });
  openModal('#teamModal');
}
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  const k = t.dataset.tab;
  $('#tab-pick').hidden = k !== 'pick'; $('#tab-table').hidden = k !== 'table'; $('#tab-cup').hidden = k !== 'cup'; $('#tab-clubs').hidden = k !== 'clubs'; $('#tab-matches').hidden = k !== 'matches'; $('#tab-totw').hidden = k !== 'totw';
  if (k === 'totw') renderTotw();
  if (k === 'clubs') renderClubs();
  if (k === 'matches') renderMatches();
  if (k === 'table') renderStandings();
  if (k === 'cup') renderCup();
});

// ---------- صفحة البطولة (مثل كأس العالم) ----------
async function saveCup(cup) {
  const body = JSON.parse(JSON.stringify({ groups: cup.groups || [], ko: cup.ko || {}, updatedAt: Date.now() }));
  await setDoc(doc(S.db, 'cup', 'main'), body);
}
const sc = (v) => (Number.isFinite(v) ? String(v) : '');
// شعار الفريق (من تبويب الفرق حسب الاسم)
function tlogo(name, cls, always) {
  const l = name ? (S.clubs.get(name) || {}).logo : null;
  if (!l && !always) return null;
  const e = el('span', 'tl' + (cls ? ' ' + cls : ''));
  if (l) { const i = new Image(); i.src = l; i.alt = ''; e.appendChild(i); } else e.appendChild(el('b', null, (name || '؟').trim().charAt(0)));
  return e;
}
function withLogo(node, name) { const lg = tlogo(name); if (lg) node.prepend(lg); return node; }

// ربط تبويب المباريات بالبطولة: المباريات المنتهية تدخل المجموعات والأدوار الإقصائية تلقائيًا
const KO_STAGES = { qf: ['qf1', 'qf2', 'qf'], sf: ['sf1', 'sf2', 'sf'], final: ['final'] };
const matchStage = (m) => { const g = S.gws.find((x) => x.n === (m.round || gwOfTime(m.at))); return g ? g.stage : 'gw'; };
const samePair = (m, a, b) => (m.a === a && m.b === b) || (m.a === b && m.b === a);
const scoreFor = (m, a) => (m.a === a ? [m.sa, m.sb] : [m.sb, m.sa]);
function groupLive(g) {
  const res = [...(g.res || [])];
  const T = new Set(g.teams || []);
  (S.matches || []).filter((m) => isDone(m) && T.has(m.a) && T.has(m.b) && !['qf1', 'qf2', 'qf', 'sf1', 'sf2', 'sf', 'final', 'r16'].includes(matchStage(m)))
    .forEach((m) => { if (!(g.res || []).some((x) => samePair(x, m.a, m.b))) res.push({ a: m.a, b: m.b, sa: m.sa, sb: m.sb }); });
  return { ...g, res };
}
function koFill(st, item) {
  if (!item.a || !item.b) return item;
  const stg = KO_STAGES[st] || [];
  const ms = (S.matches || []).filter((m) => isDone(m) && samePair(m, item.a, item.b) && stg.includes(matchStage(m))).sort((x, y) => x.at - y.at);
  if (!ms.length) return item;
  const out = { ...item };
  const l1 = ms.find((m) => matchStage(m) === stg[0]) || ms[0];
  const l2 = st !== 'final' ? (ms.find((m) => matchStage(m) === stg[1] && m !== l1) || ms.find((m) => m !== l1)) : null;
  const isN2 = (v) => Number.isFinite(v);
  if (!isN2(out.sa) && !isN2(out.sb)) [out.sa, out.sb] = scoreFor(l1, item.a);
  if (l2 && !isN2(out.sa2) && !isN2(out.sb2)) [out.sa2, out.sb2] = scoreFor(l2, item.a);
  return out;
}

function groupCard(g, gi) {
  const card = el('div', 'grp');
  const head = el('div', 'grp-h'); head.appendChild(el('b', null, g.name || `المجموعة ${gi + 1}`));
  if (S.admin) { const b = el('button', 'btn ghost sm', 'تعديل'); b.type = 'button'; b.onclick = () => openGroupForm(gi); head.appendChild(b); }
  card.appendChild(head);
  const t = el('table', 'grp-t');
  const h = el('tr'); ['#', 'الفريق', 'لعب', 'ف', 'ت', 'خ', 'فرق', 'نقاط'].forEach((x) => h.appendChild(el('th', null, x))); t.appendChild(h);
  standings(groupLive(g)).forEach((r, i) => {
    const tr = el('tr', i < 2 ? 'qual' : '');
    tr.append(el('td', null, String(i + 1)), withLogo(el('td', 'tn', r.team), r.team), el('td', null, String(r.p)), el('td', null, String(r.w)),
      el('td', null, String(r.d)), el('td', null, String(r.l)), el('td', null, (r.gd > 0 ? '+' : '') + r.gd), el('td', 'pts', String(r.pts)));
    t.appendChild(tr);
  });
  if (!(g.teams || []).length) { const tr = el('tr'); const td = el('td', 'cup-empty-td', 'لم تُضف فرق بعد'); td.colSpan = 8; tr.appendChild(td); t.appendChild(tr); }
  card.appendChild(t);
  return card;
}

function bracketMatch(st, i, m) {
  const box = el('div', 'bm' + (S.admin ? ' adm' : ''));
  const two = TWO_LEG.has(st), w = winner(m, two), g = agg(m, two);
  [['a', 'sa', 'sa2', 'pa'], ['b', 'sb', 'sb2', 'pb']].forEach(([k, s, s2, p], idx) => {
    const r = el('div', 'bm-r' + (w && w === m[k] ? ' win' : ''));
    const tot = idx === 0 ? g.a : g.b, tie = g.done && g.a === g.b;
    const legs = two && Number.isFinite(m[s]) ? ` <small>(${m[s]}${Number.isFinite(m[s2]) ? ' · ' + m[s2] : ''})</small>` : '';
    const sp = el('span', 'bm-s'); sp.innerHTML = sc(tot) + legs + (Number.isFinite(m[p]) && tie ? ` [${m[p]}]` : '');
    r.append(withLogo(el('span', 'bm-n', m[k] || '؟'), m[k]), sp);
    box.appendChild(r);
  });
  if (S.admin) box.onclick = () => openKoForm(st, i);
  return box;
}
function renderBracket(wrap) {
  const R = resolveKo(S.cup.ko, koFill);
  const col = (st, from, to, cls) => {
    const c = el('div', 'bcol ' + cls); c.appendChild(el('div', 'bcol-t', KO_NAMES[st]));
    const inner = el('div', 'bcol-in');
    for (let i = from; i < to; i++) inner.appendChild(bracketMatch(st, i, R[st][i]));
    c.appendChild(inner); return c;
  };
  const mid = el('div', 'bcol bmid');
  const champ = el('div', 'champ'); champ.append(el('div', 'trophy', '🏆'), el('div', 'champ-t', 'بطل البطولة'), el('div', 'champ-n', R.champion || '؟'));
  mid.appendChild(champ);
  mid.appendChild(el('div', 'bcol-t', KO_NAMES.final)); mid.appendChild(bracketMatch('final', 0, R.final[0]));
  wrap.append(col('qf', 0, 2, 'l'), col('sf', 0, 1, 'l'), mid, col('sf', 1, 2, 'r'), col('qf', 2, 4, 'r'));
}

function renderCup() {
  const box = $('#cupBody'); box.innerHTML = '';
  const gh = el('div', 'cup-sec-h'); gh.appendChild(el('h3', null, 'المجموعات'));
  if (S.admin) { const b = el('button', 'btn primary sm', '+ مجموعة'); b.type = 'button'; b.onclick = () => openGroupForm(-1); gh.appendChild(b); }
  box.appendChild(gh);
  const groups = S.cup.groups || [];
  if (!groups.length) box.appendChild(el('div', 'cup-empty', S.admin ? 'اضغط "+ مجموعة" وأضف الفرق.' : 'لم تُعلن المجموعات بعد'));
  else { const grid = el('div', 'grp-grid'); groups.forEach((g, i) => grid.appendChild(groupCard(g, i))); box.appendChild(grid); }

  const bh = el('div', 'cup-sec-h'); bh.appendChild(el('h3', null, 'الأدوار الإقصائية'));
  box.appendChild(bh);
  if (S.admin) box.appendChild(el('p', 'hint', 'اضغط على أي مباراة لإدخال الفرق (ربع النهائي فقط) والنتيجة. الفائز ينتقل للدور التالي تلقائيًا.'));
  const scroll = el('div', 'bracket-scroll'); const br = el('div', 'bracket'); renderBracket(br); scroll.appendChild(br); box.appendChild(scroll);

  const sh = el('div', 'cup-sec-h'); sh.appendChild(el('h3', null, 'إحصائيات اللاعبين')); box.appendChild(sh);
  renderBoards(box);

  const d = el('details', 'cup-fan'); d.appendChild(el('summary', null, 'مراحل جولات الفانتازي'));
  const inner = el('div'); d.appendChild(inner); box.appendChild(d);
  fantasyStages(inner);
}

// لوحات المتصدرين (تُحسب تلقائيًا من نتائج المباريات التي يدخلها المشرف)
const sumM = (p, f) => (p.matches || []).reduce((s, m) => s + f(m, p), 0);
const BOARDS = [
  { t: 'النقاط', f: (p) => totalPts(p) },
  { t: 'الأهداف', f: (p) => sumM(p, (m) => num(m.g)) },
  { t: 'التمريرات الحاسمة', f: (p) => sumM(p, (m) => num(m.a)) },
  { t: 'الشباك النظيفة', sub: 'حراس ومدافعون', f: (p) => (p.position === 'gk' || p.position === 'def' ? sumM(p, (m) => (num(m.min) > 0 && num(m.ga) === 0 ? 1 : 0)) : 0) },
  { t: 'البطاقات الصفراء', f: (p) => sumM(p, (m) => num(m.yc)), cls: 'yc' },
  { t: 'البطاقات الحمراء', f: (p) => sumM(p, (m) => num(m.rc)), cls: 'rc' },
];
function renderBoards(box) {
  const grid = el('div', 'brd-grid');
  BOARDS.forEach((b) => {
    const rows = S.players.map((p) => ({ p, v: b.f(p) })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v || x.p.name.localeCompare(y.p.name, 'ar')).slice(0, 10);
    const card = el('div', 'brd ' + (b.cls || ''));
    const h = el('div', 'brd-h'); h.appendChild(el('b', null, b.t)); if (b.sub) h.appendChild(el('span', null, b.sub)); card.appendChild(h);
    if (!rows.length) card.appendChild(el('div', 'brd-empty', 'لا توجد بيانات بعد'));
    rows.forEach((x, i) => {
      const r = el('div', 'brd-r' + (i === 0 ? ' first' : '')); r.onclick = () => openProfile(x.p.id);
      const who = el('div', 'brd-w'); who.append(el('b', null, x.p.name), el('span', null, x.p.club));
      r.append(el('span', 'brd-i', String(i + 1)), avatar(x.p, 'brd-av'), who, el('span', 'brd-v', String(x.v)));
      card.appendChild(r);
    });
    grid.appendChild(card);
  });
  box.appendChild(grid);
}

// نموذج المجموعة (للمشرف)
let editG = -1;
function openGroupForm(i) {
  if (!S.admin) return;
  editG = i; const g = i >= 0 ? S.cup.groups[i] : { name: 'المجموعة ' + ((S.cup.groups || []).length + 1), teams: [], res: [] };
  $('#grName').value = g.name || ''; $('#grTeams').value = (g.teams || []).join('\n');
  $('#grDel').hidden = i < 0; $('#grDel').textContent = 'حذف المجموعة'; $('#grDel').dataset.armed = '';
  $('#grErr').textContent = ''; drawGroupRes(g.res || []); openModal('#grpModal');
}
function groupTeamsFromForm() { return [...new Set($('#grTeams').value.split('\n').map((x) => x.trim()).filter(Boolean))]; }
function drawGroupRes(res) {
  const teams = groupTeamsFromForm(); const box = $('#grRes'); box.innerHTML = '';
  if (teams.length < 2) { box.appendChild(el('div', 'hint', 'أضف فريقين على الأقل لتظهر المباريات.')); return; }
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
    const old = res.find((r) => (r.a === teams[i] && r.b === teams[j]) || (r.a === teams[j] && r.b === teams[i]));
    const flip = old && old.a === teams[j];
    const sa = old ? (flip ? old.sb : old.sa) : null, sb = old ? (flip ? old.sa : old.sb) : null;
    const row = el('div', 'res-row'); row.dataset.a = teams[i]; row.dataset.b = teams[j];
    const ia = el('input'); ia.type = 'number'; ia.min = 0; ia.max = 99; ia.value = sc(sa); ia.className = 'ra';
    const ib = el('input'); ib.type = 'number'; ib.min = 0; ib.max = 99; ib.value = sc(sb); ib.className = 'rb';
    row.append(el('span', 'rn', teams[i]), ia, el('span', null, '–'), ib, el('span', 'rn', teams[j]));
    box.appendChild(row);
  }
}
const numOrNull = (v) => { const t = String(v).trim(); if (t === '') return null; const n = Math.round(Number(t)); return Number.isFinite(n) && n >= 0 && n <= 99 ? n : null; };
$('#grTeams').oninput = () => {
  const cur = collectRes(); drawGroupRes(cur);
};
function collectRes() {
  return [...document.querySelectorAll('#grRes .res-row')].map((r) => ({
    a: r.dataset.a, b: r.dataset.b, sa: numOrNull(r.querySelector('.ra').value), sb: numOrNull(r.querySelector('.rb').value),
  })).filter((r) => r.sa !== null && r.sb !== null);
}
$('#grpForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('#grName').value.trim(), teams = groupTeamsFromForm();
  if (!name) { $('#grErr').textContent = 'اكتب اسم المجموعة'; return; }
  if (teams.length < 2 || teams.length > 8) { $('#grErr').textContent = 'من 2 إلى 8 فرق (اسم في كل سطر)'; return; }
  const groups = [...(S.cup.groups || [])]; const g = { name, teams, res: collectRes() };
  if (editG >= 0) groups[editG] = g; else groups.push(g);
  try { await saveCup({ ...S.cup, groups }); closeModal('#grpModal'); toast('تم حفظ المجموعة'); }
  catch (er) { $('#grErr').textContent = errText(er); }
};
$('#grDel').onclick = async () => {
  const b = $('#grDel');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'اضغط مرة أخرى للتأكيد'; return; }
  try { await saveCup({ ...S.cup, groups: S.cup.groups.filter((_, i) => i !== editG) }); closeModal('#grpModal'); toast('تم حذف المجموعة'); }
  catch (er) { $('#grErr').textContent = errText(er); }
};

// نموذج مباراة إقصائية (للمشرف)
let editK = null;
function openKoForm(st, i) {
  if (!S.admin) return;
  editK = { st, i }; const m = resolveKo(S.cup.ko)[st][i];
  $('#koTitle').textContent = `${KO_NAMES[st]}${KO[st] > 1 ? ' — مباراة ' + (i + 1) : ''}`;
  const r16 = st === 'qf';
  $('#koA').value = m.a || ''; $('#koB').value = m.b || ''; $('#koA').disabled = !r16; $('#koB').disabled = !r16;
  const two = TWO_LEG.has(st);
  $('#koLegs').hidden = !two; $('#koLegs2').hidden = !two; $('#koLbl1').textContent = $('#koLbl2').textContent = two ? 'الذهاب' : 'النتيجة';
  $('#koSa').value = sc(m.sa); $('#koSb').value = sc(m.sb); $('#koSa2').value = sc(m.sa2); $('#koSb2').value = sc(m.sb2); $('#koPa').value = sc(m.pa); $('#koPb').value = sc(m.pb);
  $('#koErr').textContent = r16 ? '' : 'الفريقان يُحددان تلقائيًا من نتائج الدور السابق.';
  openModal('#koModal');
}
$('#koForm').onsubmit = async (e) => {
  e.preventDefault();
  const { st, i } = editK;
  const ko = JSON.parse(JSON.stringify(S.cup.ko || {}));
  ko[st] = ko[st] || []; for (let k = 0; k < KO[st]; k++) ko[st][k] = ko[st][k] || null;
  const m = { sa: numOrNull($('#koSa').value), sb: numOrNull($('#koSb').value), sa2: TWO_LEG.has(st) ? numOrNull($('#koSa2').value) : null, sb2: TWO_LEG.has(st) ? numOrNull($('#koSb2').value) : null, pa: numOrNull($('#koPa').value), pb: numOrNull($('#koPb').value) };
  if (st === 'qf') { m.a = $('#koA').value.trim() || null; m.b = $('#koB').value.trim() || null; }
  ko[st][i] = m;
  try { await saveCup({ ...S.cup, ko }); closeModal('#koModal'); toast('تم الحفظ'); }
  catch (er) { $('#koErr').textContent = errText(er); }
};

// مراحل جولات الفانتازي (قسم ثانوي)
async function fantasyStages(box) {
  box.appendChild(el('div', 'empty-msg', 'جارٍ التحميل…'));
  let totals;
  try { totals = S.admin ? await computeTable() : tableRows(); } catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'empty-msg', errText(e))); return; }
  box.innerHTML = '';
  const now = Date.now();
  Object.keys(STAGES).forEach((st) => {
    const list = S.gws.filter((g) => (g.stage || 'gw') === st);
    const sec = el('div', 'cup-stage' + (st === 'final' ? ' cup-final' : ''));
    sec.appendChild(el('h3', null, STAGES[st]));
    if (!list.length) { sec.appendChild(el('div', 'cup-empty', 'لم يُعلن بعد')); box.appendChild(sec); return; }
    const grid = el('div', 'cup-grid');
    list.forEach((g) => {
      const card = el('div', 'cup-card'); const open = g.deadline > now;
      card.append(el('b', null, `جولة ${g.n}`), el('span', 'tag ' + (g.final ? 'fin' : open ? 'open' : 'lock'), g.final ? 'منتهية' : open ? 'مفتوحة' : 'مقفلة'),
        el('div', 'cup-date', 'الموعد: ' + fmtDate(g.deadline)));
      if (g.off && g.off.length) card.appendChild(el('div', 'cup-off', '⛔ لا تلعب: ' + g.off.join('، ')));
      if (!open) {
        totals.filter((x) => x.tt.perGw[g.n]).sort((x, y) => y.tt.perGw[g.n].net - x.tt.perGw[g.n].net).slice(0, 3).forEach((x, k) => {
          const l = el('div', 'cup-top'); l.append(el('span', null, ['🥇', '🥈', '🥉'][k] + ' ' + x.t.name), el('b', null, String(x.tt.perGw[g.n].net))); card.appendChild(l);
        });
      }
      grid.appendChild(card);
    });
    sec.appendChild(grid); box.appendChild(sec);
  });
}

function lineupEl(pick) {
  const box = el('div', 'lu');
  const by = { gk: [], def: [], mid: [], fwd: [] };
  pick.starters.forEach((id) => { const p = S.byId.get(id); if (p) by[p.position].push(p); });
  const chipEl = (p, role) => {
    const c = el('div', 'lu-p'); c.appendChild(avatar(p, 'lu-av'));
    c.appendChild(el('div', 'lu-n', p.name));
    if (pick.captain === p.id) c.appendChild(el('span', 'lu-b cap', 'C'));
    else if (pick.vice === p.id) c.appendChild(el('span', 'lu-b', 'V'));
    if (role) c.classList.add(role); return c;
  };
  ORDER.forEach((k) => { if (!by[k].length) return; const row = el('div', 'lu-row'); by[k].forEach((p) => row.appendChild(chipEl(p))); box.appendChild(row); });
  const bn = el('div', 'lu-bench'); bn.appendChild(el('span', null, 'البديل:'));
  pick.bench.forEach((id) => { const p = S.byId.get(id); if (p) bn.appendChild(chipEl(p, 'bn')); });
  box.appendChild(bn);
  return box;
}

// ---------- الفرق (مع الشعارات) ----------
const clubId = (name) => 'c' + Array.from(new TextEncoder().encode(name)).map((b) => b.toString(16).padStart(2, '0')).join('');
function allClubs() {
  const m = new Map();
  S.players.forEach((p) => { if (p.club) m.set(p.club, (m.get(p.club) || 0) + 1); });
  (S.cup.groups || []).forEach((g) => (g.teams || []).forEach((t) => { if (!m.has(t)) m.set(t, 0); }));
  return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], 'ar'));
}
let clubEdit = null; // {name, logo: undefined|null|dataurl}
const clubStat = (p) => ({
  played: (p.matches || []).filter((m) => num(m.min) > 0).length,
  g: sumM(p, (m) => num(m.g)), a: sumM(p, (m) => num(m.a)),
  cs: (p.position === 'gk' || p.position === 'def') ? sumM(p, (m) => (num(m.min) > 0 && num(m.ga) === 0 ? 1 : 0)) : 0,
  yc: sumM(p, (m) => num(m.yc)), rc: sumM(p, (m) => num(m.rc)),
});
function renderClubs() {
  const box = $('#clubsBody'); if (!box) return; box.innerHTML = '';
  const list = allClubs();
  if (!list.length) { box.appendChild(el('div', 'empty-msg', 'لا توجد فرق بعد. تظهر هنا الفرق المكتوبة في لاعبيك ومجموعات البطولة.')); return; }
  const grid = el('div', 'club-grid');
  list.forEach(([name, n]) => {
    const c = S.clubs.get(name); const card = el('div', 'club-card clickable');
    const lg = el('div', 'club-logo');
    if (c && c.logo) { const i = new Image(); i.src = c.logo; i.alt = name; lg.appendChild(i); } else lg.appendChild(el('span', null, name.trim().charAt(0)));
    card.append(lg, el('b', null, name), el('span', 'club-n', n + ' لاعب'));
    card.onclick = () => openClub(name);
    if (S.admin) {
      const tools = el('div', 'club-tools');
      const ed = el('button', 'ico', '✏️'); ed.type = 'button'; ed.title = 'تعديل الفريق';
      ed.onclick = (ev) => { ev.stopPropagation(); openClubEdit(name); };
      const dl = el('button', 'ico del', '🗑️'); dl.type = 'button'; dl.title = 'حذف الفريق';
      dl.onclick = (ev) => { ev.stopPropagation(); deleteClub(name, n); };
      tools.append(ed, dl); card.appendChild(tools);
    }
    grid.appendChild(card);
  });
  box.appendChild(grid);
}

// تفاصيل الفريق: لاعبوه وإحصائياتهم
function openClub(name) {
  const c = S.clubs.get(name);
  const ps = S.players.filter((p) => p.club === name).sort((x, y) => ORDER.indexOf(x.position) - ORDER.indexOf(y.position) || y.points - x.points);
  $('#clubTitle').textContent = name;
  const body = $('#clubBody'); body.innerHTML = '';
  const top = el('div', 'club-head');
  const lg = el('div', 'club-logo sm'); if (c && c.logo) { const i = new Image(); i.src = c.logo; lg.appendChild(i); } else lg.appendChild(el('span', null, name.trim().charAt(0)));
  const tot = ps.reduce((t, p) => { const s = clubStat(p); t.pts += p.points; t.g += s.g; t.a += s.a; t.cs += s.cs; return t; }, { pts: 0, g: 0, a: 0, cs: 0 });
  const sum = el('div', 'club-sum'); sum.innerHTML = `<span>اللاعبون <b>${ps.length}</b></span><span>النقاط <b>${tot.pts}</b></span><span>الأهداف <b>${tot.g}</b></span><span>الحاسمة <b>${tot.a}</b></span><span>نظيفة <b>${tot.cs}</b></span>`;
  top.append(lg, sum); body.appendChild(top);
  if (!ps.length) { body.appendChild(el('div', 'empty-msg', 'لا يوجد لاعبون في هذا الفريق بعد.')); clubExtras(body, name, ps); openModal('#clubModal'); return; }
  const t = el('table', 'club-t'); const h = el('tr');
  ['اللاعب', 'لعب', 'أهداف', 'حاسمة', 'نظيفة', '🟨', '🟥', 'نقاط'].forEach((x) => h.appendChild(el('th', null, x))); t.appendChild(h);
  ps.forEach((p) => {
    const s = clubStat(p); const tr = el('tr', 'clickable');
    const nm = el('td', 'tn'); const wr = el('div', 'club-pl'); wr.append(avatar(p, 'club-av'), el('span', 'pos ' + p.position, POS[p.position].one), el('span', null, p.name)); nm.appendChild(wr);
    tr.append(nm, ...[s.played, s.g, s.a, s.cs, s.yc, s.rc].map((v) => el('td', null, String(v))), el('td', 'pts', String(p.points)));
    tr.onclick = () => { closeModal('#clubModal'); openProfile(p.id); };
    t.appendChild(tr);
  });
  const wrap = el('div', 'club-tw'); wrap.appendChild(t); body.appendChild(wrap);
  clubExtras(body, name, ps);
  openModal('#clubModal');
}

// تعديل الفريق (الاسم + الشعار)
function setCePrev() {
  const pr = $('#cePrev'); pr.innerHTML = '';
  const cur = clubEdit.logo !== undefined ? clubEdit.logo : (S.clubs.get(clubEdit.name) || {}).logo;
  if (cur) { const i = new Image(); i.src = cur; pr.appendChild(i); } else pr.appendChild(el('span', null, ($('#ceName').value || clubEdit.name).trim().charAt(0)));
}
function openClubEdit(name) {
  if (!S.admin) return;
  clubEdit = { name, logo: undefined };
  $('#ceName').value = name; $('#ceErr').textContent = ''; setCePrev(); openModal('#clubEditModal');
}
$('#ceChoose').onclick = () => $('#clubFile').click();
$('#ceRemove').onclick = () => { clubEdit.logo = null; setCePrev(); };
$('#clubFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !clubEdit) return;
  if (!f.type.startsWith('image/')) { $('#ceErr').textContent = 'الملف يجب أن يكون صورة'; return; }
  try { clubEdit.logo = await resizeLogo(f); $('#ceErr').textContent = ''; setCePrev(); }
  catch { $('#ceErr').textContent = 'تعذّر قراءة الصورة، جرّبي صورة أخرى'; }
};
$('#clubEditForm').onsubmit = async (e) => {
  e.preventDefault();
  const old = clubEdit.name, nn = $('#ceName').value.trim();
  if (!nn || nn.length > 40) { $('#ceErr').textContent = 'اسم الفريق من 1 إلى 40 حرفًا'; return; }
  if (nn !== old && allClubs().some(([x]) => x === nn)) { $('#ceErr').textContent = 'يوجد فريق بهذا الاسم'; return; }
  const btn = $('#clubEditForm button[type=submit]'); btn.disabled = true;
  try {
    const logo = clubEdit.logo !== undefined ? clubEdit.logo : ((S.clubs.get(old) || {}).logo || null);
    if (nn !== old) {
      for (const p of S.players.filter((x) => x.club === old)) await patchPlayer(p.id, { club: nn });
      const cup = JSON.parse(JSON.stringify(S.cup)); let ch = false;
      const rn = (x) => { if (x === old) { ch = true; return nn; } return x; };
      (cup.groups || []).forEach((g) => { g.teams = (g.teams || []).map(rn); (g.res || []).forEach((r) => { r.a = rn(r.a); r.b = rn(r.b); }); });
      Object.values(cup.ko || {}).forEach((arr) => (arr || []).forEach((m) => { if (m) { m.a = rn(m.a); m.b = rn(m.b); } }));
      if (ch) await saveCup(cup);
      if (S.clubs.has(old)) await deleteDoc(doc(S.db, 'clubs', clubId(old)));
    }
    if (logo) await setDoc(doc(S.db, 'clubs', clubId(nn)), { name: nn, logo, updatedAt: Date.now() });
    else if (S.clubs.has(nn)) await deleteDoc(doc(S.db, 'clubs', clubId(nn)));
    closeModal('#clubEditModal'); toast('تم حفظ الفريق ✅');
  } catch (er) { $('#ceErr').textContent = errText(er); }
  finally { btn.disabled = false; }
};

// حذف فريق (بتأكيد من خطوتين): يحذف لاعبيه وشعاره
let delArm = null;
async function deleteClub(name, n) {
  if (delArm !== name) { delArm = name; toast(`اضغطي 🗑️ مرة ثانية لحذف "${name}" مع ${n} لاعب`, true); setTimeout(() => { if (delArm === name) delArm = null; }, 5000); return; }
  delArm = null;
  try {
    for (const p of S.players.filter((x) => x.club === name)) await deleteDoc(doc(S.db, 'players', p.id));
    if (S.clubs.has(name)) await deleteDoc(doc(S.db, 'clubs', clubId(name)));
    toast('تم حذف الفريق');
  } catch (er) { toast(errText(er), true); }
}
function resizeLogo(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const N = 256, k = Math.min(N / img.width, N / img.height);
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const w = img.width * k, h = img.height * k;
      c.getContext('2d').drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
      URL.revokeObjectURL(url);
      let d = c.toDataURL('image/png'); if (d.length > 280000) d = c.toDataURL('image/jpeg', 0.85);
      res(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(); };
    img.src = url;
  });
}

// ---------- الجولات: الشريط والرقائق ----------
function renderGwBar() {
  const bar = $('#gwBar'); if (!bar) return;
  bar.innerHTML = '';
  if (!S.gwsLoaded) { bar.append(el('b', null, 'جارٍ التحميل…')); return; }
  if (!S.gws.length) { bar.append(el('b', null, 'لم يحدد المشرف أول جولة بعد')); return; }
  if (!S.openGw) { bar.append(el('b', null, 'لا توجد جولة مفتوحة حاليًا'), el('span', null, 'بانتظار إعلان الجولة التالية')); return; }
  const left = S.openGw.deadline - Date.now();
  const d = Math.floor(left / 864e5), h = Math.floor(left % 864e5 / 36e5), m = Math.floor(left % 36e5 / 6e4), sec = Math.floor(left % 6e4 / 1000);
  const p2 = (x) => String(x).padStart(2, '0');
  bar.append(el('b', null, gwLabel(S.openGw)), el('span', null, `الموعد النهائي: ${fmtDate(S.openGw.deadline)}`),
    S.openGw.off && S.openGw.off.length ? el('span', 'offline', '⛔ فرق لا تلعب: ' + S.openGw.off.join('، ')) : el('span'),
    el('span', 'cd', `يتبقى ${d ? d + ' يوم ' : ''}${p2(h)}:${p2(m)}:${p2(sec)}`));
}
function renderChips() {
  const box = $('#chips'); if (!box) return;
  box.innerHTML = '';
  const names = { wc: 'Wildcard', fh: 'Free Hit', bb: 'Bench Boost', tc: 'Triple Captain' };
  const tips = { wc: 'تحويلات غير محدودة بدون خصم، وتبقى للفريق', fh: 'تحويلات غير محدودة لهذه الجولة فقط ثم يرجع فريقك', bb: 'نقاط الدكة تُحسب مع الأساسيين', tc: 'الكابتن ×3 بدل ×2' };
  Object.keys(CHIP_MAX).forEach((k) => {
    const left = CHIP_MAX[k] - (S.used[k] || 0);
    const b = el('button', 'chip' + (S.chip === k ? ' on' : ''), `${names[k]} (${left})`); b.type = 'button'; b.title = tips[k];
    b.disabled = !S.openGw || left <= 0;
    b.onclick = () => { S.chip = S.chip === k ? null : k; renderChips(); renderTeam(); };
    box.appendChild(b);
  });
}
function computeBase() {
  const prev = S.gws.filter((g) => !S.openGw || g.n < S.openGw.n);
  const tl = timeline(prev, (S.uid && S.allPicks[S.uid]) || {});
  S.base = tl.base; S.used = tl.used; S.ft = tl.ft;
}
// قراءة مباشرة لفريقي واختياراتي (احتياط إضافي، لا يعتمد على قراءة كل الفرق)
let mineT = 0, mineFor = null, mineP = null;
function loadMineOnce() {
  if (mineP && mineFor === S.uid && Date.now() - mineT < 60000) return mineP;
  mineP = loadMine(); return mineP;
}
async function loadMine() {
  if (!S.uid || !S.gws.length) { mineFor = S.uid || null; return; }
  const uid = S.uid;
  try {
    const [t, ...ps] = await Promise.all([getDoc(doc(S.db, 'teams', uid)),
      ...S.gws.map((g) => getDoc(doc(S.db, 'gameweeks', String(g.n), 'picks', uid)))]);
    if (uid !== S.uid) return;
    if (t.exists()) {
      const td = t.data(); S.teams.set(uid, td);
      const gi = gInfo();
      if (gi.gName && (td.gName !== gi.gName || (td.gPhoto || '') !== (gi.gPhoto || ''))) {
        const nd = { name: td.name, createdAt: td.createdAt, updatedAt: td.updatedAt || Date.now(), ...gi };
        fsSetDoc(doc(S.db, 'teams', uid), nd).then(() => S.teams.set(uid, nd)).catch(() => {});
      }
    }
    S.allPicks[uid] = {};
    ps.forEach((sn, i) => { if (sn.exists()) S.allPicks[uid][S.gws[i].n] = sn.data(); });
    mineFor = uid; mineT = Date.now();
  } catch (e) { mineFor = uid; toast('تعذر قراءة فريقك: ' + errText(e), true); }
}
// شاشة انتظار حتى يكتمل تحميل بيانات المستخدم وفريقه (تمنع الحفظ قبل التحميل)
let loadTimer = null;
function updateLoading() {
  const box = $('#loading'); if (!box) return;
  const ready = !S.db || (S.playersOk && S.gwsLoaded && S.authKnown && (!S.uid || S.loadedFor !== null));
  box.hidden = ready;
  clearTimeout(loadTimer);
  if (!ready) loadTimer = setTimeout(() => { box.hidden = true; toast('تأخر التحميل، تأكدي من الإنترنت ثم حدّثي الصفحة', true); }, 20000);
}
function renderDiag() {
  const d = $('#diag'); if (!d) return;
  if (!S.uid) { d.textContent = ''; return; }
  const ns = Object.keys((S.allPicks[S.uid]) || {}).map(Number).sort((x, y) => x - y);
  d.textContent = `الحساب: ${$('#meName').textContent || ''} · ` + (ns.length ? `فريقك المحفوظ موجود (الجولات: ${ns.join('، ')})` : 'لا يوجد فريق محفوظ لهذا الحساب');
}
async function refreshGame(force) {
  const old = S.openGw && S.openGw.n;
  S.openGw = S.gws.find((g) => g.deadline > Date.now()) || null;
  if (S.admin) {
    try {
      await loadPicks(!!force);
      if (S.openGw && !(S.picksFor || []).includes(S.openGw.n)) await loadPicks(true);
    } catch (e) { toast('تعذر تحميل الفرق: ' + errText(e), true); }
  }
  if (force) mineT = 0;
  await loadMineOnce();
  computeBase();
  // تحميل فريقي في المنشئ مرة واحدة لكل (مستخدم + جولة). إذا لا توجد جولة مفتوحة نعرض آخر تشكيلة محفوظة
  const key = S.uid && S.gwsLoaded && mineFor === S.uid ? S.uid + ':' + (S.openGw ? S.openGw.n : 'none') : null;
  if (key && S.loadedFor !== key) {
    S.loadedFor = key;
    const t = S.teams.get(S.uid); if (t) { $('#teamName').value = t.name || ''; S.hasTeam = true; }
    const mine = S.openGw ? (S.allPicks[S.uid] || {})[S.openGw.n] : null;
    if (mine) { applyTeam(mine); S.chip = mine.chip || null; }
    else if (S.base) { applyTeam(S.base.pick); S.chip = null; }
  } else if (!S.uid) S.loadedFor = null;
  if (old && !S.openGw) toast('انتهى الموعد النهائي للجولة 🔒');
  renderGwBar(); renderChips(); renderTeam(); renderList(); renderDiag(); updateLoading();
  if ($('#gwModal').classList.contains('open')) renderGwAdmin();
}
setInterval(() => {
  if (S.openGw && S.openGw.deadline <= Date.now()) refreshGame(true); else renderGwBar();
}, 1000);

// ---------- المشرف ----------
function setAdmin(on) {
  S.admin = on;
  if (!$('#tab-cup').hidden) renderCup();
  if (!$('#tab-clubs').hidden) renderClubs();
  $('#adminChip').hidden = !on; $('#addPlayer').hidden = !on; $('#gwAdmin').hidden = !on; $('#annAdmin').hidden = !on; $('#logAdmin').hidden = !on;
  if (on) setTimeout(() => adminRefreshTable(false), 4000);
  renderList();
  if (S.profile && $('#profileModal').classList.contains('open')) renderProfile();
}
function setUser(u) {
  $('#googleBtn').hidden = !!u; $('#me').hidden = !u;
  if (u) {
    $('#meName').textContent = u.displayName || u.email || '';
    const a = $('#meAvatar');
    if (u.photoURL) { a.src = u.photoURL; a.hidden = false; } else a.hidden = true;
  }
}
async function googleLogin() {
  if (!S.auth) return;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(S.auth, provider); }
  catch (e) {
    const c = e && e.code || '';
    if (c.includes('popup-blocked') || c.includes('operation-not-supported')) {
      try { await signInWithRedirect(S.auth, provider); } catch (e2) { toast(errText(e2), true); }
    } else toast(errText(e), true);
  }
}
$('#googleBtn').onclick = googleLogin;
$('#logoutBtn').onclick = async () => {
  try { await signOut(S.auth); } catch { /* تجاهل */ }
  S.slots = emptySlots(S.formation); S.bench = Array(S.rules.bench).fill(null); $('#teamName').value = '';
  S.captain = null; S.vice = null; S.chip = null; S.loadedFor = null; S.base = null; S.used = { wc: 0, fh: 0, bb: 0, tc: 0 }; S.ft = 1;
  renderChips(); renderTeam(); renderList(); toast('تم تسجيل الخروج');
};

// ---------- إدارة الجولات (للمشرف) ----------
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function renderGwAdmin() {
  const box = $('#gwList'); box.innerHTML = '';
  if (!S.gws.length) box.appendChild(el('div', 'empty-msg', 'لا توجد جولات بعد. أضف الجولة 1 بالأسفل.'));
  S.gws.forEach((g) => {
    const row = el('div', 'gw-row');
    const info = el('div', 'gw-info');
    info.append(el('b', null, gwLabel(g)), el('span', null, fmtDate(g.deadline)),
      el('span', g.final ? 'tag fin' : (g.deadline > Date.now() ? 'tag open' : 'tag lock'), g.final ? 'منتهية' : (g.deadline > Date.now() ? 'مفتوحة' : 'مقفلة')),
      g.pricesApplied ? el('span', 'tag fin', 'تم تحديث الأسعار') : el('span'));
    const acts = el('div', 'gw-acts');
    const edit = el('button', 'btn ghost sm', 'تعديل الموعد');  edit.onclick = () => loadGwForm(g);
    const fin = el('button', 'btn ghost sm', g.final ? 'إعادة فتح الحساب' : 'إنهاء الجولة (حساب البدلاء والكابتن)'); 
    fin.onclick = async () => {
      try { await setDoc(doc(S.db, 'gameweeks', String(g.n)), { n: g.n, stage: g.stage || 'gw', deadline: g.deadline, final: !g.final }, { merge: true }); toast('تم'); setTimeout(() => adminRefreshTable(true), 1500); }
      catch (e) { toast(errText(e), true); }
    };
    edit.type = fin.type = 'button'; acts.append(edit, fin);
    if (g.final && !g.pricesApplied) {
      const pr = el('button', 'btn ghost sm', 'تحديث الأسعار');  let armed = null;
      pr.onclick = async () => {
        try {
          if (!armed) {
            await loadPicks(true);
            const all = {}; Object.keys(S.allPicks).forEach((u) => { if (S.teams.has(u)) all[u] = S.allPicks[u]; });
            const { net, teamsN } = netTransfers(S.gws, all, g.n);
            armed = priceChanges(net, teamsN, S.players);
            pr.textContent = armed.changes.length ? `سيتغير سعر ${armed.changes.length} لاعب (الحد ${armed.T}) — اضغط للتأكيد` : 'لا تغييرات — اضغط لإنهاء التحديث';
            return;
          }
          for (const c of armed.changes) await patchPlayer(c.id, { price: c.to });
          await setDoc(doc(S.db, 'gameweeks', String(g.n)), { n: g.n, stage: g.stage || 'gw', deadline: g.deadline, final: true, pricesApplied: true }, { merge: true });
          toast('تم تحديث الأسعار ✅');
        } catch (e) { toast(errText(e), true); }
      };
      pr.type = 'button'; acts.appendChild(pr);
    }
    row.append(info, acts); box.appendChild(row);
  });
}
function clubNames() {
  const s = new Set(S.players.map((p) => p.club).filter(Boolean));
  (S.cup.groups || []).forEach((gr) => (gr.teams || []).forEach((t) => s.add(t)));
  return [...s].sort((x, y) => x.localeCompare(y, 'ar'));
}
function drawOff(sel) {
  const box = $('#gwOff'); box.innerHTML = '';
  const names = clubNames();
  if (!names.length) { box.appendChild(el('div', 'hint', 'أضيفي لاعبين أو مجموعات أولًا لتظهر الفرق هنا.')); return; }
  names.forEach((n) => {
    const l = el('label', 'offchk'); const i = el('input'); i.type = 'checkbox'; i.value = n; i.checked = sel.includes(n);
    l.append(i, document.createTextNode(' ' + n)); box.appendChild(l);
  });
}
function loadGwForm(g) {
  $('#gwNum').value = g.n; $('#gwStage').value = g.stage || 'gw'; $('#gwDeadline').value = toLocalInput(g.deadline); drawOff(g.off || []);
}
$('#gwNum').onchange = () => { const g = S.gws.find((x) => x.n === Number($('#gwNum').value)); if (g) loadGwForm(g); };
$('#gwPreset').onclick = async () => {
  const dl0 = new Date($('#gwDeadline').value).getTime();
  if (!Number.isFinite(dl0)) { $('#gwErr').textContent = 'اختاري أولًا موعد الجولة الأولى في خانة الموعد النهائي'; return; }
  try {
    for (let i = 0; i < PRESET.length; i++) {
      const n = i + 1; if (S.gws.some((x) => x.n === n)) continue;
      await setDoc(doc(S.db, 'gameweeks', String(n)), { n, stage: PRESET[i], deadline: dl0 + i * 7 * 864e5, off: [], final: false, pricesApplied: false });
    }
    $('#gwErr').textContent = ''; toast('تم إنشاء الجولات الثمانية. عدّلي موعد كل جولة من زر "تعديل الموعد"');
  } catch (er) { $('#gwErr').textContent = errText(er); }
};
$('#gwAdmin').onclick = () => {
  if (!S.admin) return;
  const next = S.gws.length ? Math.max(...S.gws.map((g) => g.n)) + 1 : 1;
  $('#gwNum').value = next; $('#gwDeadline').value = toLocalInput(Date.now() + 7 * 864e5);
  $('#gwErr').textContent = ''; $('#gwStage').value = 'gw'; drawOff([]); renderGwAdmin(); openModal('#gwModal');
};
$('#gwForm').onsubmit = async (e) => {
  e.preventDefault();
  const n = Number($('#gwNum').value), dl = new Date($('#gwDeadline').value).getTime();
  if (!(Number.isInteger(n) && n >= 1 && n <= 99)) { $('#gwErr').textContent = 'رقم الجولة من 1 إلى 99'; return; }
  if (!Number.isFinite(dl)) { $('#gwErr').textContent = 'اختر تاريخ ووقت الموعد النهائي'; return; }
  try {
    const old = S.gws.find((g) => g.n === n);
    await setDoc(doc(S.db, 'gameweeks', String(n)), { n, stage: $('#gwStage').value, deadline: dl, off: [...document.querySelectorAll('#gwOff input:checked')].map((x) => x.value), final: old ? old.final : false, pricesApplied: old ? !!old.pricesApplied : false }, { merge: true });
    $('#gwErr').textContent = ''; toast('تم حفظ الجولة');
  } catch (er) { $('#gwErr').textContent = errText(er); }
};

let editing = null, photoData; // photoData: undefined = بدون تغيير، null = حذف، نص = صورة جديدة
function setPrev(src) {
  const pv = $('#pfPrev'); pv.innerHTML = '';
  if (src) { const i = new Image(); i.src = src; pv.appendChild(i); $('#pfClear').hidden = false; }
  else { pv.textContent = 'بدون صورة'; $('#pfClear').hidden = true; }
}
function openPlayerForm(id) {
  if (!S.admin) return;
  editing = id ? S.byId.get(id) : null; photoData = undefined;
  $('#pfTitle').textContent = editing ? 'تعديل بيانات اللاعب' : 'إضافة لاعب جديد';
  $('#pfSave').textContent = editing ? 'حفظ التعديلات' : 'حفظ اللاعب';
  $('#pfName').value = editing?.name || ''; $('#pfDesc').value = editing?.desc || '';
  $('#pfPos').value = editing?.position || 'mid'; $('#pfClub').value = editing?.club || '';
  $('#pfPrice').value = editing?.price ?? 6; $('#pfPoints').value = editing ? totalPts(editing) : 0;
  setPrev(photoUrl(editing));
  $('#pfDelete').hidden = !editing; $('#pfDelete').textContent = 'حذف اللاعب'; $('#pfDelete').dataset.armed = '';
  $('#pfErr').textContent = ''; $('#pfSave').disabled = false;
  openModal('#playerModal'); setTimeout(() => $('#pfName').focus(), 50);
}
$('#addPlayer').onclick = () => openPlayerForm(null);
$('#pfPick').onclick = () => $('#pfFile').click();
$('#pfClear').onclick = () => { photoData = null; setPrev(null); };
$('#pfFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!f.type.startsWith('image/')) { $('#pfErr').textContent = 'الملف يجب أن يكون صورة'; return; }
  try { photoData = await resizeImage(f); setPrev(photoData); $('#pfErr').textContent = ''; }
  catch { $('#pfErr').textContent = 'تعذّر قراءة الصورة، جرّب صورة أخرى'; }
};
function resizeImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const N = 400, s = Math.min(img.width, img.height);
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, N, N);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(); };
    img.src = url;
  });
}
$('#playerForm').onsubmit = async (e) => {
  e.preventDefault();
  const body = {
    name: $('#pfName').value.trim(), desc: $('#pfDesc').value.trim(), position: $('#pfPos').value,
    club: $('#pfClub').value.trim(), price: Number($('#pfPrice').value),
  };
  body.points = totalPts({ position: body.position, matches: editing?.matches });
  if (!body.name) { $('#pfErr').textContent = 'اكتب اسم اللاعب'; return; }
  if (!body.club) { $('#pfErr').textContent = 'اكتب اسم الفريق'; return; }
  if (!(body.price >= 1 && body.price <= 20)) { $('#pfErr').textContent = 'السعر يجب أن يكون بين 1 و 20'; return; }
  body.price = Math.round(body.price * 10) / 10;
  body.photo = photoData !== undefined ? photoData : (editing ? editing.photo || null : null);
  const now = Date.now();
  body.createdAt = editing ? editing.createdAt : now; body.updatedAt = now;
  $('#pfSave').disabled = true;
  try {
    const ref = editing ? doc(S.db, 'players', editing.id) : doc(collection(S.db, 'players'));
    await setDoc(ref, body, { merge: true });
    closeModal('#playerModal'); toast(editing ? 'تم حفظ التعديلات' : 'تمت إضافة اللاعب');
  } catch (err) {
    $('#pfSave').disabled = false; $('#pfErr').textContent = errText(err);
  }
};
$('#pfDelete').onclick = async () => {
  const b = $('#pfDelete');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'اضغط مرة أخرى للتأكيد'; return; }
  try {
    await deleteDoc(doc(S.db, 'players', editing.id));
    removeFromTeam(editing.id);
    closeModal('#playerModal'); toast('تم حذف اللاعب');
  } catch (err) { $('#pfErr').textContent = errText(err); }
};

// ---------- التشغيل ----------
function applyPlayers(list) {
  S.players = list.map((p) => ({ ...p, points: totalPts(p) }));
  S.byId = new Map(S.players.map((p) => [p.id, p]));
  ORDER.forEach((k) => { if (S.slots[k]) S.slots[k] = S.slots[k].map((id) => (id && S.byId.has(id) ? id : null)); });
  S.bench = S.bench.map((id) => (id && S.byId.has(id) ? id : null));
  renderTeam(); renderList();
  if (!$('#tab-cup').hidden) renderCup();
  if (S.profile && $('#profileModal').classList.contains('open')) renderProfile();
  if ($('#fixtureModal').classList.contains('open')) renderFixtureList();
}

let playersReady, playersLoaded;
playersReady = new Promise((r) => { playersLoaded = r; });

(function init() {
  S.rules = RULES;
  const sel = $('#formation');
  Object.keys(S.rules.formations).forEach((f) => sel.appendChild(el('option', null, f)));
  S.formation = Object.keys(S.rules.formations)[0]; sel.value = S.formation;
  S.slots = emptySlots(S.formation); S.bench = Array(S.rules.bench).fill(null);
  $('#rulesHint').textContent = `${S.rules.starters} لاعبين أساسيين و${S.rules.bench === 1 ? 'بديل واحد' : S.rules.bench + ' بدلاء'}، والميزانية ${money(S.rules.budget)}. اضغط C لتحديد الكابتن (نقاطه ×2) وV للنائب (يحل محله إذا لم يلعب). تحويلان مجانيان كل جولة (يتراكمان حتى ${3})، وكل تحويل إضافي يخصم ${HIT} نقاط. الحد الأقصى ${S.rules.maxPerClub} لاعبين من نفس الفريق. التعديل ممكن حتى الموعد النهائي لكل جولة.`;
  setAdmin(false); setUser(null); $('#googleBtn').hidden = true; renderTeam(); renderChips(); renderGwBar();

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    const m = $('#setupMsg'); m.hidden = false;
    m.textContent = 'الموقع يحتاج إلى ربطه بـ Firebase: الصقي بيانات مشروعك في الملف firebase-config.js (الخطوات في README).';
    renderList(); return;
  }
  const app = initializeApp(firebaseConfig);
  S.auth = getAuth(app); S.db = getFirestore(app);

  onSnapshot(query(collection(S.db, 'players'), orderBy('createdAt')),
    (snap) => { applyPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); S.playersOk = true; playersLoaded(); updateLoading(); },
    (e) => { toast(errText(e), true); playersLoaded(); });

  onSnapshot(collection(S.db, 'gameweeks'),
    async (snap) => {
      S.gws = snap.docs.map((d) => d.data()).sort((a, b) => a.n - b.n); S.gwsLoaded = true; updateLoading();
      await playersReady; S.picksT = 0;
      refreshGame(true);
    },
    (e) => toast(errText(e), true));

  onSnapshot(doc(S.db, 'cup', 'main'),
    (snap) => { S.cup = snap.exists() ? snap.data() : { groups: [], ko: {} }; if (!$('#tab-cup').hidden) renderCup(); },
    () => {});

  onSnapshot(collection(S.db, 'clubs'),
    (snap) => { S.clubs = new Map(snap.docs.map((d) => [d.data().name, d.data()])); renderList(); if (!$('#tab-clubs').hidden) renderClubs(); if (!$('#tab-cup').hidden) renderCup(); if (!$('#tab-matches').hidden) renderMatches(); },
    () => {});

  onSnapshot(collection(S.db, 'matches'),
    (snap) => { S.matches = snap.docs.map((d) => ({ id: d.id, ...d.data() })); applyGold(); if (!$('#tab-matches').hidden) renderMatches(); if (!$('#tab-cup').hidden) renderCup(); if ($('#mvModal').classList.contains('open')) renderMatchView(); },
    () => {});

  onSnapshot(doc(S.db, 'site', 'table'), (s) => { S.table = s.exists() ? s.data() : null; if (!S.admin && S.table && S.table.sel) S.sel = S.table.sel; if (!$('#tab-table').hidden && !S.admin) renderStandings(); }, () => {});
  onSnapshot(doc(S.db, 'site', 'potw'), (s) => { S.potw = s.exists() ? s.data() : null; if (!$('#tab-table').hidden) renderPotw(); }, () => {});
  onSnapshot(doc(S.db, 'site', 'main'), (s) => { S.site = s.exists() ? s.data() : {}; renderAnn(); applyGold(); }, () => {});

  getRedirectResult(S.auth).catch((e) => toast(errText(e), true));
  let welcomed = false;
  onAuthStateChanged(S.auth, async (u) => {
    S.uid = u ? u.uid : null; S.hasTeam = false; S.loadedFor = null; S.authKnown = true;
    updateLoading(); setUser(u);
    const admin = !!u && ADMIN_UID.split(',').map((x) => x.trim()).filter(Boolean).includes(u.uid);
    setAdmin(admin);
    if (u) {
      if (!welcomed) toast(admin ? 'مرحبًا بك، تم دخول المشرف 👑' : `أهلًا ${u.displayName || ''}`);
      welcomed = true;
      await playersReady; refreshGame(true);
    } else welcomed = false;
    if (!$('#tab-table').hidden) renderStandings();
    if (!$('#tab-cup').hidden) renderCup();
    if (u) checkJoinLink();
  });
})();


// ---------- المباريات ----------
const fmtDay = (t) => new Date(t).toLocaleDateString('ar-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'long' });
const fmtTime = (t) => new Date(t).toLocaleTimeString('ar-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const isDone = (m) => Number.isFinite(m.sa) && Number.isFinite(m.sb);
const sameDay = (x, y) => new Date(x).toDateString() === new Date(y).toDateString();
// اليوم / غدًا / أمس بدل التاريخ
function relDay(t) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(t); d1.setHours(0, 0, 0, 0);
  const diff = Math.round((d1 - d0) / 864e5);
  return diff === 0 ? 'اليوم' : diff === 1 ? 'غدًا' : diff === -1 ? 'أمس' : fmtDay(t);
}
// جولة الفانتازي للمباراة: آخر جولة بدأ موعدها قبل وقت المباراة
function gwOfTime(at) {
  const gs = [...S.gws].sort((x, y) => x.n - y.n);
  let r = gs.length ? gs[0].n : 1;
  gs.forEach((g) => { if (g.deadline <= at) r = g.n; });
  return r;
}
const gwName = (n) => { const g = S.gws.find((x) => x.n === n); return g ? gwLabel(g) : 'الجولة ' + n; };

function matchTeam(name, score) {
  const r = el('div', 'mt-team');
  r.append(tlogo(name, 'md', true), el('span', 'mt-name', name));
  if (score != null) r.appendChild(el('b', 'mt-sc', String(score)));
  return r;
}
function onMatchClick(m) { openMatchView(m.id); }
function matchFeatured(m) {
  const c = el('div', 'mt-feat clickable');
  c.appendChild(el('div', 'mt-note', gwName(m.round || gwOfTime(m.at))));
  const row = el('div', 'mt-frow');
  const side = (n) => { const s = el('div', 'mt-fside'); s.append(tlogo(n, 'xl', true), el('div', 'mt-fname', n)); return s; };
  const mid = el('div', 'mt-fmid');
  if (isDone(m)) mid.append(el('div', 'mt-fscore', `${m.sa} - ${m.sb}`), el('div', 'mt-fsub', 'انتهت'), el('div', 'mt-fsub', relDay(m.at)));
  else mid.append(el('div', 'mt-fday', relDay(m.at)), el('div', 'mt-ftime', fmtTime(m.at)));
  row.append(side(m.a), mid, side(m.b)); c.appendChild(row);
  c.appendChild(predButtons(m));
  c.onclick = () => onMatchClick(m);
  return c;
}
function matchRow(m) {
  const r = el('div', 'mt-row clickable');
  const teams = el('div', 'mt-teams'); const done = isDone(m);
  teams.append(matchTeam(m.a, done ? m.sa : null), matchTeam(m.b, done ? m.sb : null));
  const when = el('div', 'mt-when'); when.append(el('div', null, relDay(m.at)), el('div', 'mt-t', done ? 'انتهت' : fmtTime(m.at)));
  r.append(teams, when);
  r.onclick = () => onMatchClick(m);
  return r;
}
function renderMatches() {
  const box = $('#matchesBody'); box.innerHTML = '';
  const all = (S.matches || []).slice().sort((x, y) => x.at - y.at);
  if (S.admin) {
    const h = el('div', 'cup-sec-h'); h.appendChild(el('span', 'hint', 'اضغطي على أي مباراة ثم «إدارة المباراة» لإدخال التشكيلة والأحداث والإحصائيات.'));
    const b = el('button', 'btn primary sm', '+ مباراة'); b.type = 'button'; b.onclick = () => openGameForm(null); h.appendChild(b); box.appendChild(h);
  }
  if (!all.length) { box.appendChild(el('div', 'cup-empty', S.admin ? 'اضغطي "+ مباراة" وأضيفي أول مباراة.' : 'لم تُعلن المباريات بعد')); return; }
  const upcoming = all.filter((m) => !isDone(m));
  const done = all.filter(isDone).reverse();
  const feat = upcoming.find((m) => sameDay(m.at, Date.now())) || upcoming[0] || done[0];
  box.appendChild(matchFeatured(feat));
  const sec = (t, list) => {
    if (!list.length) return;
    box.appendChild(el('h3', 'mt-h', t));
    const g = el('div', 'mt-list'); list.forEach((m) => g.appendChild(matchRow(m))); box.appendChild(g);
  };
  sec('المباريات القادمة', upcoming.filter((m) => m !== feat));
  sec('النتائج', done.filter((m) => m !== feat));
}

// إضافة/تعديل مباراة: الفريقان والوقت فقط
let editM = null;
function openGameForm(id) {
  if (!S.admin) return;
  const m = id ? (S.matches || []).find((x) => x.id === id) : null;
  editM = id;
  $('#gTitle').textContent = m ? `${m.a} × ${m.b}` : 'مباراة جديدة';
  $('#gA').value = m ? m.a : ''; $('#gB').value = m ? m.b : '';
  $('#gAt').value = toLocalInput(m ? m.at : Date.now());
  $('#gDel').hidden = !m; $('#gDel').textContent = 'حذف المباراة'; $('#gErr').textContent = '';
  $('#gRes').hidden = false;
  $('#gTeams').innerHTML = ''; allClubs().forEach(([n]) => { const o = document.createElement('option'); o.value = n; $('#gTeams').appendChild(o); });
  openModal('#gameModal');
}
function readGameForm() {
  const a1 = $('#gA').value.trim(), b1 = $('#gB').value.trim(), at = new Date($('#gAt').value).getTime();
  if (!a1 || !b1 || a1 === b1) { $('#gErr').textContent = 'اكتبي فريقين مختلفين'; return null; }
  if (!Number.isFinite(at)) { $('#gErr').textContent = 'حددي التاريخ والوقت'; return null; }
  return { a: a1, b: b1, at };
}
async function saveGameBasics() {
  const f = readGameForm(); if (!f) return null;
  const old = editM ? (S.matches || []).find((x) => x.id === editM) : null;
  const id = editM || 'm' + Date.now().toString(36);
  const d = { a: f.a, b: f.b, at: f.at, sa: old ? old.sa : null, sb: old ? old.sb : null, round: old && old.round ? old.round : null, updatedAt: Date.now() };
  await setDoc(doc(S.db, 'matches', id), d);
  S.matches = (S.matches || []).filter((x) => x.id !== id).concat([{ id, ...d }]);
  editM = id; return id;
}
$('#gameForm').onsubmit = async (e) => {
  e.preventDefault();
  try { if (await saveGameBasics()) { closeModal('#gameModal'); toast('تم الحفظ'); } }
  catch (er) { $('#gErr').textContent = errText(er); }
};
$('#gRes').onclick = async () => {
  try { const id = await saveGameBasics(); if (id) { closeModal('#gameModal'); openMatchEditor(id); } }
  catch (er) { $('#gErr').textContent = errText(er); }
};
// حذف المباراة يحذف إحصائياتها من اللاعبين أيضًا
$('#gDel').onclick = async () => {
  const b = $('#gDel');
  if (b.textContent !== 'تأكيد الحذف؟') { b.textContent = 'تأكيد الحذف؟'; return; }
  try {
    for (const p of S.players.filter((x) => (x.matches || []).some((m) => m.fx === editM))) {
      const ms = p.matches.filter((m) => m.fx !== editM);
      await patchPlayer(p.id, { matches: ms, points: totalPts({ position: p.position, matches: ms }) });
    }
    await deleteDoc(doc(S.db, 'matches', editM)); closeModal('#gameModal'); toast('تم الحذف');
  } catch (er) { $('#gErr').textContent = errText(er); }
};

// ---------- تفاصيل المباراة (مثل قوقل): الأحداث، التشكيلة، الإحصائيات ----------
const EV = { goal: 'هدف', og: 'هدف عكسي', pm: 'ركلة جزاء ضائعة', ps: 'تصدي لضربة جزاء', yc: 'إنذار', rc: 'طرد', sub: 'تبديل', var: 'فار / ملاحظة' };
const EV_ICON = { goal: '⚽', og: '🔴⚽', pm: '❌', ps: '🧤', yc: '🟨', rc: '🟥', sub: '🔁', var: '📺' };
const TST = [['shots', 'التسديدات'], ['sot', 'على المرمى'], ['poss', 'الاستحواذ %'], ['fouls', 'الأخطاء']];
const minKey = (s) => { const t = String(s || '').replace(/[^0-9+]/g, ''); const [x, y] = t.split('+'); return (Number(x) || 0) + (Number(y) || 0) / 100; };
const minTxt = (s) => (s ? '\u2066' + String(s).replace(/[^0-9+]/g, '') + "'\u2069" : '');
const clubPlayers = (c) => S.players.filter((p) => p.club === c).sort((x, y) => ORDER.indexOf(x.position) - ORDER.indexOf(y.position));
const sideClub = (m, s) => (s === 'a' ? m.a : m.b);

// كل شيء يُشتق من التشكيلة والأحداث: النتيجة ونقاط كل لاعب
function deriveMatch(m) {
  const ev = [...(m.events || [])].sort((x, y) => minKey(x.min) - minKey(y.min));
  let sa = 0, sb = 0; const pl = {};
  const P = (id) => (pl[id] = pl[id] || { g: 0, a: 0, yc: 0, rc: 0, pm: 0, ps: 0, og: 0, in: null, out: null, goals: [] });
  const lu = m.lineup || {};
  ['a', 'b'].forEach((s) => { ((lu[s] || {}).st || []).forEach((id) => { P(id).start = true; P(id).side = s; }); ((lu[s] || {}).bn || []).forEach((id) => { P(id).bench = true; P(id).side = s; }); });
  ev.forEach((e) => {
    if (e.t === 'goal') { if (e.s === 'a') sa++; else sb++; if (e.p) { P(e.p).g++; P(e.p).side = e.s; } if (e.as) P(e.as).a++; }
    else if (e.t === 'og') { if (e.s === 'a') sb++; else sa++; if (e.p) { P(e.p).og++; P(e.p).side = e.s; } }
    else if (e.t === 'yc' && e.p) P(e.p).yc++;
    else if (e.t === 'rc' && e.p) P(e.p).rc++;
    else if (e.t === 'pm' && e.p) P(e.p).pm++;
    else if (e.t === 'ps' && e.p) P(e.p).ps++;
    else if (e.t === 'sub') { if (e.p) { P(e.p).in = e.min; P(e.p).side = e.s; } if (e.out) P(e.out).out = e.min; }
    e._sa = sa; e._sb = sb;
  });
  Object.entries(pl).forEach(([id, x]) => { x.played = !!(x.start || x.in); });
  return { ev, sa, sb, pl };
}
function playerEntry(m, id, x, sa, sb, round) {
  const p = S.byId.get(id); const s = x.side || (p && p.club === m.b ? 'b' : 'a');
  return { round, opp: s === 'a' ? m.b : m.a, home: s === 'a', gf: s === 'a' ? sa : sb, ga: s === 'a' ? sb : sa, min: x.played ? 90 : 0, sv: 0,
    g: x.g, a: x.a, yc: Math.min(2, x.yc), rc: Math.min(1, x.rc), pm: x.pm, ps: x.ps, og: x.og, bo: Math.max(0, Math.min(2, Number((m.bonus || {})[id]) || 0)), fx: m.id };
}

// ===== محرر المباراة (للمشرف) =====
let MX = null, mxTab = 'lineup';
function openMatchEditor(id) {
  const m = (S.matches || []).find((x) => x.id === id); if (!m || !S.admin) return;
  MX = JSON.parse(JSON.stringify({ lineup: { a: { st: [], bn: [] }, b: { st: [], bn: [] } }, events: [], stats: {}, ratings: {}, bonus: {}, ...m }));
  ['a', 'b'].forEach((s) => { MX.lineup[s] = { st: [], bn: [], ...(MX.lineup[s] || {}) }; });
  MX.round = m.round || gwOfTime(m.at);
  $('#mxTitle').textContent = `${m.a} × ${m.b}`;
  const sel = $('#mxRound'); sel.innerHTML = '';
  const ns = S.gws.length ? S.gws.map((g) => g.n) : [MX.round]; if (!ns.includes(MX.round)) ns.push(MX.round);
  ns.sort((x, y) => x - y).forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = gwName(n); sel.appendChild(o); });
  sel.value = MX.round; sel.onchange = () => { MX.round = Number(sel.value); };
  mxOpen.clear();
  $('#mxFin').checked = isDone(m) || Date.now() > m.at + 3600e3;
  $('#mxErr').textContent = ''; $('#mxSave').disabled = false; mxTab = 'lineup';
  mxRender(); openModal('#mxModal');
}
function mxScore() { const d = deriveMatch(MX); $('#mxScore').textContent = `${MX.a} ${d.sa} - ${d.sb} ${MX.b}`; return d; }
function mxRender() {
  document.querySelectorAll('#mxTabs .pf-tab').forEach((b) => b.classList.toggle('active', b.dataset.t === mxTab));
  const body = $('#mxBody'); body.innerHTML = '';
  if (mxTab === 'lineup') mxLineup(body); else if (mxTab === 'events') mxEvents(body); else mxStats(body);
  mxScore();
}
document.querySelectorAll('#mxTabs .pf-tab').forEach((b) => b.onclick = () => { mxTab = b.dataset.t; mxRender(); });

function mxLineup(body) {
  body.appendChild(el('p', 'hint', 'اختاري لكل لاعب: أساسي أو احتياط. التقييم (0-10) وأفضل لاعب تكتبينهم بإيدك. اللاعب الأساسي أو اللي دخل بديل ياخذ نقاط المشاركة.'));
  const d = deriveMatch(MX);
  ['a', 'b'].forEach((s) => {
    const club = sideClub(MX, s); const sec = el('div', 'rs-sec');
    const hh = el('div', 'rs-team'); hh.append(tlogo(club, 'md', true), el('b', null, club)); sec.appendChild(hh);
    const ps = clubPlayers(club);
    if (!ps.length) sec.appendChild(el('div', 'empty-msg', 'لا يوجد لاعبون بهذا الاسم في تبويب الفرق.'));
    ps.forEach((p) => {
      const r = el('div', 'mx-pl'); const L = MX.lineup[s];
      const role = L.st.includes(p.id) ? 'st' : L.bn.includes(p.id) ? 'bn' : '';
      const nm = el('div', 'mx-n'); nm.append(avatar(p, 'club-av'), el('span', 'pos ' + p.position, POS[p.position].one), el('b', null, p.name));
      const rs = el('select', 'mx-role'); [['', '— لم يشارك'], ['st', 'أساسي'], ['bn', 'احتياط']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; rs.appendChild(o); }); rs.value = role;
      const rt = el('input', 'mx-rt'); rt.type = 'number'; rt.step = '0.1'; rt.min = '0'; rt.max = '10'; rt.placeholder = 'تقييم'; rt.value = MX.ratings[p.id] ?? '';
      const bo = el('select', 'mx-bo'); [0, 1, 2].forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v ? `⭐ +${v}` : 'أفضل لاعب: 0'; bo.appendChild(o); }); bo.value = MX.bonus[p.id] || 0;
      const pts = el('span', 'mx-pts');
      const upd = () => { const x = deriveMatch(MX).pl[p.id]; if (!x || !x.played) { pts.textContent = ''; return; } const d2 = deriveMatch(MX); pts.textContent = matchPts(p.position, playerEntry(MX, p.id, x, d2.sa, d2.sb, 0)) + ' ن'; };
      rs.onchange = () => { L.st = L.st.filter((x) => x !== p.id); L.bn = L.bn.filter((x) => x !== p.id); if (rs.value) L[rs.value].push(p.id); upd(); mxScore(); };
      rt.oninput = () => { const v = Number(rt.value); if (rt.value === '' || !Number.isFinite(v)) delete MX.ratings[p.id]; else MX.ratings[p.id] = Math.max(0, Math.min(10, Math.round(v * 10) / 10)); };
      bo.onchange = () => { const v = Number(bo.value); if (v) MX.bonus[p.id] = v; else delete MX.bonus[p.id]; upd(); };
      const ctl = el('div', 'mx-ctl'); ctl.append(rs, rt, bo, pts);
      nm.classList.add('clickable'); nm.title = 'اضغطي لإضافة أهداف وبطاقات اللاعب';
      const arrow = el('span', 'mx-arr', mxOpen.has(p.id) ? '▲' : '▼'); nm.appendChild(arrow);
      const pp = el('div', 'mx-pp'); pp.hidden = !mxOpen.has(p.id);
      nm.onclick = () => { if (mxOpen.has(p.id)) mxOpen.delete(p.id); else mxOpen.add(p.id); pp.hidden = !mxOpen.has(p.id); arrow.textContent = pp.hidden ? '▼' : '▲'; if (!pp.hidden) drawPP(); };
      const drawPP = () => mxPlayerPanel(pp, p, s, () => { rs.value = L.st.includes(p.id) ? 'st' : L.bn.includes(p.id) ? 'bn' : ''; upd(); mxScore(); });
      if (!pp.hidden) drawPP();
      r.append(nm, ctl, pp); sec.appendChild(r); upd();
    });
    body.appendChild(sec);
  });
}

// لوحة اللاعب: أحداثه في هذه المباراة
const mxOpen = new Set();
function mxPlayerPanel(pp, p, s, changed) {
  pp.innerHTML = '';
  const L = MX.lineup[s];
  const mine = MX.events.map((e, i) => [e, i]).filter(([e]) => e.p === p.id || e.as === p.id || e.out === p.id).sort((x, y) => minKey(x[0].min) - minKey(y[0].min));
  const cnt = { g: 0, a: 0, yc: 0, rc: 0, pm: 0, ps: 0, og: 0 };
  mine.forEach(([e]) => { if (e.t === 'goal' && e.p === p.id) cnt.g++; if (e.t === 'goal' && e.as === p.id) cnt.a++; if (['yc', 'rc', 'pm', 'ps', 'og'].includes(e.t) && e.p === p.id) cnt[e.t]++; });
  const sum = el('div', 'mx-psum');
  [['⚽', 'أهداف', cnt.g], ['👟', 'صناعة', cnt.a], ['🟨', 'صفراء', cnt.yc], ['🟥', 'حمراء', cnt.rc], ['❌', 'جزاء ضائعة', cnt.pm], ['🧤', 'تصدي جزاء', cnt.ps], ['🔴', 'عكسي', cnt.og]].forEach(([i, l, v]) => { const c = el('div', 'mx-pc' + (v ? ' on' : '')); c.append(el('b', null, `${i} ${v}`), el('span', null, l)); sum.appendChild(c); });
  pp.appendChild(sum);
  const row = el('div', 'mx-padd');
  const mn = el('input'); mn.type = 'text'; mn.maxLength = 7; mn.placeholder = 'الدقيقة'; mn.className = 'mx-pmin';
  const er = el('div', 'err');
  const teamGoals = () => MX.events.filter((e) => e.t === 'goal' && e.s === s && e.p && e.p !== p.id && !e.as);
  const asSel = el('select', 'mx-pas'); asSel.hidden = true;
  const add = (t) => {
    const m0 = mn.value.replace(/[^0-9+]/g, '').slice(0, 7);
    if (t !== 'as' && !m0.replace(/\D/g, '')) { er.textContent = 'اكتبي الدقيقة أول'; mn.focus(); return; }
    if (t === 'as') {
      const gs = teamGoals();
      if (!gs.length) { er.textContent = 'سجّلي هدف زميله أولًا، وبعدها أضيفي الصناعة'; return; }
      if (gs.length > 1 && asSel.hidden) { asSel.innerHTML = ''; gs.forEach((g) => { const o = document.createElement('option'); o.value = MX.events.indexOf(g); o.textContent = `هدف ${(S.byId.get(g.p) || {}).name || ''} ${minTxt(g.min)}`; asSel.appendChild(o); }); asSel.hidden = false; er.textContent = 'اختاري الهدف واضغطي 👟 مرة ثانية'; return; }
      const g = gs.length === 1 ? gs[0] : MX.events[Number(asSel.value)]; g.as = p.id;
    } else MX.events.push({ t, min: m0, s, p: p.id, ...(t === 'goal' ? { as: null } : {}) });
    if (!L.st.includes(p.id) && !L.bn.includes(p.id)) L.st.push(p.id);
    mxPlayerPanel(pp, p, s, changed); changed();
  };
  [['goal', '⚽ هدف'], ['as', '👟 صناعة'], ['yc', '🟨 صفراء'], ['rc', '🟥 حمراء'], ['pm', '❌ جزاء ضائعة'], ['ps', '🧤 تصدي لجزاء'], ['og', '🔴 هدف عكسي']].forEach(([t, l]) => { const b = el('button', 'btn ghost sm', '+ ' + l); b.type = 'button'; b.onclick = () => add(t); row.appendChild(b); });
  pp.append(el('label', null, 'الدقيقة ثم اختاري الحدث:'), mn, row, asSel, er);
  const list = el('div', 'mx-plist');
  mine.forEach(([e, i]) => {
    let txt = `${EV_ICON[e.t]} ${minTxt(e.min)} ${EV[e.t]}`;
    if (e.t === 'goal' && e.as === p.id) txt = `👟 ${minTxt(e.min)} صناعة هدف ${(S.byId.get(e.p) || {}).name || ''}`;
    else if (e.t === 'goal' && e.as) txt += ` (صناعة ${(S.byId.get(e.as) || {}).name || ''})`;
    if (e.t === 'sub') txt = e.p === p.id ? `🟢⬆ ${minTxt(e.min)} دخل بديل` : `🔻 ${minTxt(e.min)} خرج`;
    const it = el('div', 'mx-ev'); const del = el('button', 'pf-edit', '✕'); del.type = 'button';
    del.onclick = () => { if (e.t === 'goal' && e.as === p.id && e.p !== p.id) e.as = null; else MX.events.splice(i, 1); mxPlayerPanel(pp, p, s, changed); changed(); };
    it.append(el('span', null, txt), del); list.appendChild(it);
  });
  if (!mine.length) list.appendChild(el('div', 'ev-ps', 'لا توجد أحداث لهذا اللاعب بعد.'));
  pp.appendChild(list);
}
function optList(sel, list, empty) {
  sel.innerHTML = ''; if (empty) { const o = document.createElement('option'); o.value = ''; o.textContent = empty; sel.appendChild(o); }
  list.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
}
function mxEvents(body) {
  const f = el('div', 'mx-evf');
  const t = el('select'); Object.entries(EV).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = EV_ICON[k] + ' ' + v; t.appendChild(o); });
  const mn = el('input'); mn.type = 'text'; mn.placeholder = 'الدقيقة مثل 45 أو 90+3'; mn.maxLength = 7; mn.inputMode = 'text';
  const sd = el('select'); [['a', MX.a], ['b', MX.b]].forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sd.appendChild(o); });
  const pl = el('select'), x2 = el('select'), note = el('input'); note.type = 'text'; note.maxLength = 80; note.placeholder = 'مثال: الفار ألغى الهدف';
  const l1 = el('label'), l2 = el('label');
  const refresh = () => {
    const ps = clubPlayers(sideClub(MX, sd.value)); const k = t.value;
    l1.textContent = k === 'sub' ? 'اللاعب الداخل' : k === 'og' ? 'اللاعب (سجّل في مرماه)' : 'اللاعب';
    optList(pl, ps, k === 'var' ? '— بدون لاعب' : null);
    l2.textContent = k === 'goal' ? 'صناعة (اختياري)' : k === 'sub' ? 'اللاعب الخارج' : '';
    if (k === 'goal') optList(x2, ps.filter((p) => p.id !== pl.value), '— بدون');
    else if (k === 'sub') optList(x2, ps, null);
    x2.parentElement.hidden = !(k === 'goal' || k === 'sub'); note.parentElement.hidden = k !== 'var';
  };
  const wrap = (lbl, inp) => { const w = el('div'); const lb = typeof lbl === 'string' ? el('label', null, lbl) : lbl; w.append(lb, inp); return w; };
  f.append(wrap('النوع', t), wrap('الدقيقة', mn), wrap('الفريق', sd), wrap(l1, pl), wrap(l2, x2), wrap('الملاحظة', note));
  const add = el('button', 'btn add', '+ إضافة الحدث'); add.type = 'button';
  const cancel = el('button', 'btn ghost sm', 'إلغاء التعديل'); cancel.type = 'button'; cancel.hidden = true;
  const er = el('div', 'err');
  let editIdx = null;
  const resetForm = () => { editIdx = null; add.textContent = '+ إضافة الحدث'; cancel.hidden = true; mn.value = ''; note.value = ''; er.textContent = ''; f.classList.remove('editing'); };
  cancel.onclick = () => { resetForm(); drawList(); };
  const startEdit = (i) => {
    const e = MX.events[i]; editIdx = i;
    t.value = e.t; sd.value = e.s; refresh();
    if (e.p) pl.value = e.p;
    if (e.t === 'goal') { optList(x2, clubPlayers(sideClub(MX, sd.value)).filter((p) => p.id !== pl.value), '— بدون'); x2.value = e.as || ''; }
    if (e.t === 'sub') x2.value = e.out || '';
    mn.value = e.min || ''; note.value = e.note || '';
    add.textContent = '💾 حفظ التعديل'; cancel.hidden = false; er.textContent = ''; f.classList.add('editing');
    drawList(); f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  add.onclick = () => {
    if (!mn.value.replace(/[^0-9]/g, '')) { er.textContent = 'اكتبي الدقيقة'; return; }
    const e = { t: t.value, min: mn.value.replace(/[^0-9+]/g, '').slice(0, 7), s: sd.value, p: pl.value || null };
    if (e.t === 'goal') e.as = x2.value || null;
    if (e.t === 'sub') { e.out = x2.value || null; if (e.out === e.p) { er.textContent = 'اختاري لاعبين مختلفين'; return; } }
    if (e.t === 'var') e.note = note.value.trim().slice(0, 80);
    else if (!e.p) { er.textContent = 'اختاري اللاعب'; return; }
    if (editIdx != null) MX.events[editIdx] = e; else MX.events.push(e);
    resetForm(); drawList(); mxScore();
  };
  t.onchange = refresh; sd.onchange = refresh; pl.onchange = () => { if (t.value === 'goal') optList(x2, clubPlayers(sideClub(MX, sd.value)).filter((p) => p.id !== pl.value), '— بدون'); };
  const btns = el('div', 'mx-evbtns'); btns.append(add, cancel);
  body.append(f, btns, er); refresh();
  const list = el('div', 'mx-evlist'); body.appendChild(list);
  const pn = (id) => (S.byId.get(id) || {}).name || '؟';
  function drawList() {
    list.innerHTML = '';
    const evs = MX.events.map((e, i) => [e, i]).sort((x, y) => minKey(x[0].min) - minKey(y[0].min));
    if (!evs.length) list.appendChild(el('div', 'empty-msg', 'لا توجد أحداث بعد.'));
    evs.forEach(([e, i]) => {
      const r = el('div', 'mx-ev');
      let txt = `${EV_ICON[e.t]} ${minTxt(e.min)} · ${EV[e.t]} · ${sideClub(MX, e.s)}`;
      if (e.p) txt += ` · ${pn(e.p)}`; if (e.t === 'goal' && e.as) txt += ` (صناعة ${pn(e.as)})`; if (e.t === 'sub') txt += ` ↔ ${pn(e.out)}`; if (e.note) txt += ` · ${e.note}`;
      if (i === editIdx) r.classList.add('editing');
      const ed = el('button', 'pf-edit', '✏️'); ed.type = 'button'; ed.title = 'تعديل'; ed.onclick = () => startEdit(i);
      const del = el('button', 'pf-edit', '✕'); del.type = 'button'; del.title = 'حذف'; del.onclick = () => { MX.events.splice(i, 1); if (editIdx === i) resetForm(); else if (editIdx > i) editIdx--; drawList(); mxScore(); };
      const bx = el('div', 'mx-evact'); bx.append(ed, del);
      r.append(el('span', null, txt), bx); list.appendChild(r);
    });
  }
  drawList();
}
function mxStats(body) {
  body.appendChild(el('p', 'hint', 'اكتبي إحصائيات الفريقين (اختياري). الإنذارات والطرد تنحسب تلقائيًا من الأحداث.'));
  const g = el('div', 'mx-st');
  g.append(el('b', null, MX.a), el('span'), el('b', null, MX.b));
  TST.forEach(([k, l]) => {
    const v = MX.stats[k] || [null, null];
    const mk = (j) => { const i = el('input'); i.type = 'number'; i.min = '0'; i.inputMode = 'numeric'; i.value = v[j] ?? ''; i.oninput = () => { const arr = MX.stats[k] || [null, null]; arr[j] = i.value === '' ? null : Math.max(0, Math.round(Number(i.value)) || 0); MX.stats[k] = arr; }; return i; };
    g.append(mk(0), el('span', 'mx-stl', l), mk(1));
  });
  body.appendChild(g);
}
$('#mxForm').onsubmit = async (e) => {
  e.preventDefault(); if (!MX) return;
  const d = deriveMatch(MX); const round = MX.round; const fin = $('#mxFin').checked;
  $('#mxSave').disabled = true;
  try {
    const clubs = [MX.a, MX.b];
    for (const p of S.players.filter((x) => clubs.includes(x.club) || (x.matches || []).some((y) => y.fx === MX.id))) {
      const x = d.pl[p.id];
      const ms = (p.matches || []).filter((y) => y.fx !== MX.id && !(y.round === round && clubs.includes(p.club)));
      if (fin && x && x.played) ms.push(playerEntry(MX, p.id, x, d.sa, d.sb, round));
      ms.sort((y, z) => y.round - z.round);
      if (JSON.stringify(ms) === JSON.stringify([...(p.matches || [])].sort((y, z) => y.round - z.round))) continue;
      await patchPlayer(p.id, { matches: ms, fixtures: (p.fixtures || []).filter((f) => f.round !== round), points: totalPts({ position: p.position, matches: ms }) });
    }
    const clean = (o) => JSON.parse(JSON.stringify(o));
    const ev = MX.events.map(({ _sa, _sb, ...r }) => r);
    const out = clean({ a: MX.a, b: MX.b, at: MX.at, sa: fin ? d.sa : null, sb: fin ? d.sb : null, round, lineup: MX.lineup, events: ev, stats: MX.stats, ratings: MX.ratings, bonus: MX.bonus, updatedAt: Date.now() });
    await setDoc(doc(S.db, 'matches', MX.id), out);
    adminRefreshTable(true);
    closeModal('#mxModal'); toast(fin ? 'تم حفظ المباراة ونقاط اللاعبين ✅' : 'تم حفظ التشكيلة، تظهر للجميع الآن ✅');
  } catch (er) { $('#mxSave').disabled = false; $('#mxErr').textContent = errText(er); }
};
$('#mxClear').onclick = () => { if (!MX) return; const b = $('#mxClear'); if (b.textContent !== 'تأكيد؟') { b.textContent = 'تأكيد؟'; return; } b.textContent = 'إلغاء النتيجة'; MX.events = []; MX.lineup = { a: { st: [], bn: [] }, b: { st: [], bn: [] } }; mxRender(); };

// ===== صفحة المباراة (للجميع) =====
let mvId = null, mvTab = 'events';
function openMatchView(id) { mvId = id; const m0 = (S.matches || []).find((x) => x.id === id); mvTab = m0 && isDone(m0) ? 'events' : 'lineup'; renderMatchView(); openModal('#mvModal'); }
const rtClass = (r) => (r >= 7 ? 'g' : r >= 5 ? 'y' : 'r');
function renderMatchView() {
  const m = (S.matches || []).find((x) => x.id === mvId); if (!m) { closeModal('#mvModal'); return; }
  const d = deriveMatch(m); const hasLu = ['a', 'b'].some((s) => (((m.lineup || {})[s] || {}).st || []).length); const played = (m.events || []).length || hasLu || isDone(m);
  const body = $('#mvBody'); body.innerHTML = '';
  $('#mvTitle').textContent = `${m.a} × ${m.b}`;
  // الرأس
  const hd = el('div', 'mv-head');
  const top = el('div', 'mv-top'); top.append(el('span', null, `${gwName(m.round || gwOfTime(m.at))} · ${relDay(m.at)}`), el('b', null, isDone(m) ? 'انتهت' : fmtTime(m.at)));
  hd.appendChild(top);
  const row = el('div', 'mv-row');
  const side = (n) => { const s = el('div', 'mt-fside'); s.append(tlogo(n, 'xl', true), el('div', 'mt-fname', n)); return s; };
  const sc2 = el('div', 'mv-score');
  if (isDone(m)) sc2.append(el('b', null, String(m.sa)), el('span', null, '-'), el('b', null, String(m.sb)));
  else sc2.append(el('span', 'mv-vs', 'ضد'));
  row.append(side(m.a), sc2, side(m.b)); hd.appendChild(row);
  const scr = el('div', 'mv-scorers');
  ['a', 'b'].forEach((s) => {
    const c = el('div', 'mv-sc ' + s);
    d.ev.filter((e) => (e.t === 'goal' && e.s === s) || (e.t === 'og' && e.s !== s)).forEach((e) => c.appendChild(el('div', null, `${(S.byId.get(e.p) || {}).name || '؟'}${e.t === 'og' ? ' (ع.ع)' : ''} ${minTxt(e.min)}`)));
    scr.appendChild(c); if (s === 'a') scr.appendChild(el('div', 'mv-ball', d.ev.some((e) => e.t === 'goal' || e.t === 'og') ? '⚽' : ''));
  });
  hd.appendChild(scr);
  hd.appendChild(predButtons(m));
  if (S.admin) { const ed = el('div', 'mv-adm'); const b1 = el('button', 'btn primary sm', '📝 إدارة المباراة (التشكيلة والأحداث)'); b1.type = 'button'; b1.onclick = () => { closeModal('#mvModal'); openMatchEditor(m.id); }; const b2 = el('button', 'btn ghost sm', 'تعديل الفريقين والوقت'); b2.type = 'button'; b2.onclick = () => { closeModal('#mvModal'); openGameForm(m.id); }; ed.append(b1, b2); hd.appendChild(ed); }
  body.appendChild(hd);
  const tabs = el('div', 'pf-tabs mv-tabs');
  [['events', 'الأحداث'], ['lineup', 'التشكيلة'], ['stats', 'الإحصائيات'], ['vote', '⭐ التصويت'], ['comments', '💬 التعليقات'], ['photos', '📷 الصور']].forEach(([k, l]) => { const b = el('button', 'pf-tab' + (mvTab === k ? ' active' : ''), l); b.type = 'button'; b.onclick = () => { mvTab = k; renderMatchView(); }; tabs.appendChild(b); });
  body.appendChild(tabs);
  const pane = el('div', 'mv-pane'); body.appendChild(pane);
  if (mvTab !== 'comments') stopComments();
  if (mvTab === 'vote') { mvVote(m, d, pane); return; }
  if (mvTab === 'comments') { mvComments(m, pane); return; }
  if (mvTab === 'photos') { mvPhotos(m, pane); return; }
  if (!played) { pane.appendChild(el('div', 'empty-msg', 'تظهر التفاصيل قريبًا.')); return; }
  if (mvTab === 'events') mvEvents(m, d, pane); else if (mvTab === 'lineup') mvLineup(m, d, pane); else mvStats(m, d, pane);
}
function evPlayer(id, sub) {
  const p = S.byId.get(id); const r = el('div', 'ev-pl');
  if (!p) { r.appendChild(el('div', 'ev-pn', '؟')); return r; }
  const tx = el('div', 'ev-tx'); tx.append(el('div', 'ev-pn', p.name), el('div', 'ev-ps', `${p.club} · ${POS[p.position].one}`));
  if (sub) tx.appendChild(el('div', 'ev-ps', sub));
  r.append(tx, avatar(p, 'ev-av')); r.classList.add('clickable'); r.onclick = () => { closeModal('#mvModal'); openProfile(p.id); };
  return r;
}
function mvEvents(m, d, pane) {
  if (!d.ev.length) { pane.appendChild(el('div', 'empty-msg', 'لا توجد أحداث مسجّلة.')); return; }
  const pn = (id) => (S.byId.get(id) || {}).name || '؟';
  [...d.ev].reverse().forEach((e) => {
    const c = el('div', 'ev ev-' + e.t + ' s' + e.s);
    if (e.t === 'goal' || e.t === 'og') {
      const h = el('div', 'ev-goal'); h.append(el('div', 'ev-ic', '⚽'), el('div', 'ev-gt', e.t === 'og' ? 'هدف عكسي!' : 'جووووول!'), el('div', 'ev-min', minTxt(e.min)));
      const sc3 = el('div', 'ev-sc'); sc3.append(el('span', null, m.a), el('b', null, String(e._sa)), el('span', null, '-'), el('b', null, String(e._sb)), el('span', null, m.b));
      c.append(h, sc3, evPlayer(e.p, e.t === 'goal' && e.as ? 'صناعة: ' + pn(e.as) : ''));
    } else if (e.t === 'var') {
      const h = el('div', 'ev-goal'); h.append(el('div', 'ev-ic', '📺'), el('div', 'ev-gt', 'الفار'), el('div', 'ev-min', minTxt(e.min)));
      c.append(h, el('div', 'ev-note', e.note || sideClub(m, e.s)));
    } else {
      const h = el('div', 'ev-h'); h.append(el('span', 'ev-hi', EV_ICON[e.t]), el('b', null, EV[e.t]), el('span', 'ev-hm', minTxt(e.min)));
      c.appendChild(h);
      if (e.t === 'sub') { c.append(el('div', 'ev-in', 'دخول'), evPlayer(e.p), el('div', 'ev-out', 'خروج'), evPlayer(e.out)); }
      else c.appendChild(evPlayer(e.p));
    }
    pane.appendChild(c);
  });
}
function lineupPlayer(id, x, m) {
  const p = S.byId.get(id); const w = el('div', 'mv-lp clickable');
  if (!p) return w;
  const av = el('div', 'mv-av'); av.appendChild(avatar(p, 'mv-pic'));
  const r = (m.ratings || {})[id]; if (r != null) av.appendChild(el('span', 'mv-rt ' + rtClass(r), r.toFixed(1)));
  const ic = el('div', 'mv-ic');
  if (x) { for (let k = 0; k < x.g; k++) ic.appendChild(el('span', null, '⚽')); if (x.og) ic.appendChild(el('span', null, '🔴')); if (x.a) ic.appendChild(el('span', null, '👟'.repeat(x.a))); if (x.yc) ic.appendChild(el('span', null, x.yc > 1 ? '🟨🟨' : '🟨')); if (x.rc) ic.appendChild(el('span', null, '🟥')); if (x.ps) ic.appendChild(el('span', null, '🧤'.repeat(x.ps))); if (x.out) ic.appendChild(el('span', 'mv-out', '🔻')); }
  av.appendChild(ic);
  w.append(av, el('div', 'mv-ln', p.name));
  w.onclick = () => { closeModal('#mvModal'); openProfile(p.id); };
  return w;
}
function mvLineup(m, d, pane) {
  const lu = m.lineup || {};
  ['a', 'b'].forEach((s, si) => {
    const st = ((lu[s] || {}).st || []).filter((id) => S.byId.get(id));
    const club = sideClub(m, s);
    const rows = ORDER.map((k) => st.filter((id) => S.byId.get(id).position === k)).filter((r) => r.length);
    const form = ORDER.slice(1).map((k) => st.filter((id) => S.byId.get(id).position === k).length).filter((n) => n).join('-');
    const card = el('div', 'mv-team');
    const hh = el('div', 'mv-th'); hh.append(tlogo(club, 'md', true), el('b', null, club), el('span', 'mv-form', form || '—')); card.appendChild(hh);
    const pitch = el('div', 'mv-pitch' + (si ? ' flip' : ''));
    pitch.appendChild(el('div', 'mv-box'));
    if (!st.length) pitch.appendChild(el('div', 'empty-msg', 'لم تُسجَّل التشكيلة'));
    (si ? [...rows].reverse() : rows).forEach((r) => { const rr = el('div', 'mv-prow'); r.forEach((id) => rr.appendChild(lineupPlayer(id, d.pl[id], m))); pitch.appendChild(rr); });
    card.appendChild(pitch); pane.appendChild(card);
  });
  // الاحتياط
  const bn = el('div', 'mv-bench'); bn.appendChild(el('div', 'mv-bt', 'الاحتياط'));
  const cols = el('div', 'mv-bcols');
  ['a', 'b'].forEach((s) => {
    const ids = [...new Set([...((lu[s] || {}).bn || []), ...Object.entries(d.pl).filter(([, x]) => x.in && x.side === s).map(([id]) => id)])].filter((id) => S.byId.get(id) && !((lu[s] || {}).st || []).includes(id));
    const col = el('div', 'mv-bcol');
    if (!ids.length) col.appendChild(el('div', 'ev-ps', '—'));
    ids.forEach((id) => {
      const p = S.byId.get(id); const x = d.pl[id] || {}; const r = el('div', 'mv-brow clickable');
      const av = el('div', 'mv-av sm'); av.appendChild(avatar(p, 'mv-pic')); const rt = (m.ratings || {})[id]; if (rt != null) av.appendChild(el('span', 'mv-rt ' + rtClass(rt), rt.toFixed(1)));
      const tx = el('div', 'ev-tx'); tx.appendChild(el('div', 'ev-pn', p.name));
      const meta = x.in ? `🟢⬆ ${minTxt(x.in)}${x.g ? ' ⚽' : ''}${x.a ? ' 👟' : ''}${x.yc ? ' 🟨' : ''}${x.rc ? ' 🟥' : ''}` : POS[p.position].one;
      tx.appendChild(el('div', 'ev-ps', meta));
      r.append(av, tx); r.onclick = () => { closeModal('#mvModal'); openProfile(p.id); };
      col.appendChild(r);
    });
    cols.appendChild(col);
  });
  bn.appendChild(cols); pane.appendChild(bn);
  const lg = el('div', 'mv-legend'); lg.innerHTML = '<span>⚽ هدف</span><span>🔴 هدف عكسي</span><span>👟 صناعة</span><span>🟨 إنذار</span><span>🟥 طرد</span><span>🧤 تصدي لجزاء</span><span>🟢⬆ دخل</span><span>🔻 خرج</span><span>التقييم من 0 إلى 10</span>';
  pane.appendChild(lg);
}
function mvStats(m, d, pane) {
  const st = { ...(m.stats || {}) };
  const yc = [0, 0], rc = [0, 0]; d.ev.forEach((e) => { const j = e.s === 'b' ? 1 : 0; if (e.t === 'yc') yc[j]++; if (e.t === 'rc') rc[j]++; });
  const rows = [...TST.slice(0, 6), ['yc', 'الإنذارات'], ['rc', 'الطرد'], ...TST.slice(6)];
  const t = el('div', 'mv-st');
  const hh = el('div', 'mv-srow h'); hh.append(tlogo(m.a, 'md', true), el('b', null, 'إحصائيات الفريقين'), tlogo(m.b, 'md', true)); t.appendChild(hh);
  let any = false;
  rows.forEach(([k, l]) => {
    const v = k === 'yc' ? yc : k === 'rc' ? rc : (st[k] || [null, null]);
    if (v[0] == null && v[1] == null) return; any = true;
    const pct = k === 'poss' || k === 'acc';
    const f = (x) => (x == null ? '—' : x + (pct ? '%' : ''));
    const lowGood = k === 'fouls' || k === 'off' || k === 'yc' || k === 'rc';
    const best = v[0] == null || v[1] == null || v[0] === v[1] ? -1 : (lowGood ? (v[0] < v[1] ? 0 : 1) : (v[0] > v[1] ? 0 : 1));
    const r = el('div', 'mv-srow');
    r.append(el('span', 'mv-sv' + (best === 0 ? ' best a' : ''), f(v[0])), el('span', 'mv-sl', l), el('span', 'mv-sv' + (best === 1 ? ' best b' : ''), f(v[1])));
    t.appendChild(r);
  });
  if (!any) t.appendChild(el('div', 'empty-msg', 'لا توجد إحصائيات'));
  pane.appendChild(t);
}


// ---------- التوقعات ----------
const predOpen = (m) => !isDone(m) && Date.now() < m.at;
function predButtons(m) {
  const w = el('div', 'pr-btns');
  if (predOpen(m)) { const b1 = el('button', 'btn primary sm', '🎯 توقع المباراة'); b1.type = 'button'; b1.onclick = (e) => { e.stopPropagation(); openPredict(m.id); }; w.appendChild(b1); }
  const b2 = el('button', 'btn ghost sm', '📋 التوقعات'); b2.type = 'button'; b2.onclick = (e) => { e.stopPropagation(); openPredList(m.id); }; w.appendChild(b2);
  return w;
}
let prId = null;
async function openPredict(id) {
  const m = (S.matches || []).find((x) => x.id === id); if (!m) return;
  if (!S.uid) { toast('سجّل دخول بقوقل أولًا عشان تتوقع'); googleLogin(); return; }
  if (!predOpen(m)) { toast('انتهى وقت التوقع لهذه المباراة'); return; }
  prId = id;
  $('#prTitle').textContent = 'توقع المباراة';
  const box = $('#prTeams'); box.innerHTML = '';
  const side = (n, inp) => { const s = el('div', 'mt-fside'); s.append(tlogo(n, 'xl', true), el('div', 'mt-fname', n), inp); return s; };
  const ia = el('input', 'pr-in'); ia.type = 'number'; ia.min = '0'; ia.max = '30'; ia.inputMode = 'numeric'; ia.id = 'prA'; ia.placeholder = '؟';
  const ib = el('input', 'pr-in'); ib.type = 'number'; ib.min = '0'; ib.max = '30'; ib.inputMode = 'numeric'; ib.id = 'prB'; ib.placeholder = '؟';
  box.append(side(m.a, ia), el('div', 'pr-dash', '-'), side(m.b, ib));
  $('#prErr').textContent = ''; $('#prSave').disabled = true; $('#prSave').textContent = 'حفظ التوقع';
  $('#prNote').textContent = `آخر موعد للتوقع: ${relDay(m.at)} ${fmtTime(m.at)}`;
  openModal('#predModal');
  try {
    const s = await getDoc(doc(S.db, 'matches', id, 'preds', S.uid));
    if (s.exists()) { const p = s.data(); ia.value = p.a; ib.value = p.b; $('#prSave').textContent = 'تعديل التوقع'; $('#prNote').textContent += ' · سبق وتوقعت، تقدر تعدّل توقعك فقط'; }
  } catch (e) { /* أول توقع */ }
  $('#prSave').disabled = false;
}
$('#predForm').onsubmit = async (e) => {
  e.preventDefault();
  const va = numOrNull($('#prA').value), vb = numOrNull($('#prB').value);
  if (va == null || vb == null || va > 30 || vb > 30) { $('#prErr').textContent = 'اكتب نتيجة الفريقين'; return; }
  const u = S.auth.currentUser; const t = S.teams.get(S.uid);
  const name = ((t && t.name) || (u && u.displayName) || 'لاعب').slice(0, 60);
  $('#prSave').disabled = true;
  try {
    await setDoc(doc(S.db, 'matches', prId, 'preds', S.uid), { a: va, b: vb, name, updatedAt: Date.now() });
    closeModal('#predModal'); toast('تم حفظ توقعك ✅');
  } catch (er) { $('#prSave').disabled = false; $('#prErr').textContent = predOpen((S.matches || []).find((x) => x.id === prId) || {}) ? errText(er) : 'انتهى وقت التوقع'; }
};
async function openPredList(id) {
  const m = (S.matches || []).find((x) => x.id === id); if (!m) return;
  $('#plTitle').textContent = `توقعات: ${m.a} × ${m.b}`;
  const box = $('#plBody'); box.innerHTML = ''; box.appendChild(el('div', 'empty-msg', 'جاري التحميل…'));
  openModal('#predList');
  let list = [];
  try { const s = await getDocs(collection(S.db, 'matches', id, 'preds')); list = s.docs.map((d) => ({ uid: d.id, ...d.data() })); }
  catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'err', errText(e))); return; }
  box.innerHTML = '';
  const done = isDone(m);
  const res = (x, y) => Math.sign(x - y);
  const kind = (p) => (!done ? '' : p.a === m.sa && p.b === m.sb ? 'exact' : res(p.a, p.b) === res(m.sa, m.sb) ? 'win' : 'miss');
  const rank = { exact: 0, win: 1, miss: 2, '': 3 };
  list.sort((x, y) => rank[kind(x)] - rank[kind(y)] || x.updatedAt - y.updatedAt);
  const hh = el('div', 'pl-sum');
  hh.append(el('span', null, `عدد التوقعات: ${list.length}`));
  if (list.length) {
    const wa = list.filter((p) => p.a > p.b).length, dr = list.filter((p) => p.a === p.b).length, wb = list.length - wa - dr;
    const pc = (n) => Math.round((n / list.length) * 100) + '%';
    const bar = el('div', 'pl-bar'); bar.append(el('span', 'pa', `${m.a} ${pc(wa)}`), el('span', 'pd', `تعادل ${pc(dr)}`), el('span', 'pb', `${m.b} ${pc(wb)}`));
    hh.appendChild(bar);
  }
  if (done) hh.appendChild(el('div', 'pl-res', `النتيجة: ${m.a} ${m.sa} - ${m.sb} ${m.b}`));
  box.appendChild(hh);
  if (!list.length) { box.appendChild(el('div', 'empty-msg', 'لا توجد توقعات بعد.')); return; }
  list.forEach((p) => {
    const k = kind(p); const r = el('div', 'pl-row ' + k + (p.uid === S.uid ? ' me' : ''));
    const top = el('div', 'pl-top'); top.append(el('div', 'pl-n', p.name + (p.uid === S.uid ? ' (أنت)' : '')), el('div', 'pl-k', k === 'exact' ? '🎯 توقع صحيح' : k === 'win' ? '✅ الفائز صح' : k === 'miss' ? '❌' : ''));
    const tm = (n) => { const t = el('div', 'pl-tm'); t.append(tlogo(n, 'md', true), el('span', null, n)); return t; };
    const sc4 = el('div', 'pl-sc'); sc4.append(tm(m.a), el('b', null, String(p.a)), el('span', 'pl-d', '-'), el('b', null, String(p.b)), tm(m.b));
    r.append(top, sc4);
    box.appendChild(r);
  });
}


// ---------- الإعلانات ----------
function renderAnn() {
  const b = $('#annBar'); const t = (S.site && S.site.ann || '').trim();
  let hid = ''; try { hid = localStorage.getItem('annHide') || ''; } catch (e) { /* */ }
  b.hidden = !t || hid === String(S.site.annAt);
  b.innerHTML = '';
  if (!t) return;
  const x = el('button', 'ann-x', '✕'); x.type = 'button'; x.title = 'إخفاء';
  x.onclick = () => { try { localStorage.setItem('annHide', String(S.site.annAt)); } catch (e) { /* */ } b.hidden = true; };
  b.append(el('span', 'ann-i', '📢'), el('span', 'ann-t', t), x);
}
$('#annAdmin').onclick = () => {
  $('#annText').value = (S.site && S.site.ann) || '';
  $('#annTheme').value = (S.site && S.site.theme) || 'auto';
  $('#annErr').textContent = ''; openModal('#annModal');
};
async function saveSite(ann) {
  const theme = $('#annTheme').value;
  await setDoc(doc(S.db, 'site', 'main'), { ann: ann.slice(0, 300), annAt: Date.now(), theme, updatedAt: Date.now() });
}
$('#annForm').onsubmit = async (e) => {
  e.preventDefault();
  try { await saveSite($('#annText').value.trim()); closeModal('#annModal'); toast('تم نشر الإعلان'); } catch (er) { $('#annErr').textContent = errText(er); }
};
$('#annClear').onclick = async () => {
  try { await saveSite(''); closeModal('#annModal'); toast('تم حذف الإعلان'); } catch (er) { $('#annErr').textContent = errText(er); }
};

// ---------- سجل التعديلات ----------
$('#logAdmin').onclick = async () => {
  const box = $('#logBody'); box.innerHTML = ''; box.appendChild(el('div', 'empty-msg', 'جاري التحميل…')); openModal('#logModal');
  try {
    const s = await getDocs(query(collection(S.db, 'logs'), orderBy('at', 'desc'), limit(150)));
    box.innerHTML = '';
    if (s.empty) { box.appendChild(el('div', 'empty-msg', 'لا توجد تعديلات مسجّلة بعد.')); return; }
    let day = '';
    s.docs.forEach((d) => {
      const x = d.data(); const dy = relDay(x.at);
      if (dy !== day) { day = dy; box.appendChild(el('div', 'log-day', dy)); }
      const r = el('div', 'log-row ' + x.act);
      r.append(el('span', 'log-ic', x.act === 'del' ? '🗑' : '✏️'), el('div', 'log-tx', `${x.by} ${x.act === 'del' ? 'حذف' : 'عدّل'} ${x.label}`), el('span', 'log-t', fmtTime(x.at)));
      box.appendChild(r);
    });
  } catch (er) { box.innerHTML = ''; box.appendChild(el('div', 'err', errText(er))); }
};

// ---------- الوضع الفاتح والغامق ----------
function applyTheme(t) { document.body.classList.toggle('light', t === 'light'); $('#themeBtn').textContent = t === 'light' ? '🌙' : '☀️'; $('#themeBtn').title = t === 'light' ? 'الوضع الغامق' : 'الوضع الفاتح'; }
let curTheme = 'dark'; try { curTheme = localStorage.getItem('theme') || 'dark'; } catch (e) { /* */ }
applyTheme(curTheme);
$('#themeBtn').onclick = () => { curTheme = curTheme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('theme', curTheme); } catch (e) { /* */ } applyTheme(curTheme); };

// ---------- الخلفية الذهبية وقت النهائي ----------
function applyGold() {
  const mode = (S.site && S.site.theme) || 'auto';
  let on = mode === 'gold';
  if (mode === 'auto') on = (S.matches || []).some((m) => { const g = S.gws.find((x) => x.n === (m.round || gwOfTime(m.at))); return g && g.stage === 'final' && Math.abs(m.at - Date.now()) < 864e5 * 1.5 && (sameDay(m.at, Date.now()) || !isDone(m) || Date.now() - m.at < 864e5); });
  document.body.classList.toggle('gold', on);
}


// ---------- لاعب الجولة (تختاره المشرفة) ----------
function renderPotw() {
  const box = $('#potw'); box.innerHTML = '';
  const pw = S.potw; const p = pw && pw.pid ? S.byId.get(pw.pid) : null;
  if (!p) {
    if (S.admin) { const b = el('button', 'btn ghost sm', '⭐ اختيار لاعب الجولة'); b.type = 'button'; b.onclick = openPotwForm; box.appendChild(b); }
    return;
  }
  const g = S.gws.find((x) => x.n === pw.n) || { n: pw.n };
  const c = el('div', 'potw clickable');
  const info = el('div', 'potw-i');
  const ms = roundMatches(p, pw.n);
  const st = ms.reduce((t, m) => ({ g: t.g + num(m.g), a: t.a + num(m.a) }), { g: 0, a: 0 });
  info.append(el('div', 'potw-h', `⭐ لاعب ${gwLabel(g)}`), el('div', 'potw-n', p.name), el('div', 'potw-c', `${p.club || ''} · ${POS[p.position].one}${st.g ? ` · ⚽ ${st.g}` : ''}${st.a ? ` · 👟 ${st.a}` : ''}`));
  if (pw.note) info.appendChild(el('div', 'potw-note', pw.note));
  const pts = el('div', 'potw-p'); pts.append(el('b', null, String(roundPts(p, pw.n))), el('span', null, 'نقطة'));
  c.append(avatar(p, 'potw-av'), info, pts);
  c.onclick = () => openProfile(p.id);
  if (S.admin) { const ed = el('button', 'potw-ed', '✏️'); ed.type = 'button'; ed.title = 'تغيير لاعب الجولة'; ed.onclick = (ev) => { ev.stopPropagation(); openPotwForm(); }; c.appendChild(ed); }
  box.appendChild(c);
}
function potwPlayers() {
  const n = Number($('#pwGw').value); const sel = $('#pwPl'); const cur = sel.value || (S.potw && S.potw.pid) || '';
  sel.innerHTML = '';
  const q = ($('#pwSearch').value || '').trim().toLowerCase();
  const list = S.players.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.club || '').toLowerCase().includes(q) || p.id === cur);
  if (!list.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'ما فيه لاعب بهذا الاسم'; sel.appendChild(o); return; }
  list.map((p) => ({ p, pts: roundPts(p, n), pl: roundMatches(p, n).some((m) => num(m.min) > 0) }))
    .sort((x, y) => (y.pl - x.pl) || y.pts - x.pts || x.p.name.localeCompare(y.p.name, 'ar'))
    .forEach(({ p, pts, pl }) => { const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.name} · ${p.club || ''}${pl ? ` · ${pts} نقطة` : ''}`; sel.appendChild(o); });
  if (cur && S.byId.get(cur)) sel.value = cur;
}
function openPotwForm() {
  if (!S.admin) return;
  const sel = $('#pwGw'); sel.innerHTML = '';
  const gs = [...S.gws].sort((x, y) => x.n - y.n);
  gs.forEach((g) => { const o = document.createElement('option'); o.value = g.n; o.textContent = gwLabel(g); sel.appendChild(o); });
  if (!gs.length) { const o = document.createElement('option'); o.value = 1; o.textContent = 'الجولة 1'; sel.appendChild(o); }
  const past = gs.filter((g) => g.deadline <= Date.now());
  sel.value = String(S.potw && S.potw.n ? S.potw.n : (past.length ? past[past.length - 1].n : (gs[0] ? gs[0].n : 1)));
  $('#pwSearch').value = ''; $('#pwPl').value = ''; potwPlayers(); sel.onchange = potwPlayers;
  $('#pwNote').value = (S.potw && S.potw.note) || '';
  $('#pwDel').hidden = !(S.potw && S.potw.pid); $('#pwErr').textContent = '';
  openModal('#potwModal');
}
$('#pwSearch').oninput = () => { const s = $('#pwPl'); const keep = s.value; s.value = ''; potwPlayers(); const q = $('#pwSearch').value.trim(); if (q && s.options.length && s.options[0].value) s.selectedIndex = 0; else if (keep) s.value = keep; };
$('#potwForm').onsubmit = async (e) => {
  e.preventDefault();
  const pid = $('#pwPl').value; if (!pid) { $('#pwErr').textContent = 'اختاري اللاعب'; return; }
  try { await setDoc(doc(S.db, 'site', 'potw'), { pid, n: Number($('#pwGw').value), note: $('#pwNote').value.trim().slice(0, 80), updatedAt: Date.now() }); closeModal('#potwModal'); toast('تم تحديد لاعب الجولة ⭐'); }
  catch (er) { $('#pwErr').textContent = errText(er); }
};
$('#pwDel').onclick = async () => {
  try { await deleteDoc(doc(S.db, 'site', 'potw')); closeModal('#potwModal'); toast('تم إزالة لاعب الجولة'); } catch (er) { $('#pwErr').textContent = errText(er); }
};

// ---------- الدوريات الخاصة ----------
let stView = 'all', S_leagues = [], openLg = null;
function drawStTabs() {
  const t = $('#stTabs'); t.innerHTML = '';
  [['all', 'الدوري العام'], ['leagues', '🏅 دورياتي']].forEach(([k, l]) => { const b = el('button', 'pf-tab' + (stView === k ? ' active' : ''), l); b.type = 'button'; b.onclick = () => { stView = k; openLg = null; renderStandings(); }; t.appendChild(b); });
}
const genCode = () => { const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += ch[Math.floor(Math.random() * ch.length)]; return s; };
const joinUrl = (code) => location.origin + location.pathname + '?join=' + code;
const myName = () => { const u = S.auth.currentUser; const t = S.teams.get(S.uid); return ((t && t.name) || (u && u.displayName) || 'لاعب').slice(0, 60); };
async function renderLeagues() {
  const box = $('#leagues'); box.innerHTML = '';
  if (!S.uid) { box.appendChild(el('div', 'empty-msg', 'سجّل دخول بقوقل عشان تسوي دوري خاص أو تنضم لدوري أصحابك.')); const b = el('button', 'btn primary', 'تسجيل الدخول'); b.onclick = googleLogin; box.appendChild(b); return; }
  if (openLg) { renderLeague(box, openLg); return; }
  const tools = el('div', 'lg-tools');
  const nb = el('button', 'btn primary sm', '+ إنشاء دوري'); nb.type = 'button'; nb.onclick = createLeague;
  const ji = el('input'); ji.type = 'text'; ji.placeholder = 'رمز الدوري'; ji.maxLength = 6; ji.className = 'lg-code-in';
  const jb = el('button', 'btn ghost sm', 'انضمام'); jb.type = 'button'; jb.onclick = () => joinLeague(ji.value.trim().toUpperCase());
  tools.append(nb, ji, jb); box.appendChild(tools);
  const list = el('div', 'lg-list'); list.appendChild(el('div', 'empty-msg', 'جاري التحميل…')); box.appendChild(list);
  try {
    const s = await getDocs(query(collection(S.db, 'leagues'), where('members', 'array-contains', S.uid)));
    S_leagues = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((x, y) => x.createdAt - y.createdAt);
  } catch (e) { list.innerHTML = ''; list.appendChild(el('div', 'err', errText(e))); return; }
  list.innerHTML = '';
  if (!S_leagues.length) { list.appendChild(el('div', 'empty-msg', 'ما عندك دوريات بعد. سوّ دوري وأرسل الرابط لأصحابك، أو اكتب رمز دوري وانضم.')); return; }
  S_leagues.forEach((L) => {
    const c = el('div', 'lg-card clickable');
    c.append(el('div', 'lg-n', L.name), el('div', 'lg-m', `${L.members.length} مشارك${L.owner === S.uid ? ' · 👑 أنت المالك' : ''}`));
    c.onclick = () => { openLg = L.id; renderLeagues(); };
    list.appendChild(c);
  });
}
async function createLeague() {
  const name = (prompt('اسم الدوري الخاص:') || '').trim().slice(0, 40);
  if (!name) return;
  try {
    let code = genCode();
    for (let i = 0; i < 5; i++) { const x = await getDoc(doc(S.db, 'leagues', code)); if (!x.exists()) break; code = genCode(); }
    await fsSetDoc(doc(S.db, 'leagues', code), { name, owner: S.uid, ownerName: myName(), members: [S.uid], createdAt: Date.now() });
    toast('تم إنشاء الدوري ✅'); openLg = code; renderLeagues();
  } catch (e) { toast(errText(e), true); }
}
async function joinLeague(code) {
  if (!S.uid) { toast('سجّل دخول أولًا'); googleLogin(); return; }
  if (!/^[A-Z0-9]{6}$/.test(code)) { toast('الرمز لازم يكون 6 حروف/أرقام', true); return; }
  try {
    const s = await getDoc(doc(S.db, 'leagues', code));
    if (!s.exists()) { toast('ما فيه دوري بهذا الرمز', true); return; }
    const L = s.data();
    if (!L.members.includes(S.uid)) await updateDoc(doc(S.db, 'leagues', code), { members: arrayUnion(S.uid) });
    toast(`انضممت لدوري «${L.name}» ✅`);
    stView = 'leagues'; openLg = code;
    document.querySelector('.tab[data-tab=table]').click();
  } catch (e) { toast(errText(e), true); }
}
let joinChecked = false;
function checkJoinLink() {
  if (joinChecked) return; const code = new URLSearchParams(location.search).get('join'); if (!code) return;
  joinChecked = true;
  history.replaceState(null, '', location.pathname);
  joinLeague(code.toUpperCase());
}
async function renderLeague(box, id) {
  box.innerHTML = '';
  const back = el('button', 'btn ghost sm', '→ رجوع لدورياتي'); back.type = 'button'; back.onclick = () => { openLg = null; renderLeagues(); }; box.appendChild(back);
  let L;
  try { const s = await getDoc(doc(S.db, 'leagues', id)); if (!s.exists()) { openLg = null; renderLeagues(); return; } L = { id, ...s.data() }; if (S.admin) await loadPicks(); }
  catch (e) { box.appendChild(el('div', 'err', errText(e))); return; }
  const own = L.owner === S.uid;
  const hd = el('div', 'lg-head');
  hd.append(el('h3', null, '🏅 ' + L.name), el('div', 'lg-m', `المالك: ${L.ownerName || ''} · ${L.members.length} مشارك`));
  const codeBox = el('div', 'lg-codebox');
  codeBox.append(el('span', null, 'رمز الدخول:'), el('b', 'lg-code', L.id));
  const cp = el('button', 'btn ghost sm', '🔗 نسخ رابط الدعوة'); cp.type = 'button';
  cp.onclick = async () => { const u = joinUrl(L.id); try { if (navigator.share) await navigator.share({ title: L.name, text: `انضم لدوري «${L.name}» في Aqeq League`, url: u }); else { await navigator.clipboard.writeText(u); toast('تم نسخ الرابط'); } } catch (e) { try { await navigator.clipboard.writeText(u); toast('تم نسخ الرابط'); } catch (e2) { prompt('انسخ الرابط:', u); } } };
  codeBox.appendChild(cp); hd.appendChild(codeBox); box.appendChild(hd);
  const now = Date.now();
  const tr0 = new Map((S.admin ? await computeTable() : tableRows()).map((x) => [x.uid, x]));
  const rows = L.members.map((uid) => tr0.get(uid) || { uid, t: null, tt: { total: 0, perGw: {} } }).sort((x, y) => y.tt.total - x.tt.total);
  const tbl = el('table'); const h = el('tr'); ['#', 'الفريق', 'المجموع', ''].forEach((x) => h.appendChild(el('th', null, x))); tbl.appendChild(h);
  rows.forEach((r, i) => {
    const tr = el('tr', (r.uid === S.uid ? 'mine ' : '') + (r.t ? 'clickable' : ''));
    const nm = r.t ? r.t.name : '(لم يحفظ فريق بعد)';
    tr.append(el('td', 'rank', i === 0 && r.tt.total > 0 ? '🏆' : String(i + 1)), el('td', null, nm + (r.uid === L.owner ? ' 👑' : '') + (r.uid === S.uid ? ' (أنت)' : '')), el('td', 'pts', String(r.tt.total)));
    const td = el('td');
    if (own && r.uid !== S.uid) {
      const d = el('button', 'del-team', 'إزالة'); let armed = false;
      d.onclick = async (ev) => { ev.stopPropagation(); if (!armed) { armed = true; d.textContent = 'تأكيد؟'; return; } try { await updateDoc(doc(S.db, 'leagues', L.id), { members: arrayRemove(r.uid) }); renderLeague(box, id); } catch (e) { toast(errText(e), true); } };
      td.appendChild(d);
    }
    tr.appendChild(td);
    if (r.t) tr.onclick = () => openTeamModal(r);
    tbl.appendChild(tr);
  });
  box.appendChild(tbl);
  const act = el('div', 'actions');
  if (own) {
    const rn = el('button', 'btn ghost sm', '✏️ تغيير الاسم'); rn.type = 'button';
    rn.onclick = async () => { const n = (prompt('الاسم الجديد:', L.name) || '').trim().slice(0, 40); if (!n) return; try { await updateDoc(doc(S.db, 'leagues', L.id), { name: n }); renderLeague(box, id); } catch (e) { toast(errText(e), true); } };
    const del = el('button', 'btn ghost sm', '🗑 حذف الدوري'); del.type = 'button'; let armed = false;
    del.onclick = async () => { if (!armed) { armed = true; del.textContent = 'تأكيد الحذف؟'; return; } try { await fsDeleteDoc(doc(S.db, 'leagues', L.id)); openLg = null; renderLeagues(); toast('تم حذف الدوري'); } catch (e) { toast(errText(e), true); } };
    act.append(rn, del);
  } else {
    const lv = el('button', 'btn ghost sm', 'مغادرة الدوري'); lv.type = 'button'; let armed = false;
    lv.onclick = async () => { if (!armed) { armed = true; lv.textContent = 'تأكيد المغادرة؟'; return; } try { await updateDoc(doc(S.db, 'leagues', L.id), { members: arrayRemove(S.uid) }); openLg = null; renderLeagues(); } catch (e) { toast(errText(e), true); } };
    act.appendChild(lv);
  }
  box.appendChild(act);
}


// ---------- مشاركة التشكيلة كصورة ----------
const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
async function shareLineup() {
  const st = ORDER.flatMap((k) => S.slots[k]).filter(Boolean);
  if (!st.length) { toast('اختر لاعبينك أولًا', true); return; }
  toast('جاري تجهيز الصورة…');
  try { await document.fonts.ready; } catch (e) { /* */ }
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const F = (s, w) => `${w || 800} ${s}px Cairo, system-ui, sans-serif`;
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1a33'); g.addColorStop(1, '#1f4e86'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.direction = 'rtl'; c.textAlign = 'center';
  const logo = await loadImg('logo.webp');
  if (logo) { c.save(); c.beginPath(); c.arc(W - 110, 95, 55, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.clip(); c.drawImage(logo, W - 165, 40, 110, 110); c.restore(); }
  c.fillStyle = '#f4c430'; c.font = F(30, 900); c.textAlign = 'right'; c.fillText('Aqeq League', W - 185, 80);
  c.fillStyle = '#fff'; c.font = F(54, 900); c.fillText(($('#teamName').value || 'فريقي').slice(0, 24), W - 185, 145);
  c.textAlign = 'left'; c.font = F(30, 700); c.fillStyle = '#c9d6ee';
  c.fillText(S.openGw ? gwLabel(S.openGw) : '', 60, 110);
  // الملعب
  const px = 50, py = 200, pw = W - 100, ph = 880;
  c.save(); rrect(c, px, py, pw, ph, 30); c.clip();
  for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#2e8b3e' : '#287f37'; c.fillRect(px, py + (ph / 10) * i, pw, ph / 10 + 1); }
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 4;
  c.strokeRect(px + pw * 0.28, py + ph - 150, pw * 0.44, 150); c.beginPath(); c.arc(W / 2, py, 110, 0, Math.PI); c.stroke();
  c.restore();
  const drawP = async (id, x, y, sz) => {
    const p = S.byId.get(id); if (!p) return;
    const img = await loadImg(photoUrl(p));
    c.save(); rrect(c, x - sz / 2, y - sz / 2, sz, sz, sz * 0.22); c.fillStyle = '#dfe7f5'; c.fill(); c.clip();
    if (img) { const s = Math.max(sz / img.width, sz / img.height); c.drawImage(img, x - (img.width * s) / 2, y - (img.height * s) / 2, img.width * s, img.height * s); }
    else { c.fillStyle = '#1d2f5d'; c.font = F(sz * 0.45, 900); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(initialOf(p.name), x, y); c.textBaseline = 'alphabetic'; }
    c.restore();
    const nm = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
    c.font = F(26, 800); const tw = Math.max(c.measureText(nm).width + 30, sz);
    c.fillStyle = '#fff'; rrect(c, x - tw / 2, y + sz / 2 + 8, tw, 44, 10); c.fill();
    c.fillStyle = '#14213a'; c.textAlign = 'center'; c.fillText(nm, x, y + sz / 2 + 40);
    c.fillStyle = '#1f4e86'; rrect(c, x - tw / 2, y + sz / 2 + 52, tw, 30, 8); c.fill();
    c.fillStyle = '#fff'; c.font = F(19, 700); c.fillText(`${p.club || ''}`.slice(0, 18), x, y + sz / 2 + 74);
    const badge = S.captain === id ? 'C' : S.vice === id ? 'V' : '';
    if (badge) { c.beginPath(); c.arc(x + sz / 2 - 6, y - sz / 2 + 6, 24, 0, Math.PI * 2); c.fillStyle = badge === 'C' ? '#f4c430' : '#fff'; c.fill(); c.fillStyle = '#14213a'; c.font = F(26, 900); c.fillText(badge, x + sz / 2 - 6, y - sz / 2 + 15); }
  };
  const rows = ['fwd', 'mid', 'def', 'gk'].map((k) => S.slots[k].filter(Boolean)).filter((r) => r.length);
  const gap = ph / rows.length, sz = rows.length > 3 ? 112 : 130;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const y = py + gap * (i + 0.5) - 34;
    for (let j = 0; j < r.length; j++) await drawP(r[j], px + (pw / (r.length + 1)) * (r.length - j), y, sz);
  }
  // البديل
  c.fillStyle = 'rgba(255,255,255,.08)'; rrect(c, px, py + ph + 25, pw, 200, 24); c.fill();
  c.fillStyle = '#c9d6ee'; c.font = F(26, 800); c.textAlign = 'right'; c.fillText('الاحتياط', W - 80, py + ph + 70);
  const bn = S.bench.filter(Boolean);
  for (let j = 0; j < bn.length; j++) await drawP(bn[j], W / 2 - j * 200, py + ph + 80, 86);
  c.fillStyle = '#8a9ab5'; c.font = F(24, 700); c.textAlign = 'center'; c.direction = 'ltr'; c.fillText(location.host + location.pathname.replace(/index\.html$/, ''), W / 2, H - 30);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = new File([blob], 'aqeq-lineup.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'تشكيلتي في Aqeq League' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const u = URL.createObjectURL(blob); const a2 = document.createElement('a'); a2.href = u; a2.download = 'aqeq-lineup.png'; document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  toast('تم تنزيل صورة التشكيلة ✅');
}
$('#shareTeam').onclick = shareLineup;


// صفحة الفريق: سجل النتائج والمباريات والهدافون
function clubExtras(body, name, ps) {
  const ms = (S.matches || []).filter((m) => m.a === name || m.b === name).sort((x, y) => x.at - y.at);
  const done = ms.filter(isDone);
  const rec = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  done.forEach((m) => { const me = m.a === name ? m.sa : m.sb, op = m.a === name ? m.sb : m.sa; rec.gf += me; rec.ga += op; if (me > op) rec.w++; else if (me < op) rec.l++; else rec.d++; });
  body.appendChild(el('h3', 'mt-h', '📊 سجل الفريق'));
  const rb = el('div', 'club-rec');
  [['لعب', done.length], ['فوز', rec.w], ['تعادل', rec.d], ['خسارة', rec.l], ['له', rec.gf], ['عليه', rec.ga]].forEach(([l, v]) => { const c = el('div'); c.append(el('b', null, String(v)), el('span', null, l)); rb.appendChild(c); });
  body.appendChild(rb);
  const form = el('div', 'club-form');
  done.slice(-5).forEach((m) => { const me = m.a === name ? m.sa : m.sb, op = m.a === name ? m.sb : m.sa; form.appendChild(el('span', me > op ? 'w' : me < op ? 'l' : 'd', me > op ? 'ف' : me < op ? 'خ' : 'ت')); });
  if (done.length) { const fw = el('div', 'club-formw'); fw.append(el('span', null, 'آخر النتائج:'), form); body.appendChild(fw); }
  body.appendChild(el('h3', 'mt-h', '📅 المباريات والنتائج'));
  if (!ms.length) body.appendChild(el('div', 'empty-msg', 'لا توجد مباريات بعد.'));
  else {
    const g = el('div', 'mt-list');
    ms.forEach((m) => { const rw = matchRow(m); rw.onclick = () => { closeModal('#clubModal'); openMatchView(m.id); }; g.appendChild(rw); });
    body.appendChild(g);
  }
  const sc = ps.map((p) => ({ p, s: clubStat(p) })).filter((x) => x.s.g > 0 || x.s.a > 0).sort((x, y) => y.s.g - x.s.g || y.s.a - x.s.a);
  body.appendChild(el('h3', 'mt-h', '⚽ الهدافون'));
  if (!sc.length) body.appendChild(el('div', 'empty-msg', 'لا توجد أهداف بعد.'));
  sc.forEach(({ p, s }, i) => {
    const rw = el('div', 'club-sc clickable');
    rw.append(el('span', 'club-sc-r', String(i + 1)), avatar(p, 'club-av'), el('b', 'club-sc-n', p.name), el('span', 'club-sc-v', `⚽ ${s.g}`), el('span', 'club-sc-v a', `👟 ${s.a}`));
    rw.onclick = () => { closeModal('#clubModal'); openProfile(p.id); };
    body.appendChild(rw);
  });
}


// ---------- تصويت أفضل لاعب في المباراة ----------
const VT = {};
async function mvVote(m, d, pane) {
  if (!isDone(m)) { pane.appendChild(el('div', 'empty-msg', 'التصويت لأفضل لاعب يفتح بعد نهاية المباراة.')); return; }
  const cands = Object.entries(d.pl).filter(([id, x]) => x.played && S.byId.get(id)).map(([id, x]) => ({ id, x, p: S.byId.get(id) }));
  if (!cands.length) { pane.appendChild(el('div', 'empty-msg', 'لم تُسجَّل تشكيلة المباراة.')); return; }
  if (!VT[m.id]) {
    pane.appendChild(el('div', 'empty-msg', 'جاري التحميل…'));
    try { const s = await getDocs(collection(S.db, 'matches', m.id, 'votes')); VT[m.id] = s.docs.map((x) => ({ uid: x.id, ...x.data() })); }
    catch (e) { pane.innerHTML = ''; pane.appendChild(el('div', 'err', errText(e))); return; }
    if (mvTab === 'vote' && mvId === m.id) renderMatchView(); return;
  }
  const votes = VT[m.id]; const mine = (votes.find((v) => v.uid === S.uid) || {}).pid;
  const cnt = {}; votes.forEach((v) => { cnt[v.pid] = (cnt[v.pid] || 0) + 1; });
  pane.appendChild(el('p', 'hint', S.uid ? (mine ? 'صوّتّ، تقدر تغيّر صوتك بالضغط على لاعب ثاني.' : 'اختر أفضل لاعب في المباراة.') : 'سجّل دخول بقوقل عشان تصوّت.'));
  pane.appendChild(el('div', 'vt-total', `عدد الأصوات: ${votes.length}`));
  cands.sort((x, y) => (cnt[y.id] || 0) - (cnt[x.id] || 0) || (x.x.side === 'a' ? -1 : 1));
  cands.forEach(({ id, x, p }) => {
    const n = cnt[id] || 0; const pc = votes.length ? Math.round((n / votes.length) * 100) : 0;
    const r = el('div', 'vt-row clickable' + (mine === id ? ' me' : ''));
    const bar = el('div', 'vt-bar'); bar.style.width = pc + '%';
    const tx = el('div', 'vt-tx'); tx.append(el('b', null, p.name), el('span', 'ev-ps', `${p.club} · ${POS[p.position].one}`));
    r.append(bar, avatar(p, 'club-av'), tx, el('div', 'vt-pc', `${pc}% (${n})`));
    r.onclick = async () => {
      if (!S.uid) { googleLogin(); return; }
      try { await fsSetDoc(doc(S.db, 'matches', m.id, 'votes', S.uid), { pid: id, at: Date.now() }); VT[m.id] = votes.filter((v) => v.uid !== S.uid).concat([{ uid: S.uid, pid: id }]); toast('تم تسجيل صوتك ✅'); renderMatchView(); }
      catch (e) { toast(errText(e), true); }
    };
    pane.appendChild(r);
  });
}

// ---------- التعليقات ----------
const CM = {}; let cmUnsub = null, cmFor = null, cmDraft = '', cmReply = null;
function stopComments() { if (cmUnsub) { cmUnsub(); cmUnsub = null; cmFor = null; } }
function mvComments(m, pane) {
  if (cmFor !== m.id) {
    stopComments(); cmFor = m.id;
    cmUnsub = onSnapshot(collection(S.db, 'matches', m.id, 'comments'), (s) => { CM[m.id] = s.docs.map((x) => ({ id: x.id, ...x.data() })); if (mvTab === 'comments' && mvId === m.id && $('#mvModal').classList.contains('open') && !document.activeElement?.closest?.('.cm-form')) renderMatchView(); }, (e) => toast(errText(e), true));
  }
  const all = CM[m.id];
  const form = el('div', 'cm-form');
  if (S.uid) {
    if (cmReply) { const rp = (all || []).find((c) => c.id === cmReply); const rb = el('div', 'cm-replying'); const x = el('button', 'pf-edit', '✕'); x.type = 'button'; x.onclick = () => { cmReply = null; renderMatchView(); }; rb.append(el('span', null, `رد على ${rp ? rp.name : ''}`), x); form.appendChild(rb); }
    const ta = el('textarea'); ta.maxLength = 300; ta.rows = 2; ta.placeholder = cmReply ? 'اكتب ردك…' : 'اكتب تعليقك على المباراة…'; ta.value = cmDraft; ta.oninput = () => { cmDraft = ta.value; };
    const sb = el('button', 'btn primary sm', 'نشر'); sb.type = 'button';
    sb.onclick = async () => {
      const t = ta.value.trim(); if (!t) return; sb.disabled = true;
      try { await fsSetDoc(doc(collection(S.db, 'matches', m.id, 'comments')), { uid: S.uid, name: myName(), text: t.slice(0, 300), at: Date.now(), parent: cmReply || null, likes: [] }); cmDraft = ''; cmReply = null; ta.blur(); renderMatchView(); }
      catch (e) { sb.disabled = false; toast(errText(e), true); }
    };
    form.append(ta, sb);
  } else { const b = el('button', 'btn ghost sm', 'سجّل دخول عشان تعلّق'); b.type = 'button'; b.onclick = googleLogin; form.appendChild(b); }
  pane.appendChild(form);
  if (!all) { pane.appendChild(el('div', 'empty-msg', 'جاري التحميل…')); return; }
  const tops = all.filter((c) => !c.parent).sort((x, y) => y.at - x.at);
  if (!tops.length) pane.appendChild(el('div', 'empty-msg', 'لا توجد تعليقات بعد. كن أول من يعلّق!'));
  const card = (c, isReply) => {
    const w = el('div', 'cm' + (isReply ? ' reply' : '') + (c.uid === S.uid ? ' mine' : ''));
    const hd = el('div', 'cm-h'); hd.append(el('b', null, c.name), el('span', 'cm-t', `${relDay(c.at)} ${fmtTime(c.at)}`));
    const tx = el('div', 'cm-tx', c.text);
    const ac = el('div', 'cm-ac');
    const liked = S.uid && (c.likes || []).includes(S.uid);
    const lk = el('button', 'cm-btn' + (liked ? ' on' : ''), `${liked ? '❤️' : '🤍'} ${(c.likes || []).length || ''}`); lk.type = 'button';
    lk.onclick = async () => { if (!S.uid) { googleLogin(); return; } try { await updateDoc(doc(S.db, 'matches', m.id, 'comments', c.id), { likes: liked ? arrayRemove(S.uid) : arrayUnion(S.uid) }); } catch (e) { toast(errText(e), true); } };
    ac.appendChild(lk);
    if (!isReply) { const rp = el('button', 'cm-btn', '↩ رد'); rp.type = 'button'; rp.onclick = () => { if (!S.uid) { googleLogin(); return; } cmReply = c.id; renderMatchView(); const t = document.querySelector('.cm-form textarea'); if (t) t.focus(); }; ac.appendChild(rp); }
    if (S.uid && (c.uid === S.uid || S.admin)) {
      const dl = el('button', 'cm-btn del', '🗑 حذف'); dl.type = 'button'; let armed = false;
      dl.onclick = async () => {
        if (!armed) { armed = true; dl.textContent = 'تأكيد؟'; return; }
        try { if (S.admin && !isReply) for (const rr of all.filter((x) => x.parent === c.id)) await fsDeleteDoc(doc(S.db, 'matches', m.id, 'comments', rr.id)); await fsDeleteDoc(doc(S.db, 'matches', m.id, 'comments', c.id)); }
        catch (e) { toast(errText(e), true); }
      };
      ac.appendChild(dl);
    }
    w.append(hd, tx, ac); return w;
  };
  tops.forEach((c) => {
    pane.appendChild(card(c, false));
    all.filter((x) => x.parent === c.id).sort((x, y) => x.at - y.at).forEach((rr) => pane.appendChild(card(rr, true)));
  });
}

// ---------- ألبوم صور المباراة ----------
const PH = {};
function resizePhoto(file) {
  return new Promise((res, rej) => {
    const r0 = new FileReader(); r0.onerror = rej;
    r0.onload = () => { const img = new Image(); img.onerror = () => rej(new Error('صورة غير صالحة')); img.onload = () => {
      let q = 0.82, max = 1280, out;
      for (let k = 0; k < 6; k++) { const s = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); out = cv.toDataURL('image/jpeg', q); if (out.length < 700000) break; q -= 0.1; max = Math.round(max * 0.85); }
      res(out);
    }; img.src = r0.result; };
    r0.readAsDataURL(file);
  });
}
async function mvPhotos(m, pane) {
  if (S.admin) {
    const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true;
    const b = el('button', 'btn primary sm', '+ إضافة صور'); b.type = 'button'; b.onclick = () => inp.click();
    inp.onchange = async () => {
      const fs = [...inp.files]; if (!fs.length) return; b.disabled = true; b.textContent = 'جاري الرفع…';
      try { for (const f of fs) { const src = await resizePhoto(f); await setDoc(doc(collection(S.db, 'matches', m.id, 'photos')), { src, at: Date.now() }); } delete PH[m.id]; toast('تم رفع الصور ✅'); }
      catch (e) { toast(errText(e), true); }
      renderMatchView();
    };
    pane.append(b, inp);
  }
  if (!PH[m.id]) {
    const ld = el('div', 'empty-msg', 'جاري التحميل…'); pane.appendChild(ld);
    try { const s = await getDocs(collection(S.db, 'matches', m.id, 'photos')); PH[m.id] = s.docs.map((x) => ({ id: x.id, ...x.data() })).sort((x, y) => x.at - y.at); }
    catch (e) { ld.textContent = errText(e); return; }
    if (mvTab === 'photos' && mvId === m.id) renderMatchView(); return;
  }
  const ps = PH[m.id];
  if (!ps.length) { pane.appendChild(el('div', 'empty-msg', 'لا توجد صور لهذه المباراة بعد.')); return; }
  const g = el('div', 'ph-grid');
  ps.forEach((p, i) => {
    const c = el('div', 'ph clickable'); const im = new Image(); im.src = p.src; im.alt = ''; im.loading = 'lazy'; c.appendChild(im);
    c.onclick = () => openPhoto(m.id, i);
    if (S.admin) { const d = el('button', 'ph-del', '🗑'); d.type = 'button'; let armed = false; d.onclick = async (e) => { e.stopPropagation(); if (!armed) { armed = true; d.textContent = 'تأكيد؟'; return; } try { await deleteDoc(doc(S.db, 'matches', m.id, 'photos', p.id)); PH[m.id] = ps.filter((x) => x.id !== p.id); renderMatchView(); } catch (er) { toast(errText(er), true); } }; c.appendChild(d); }
    g.appendChild(c);
  });
  pane.appendChild(g);
}
let phView = null;
function openPhoto(mid, i) { phView = { mid, i }; drawPhoto(); openModal('#photoModal'); }
function drawPhoto() { const ps = PH[phView.mid] || []; if (!ps.length) return; phView.i = (phView.i + ps.length) % ps.length; $('#phImg').src = ps[phView.i].src; $('#phCount').textContent = `${phView.i + 1} / ${ps.length}`; }
$('#phPrev').onclick = () => { phView.i++; drawPhoto(); };
$('#phNext').onclick = () => { phView.i--; drawPhoto(); };


// ---------- التطبيق على الجوال (PWA) ----------
let swReg = null, installEvt = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) $('#installBtn').hidden = false;
$('#installBtn').onclick = async () => {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r && r.outcome === 'accepted') { $('#installBtn').hidden = true; toast('تم تثبيت التطبيق ✅'); } installEvt = null; return; }
  $('#iosHelp').hidden = false; openModal('#installModal');
};
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });




// ---------- ملخص الترتيب (توفير قراءات Firebase) ----------
// المشرفة تحسب الترتيب من كل التشكيلات وتحفظه في site/table، والزوار يقرون هذا الملف الواحد فقط
async function computeTable(force) {
  await loadPicks(!!force);
  const now = Date.now();
  return [...S.teams.entries()].map(([uid, t]) => {
    const tt = teamTotals(S.gws, S.allPicks[uid] || {}, S.byId, S.rules.formations, now);
    const ns = Object.keys(tt.perGw).map(Number);
    const last = ns.length ? tt.perGw[Math.max(...ns)] : null;
    return { uid, t, tt, last, lastN: ns.length ? Math.max(...ns) : null };
  }).sort((a2, b2) => b2.tt.total - a2.tt.total || (a2.t.createdAt || 0) - (b2.t.createdAt || 0));
}
let lastPub = '';
async function publishTable(rows) {
  if (!S.admin) return;
  const out = rows.map((x) => ({ uid: x.uid, name: (x.t.name || '').slice(0, 40), c: x.t.createdAt || 0, gn: x.t.gName || '', gp: x.t.gPhoto || '', total: x.tt.total,
    g: Object.fromEntries(Object.entries(x.tt.perGw).map(([n, v]) => [n, [v.net, v.chip || null]])) }));
  const sel = S.sel ? { total: S.sel.total, counts: S.sel.counts } : { total: 0, counts: {} };
  const key = JSON.stringify([out, sel]);
  if (key === lastPub || (S.table && JSON.stringify([S.table.rows, S.table.sel]) === key)) { lastPub = key; return; }
  try { await fsSetDoc(doc(S.db, 'site', 'table'), { rows: out, sel, at: Date.now() }); lastPub = key; } catch (e) { /* */ }
}
function tableRows() {
  const rows = ((S.table && S.table.rows) || []).map((x) => {
    const perGw = {}; Object.entries(x.g || {}).forEach(([n, v]) => { perGw[n] = { net: v[0], chip: v[1] }; });
    const ns = Object.keys(perGw).map(Number);
    return { uid: x.uid, t: { name: x.name, createdAt: x.c, gName: x.gn || '', gPhoto: x.gp || '' }, tt: { total: x.total, perGw }, last: ns.length ? perGw[Math.max(...ns)] : null, lastN: ns.length ? Math.max(...ns) : null, light: true };
  });
  // فريقي يظهر حتى لو ما تحدث الملخص بعد
  if (S.uid && !rows.some((x) => x.uid === S.uid) && S.teams.get(S.uid)) rows.push({ uid: S.uid, t: S.teams.get(S.uid), tt: { total: 0, perGw: {} }, last: null, lastN: null, light: true });
  return rows;
}
async function fetchUserPicks(uid) {
  const gs = S.admin || uid === S.uid ? S.gws : S.gws.filter((g) => g.deadline <= Date.now());
  const ps = await Promise.all(gs.map((g) => getDoc(doc(S.db, 'gameweeks', String(g.n), 'picks', uid)).catch(() => null)));
  S.allPicks[uid] = S.allPicks[uid] || {};
  ps.forEach((sn, i) => { if (sn && sn.exists()) S.allPicks[uid][gs[i].n] = sn.data(); });
}
// المشرفة: تحديث الملخص بعد حفظ المباريات وإنهاء الجولات، وعند الدخول (مرة كل 10 دقائق)
let tableBusy = false;
async function adminRefreshTable(force) {
  if (!S.admin || tableBusy) return;
  if (!force && S.table && Date.now() - (S.table.at || 0) < 600000) return;
  tableBusy = true;
  try { await publishTable(await computeTable(true)); } catch (e) { /* */ } finally { tableBusy = false; }
}

// اسم حساب قوقل وصورته (يظهر جنب اسم الفريق)
function gInfo() {
  const u = S.auth && S.auth.currentUser; if (!u) return {};
  const o = {}; if (u.displayName) o.gName = u.displayName.slice(0, 80); if (u.photoURL && u.photoURL.length <= 600) o.gPhoto = u.photoURL;
  return o;
}


// ---------- الجولة: فريق الجولة (فانتازي) + تشكيلة الجولة بالتصويت ----------
let totwN = null; const TOTW = {};
const FORMS = () => Object.entries(S.rules.formations);
// أفضل تشكيلة حسب دالة تقييم (نقاط أو أصوات) ضمن الخطط المسموحة
function bestXI(cands, score) {
  const by = { gk: [], def: [], mid: [], fwd: [] };
  cands.forEach((p) => by[p.position] && by[p.position].push(p));
  Object.values(by).forEach((l) => l.sort((x, y) => score(y) - score(x)));
  let best = null;
  FORMS().forEach(([name, f]) => {
    if (ORDER.some((k) => by[k].length < f[k])) return;
    const ids = ORDER.flatMap((k) => by[k].slice(0, f[k]));
    const tot = ids.reduce((s, p) => s + score(p), 0);
    if (!best || tot > best.tot) best = { name, ids, tot };
  });
  return best;
}
function pitchOf(list, badge) {
  const box = el('div', 'lu');
  ORDER.forEach((k) => {
    const ps = list.filter((p) => p.position === k); if (!ps.length) return;
    const row = el('div', 'lu-row');
    ps.forEach((p) => { const c = el('div', 'lu-p clickable'); c.append(avatar(p, 'lu-av'), el('div', 'lu-n', p.name), el('div', 'lu-sc', badge(p))); c.onclick = () => openProfile(p.id); row.appendChild(c); });
    box.appendChild(row);
  });
  return box;
}
async function renderTotw() {
  const box = $('#totwBody'); box.innerHTML = '';
  const now = Date.now();
  const gs = [...S.gws].filter((g) => g.deadline <= now).sort((x, y) => y.n - x.n);
  if (!gs.length) { box.appendChild(el('div', 'empty-msg', 'يظهر فريق الجولة بعد بداية أول جولة.')); return; }
  if (!gs.some((g) => g.n === totwN)) totwN = gs[0].n;
  const sel = el('select', 'totw-sel');
  gs.forEach((g) => { const o = document.createElement('option'); o.value = g.n; o.textContent = gwLabel(g); sel.appendChild(o); });
  sel.value = totwN; sel.onchange = () => { totwN = Number(sel.value); renderTotw(); };
  box.appendChild(sel);
  const n = totwN; const g = gs.find((x) => x.n === n);
  const played = S.players.filter((p) => roundMatches(p, n).some((m) => num(m.min) > 0));

  // 1) فريق الجولة في الفانتازي (أعلى النقاط)
  const s1 = el('div', 'totw-sec');
  s1.appendChild(el('h3', 'mt-h', '🏆 فريق الجولة في الفانتازي'));
  const dt = bestXI(played, (p) => roundPts(p, n));
  if (!dt) s1.appendChild(el('div', 'empty-msg', 'تظهر بعد تسجيل نتائج مباريات هذه الجولة.'));
  else {
    s1.appendChild(el('div', 'totw-sub', `الخطة ${dt.name} · مجموع ${dt.tot} نقطة`));
    s1.appendChild(pitchOf(dt.ids, (p) => `${roundPts(p, n)} ن`));
  }
  // أفضل مدرب في الجولة
  const rows = S.admin ? [] : tableRows();
  const src = S.admin && S.table ? ((S.table.rows || []).map((x) => ({ name: x.name, v: (x.g || {})[n] ? x.g[n][0] : null }))) : rows.map((x) => ({ name: x.t.name, v: x.tt.perGw[n] ? x.tt.perGw[n].net : null }));
  const top = src.filter((x) => x.v != null).sort((x, y) => y.v - x.v)[0];
  if (top) { const c = el('div', 'totw-mgr'); c.append(el('span', null, '👑 أفضل مدرب في الجولة'), el('b', null, top.name), el('span', 'totw-mp', `${top.v} نقطة`)); s1.appendChild(c); }
  box.appendChild(s1);

  // 2) تشكيلة الجولة بتصويت الجمهور
  const s2 = el('div', 'totw-sec');
  s2.appendChild(el('h3', 'mt-h', '🗳️ تشكيلة الجولة (تصويت الجمهور)'));
  box.appendChild(s2);
  if (!TOTW[n]) {
    s2.appendChild(el('div', 'empty-msg', 'جاري التحميل…'));
    try { const d = await getDoc(doc(S.db, 'totw', String(n))); TOTW[n] = d.exists() ? (d.data().votes || {}) : {}; }
    catch (e) { s2.innerHTML = ''; s2.appendChild(el('div', 'err', errText(e))); return; }
    if (totwN === n && !$('#tab-totw').hidden) renderTotw(); return;
  }
  const votes = TOTW[n]; const voters = Object.keys(votes).length;
  const cnt = {}; Object.values(votes).forEach((v) => (v.ids || []).forEach((id) => { cnt[id] = (cnt[id] || 0) + 1; }));
  const mine = S.uid && votes[S.uid];
  const vb = el('button', 'btn primary sm', mine ? '✏️ عدّل تصويتك' : '🗳️ صوّت لتشكيلتك'); vb.type = 'button';
  vb.onclick = () => { if (!S.uid) { toast('سجّل دخول بقوقل عشان تصوّت'); googleLogin(); return; } openTotwVote(n, played); };
  const hd = el('div', 'totw-vh'); hd.append(el('span', 'totw-sub', `عدد المصوّتين: ${voters}`), vb); s2.appendChild(hd);
  const vcands = S.players.filter((p) => cnt[p.id]);
  const vt = voters ? bestXI(vcands, (p) => cnt[p.id] || 0) : null;
  if (!vt) s2.appendChild(el('div', 'empty-msg', voters ? 'الأصوات ما تكمّل تشكيلة كاملة بعد.' : 'ما أحد صوّت بعد. كن أول واحد!'));
  else s2.appendChild(pitchOf(vt.ids, (p) => `${Math.round((cnt[p.id] / voters) * 100)}% (${cnt[p.id]})`));
  if (mine) s2.appendChild(el('div', 'totw-sub', '✅ صوّتّ في هذي الجولة'));
}
let tvN = null, tvSel = [];
function openTotwVote(n, played) {
  tvN = n; const mine = (TOTW[n] || {})[S.uid];
  tvSel = mine ? [...mine.ids] : [];
  const fsel = $('#tvForm'); fsel.innerHTML = '';
  FORMS().forEach(([k]) => { const o = document.createElement('option'); o.value = k; o.textContent = k; fsel.appendChild(o); });
  fsel.value = mine && S.rules.formations[mine.f] ? mine.f : FORMS()[0][0];
  const cands = played.length ? played : S.players;
  const draw = () => {
    const f = S.rules.formations[fsel.value];
    tvSel = tvSel.filter((id) => S.byId.get(id));
    const box = $('#tvList'); box.innerHTML = '';
    ORDER.forEach((k) => {
      const ps = cands.filter((p) => p.position === k).sort((x, y) => roundPts(y, n) - roundPts(x, n));
      if (!ps.length) return;
      const have = tvSel.filter((id) => S.byId.get(id).position === k).length;
      box.appendChild(el('div', 'tv-h', `${POS_PL[k]} (${have}/${f[k]})`));
      ps.forEach((p) => {
        const on = tvSel.includes(p.id);
        const r = el('label', 'tv-row' + (on ? ' on' : ''));
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = on;
        cb.onchange = () => {
          if (cb.checked) { if (have >= f[k]) { cb.checked = false; toast(`الخطة ${fsel.value} فيها ${f[k]} فقط من ${POS_PL[k]}`, true); return; } tvSel.push(p.id); }
          else tvSel = tvSel.filter((x) => x !== p.id);
          draw();
        };
        r.append(cb, avatar(p, 'club-av'), el('b', 'rs-n', p.name), el('span', 'ev-ps', `${p.club || ''} · ${roundPts(p, n)} ن`));
        box.appendChild(r);
      });
    });
    const need = ORDER.reduce((s, k) => s + f[k], 0);
    $('#tvCount').textContent = `اخترت ${tvSel.length} من ${need}`;
    $('#tvSave').disabled = !legalFormation(tvSel, S.byId, { x: f });
  };
  fsel.onchange = () => { const f = S.rules.formations[fsel.value]; ORDER.forEach((k) => { const ids = tvSel.filter((id) => S.byId.get(id).position === k); if (ids.length > f[k]) tvSel = tvSel.filter((id) => !ids.slice(f[k]).includes(id)); }); draw(); };
  $('#tvErr').textContent = ''; draw(); openModal('#totwModal');
}
$('#tvSave').onclick = async () => {
  const f = $('#tvForm').value;
  if (!legalFormation(tvSel, S.byId, { x: S.rules.formations[f] })) { $('#tvErr').textContent = 'كمّل التشكيلة حسب الخطة'; return; }
  const v = { ids: [...tvSel], f, at: Date.now() };
  $('#tvSave').disabled = true;
  try {
    await fsSetDoc(doc(S.db, 'totw', String(tvN)), { votes: { [S.uid]: v } }, { merge: true });
    TOTW[tvN] = { ...(TOTW[tvN] || {}), [S.uid]: v };
    closeModal('#totwModal'); toast('تم تسجيل تصويتك ✅'); renderTotw();
  } catch (e) { $('#tvSave').disabled = false; $('#tvErr').textContent = errText(e); }
};

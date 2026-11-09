// ================= Aqeq League — الواجهة (GitHub Pages + Firebase) =================
import { firebaseConfig, ADMIN_UID, RULES } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
const totalSlots = () => S.rules.starters + S.rules.bench;
const clubCount = (club) => picked().filter((id) => S.byId.get(id)?.club === club).length;

function canAfford(p) {
  if (cost() + p.price > S.rules.budget + 1e-9) { toast('الميزانية لا تكفي لهذا اللاعب', true); return false; }
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
  $('#teamName').value = t.name || '';
  $('#formation').value = S.formation;
}

// ---------- رسم الملعب ----------
function slotEl(id, pos, i, label) {
  const p = id ? S.byId.get(id) : null;
  const b = el('button', 'slot ' + (p ? 'filled' : 'empty')); b.type = 'button';
  if (p) {
    b.appendChild(avatar(p, 'pic'));
    b.appendChild(el('div', 'lbl', p.name));
    b.appendChild(el('div', 'sub', `${money(p.price)} · ${p.points}`));
    b.title = 'اضغط لإزالة اللاعب';
    b.onclick = () => removeFromTeam(id);
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
  }
  return b;
}
function renderTeam() {
  const rows = $('#rows'); rows.innerHTML = '';
  ORDER.forEach((k) => {
    const row = el('div', 'row');
    S.slots[k].forEach((id, i) => row.appendChild(slotEl(id, k, i, POS[k].slot)));
    rows.appendChild(row);
  });
  const bench = $('#benchSlots'); bench.innerHTML = '';
  S.bench.forEach((id, i) => bench.appendChild(slotEl(id, 'bench', i, 'بديل')));

  const left = S.rules.budget - cost();
  $('#sBudget').textContent = money(left);
  $('#sBudget').classList.toggle('neg', left < 0);
  $('#sCount').textContent = `${picked().length}/${totalSlots()}`;
  const pts = ORDER.flatMap((k) => S.slots[k]).filter(Boolean).reduce((s, id) => s + (S.byId.get(id)?.points || 0), 0);
  $('#sPoints').textContent = pts;
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
    meta.append(nm, el('div', 'cl', p.club));
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
const SC = { goal: { gk: 6, def: 6, mid: 5, fwd: 4 }, assist: 3, cs: { gk: 4, def: 4, mid: 1, fwd: 0 }, yc: -1, rc: -3, pm: -2, og: -2 };
const POS_PL = { gk: 'الحراس', def: 'المدافعين', mid: 'لاعبي الوسط', fwd: 'المهاجمين' };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const LBL = {
  min: 'دقائق اللعب', goals: 'الأهداف', assists: 'التمريرات الحاسمة', cs: 'الشباك النظيفة', saves: 'التصديات',
  bonus: 'نقاط البونص', yc: 'البطاقات الصفراء', rc: 'البطاقات الحمراء', pm: 'ركلات جزاء ضائعة', og: 'أهداف عكسية', gc: 'أهداف مستقبلة',
};

function breakdown(pos, m) {
  const zero = { min: 0, goals: 0, assists: 0, cs: 0, saves: 0, bonus: 0, yc: 0, rc: 0, pm: 0, og: 0, gc: 0 };
  const min = num(m.min);
  if (min <= 0) return zero;
  const ga = num(m.ga);
  return {
    min: min >= 11 ? 2 : 1,
    goals: num(m.g) * SC.goal[pos],
    assists: num(m.a) * SC.assist,
    cs: ga === 0 ? SC.cs[pos] : 0,
    saves: pos === 'gk' ? Math.floor(num(m.sv) / 3) : 0,
    bonus: num(m.bo),
    yc: num(m.yc) * SC.yc,
    rc: num(m.rc) * SC.rc,
    pm: num(m.pm) * SC.pm,
    og: num(m.og) * SC.og,
    gc: (pos === 'gk' || pos === 'def') ? -Math.floor(ga / 2) : 0,
  };
}
const sumObj = (o) => Object.values(o).reduce((s, v) => s + v, 0) + 0;
const matchPts = (pos, m) => sumObj(breakdown(pos, m));
const totalPts = (p) => (p?.matches || []).reduce((s, m) => s + matchPts(p.position, m), 0) + 0;
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
  if (!S.db || (S.sel && Date.now() - S.sel.t < 60000)) return;
  try {
    const snap = await getDocs(collection(S.db, 'teams'));
    const counts = {};
    snap.docs.forEach((d) => { const t = d.data(); [...(t.starters || []), ...(t.bench || [])].forEach((id) => { counts[id] = (counts[id] || 0) + 1; }); });
    S.sel = { t: Date.now(), total: snap.docs.length, counts };
    if ($('#profileModal').classList.contains('open')) renderProfile();
  } catch { /* نسبة الاختيار اختيارية */ }
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
function pfFormFixtures(p) {
  const card = el('div', 'pf-card pf-two');
  // الفورم: آخر مباراة
  const f = el('div', 'pf-col pf-formcol'); f.appendChild(el('h4', null, 'الفورم'));
  const last = [...(p.matches || [])].sort((a, b) => b.round - a.round)[0];
  if (last) {
    const it = el('div', 'pf-item');
    it.append(el('div', 'pf-rd', 'ج' + last.round), el('div', 'pf-crest', initialOf(last.opp)),
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
      it.append(el('div', 'pf-rd', 'ج' + m.round), el('div', 'pf-crest', initialOf(m.opp)),
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
  if (m.og) a.push('هدف عكسي');
  return a.join('  ·  ');
}
function pfMatchesPane(p, w) {
  if (S.admin) {
    const add = el('button', 'btn add sm', '+ إضافة نتيجة مباراة'); add.type = 'button';
    add.onclick = () => openMatchForm(p.id, null); w.appendChild(add);
  }
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
  const ms = (p.matches || []), tot = { min: 0, goals: 0, assists: 0, cs: 0, saves: 0, bonus: 0, yc: 0, rc: 0, pm: 0, og: 0, gc: 0 };
  const pts = { ...tot }, val = { ...tot };
  ms.forEach((m) => {
    const b = breakdown(p.position, m), played = num(m.min) > 0;
    Object.keys(pts).forEach((k) => { pts[k] += b[k]; });
    if (!played) return;
    val.min += num(m.min); val.goals += num(m.g); val.assists += num(m.a);
    if (num(m.ga) === 0) val.cs += 1;
    val.saves += num(m.sv); val.bonus += num(m.bo); val.yc += num(m.yc); val.rc += num(m.rc);
    val.pm += num(m.pm); val.og += num(m.og); val.gc += num(m.ga);
  });
  const keys = ['min', 'goals', 'assists', 'cs'];
  if (p.position === 'gk') keys.push('saves');
  keys.push('bonus', 'yc', 'rc', 'pm', 'og');
  if (p.position === 'gk' || p.position === 'def') keys.push('gc');
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
    'اللعب 11 دقيقة فأكثر: 2 نقطة (أقل من 11 دقيقة: 1 نقطة)',
    'هدف: مهاجم 4 · وسط 5 · مدافع أو حارس 6',
    'تمريرة حاسمة: 3 نقاط',
    'شباك نظيفة: حارس أو مدافع 4 نقاط · وسط نقطة واحدة',
    'التصديات: نقطة لكل 3 تصديات للحارس',
    'البونص: من 1 إلى 3 نقاط لأفضل لاعبين في المباراة',
    'بطاقة صفراء -1 · حمراء -3 · ركلة جزاء ضائعة أو هدف عكسي -2',
    'الحارس أو المدافع: -1 لكل هدفين يدخلان مرماه',
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
    sv: n('#mfSv', 60), bo: n('#mfBo', 3), yc: n('#mfYc', 2), rc: n('#mfRc', 1), pm: n('#mfPm', 5), og: n('#mfOg', 5),
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
  $('#mfSvWrap').hidden = p.position !== 'gk';
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
  const v = { '#mfGf': 'gf', '#mfGa': 'ga', '#mfMin': 'min', '#mfG': 'g', '#mfA': 'a', '#mfSv': 'sv', '#mfBo': 'bo', '#mfYc': 'yc', '#mfRc': 'rc', '#mfPm': 'pm', '#mfOg': 'og' };
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
  if (m.min === 0 && (m.g || m.a || m.sv || m.bo || m.yc || m.rc || m.pm || m.og)) return err('اللاعب لم يشارك (الدقائق صفر) ولا يمكن تسجيل إحصائيات له');
  const ms = (p.matches || []).filter((x) => x.round !== mfOrig);
  if (ms.some((x) => x.round === m.round)) return err('هذه الجولة مسجّلة من قبل، عدّليها من القائمة');
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
  if (!S.uid) { toast('سجّل الدخول بـ Google لحفظ فريقك'); googleLogin(); return; }
  const body = { name, formation: S.formation, starters: ORDER.flatMap((k) => S.slots[k]), bench: S.bench };
  const btn = $('#saveTeam'); btn.disabled = true;
  try {
    const ref = doc(S.db, 'teams', S.uid);
    const old = await getDoc(ref);
    const now = Date.now();
    await setDoc(ref, { ...body, createdAt: old.exists() ? old.data().createdAt : now, updatedAt: now });
    toast(old.exists() ? 'تم تحديث فريقك ✅' : 'تم حفظ فريقك ودخوله ترتيب الدوري 🎉');
    S.hasTeam = true;
  } catch (e) { toast(errText(e), true); }
  finally { btn.disabled = false; }
};
$('#resetTeam').onclick = () => {
  S.slots = emptySlots(S.formation); S.bench = Array(S.rules.bench).fill(null); S.target = null;
  renderTeam(); renderList();
};
$('#formation').onchange = (e) => setFormation(e.target.value);
$('#filters').onclick = (e) => { const b = e.target.closest('.f'); if (b) { S.target = null; setFilter(b.dataset.pos); renderTeam(); } };
$('#search').oninput = (e) => { S.query = e.target.value; renderList(); };

// ---------- الترتيب ----------
async function renderStandings() {
  const box = $('#standings'); box.innerHTML = '';
  box.appendChild(el('div', 'empty-msg', 'جارٍ التحميل…'));
  let teams;
  try {
    const snap = await getDocs(collection(S.db, 'teams'));
    teams = snap.docs.map((d) => {
      const t = { id: d.id, ...d.data() };
      t.points = (t.starters || []).reduce((sum, id) => sum + (S.byId.get(id)?.points || 0), 0);
      return t;
    }).sort((a, b) => b.points - a.points || a.createdAt - b.createdAt);
  } catch (e) { box.innerHTML = ''; box.appendChild(el('div', 'empty-msg', errText(e))); return; }
  box.innerHTML = '';
  if (!teams.length) { box.appendChild(el('div', 'empty-msg', 'لا توجد فرق بعد. كن أول من يحفظ فريقه!')); return; }
  const tbl = el('table'); const head = el('tr');
  ['#', 'الفريق', 'الخطة', 'النقاط'].forEach((h) => head.appendChild(el('th', null, h)));
  if (S.admin) head.appendChild(el('th', null, ''));
  tbl.appendChild(head);
  teams.forEach((t, i) => {
    const tr = el('tr', (S.uid === t.id ? 'mine ' : '') + (i === 0 ? 'top1' : ''));
    tr.append(el('td', 'rank', i === 0 ? '🏆' : String(i + 1)), el('td', null, t.name + (S.uid === t.id ? ' (فريقي)' : '')),
      el('td', null, t.formation), el('td', 'pts', String(t.points)));
    if (S.admin) {
      const td = el('td'); const d = el('button', 'del-team', 'حذف'); let armed = false;
      d.onclick = async () => {
        if (!armed) { armed = true; d.textContent = 'تأكيد الحذف؟'; return; }
        try { await deleteDoc(doc(S.db, 'teams', t.id)); toast('تم حذف الفريق'); renderStandings(); }
        catch (e) { toast(errText(e), true); }
      };
      td.appendChild(d); tr.appendChild(td);
    }
    tbl.appendChild(tr);
  });
  box.appendChild(tbl);
}
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  const pick = t.dataset.tab === 'pick';
  $('#tab-pick').hidden = !pick; $('#tab-table').hidden = pick;
  if (!pick) renderStandings();
});

// ---------- المشرف ----------
function setAdmin(on) {
  S.admin = on;
  $('#adminChip').hidden = !on; $('#addPlayer').hidden = !on;
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
  renderTeam(); renderList(); toast('تم تسجيل الخروج');
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
  S.players = list;
  S.byId = new Map(S.players.map((p) => [p.id, p]));
  ORDER.forEach((k) => { if (S.slots[k]) S.slots[k] = S.slots[k].map((id) => (id && S.byId.has(id) ? id : null)); });
  S.bench = S.bench.map((id) => (id && S.byId.has(id) ? id : null));
  renderTeam(); renderList();
  if (S.profile && $('#profileModal').classList.contains('open')) renderProfile();
  if ($('#fixtureModal').classList.contains('open')) renderFixtureList();
}

let playersReady, playersLoaded;
playersReady = new Promise((r) => { playersLoaded = r; });

async function loadMyTeam() {
  try {
    await playersReady;
    const d = await getDoc(doc(S.db, 'teams', S.uid));
    S.hasTeam = d.exists();
    if (d.exists()) { applyTeam(d.data()); renderTeam(); renderList(); }
  } catch { /* لا يوجد فريق */ }
}

(function init() {
  S.rules = RULES;
  const sel = $('#formation');
  Object.keys(S.rules.formations).forEach((f) => sel.appendChild(el('option', null, f)));
  S.formation = Object.keys(S.rules.formations)[0]; sel.value = S.formation;
  S.slots = emptySlots(S.formation); S.bench = Array(S.rules.bench).fill(null);
  $('#rulesHint').textContent = `${S.rules.starters} لاعبين أساسيين و${S.rules.bench === 1 ? 'بديل واحد' : S.rules.bench + ' بدلاء'}، والميزانية ${money(S.rules.budget)}. إذا امتلأ المركز في الملعب ينتقل اللاعب الجديد إلى الدكة. اضغط على اللاعب في الملعب لإزالته. الحد الأقصى ${S.rules.maxPerClub} لاعبين من نفس الفريق.`;
  setAdmin(false); setUser(null); $('#googleBtn').hidden = true; renderTeam();

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    const m = $('#setupMsg'); m.hidden = false;
    m.textContent = 'الموقع يحتاج إلى ربطه بـ Firebase: الصقي بيانات مشروعك في الملف firebase-config.js (الخطوات في README).';
    renderList(); return;
  }
  const app = initializeApp(firebaseConfig);
  S.auth = getAuth(app); S.db = getFirestore(app);

  onSnapshot(query(collection(S.db, 'players'), orderBy('createdAt')),
    (snap) => { applyPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); playersLoaded(); },
    (e) => { toast(errText(e), true); playersLoaded(); });

  getRedirectResult(S.auth).catch((e) => toast(errText(e), true));
  let welcomed = false;
  onAuthStateChanged(S.auth, (u) => {
    S.uid = u ? u.uid : null; S.hasTeam = false;
    setUser(u);
    const admin = !!u && ADMIN_UID.split(',').map((x) => x.trim()).filter(Boolean).includes(u.uid);
    setAdmin(admin);
    if (u) {
      if (!welcomed) toast(admin ? 'مرحبًا بك، تم دخول المشرف 👑' : `أهلًا ${u.displayName || ''}`);
      welcomed = true;
      loadMyTeam();
    } else welcomed = false;
    if (!$('#tab-table').hidden) renderStandings();
  });
})();

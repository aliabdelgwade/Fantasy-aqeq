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
  uid: null, hasTeam: false, db: null, auth: null,
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
    const av = avatar(p, 'av'); av.onclick = () => showInfo(p.id);
    const meta = el('div', 'meta'); meta.onclick = () => showInfo(p.id);
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
function showInfo(id) {
  const p = S.byId.get(id); if (!p) return;
  const b = $('#infoBody'); b.innerHTML = '';
  const tags = el('div', 'info-tags');
  tags.append(el('span', 'pos ' + p.position, POS[p.position].one), el('span', 'tag', p.club),
    el('span', 'tag', 'السعر ' + money(p.price)), el('span', 'tag', 'النقاط ' + p.points));
  b.append(avatar(p, 'info-photo'), el('div', 'info-name', p.name), tags, el('p', 'info-desc', p.desc || 'لا يوجد وصف.'));
  const a = el('div', 'actions');
  const on = isPicked(id);
  const t = el('button', 'btn ' + (on ? 'ghost' : 'primary'), on ? 'إزالة من فريقي' : 'إضافة إلى فريقي');
  t.onclick = () => { closeModal('#infoModal'); on ? removeFromTeam(id) : addToTeam(id); };
  a.appendChild(t);
  if (S.admin) { const e = el('button', 'btn ghost', 'تعديل'); e.onclick = () => { closeModal('#infoModal'); openPlayerForm(id); }; a.appendChild(e); }
  b.appendChild(a);
  openModal('#infoModal');
}

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
  $('#pfPrice').value = editing?.price ?? 6; $('#pfPoints').value = editing?.points ?? 0;
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
    club: $('#pfClub').value.trim(), price: Number($('#pfPrice').value), points: Number($('#pfPoints').value || 0),
  };
  if (!body.name) { $('#pfErr').textContent = 'اكتب اسم اللاعب'; return; }
  if (!body.club) { $('#pfErr').textContent = 'اكتب اسم الفريق'; return; }
  if (!(body.price >= 1 && body.price <= 20)) { $('#pfErr').textContent = 'السعر يجب أن يكون بين 1 و 20'; return; }
  body.price = Math.round(body.price * 10) / 10;
  body.points = Math.round(body.points);
  if (!(body.points >= -100 && body.points <= 9999)) { $('#pfErr').textContent = 'النقاط غير صحيحة'; return; }
  body.photo = photoData !== undefined ? photoData : (editing ? editing.photo || null : null);
  const now = Date.now();
  body.createdAt = editing ? editing.createdAt : now; body.updatedAt = now;
  $('#pfSave').disabled = true;
  try {
    const ref = editing ? doc(S.db, 'players', editing.id) : doc(collection(S.db, 'players'));
    await setDoc(ref, body);
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
   const admin = !!u && ADMIN_UID.split(',').map((x) => x.trim()).includes(u.uid);
    setAdmin(admin);
    if (u) {
      if (!welcomed) toast(admin ? 'مرحبًا بك، تم دخول المشرف 👑' : `أهلًا ${u.displayName || ''}`);
      welcomed = true;
      loadMyTeam();
    } else welcomed = false;
    if (!$('#tab-table').hidden) renderStandings();
  });
})();

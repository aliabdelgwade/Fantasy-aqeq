// ================= Aqeq League — منطق الجولات (دوال نقية بدون Firebase) =================
// نظام النقاط
export const SC = { play: 2, goal: { gk: 5, def: 5, mid: 5, fwd: 5 }, assist: 4, cs: { gk: 4, def: 4, mid: 0, fwd: 0 }, yc: -1, rc: -3, pm: -2, og: -3, bonusMax: 2 };
export const CHIPS = { wc: 'Wildcard', fh: 'Free Hit', bb: 'Bench Boost', tc: 'Triple Captain' };
export const CHIP_MAX = { wc: 2, fh: 1, bb: 1, tc: 1 };
export const HIT = 4;
export const MAX_BANK = 3;
export const FT_PER_WEEK = 2;

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function breakdown(pos, m) {
  const zero = { min: 0, goals: 0, assists: 0, cs: 0, saves: 0, bonus: 0, yc: 0, rc: 0, pm: 0, og: 0, gc: 0 };
  const min = num(m.min);
  if (min <= 0) return zero;
  const ga = num(m.ga);
  return {
    min: SC.play,
    goals: num(m.g) * SC.goal[pos],
    assists: num(m.a) * SC.assist,
    cs: ga === 0 ? SC.cs[pos] : 0,
    saves: 0,
    bonus: Math.min(SC.bonusMax, Math.max(0, num(m.bo))),
    yc: num(m.yc) * SC.yc,
    rc: num(m.rc) * SC.rc,
    pm: num(m.pm) * SC.pm,
    og: num(m.og) * SC.og,
    gc: 0,
  };
}
export const sumObj = (o) => Object.values(o).reduce((s, v) => s + v, 0) + 0;
export const matchPts = (pos, m) => sumObj(breakdown(pos, m));
export const totalPts = (p) => (p?.matches || []).reduce((s, m) => s + matchPts(p.position, m), 0) + 0;

// ---- نقاط لاعب في جولة محددة (رقم الجولة = رقم round في المباراة) ----
export function roundMatches(p, n) { return (p?.matches || []).filter((m) => num(m.round) === n); }
export function roundPts(p, n) { return roundMatches(p, n).reduce((s, m) => s + matchPts(p.position, m), 0) + 0; }
export function played(p, n) { return roundMatches(p, n).some((m) => num(m.min) > 0); }

// ---- الخطط ----
export function counts(ids, byId) {
  const c = { gk: 0, def: 0, mid: 0, fwd: 0 };
  ids.forEach((id) => { const p = byId.get(id); if (p) c[p.position]++; });
  return c;
}
export function legalFormation(ids, byId, formations) {
  const c = counts(ids, byId);
  return Object.values(formations).some((f) => f.gk === c.gk && f.def === c.def && f.mid === c.mid && f.fwd === c.fwd);
}

// ---- نقاط الفريق في جولة: بدائل تلقائية + قائد/نائب + رقائق ----
// pick: {starters[], bench[], captain, vice}; chip: 'bb'|'tc'|...|null; g: {n, final}
export function scorePick(pick, chip, g, byId, formations) {
  const n = g.n;
  const pl = (id) => byId.get(id);
  const pts = (id) => (pl(id) ? roundPts(pl(id), n) : 0);
  const did = (id) => (pl(id) ? played(pl(id), n) : false);

  let active = [...pick.starters];
  const subs = [];
  if (chip === 'bb') {
    active = [...pick.starters, ...pick.bench];
  } else if (g.final) {
    pick.bench.forEach((b) => {
      if (!did(b)) return;
      for (let i = 0; i < active.length; i++) {
        if (did(active[i])) continue;
        const test = active.map((x, j) => (j === i ? b : x));
        if (legalFormation(test, byId, formations)) { subs.push({ out: active[i], in: b }); active = test; break; }
      }
    });
  }

  let cap = null;
  if (active.includes(pick.captain) && (!g.final || did(pick.captain))) cap = pick.captain;
  else if (g.final && active.includes(pick.vice) && did(pick.vice)) cap = pick.vice;
  else if (!g.final && active.includes(pick.vice) && !active.includes(pick.captain)) cap = pick.vice;
  const mult = chip === 'tc' ? 3 : 2;

  const items = active.map((id) => ({ id, base: pts(id), mult: id === cap ? mult : 1, played: did(id) }));
  items.forEach((it) => { it.pts = it.base * it.mult; });
  const benchOut = pick.bench.filter((id) => !active.includes(id));
  return {
    gross: items.reduce((s, it) => s + it.pts, 0) + 0,
    items, subs, captain: cap, benchOut, benchPts: benchOut.reduce((s, id) => s + pts(id), 0),
  };
}

// ---- خط زمني لفريق: التحويلات، الرقائق، الخصم، الجولات المتروكة ----
// gws مرتّبة تصاعديًا [{n, deadline, final}] ، picks: {n: pick}
export function timeline(gws, picks) {
  const used = { wc: 0, fh: 0, bb: 0, tc: 0 };
  let base = null;          // آخر تشكيلة "حقيقية" (بدون Free Hit)
  let ft = FT_PER_WEEK;     // التحويلات المجانية المتاحة قبل الجولة
  const out = [];
  for (const g of gws) {
    const sp = picks[g.n];
    let pick, carried = false;
    if (sp) pick = { starters: [...sp.starters], bench: [...sp.bench], captain: sp.captain, vice: sp.vice, formation: sp.formation, chip: sp.chip || null };
    else if (base) { pick = { ...base.pick, starters: [...base.pick.starters], bench: [...base.pick.bench], chip: null }; carried = true; }
    else { out.push({ n: g.n, none: true }); continue; }

    let chip = pick.chip;
    if (chip && (!(chip in CHIP_MAX) || used[chip] >= CHIP_MAX[chip])) chip = null;
    const squad = [...pick.starters, ...pick.bench];
    const prev = base ? base.squad : null;
    const t = prev ? squad.filter((id) => !prev.includes(id)).length : 0;
    const free = !prev || chip === 'wc' || chip === 'fh';
    const hit = free ? 0 : Math.max(0, t - ft) * HIT;
    const ftBefore = ft;
    let ftNext;
    if (!prev) ftNext = FT_PER_WEEK;
    else if (chip === 'wc' || chip === 'fh') ftNext = ft;
    else ftNext = Math.min(MAX_BANK, Math.max(0, ft - t) + FT_PER_WEEK);
    if (chip) used[chip]++;

    out.push({ n: g.n, pick, squad, chip, carried, transfers: t, free, hit, ftBefore, ftNext, prevBase: prev });
    if (chip !== 'fh') base = { pick, squad };
    ft = ftNext;
  }
  return { rows: out, used, base, ft };
}

// ---- مجموع نقاط فريق خلال الجولات التي انتهى موعدها ----
export function teamTotals(gws, picks, byId, formations, now) {
  const locked = gws.filter((g) => g.deadline <= now);
  const tl = timeline(locked, picks);
  let total = 0; const perGw = {};
  tl.rows.forEach((r) => {
    if (r.none) return;
    const g = locked.find((x) => x.n === r.n);
    const sc = scorePick(r.pick, r.chip, g, byId, formations);
    const net = sc.gross - r.hit;
    perGw[r.n] = { gross: sc.gross, hit: r.hit, net, chip: r.chip, carried: r.carried, score: sc };
    total += net;
  });
  return { total, perGw, tl };
}

// ---- صافي التحويلات لكل لاعب في جولة (لتحديث الأسعار) ----
export function netTransfers(gws, allPicks, n) {
  const net = new Map(); const g = gws.filter((x) => x.n <= n);
  let teamsN = 0;
  Object.values(allPicks).forEach((picks) => {
    const row = timeline(g, picks).rows.find((r) => r.n === n);
    if (!row || row.none || !row.prevBase || row.chip === 'fh') return;
    teamsN++;
    const cur = row.squad;
    cur.filter((id) => !row.prevBase.includes(id)).forEach((id) => net.set(id, (net.get(id) || 0) + 1));
    row.prevBase.filter((id) => !cur.includes(id)).forEach((id) => net.set(id, (net.get(id) || 0) - 1));
  });
  return { net, teamsN };
}
export function priceChanges(net, teamsN, players) {
  const T = Math.max(2, Math.ceil(teamsN * 0.1));
  const out = [];
  players.forEach((p) => {
    const v = net.get(p.id) || 0;
    const d = v >= T ? 0.1 : v <= -T ? -0.1 : 0;
    if (!d) return;
    const np = Math.min(20, Math.max(1, Math.round((p.price + d) * 10) / 10));
    if (np !== p.price) out.push({ id: p.id, from: p.price, to: np, net: v });
  });
  return { T, changes: out };
}

// ---- مراحل البطولة (مثل كأس العالم) ----
export const STAGES = { gw: 'الجولات', r16: 'دور الـ16', qf1: 'ذهاب ربع النهائي', qf2: 'إياب ربع النهائي', sf1: 'ذهاب نصف النهائي', sf2: 'إياب نصف النهائي', final: 'النهائي', qf: 'ربع النهائي', sf: 'نصف النهائي' };
export const PRESET = ['gw', 'gw', 'gw', 'qf1', 'qf2', 'sf1', 'sf2', 'final'];
export const gwLabel = (g) => (!g.stage || g.stage === 'gw' ? `الجولة ${g.n}` : (STAGES[g.stage] || g.stage));
export const isOff = (g, club) => !!(g && Array.isArray(g.off) && g.off.includes(club));

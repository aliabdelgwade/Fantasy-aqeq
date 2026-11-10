// ================= Aqeq League — منطق البطولة (مجموعات + أدوار إقصائية) =================
export const KO = { r16: 8, qf: 4, sf: 2, final: 1, third: 1 };
export const KO_NAMES = { r16: 'دور الـ16', qf: 'ربع النهائي', sf: 'نصف النهائي', final: 'النهائي', third: 'المركز الثالث' };
const isN = (v) => Number.isFinite(v);

// جدول مجموعة: g = {name, teams:[...], res:[{a,b,sa,sb}]}
export function standings(g) {
  const rows = new Map((g.teams || []).map((t) => [t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }]));
  (g.res || []).forEach((r) => {
    const A = rows.get(r.a), B = rows.get(r.b);
    if (!A || !B || !isN(r.sa) || !isN(r.sb)) return;
    A.p++; B.p++; A.gf += r.sa; A.ga += r.sb; B.gf += r.sb; B.ga += r.sa;
    if (r.sa > r.sb) { A.w++; B.l++; A.pts += 3; } else if (r.sa < r.sb) { B.w++; A.l++; B.pts += 3; } else { A.d++; B.d++; A.pts++; B.pts++; }
  });
  const out = [...rows.values()];
  out.forEach((x) => { x.gd = x.gf - x.ga; });
  return out.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf);
}

export function winner(m) {
  if (!m || !m.a || !m.b || !isN(m.sa) || !isN(m.sb)) return null;
  if (m.sa > m.sb) return m.a;
  if (m.sb > m.sa) return m.b;
  if (isN(m.pa) && isN(m.pb) && m.pa !== m.pb) return m.pa > m.pb ? m.a : m.b;
  return null;
}
export function loser(m) { const w = winner(m); return w ? (w === m.a ? m.b : m.a) : null; }

// الأدوار اللاحقة تُشتق تلقائيًا من الفائزين؛ يدخل المشرف فرق دور الـ16 فقط
export function resolveKo(ko) {
  const get = (st, i) => ({ a: null, b: null, sa: null, sb: null, pa: null, pb: null, ...((ko && ko[st] && ko[st][i]) || {}) });
  const out = {};
  out.r16 = [...Array(KO.r16)].map((_, i) => get('r16', i));
  const next = (st, prev) => [...Array(KO[st])].map((_, i) => ({ ...get(st, i), a: winner(prev[2 * i]), b: winner(prev[2 * i + 1]) }));
  out.qf = next('qf', out.r16); out.sf = next('sf', out.qf); out.final = next('final', out.sf);
  out.third = [{ ...get('third', 0), a: loser(out.sf[0]), b: loser(out.sf[1]) }];
  out.champion = winner(out.final[0]);
  return out;
}

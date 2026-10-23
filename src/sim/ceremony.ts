/** 開通の儀: turn two hand-drawn curves into snapped, previewable routes. Pure; no DOM. */
import { dist, pointSegDist } from "../core/geom";
import type { Vec } from "../core/types";
import { designate, ev, routeOfficial } from "./engine";
import { buildIndex, layPath, nodeSplitAt, setEdgeState } from "./network";
import { LAKE_TAG, maxFerryKm, crossingPorts, findFerry, makeFerry, makeFerryAt, makeLakeBridgeAt, massRoute, nearTown, servedMasses } from "./ferry";
import { techAt } from "./tech";
import { DEFAULT_SUB, prefOfSeat } from "../core/seat";
import { ERA, eraLabel, modeOf, type SimState } from "./types";
import { ERAS, eraKeyOf } from "./eras";
import { cellDistKm, mountainCost, pathfind, type World } from "./world";

export type CerKind = "kokudo1" | "fudo1";
export const CER_LABEL: Record<CerKind, string> = { kokudo1: "国道1号(東京府起点)", fudo1: "府道1号(東京府内)" };
export const TOKYO = "JP-13";
export interface CerPreview { ok: boolean; reasons: string[]; cells: number[]; path: Vec[]; lengthKm: number; passes: string[]; maxGradePct: number; endName: string }

/** Points every `step` km along the line, each with its distance from the start. */
function resampleT(pts: Vec[], step: number): { p: Vec; t: number }[] {
  const out = [{ p: pts[0], t: 0 }]; let acc = 0, tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); acc += d; tot += d; if (acc >= step) { out.push({ p: pts[i], t: tot }); acc = 0; } }
  if (dist(out[out.length - 1].p, pts[pts.length - 1]) > 1) out.push({ p: pts[pts.length - 1], t: tot }); return out;
}
function resample(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1], pts[i]); if (acc >= step) { out.push(pts[i]); acc = 0; } }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > 1) out.push(pts[pts.length - 1]); return out;
}
const lineDist = (p: Vec, line: Vec[]) => { let m = Infinity; for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, pointSegDist(p, line[i], line[i + 1])); return m; };
export function tokyoCity(w: World) { return w.cities.find((c) => c.pref === TOKYO && c.kind === "capital") ?? null; }
/** The prefectural capital (県庁所在地) city of a prefecture, or null. */
export const seatCity = (w: World, prefId: string) => w.cities.find((c) => c.pref === prefId && c.kind === "capital") ?? null;
/**
 * The capital city of this game: the 県庁所在地 of the chosen prefecture (any of the 49), else Tokyo. `v` is a prefecture id, or the city id an older save kept.
 * The sub-capital is the same lookup with no fallback.
 */
export function homeCity(w: World, v?: string) { const p = prefOfSeat(v); return (p ? seatCity(w, p) : null) ?? tokyoCity(w); }
export function subCity(w: World, v?: string) { const p = prefOfSeat(v); return p ? seatCity(w, p) : null; }
export const cerLabel = (kind: CerKind, home?: { name: string } | null, sub?: { name: string } | null): string => kind === "kokudo1" ? `国道1号(${(home?.name ?? "東京").replace(/市$/, "")}→${(sub?.name ?? "大阪市").replace(/市$/, "")})` : "府道1号(旧版)";
function nearestLandCell(w: World, p: Vec, ok: (k: number) => boolean): number {
  const k0 = w.cellOf(p); if (k0 < 0) return -1; const i0 = k0 % w.nx, j0 = (k0 / w.nx) | 0; let best = -1, bd = Infinity;
  for (let r = 0; r < 8 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue;
    const k = b * w.nx + a; if (w.t.land[k] !== 1 || !ok(k)) continue; const d = dist(w.cellPos(k), p); if (d < bd) { bd = d; best = k; }
  }
  return best;
}
export function previewCeremony(w: World, kind: CerKind, drawn: Vec[], capId?: string): CerPreview {
  const bad = (r: string[]): CerPreview => ({ ok: false, reasons: r, cells: [], path: [], lengthKm: 0, passes: [], maxGradePct: 0, endName: "" });
  const tokyo = homeCity(w, capId); if (!tokyo) return bad(["首都の都市が地図にありません"]); const HOME = tokyo.pref ?? TOKYO, homeName = HOME !== TOKYO ? `${tokyo.name.replace(/市$/, "")}${HOME === "JP-26" || HOME === "JP-27" ? "府" : ""}` : "東京府";
  if (drawn.length < 2) return bad(["線が短すぎます。画面上でなぞってください"]);
  let len = 0; for (let i = 1; i < drawn.length; i++) len += dist(drawn[i - 1], drawn[i]);
  const reasons: string[] = [], minLen = kind === "kokudo1" ? 60 : 12;
  if (len < minLen) reasons.push(`線が短すぎます(${Math.round(len)}km。${minLen}km以上必要)`);
  const sk = w.cellOf(drawn[0]); if (!(dist(drawn[0], tokyo.pos) <= 45 || (sk >= 0 && w.prefOf(sk) === HOME))) reasons.push(`起点が${homeName}にありません。${homeName}内から描き始めてください`);
  const inTokyo = (k: number) => w.prefOf(k) === HOME;
  let endCell = -1, endName = "";
  if (kind === "kokudo1") {
    let bc: typeof w.cities[number] | null = null, bd = Infinity;
    for (const c of w.cities) if (c.id !== tokyo.id) { const d = dist(c.pos, drawn[drawn.length - 1]); if (d < bd) { bd = d; bc = c; } }
    if (!bc || bd > 50) reasons.push("終点が都市に届いていません(都市の近く50km以内で止めてください)");
    else if (bc.island !== tokyo.island) reasons.push(`終点の${bc.name}は別の島にあります。陸続きの都市を選んでください`);
    else { endCell = bc.cell; endName = bc.name; }
  } else {
    const ek = nearestLandCell(w, drawn[drawn.length - 1], inTokyo);
    if (ek < 0 || dist(w.cellPos(ek), drawn[drawn.length - 1]) > 12) reasons.push(`終点が${homeName}内にありません`);
    else if (cellDistKm(w, ek, tokyo.cell) < 8) reasons.push("終点が起点に近すぎます(8km以上離してください)");
    else { endCell = ek; endName = `${homeName}内の端点`; }
  }
  if (reasons.length) return bad(reasons);
  const via = resample(drawn, kind === "kokudo1" ? 35 : 12);
  const allow = kind === "fudo1" ? inTokyo : undefined, bias = (k: number) => 1 + Math.pow(lineDist(w.cellPos(k), drawn) / 25, 2);
  const stops: number[] = [tokyo.cell];
  for (const v of via.slice(1, -1)) { const k = nearestLandCell(w, v, (q) => w.t.island[q] === tokyo.island && (!allow || allow(q))); if (k >= 0 && k !== stops[stops.length - 1]) stops.push(k); }
  stops.push(endCell);
  const cells: number[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const seg = pathfind(w, stops[i], stops[i + 1], { bias, allow, margin: 18 });
    if (!seg) return bad([`経路を作れません。途中が海・湖で分断されているか、${homeName}の外に出ています`]);
    for (const k of seg) if (cells[cells.length - 1] !== k) cells.push(k);
  }
  // remove loops created by waypoint back-tracking
  const seen = new Map<number, number>(), flat: number[] = [];
  for (const k of cells) { const at = seen.get(k); if (at !== undefined) { for (const d of flat.splice(at + 1)) seen.delete(d); } else { seen.set(k, flat.length); flat.push(k); } }
  let length = 0, maxG = 0; for (let i = 1; i < flat.length; i++) { const dk = cellDistKm(w, flat[i - 1], flat[i]); length += dk; maxG = Math.max(maxG, Math.abs(w.elevM(flat[i]) - w.elevM(flat[i - 1])) / (dk * 1000) * 100); }
  const passes = flat.map((k) => w.cityByCell.get(k)?.name).filter((n): n is string => !!n);
  const warn: string[] = []; if (flat.length < 3) return bad(["経路が短すぎます"]);
  return { ok: true, reasons: warn, cells: flat, path: flat.map((k) => w.cellPos(k)), lengthKm: Math.round(length), passes, maxGradePct: Math.round(maxG * 10) / 10, endName };
}
/** Perform the ceremony: lay both roads, designate 酷道1号 and 腐道1号, start the clock. */
export function performCeremony(sim: SimState, w: World, kokudo: CerPreview, fudo: CerPreview): boolean {
  if (sim.ceremonyDone || !kokudo.ok || !fudo.ok) return false;
  const home = homeCity(w, sim.capital), HOME = home?.pref ?? TOKYO, homeBase = (home?.name ?? "東京").replace(/市$/, "");
  ev(sim, "ceremony", sim.stage3 ? `開通の儀。${eraLabel(1950, eraKeyOf(sim.era))}(1950年)。${ERAS[eraKeyOf(sim.era)].summary}` : `開通の儀。${ERA.name}6年(1950)、${ERA.note}`, "プレイヤーが二本の道(国道1号・東京府道1号)を描いた", {});
  const a = layPath(sim, w, kokudo.cells, { open: true, surface: "gravel", quality: 55, built: 1, month: 0 });
  const r1 = designate(sim, a.chain, "national", "JP", `${homeBase}〜${kokudo.endName}`, "開通の儀", false, 1);
  const b = layPath(sim, w, fudo.cells, { open: true, surface: "gravel", quality: 55, built: 1, month: 0 });
  const r2 = designate(sim, b.chain, "fu", HOME, `${homeBase}府内`, "開通の儀", false, 1);
  if (!r1 || !r2) return false;
  ev(sim, "ceremony", `${routeOfficial(r1)}・${routeOfficial(r2)}が象徴の道として開通`, "開通の儀", { route: r1.id });
  sim.ceremonyDone = true; return true;
}


// ---------------------------------------------------------------- Issue #15: the one national road, capital -> sub-capital ----------
export interface CerSeg { cells: number[]; ferry: boolean; lake?: "ferry" | "bridge"; port?: true /* Stage 9: a crossing where the player drew it (shore cells, not port cities) */ }
export interface LakeHop { a: number; b: number; waterKm: number; kind: "ferry" | "bridge"; tIn: number; tOut: number; from: string; to: string }
export interface NatPreview extends CerPreview { segments: CerSeg[]; ferries: { from: string; to: string; km: number }[]; lakes?: { from: string; to: string; km: number; kind: "ferry" | "bridge" }[]; from: string; to: string;
  /** Stage 21: the line was drawn from the sub-capital to the capital and has been turned round */ reversed?: true;
  /** Stage 21: 県庁所在地 the line passes near but not through: a short access road to each (laid at the opening unless the city is already on a road) */ spurs?: { city: string; cells: number[]; km: number }[];
  /** Stage 21: 県庁所在地 the line was routed through because they lay within a short detour of it */ through?: string[] }
/**
 * Stage 8: where the drawn line runs ACROSS a lake, the road is not routed round it (nor painted over the water): it stops at the shore, crosses by a lake
 * ferry -- or by a bridge when the open water is within what that year's technology can span -- and carries on from the far shore. A line drawn round the
 * lake is simply routed round it. Everything is read from the lake as it stands on the map (moved, turned, 0.2-5x), never from where it used to be.
 */
export const LAKE_HOP_MIN_SAMPLES = 1;
export function lakeHops(w: World, drawn: Vec[], techK = 2, year = 1950): LakeHop[] {
  const step = w.cell * 0.4, pts: { p: Vec; t: number }[] = [{ p: drawn[0], t: 0 }]; let tt = 0;
  for (let i = 1; i < drawn.length; i++) { const a = drawn[i - 1], b = drawn[i], d = dist(a, b), n = Math.max(1, Math.ceil(d / step)); for (let s = 1; s <= n; s++) pts.push({ p: [a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n], t: tt + (d * s) / n }); tt += d; }
  const onLake = (p: Vec) => { const k = w.cellOf(p); return k >= 0 && w.t.land[k] === 2; }, out: LakeHop[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (!onLake(pts[i].p)) continue; let j = i; while (j + 1 < pts.length && onLake(pts[j + 1].p)) j++;
    const pin = pts[Math.max(0, i - 1)], pout = pts[Math.min(pts.length - 1, j + 1)];
    const a = nearestLandCell(w, pin.p, () => true), b = nearestLandCell(w, pout.p, () => true);
    if (j - i + 1 >= LAKE_HOP_MIN_SAMPLES && a >= 0 && b >= 0 && a !== b && w.lm[a] === w.lm[b] && w.lm[a] > 0 && dist(w.cellPos(a), w.cellPos(b)) >= w.cell * 1.5) {
      const waterKm = Math.max(0.5, Math.round((dist(w.cellPos(a), w.cellPos(b)) - w.cell) * 10) / 10), kind = waterKm <= techAt(techK, year).bridgeKm ? "bridge" : "ferry";
      out.push({ a, b, waterKm, kind, tIn: pin.t, tOut: pout.t, from: nearTown(w, a), to: nearTown(w, b) });
    }
    i = j;
  }
  return out;
}
/** Stage 9: the closest pair of coastal cells between two land masses, near where the drawing leaves one (pa) and reaches the other (pb). */
function nearestPair(w: World, la: number, lb: number, pa: Vec, pb: Vec): { a: number; b: number; km: number } | null {
  const coast = (lm: number) => { const out: number[] = []; for (let k = 0; k < w.N; k++) { if (w.lm[k] !== lm) continue; const i = k % w.nx, j = (k / w.nx) | 0; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => { const x = i + di, y = j + dj; return x < 0 || y < 0 || x >= w.nx || y >= w.ny || w.t.land[y * w.nx + x] === 0; })) out.push(k); } return out; };
  const A = coast(la), B = coast(lb); if (!A.length || !B.length) return null;
  // score: the crossing itself, plus how far its ends are from where the line was drawn (so the crossing sits where the player crossed)
  const mid: Vec = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], pick = (C: number[]) => C.map((k) => ({ k, d: dist(w.cellPos(k), mid) })).sort((p, q) => p.d - q.d).slice(0, 60);
  let best: { a: number; b: number; km: number } | null = null, bs = Infinity;
  for (const x of pick(A)) for (const y of pick(B)) { const km = dist(w.cellPos(x.k), w.cellPos(y.k)), sc = km + 0.5 * (x.d + y.d); if (sc < bs) { bs = sc; best = { a: x.k, b: y.k, km: Math.round(km * 10) / 10 }; } }
  return best;
}
/**
 * 国道1号: from the capital's 県庁所在地 to the sub-capital's. The player draws strokes (several are fine); the program snaps them to land, joins them, and where the way
 * leaves a land mass it adds the ferry by itself (never a road over water), chaining masses when it must (Okinawa -> Kyushu -> Honshu -> Hokkaido ...).
 */
/** Stage 21. How far an end of the drawn line may be from its 県庁所在地 and still count as drawn from / to it: a fingertip (about 24 px) at the zoom it was drawn at, kept between 30 km (six cells: the grid cannot place a point closer than that
 *  anyway) and 90 km (further, and the line is not at that city at all). The connection itself is always a road over land (or the ferry the program adds) -- never a straight line over water. */
export const snapKmFor = (zoomPxPerKm: number) => Math.max(30, Math.min(90, 24 / Math.max(0.02, zoomPxPerKm)));
/** A 県庁所在地 within this far of the drawn line is routed THROUGH if the detour it costs is at most VIA_DETOUR_KM, else given an access road if within SPUR_KM. */
export const VIA_NEAR_KM = 20, VIA_DETOUR_KM = 15, SPUR_KM = 20, SPUR_MAX_KM = 30;
export function previewNational(w: World, drawn: Vec[], capital?: string, sub?: string, opts: { techK?: number; year?: number; snapKm?: number; /** Stage 21: route through / give access roads to 県庁所在地 near the line (the game turns it on; the older quantitative studies run without it) */ roadside?: boolean; /** Stage 22 (国道0号): cells of existing roads (open, old or abandoned): the line runs along them where it can */ roadCells?: { has(k: number): boolean } } = {}): NatPreview {
  const bad = (r: string[]): NatPreview => ({ ok: false, reasons: r, cells: [], path: [], lengthKm: 0, passes: [], maxGradePct: 0, endName: "", segments: [], ferries: [], from: "", to: "" });
  const home = homeCity(w, capital), dest = subCity(w, sub) ?? seatCity(w, DEFAULT_SUB); if (!home || !dest) return bad(["首都または副首都の県庁所在地が地図にありません"]);
  if (home.pref === dest.pref) return bad(["首都と副首都は別の府県にしてください"]);
  if (drawn.length < 2) return bad(["線が短すぎます。画面上でなぞってください"]);
  let len = 0; for (let i = 1; i < drawn.length; i++) len += dist(drawn[i - 1], drawn[i]);
  const straight = dist(home.pos, dest.pos), minLen = Math.min(60, Math.max(8, 0.5 * straight)), reasons: string[] = [];
  if (len < minLen) reasons.push(`線が短すぎます(${Math.round(len)}km。${Math.round(minLen)}km以上必要)`);
  const R = opts.snapKm ?? 45, near = (p: Vec, c: typeof home, r: number) => { const k = nearestLandCell(w, p, () => true); return dist(p, c.pos) <= r || (k >= 0 && dist(w.cellPos(k), p) <= 20 && w.prefOf(k) === c.pref); };
  // Stage 21: drawn from the sub-capital to the capital is the same road: turn the line round
  let reversed = false;
  if (!(near(drawn[0], home, R) && near(drawn[drawn.length - 1], dest, R + 5)) && near(drawn[0], dest, R + 5) && near(drawn[drawn.length - 1], home, R)) { drawn = [...drawn].reverse(); reversed = true; }
  if (!near(drawn[0], home, R)) reasons.push(`起点が首都(${home.name})の府県にありません。${home.name}の近くから描き始めてください(副首都側から描いても構いません)`);
  if (!near(drawn[drawn.length - 1], dest, R + 5)) reasons.push(`終点が副首都(${dest.name})に届いていません。${dest.name}の近く${Math.round(R + 5)}km以内で止めてください`);
  if (reasons.length) return bad(reasons);
  // waypoints: the drawn line, resampled and snapped to the nearest land (the only correction made to it)
  const hops = lakeHops(w, drawn, opts.techK ?? 2, opts.year ?? 1950), inHop = (t: number) => hops.some((hp) => t > hp.tIn - w.cell && t < hp.tOut + w.cell);
  const bias = (k: number) => 1 + Math.pow(lineDist(w.cellPos(k), drawn) / 25, 2), served = new Set(servedMasses(w));
  const vias = resampleT(drawn, 35).slice(1, -1).filter((v) => !inHop(v.t)).map((v) => ({ ...v, k: nearestLandCell(w, v.p, () => true) })).filter((v) => v.k >= 0 && dist(w.cellPos(v.k), v.p) <= 40)
    .filter((v) => served.has(w.lm[v.k]) || (w.cellOf(v.p) >= 0 && w.t.land[w.cellOf(v.p)] === 1));
  // Stage 21: a 県庁所在地 close to the line is routed through when that costs a short detour (the line need not run through its centre)
  const prox = (p: Vec) => { let best = { d: Infinity, t: 0 }, acc = 0; for (let i = 0; i + 1 < drawn.length; i++) { const a = drawn[i], b = drawn[i + 1], sg = dist(a, b), u = sg ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (sg * sg))) : 0, d = dist(p, [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); if (d < best.d) best = { d, t: acc + u * sg }; acc += sg; } return best; };
  const throughCities: string[] = [];
  for (const c of (opts.roadside ? w.cities : []).filter((x) => x.kind === "capital" && x !== home && x !== dest).map((x) => ({ x, ...prox(x.pos) })).filter((q) => q.d <= VIA_NEAR_KM).sort((a, b) => a.t - b.t)) {
    if (vias.some((v) => v.k === c.x.cell)) continue;
    let at = 0; while (at < vias.length && vias[at].t < c.t) at++;
    const pv = at > 0 ? vias[at - 1] : null, nv = at < vias.length ? vias[at] : null, pp = pv ? pv.p : home.pos, np = nv ? nv.p : dest.pos;
    const lmP = pv ? w.lm[pv.k] : w.lm[home.cell], lmN = nv ? w.lm[nv.k] : w.lm[dest.cell], lc = w.lm[c.x.cell];
    if (lc !== lmP && lc !== lmN) continue;   // not on a land mass the line visits at this point (an island is never joined by a road)
    if (dist(pp, c.x.pos) + dist(c.x.pos, np) - dist(pp, np) > VIA_DETOUR_KM) continue;
    vias.splice(at, 0, { p: c.x.pos, t: c.t, k: c.x.cell }); throughCities.push(c.x.name);
  }
  // Stage 9: the land masses are visited in the order they were DRAWN (a 国道1号 drawn through Shikoku goes through Shikoku); only a gap the drawing leaves
  // (no ferry possible between two drawn masses) is filled with the shortest chain of crossings
  const visits: { lm: number; t0: number; vias: { t: number; k: number }[] }[] = [{ lm: w.lm[home.cell], t0: 0, vias: [] }];
  for (const v of vias) { const last = visits[visits.length - 1]; if (w.lm[v.k] === last.lm) last.vias.push({ t: v.t, k: v.k }); else visits.push({ lm: w.lm[v.k], t0: v.t, vias: [{ t: v.t, k: v.k }] }); }
  if (visits[visits.length - 1].lm !== w.lm[dest.cell]) visits.push({ lm: w.lm[dest.cell], t0: len, vias: [] });
  const legs: { lm: number; vias: { t: number; k: number }[]; t0: number; t1: number; out: { a: number; b: number; drawn: boolean; km: number } | null }[] = [];
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i], nx = visits[i + 1], t1 = nx ? nx.t0 : len + 1;
    if (!nx) { legs.push({ lm: v.lm, vias: v.vias, t0: v.t0, t1, out: null }); break; }
    const near = nearestPair(w, v.lm, nx.lm, v.vias.length ? w.cellPos(v.vias[v.vias.length - 1].k) : w.cellPos(home.cell), nx.vias.length ? w.cellPos(nx.vias[0].k) : w.cellPos(dest.cell));
    if (near && near.km <= maxFerryKm(w)) { legs.push({ lm: v.lm, vias: v.vias, t0: v.t0, t1, out: { a: near.a, b: near.b, drawn: true, km: near.km } }); continue; }
    const chain = massRoute(w, v.lm, nx.lm); if (!chain) return bad(["航路でも結べない陸地をまたいでいます"]);
    for (let m = 0; m < chain.length - 1; m++) { const cx = crossingPorts(w, chain[m], chain[m + 1])!, ea = cx.la === chain[m] ? cx.a : cx.b, eb = cx.la === chain[m] ? cx.b : cx.a; legs.push({ lm: chain[m], vias: m === 0 ? v.vias : [], t0: m === 0 ? v.t0 : t1, t1, out: { a: ea.cell, b: eb.cell, drawn: false, km: cx.km } }); }
  }
  const segments: CerSeg[] = [], ferries: NatPreview["ferries"] = [], lakes: NonNullable<NatPreview["lakes"]> = []; let entry = home.cell;
  const dedupe = (cells: number[]) => { const seen = new Map<number, number>(), flat: number[] = []; for (const k of cells) { const at = seen.get(k); if (at !== undefined) { for (const d of flat.splice(at + 1)) seen.delete(d); } else { seen.set(k, flat.length); flat.push(k); } } return flat; };
  for (const leg of legs) {
    const lm = leg.lm, exitCell = leg.out ? leg.out.a : dest.cell;
    // the stops on this visit, in the order they were drawn: waypoints, and lake crossings (shore -> far shore)
    const items: ({ t: number; k: number } | { t: number; hop: LakeHop })[] = [...leg.vias.map((v) => ({ t: v.t, k: v.k })), ...hops.filter((hp) => w.lm[hp.a] === lm && hp.tIn >= leg.t0 - w.cell && hp.tIn < leg.t1).map((hp) => ({ t: hp.tIn, hop: hp }))].sort((p, q) => p.t - q.t);
    let cur = entry, cells: number[] = [entry];
    const go = (to: number): boolean => { if (to === cur) return true; const seg = pathfind(w, cur, to, { bias, margin: 18, ...(opts.roadCells ? { roadCells: opts.roadCells } : {}) }); if (!seg) return false; for (const k of seg) if (cells[cells.length - 1] !== k) cells.push(k); cur = to; return true; };
    for (const it of items) {
      if ("hop" in it) {
        if (!go(it.hop.a)) return bad(["経路を作れません。湖岸まで陸路でつながりません"]);
        const flat = dedupe(cells); if (flat.length >= 2) segments.push({ cells: flat, ferry: false });
        segments.push({ cells: [it.hop.a, it.hop.b], ferry: it.hop.kind === "ferry", lake: it.hop.kind }); lakes.push({ from: it.hop.from, to: it.hop.to, km: it.hop.waterKm, kind: it.hop.kind });
        cur = it.hop.b; cells = [cur];
      } else if (!go(it.k)) return bad(["経路を作れません。途中が海・湖で分断されています(陸地どうしは自動でフェリーを使いますが、陸の途中は描き直してください)"]);
    }
    if (!go(exitCell)) return bad(["経路を作れません。途中が海・湖で分断されています(陸地どうしは自動でフェリーを使いますが、陸の途中は描き直してください)"]);
    const flat = dedupe(cells); if (flat.length >= 2) segments.push({ cells: flat, ferry: false });
    if (leg.out) { segments.push({ cells: [leg.out.a, leg.out.b], ferry: true, ...(leg.out.drawn ? { port: true as const } : {}) }); ferries.push({ from: nearTown(w, leg.out.a), to: nearTown(w, leg.out.b), km: leg.out.km }); entry = leg.out.b; }
  }
  let length = 0, maxG = 0; const all: number[] = [];
  for (const s of segments) { if (s.ferry || s.lake) { length += dist(w.cellPos(s.cells[0]), w.cellPos(s.cells[1])); continue; } for (let i = 1; i < s.cells.length; i++) { const dk = cellDistKm(w, s.cells[i - 1], s.cells[i]); length += dk; maxG = Math.max(maxG, Math.abs(w.elevM(s.cells[i]) - w.elevM(s.cells[i - 1])) / (dk * 1000) * 100); } all.push(...s.cells); }
  if (all.length < 2) return bad(["経路が短すぎます"]);
  const passes = all.map((k) => w.cityByCell.get(k)?.name).filter((n): n is string => !!n);
  // Stage 21: a 県庁所在地 the road passes near but not through gets a short access road, if one can be made over land without a detour or a mountain wall. One road per city; none to a city on the way.
  const onWay = new Set(all), spurs: NonNullable<NatPreview["spurs"]> = [];
  for (const c of opts.roadside ? w.cities : []) {
    if (c.kind !== "capital" || onWay.has(c.cell)) continue;
    let bk = -1, bd = Infinity; for (const k of all) { if (w.lm[k] !== w.lm[c.cell]) continue; const d = dist(w.cellPos(k), c.pos); if (d < bd) { bd = d; bk = k; } }
    if (bk < 0 || bd > SPUR_KM) continue;
    const sp = pathfind(w, bk, c.cell, { margin: 8 }); if (!sp || sp.length < 2) continue;
    let km = 0; for (let i = 1; i < sp.length; i++) km += cellDistKm(w, sp[i - 1], sp[i]);
    if (km > SPUR_MAX_KM || km > 1.7 * bd + 8 || mountainCost(w, sp) > 1.8 || sp.some((k) => w.t.land[k] !== 1)) continue;
    spurs.push({ city: c.id, cells: sp, km: Math.round(km * 10) / 10 });
  }
  return { ok: true, reasons: [], cells: all, path: all.map((k) => w.cellPos(k)), lengthKm: Math.round(length), passes, maxGradePct: Math.round(maxG * 10) / 10, endName: dest.name, segments, ferries, ...(lakes.length ? { lakes } : {}), from: home.name, to: dest.name, ...(reversed ? { reversed: true as const } : {}), ...(spurs.length ? { spurs } : {}), ...(throughCities.length ? { through: throughCities } : {}) };
}
/** Lay 国道1号 from the previewed segments: ordinary road for each land piece, the ferry edge (existing or new) across each strait, all designated as one route. */
export function performNational(sim: SimState, w: World, prev: NatPreview, o: { road0?: boolean } = {}): boolean {
  if (o.road0) return performRoad0(sim, w, prev) !== null;
  if (sim.ceremonyDone || !prev.ok) return false;
  ev(sim, "ceremony", sim.stage3 ? `開通の儀。${eraLabel(1950, eraKeyOf(sim.era))}(1950年)。${ERAS[eraKeyOf(sim.era)].summary}` : `開通の儀。${ERA.name}6年(1950)、${ERA.note}`, `プレイヤーが国道1号(${prev.from}→${prev.to})を描いた`, {});
  const chain: { edgeId: string; dir: 1 | -1 }[] = [];
  // Stage 9: while it is being laid, the chain is registered as a placeholder route so that any edge split later (the line may pass a place twice) is rewritten in it too
  const TMP = "r.__national"; sim.routes[TMP] = { id: TMP, edges: chain, active: false, oldEdges: [] } as unknown as SimState["routes"][string];
  // Stage 9: the ends of every crossing are made real nodes first, so no edge laid into the chain below is split afterwards
  { const idx = buildIndex(sim, "road"); for (const s of prev.segments) if (s.ferry || s.lake) for (const k of s.cells) nodeSplitAt(sim, w, idx, k); }
  for (const s of prev.segments) {
    if (s.lake) {   // Stage 8: a lake crossing of 国道1号 -- a lake ferry, or a bridge where 1950's technology could span the water
      const [a, b] = s.cells, A = { cell: a, pos: w.cellPos(a) }, B = { cell: b, pos: w.cellPos(b) }, na = nearTown(w, a), nb = nearTown(w, b);
      const e = s.lake === "bridge" ? makeLakeBridgeAt(sim, w, A, B, `bridge:${na}〜${nb}湖上大橋`, "国道1号が湖を渡るため、開通の儀で橋を架けた")
        : makeFerryAt(sim, w, A, B, "road", "国道1号が湖を渡るため、開通の儀で湖上航路を設けた", `ferry:${LAKE_TAG}${na}〜${nb}湖上フェリー(国道1号)`);
      const nid = Object.values(sim.nodes).find((n) => n.cell === a)?.id; chain.push({ edgeId: e.id, dir: e.a === nid ? 1 : -1 }); continue;
    }
    if (s.ferry && s.port) {   // Stage 9: the crossing the player drew, between the shores where they drew it
      const [a, b] = s.cells, na = nearTown(w, a), nb = nearTown(w, b), e = makeFerryAt(sim, w, { cell: a, pos: w.cellPos(a) }, { cell: b, pos: w.cellPos(b) }, "road", "国道1号を描かれた経路のとおり結ぶため、開通の儀で航路を設けた", `ferry:${na}〜${nb === na ? `${nb}対岸` : nb}フェリー(国道1号)`);
      const nid = Object.values(sim.nodes).find((n) => n.cell === a)?.id; chain.push({ edgeId: e.id, dir: e.a === nid ? 1 : -1 }); continue;
    }
    if (s.ferry) {
      const ca = w.cityByCell.get(s.cells[0]), cb = w.cityByCell.get(s.cells[1]); if (!ca || !cb) { delete sim.routes[TMP]; return false; }
      const e = findFerry(sim, w, ca, cb, "road") ?? makeFerry(sim, w, ca, cb, "road", "国道1号を結ぶため、開通の儀で航路を設けた");
      const na = Object.values(sim.nodes).find((n) => n.cell === ca.cell)?.id; chain.push({ edgeId: e.id, dir: e.a === na ? 1 : -1 });
    } else { const l = layPath(sim, w, s.cells, { facilities: w.land12, open: true, surface: "gravel", quality: 55, built: 1, month: 0 }); chain.push(...l.chain); }
  }
  delete sim.routes[TMP];
  // Stage 21: the access roads (ordinary roads, not part of 国道1号); a city already standing on an open road needs none
  for (const sp of prev.spurs ?? []) {
    const c = w.cityById.get(sp.city); if (!c) continue;
    if (Object.values(sim.edges).some((e) => e.state === "open" && modeOf(e) === "road" && !e.facility && e.cells.includes(c.cell))) continue;
    layPath(sim, w, sp.cells, { facilities: w.land12, open: true, surface: "gravel", quality: 50, built: 1, month: 0 });
    ev(sim, "ceremony", `${c.name}へ取付路(約${sp.km}km)を設けた`, "国道1号が県庁所在地の近くを通るため", {});
  }
  const r = designate(sim, chain, "national", "JP", `${prev.from.replace(/市$/, "")}〜${prev.to.replace(/市$/, "")}`, "開通の儀", false, 1); if (!r) return false;
  const lk = prev.lakes ?? [];
  ev(sim, "ceremony", `${routeOfficial(r)}が象徴の道として開通${prev.ferries.length ? `(海をまたぐ区間はフェリー${prev.ferries.length}本)` : ""}${lk.length ? `(湖は${lk.map((l) => (l.kind === "bridge" ? `${l.from}〜${l.to}の橋` : `${l.from}〜${l.to}の湖上フェリー`)).join("・")}で渡る)` : ""}`, "開通の儀", { route: r.id });
  sim.ceremonyDone = true; return true;
}

/**
 * Stage 22: 国道0号 -- the 2200 line between the new capital and sub-capital. Laid like 国道1号, but the line was routed along existing roads (open, old or abandoned) where it could, and those
 * edges are SHARED, not doubled: they keep their own history and carry both numbers; an abandoned or closed one is first restored. Only the gaps get new road. The ferries the line needs are reused or opened.
 * Returns what it did (reused / restored / new km, the cost of the works), or null if it could not be laid.
 */
export function performRoad0(sim: SimState, w: World, prev: NatPreview): { routeId: string; reusedKm: number; restoredKm: number; newKm: number; costBu: number; spurs: number } | null {
  if (!prev.ok) return null;
  const before = new Set(Object.keys(sim.edges)), chain: { edgeId: string; dir: 1 | -1 }[] = [];
  const TMP = "r.__national0"; sim.routes[TMP] = { id: TMP, edges: chain, active: false, oldEdges: [] } as unknown as SimState["routes"][string];
  { const idx = buildIndex(sim, "road"); for (const s of prev.segments) if (s.ferry || s.lake) for (const k of s.cells) nodeSplitAt(sim, w, idx, k); }
  for (const s of prev.segments) {
    if (s.ferry || s.lake) {
      const [a, b] = s.cells, ca = w.cityByCell.get(a), cb = w.cityByCell.get(b);
      const e = ca && cb ? findFerry(sim, w, ca, cb, "road") ?? makeFerry(sim, w, ca, cb, "road", "国道0号を結ぶため航路を設けた") : makeFerryAt(sim, w, { cell: a, pos: w.cellPos(a) }, { cell: b, pos: w.cellPos(b) }, "road", "国道0号を結ぶため航路を設けた", `ferry:${nearTown(w, a)}〜${nearTown(w, b)}フェリー(国道0号)`);
      const nid = Object.values(sim.nodes).find((n) => n.cell === a)?.id; chain.push({ edgeId: e.id, dir: e.a === nid ? 1 : -1 }); continue;
    }
    const l = layPath(sim, w, s.cells, { facilities: w.land12, open: true, surface: "gravel", quality: 50, built: 1, month: sim.month }); chain.push(...l.chain);
  }
  delete sim.routes[TMP];
  let reusedKm = 0, restoredKm = 0, newKm = 0;
  for (const ref of chain) {
    const e = sim.edges[ref.edgeId]; if (!e || e.facility === "ferry") continue;
    if (!before.has(e.id)) { newKm += e.lengthKm; continue; }
    if (e.state !== "open" || e.built < 1) { e.built = 1; e.open = true; e.quality = Math.max(e.quality, 50); setEdgeState(sim, e, "open", "国道0号に転用するため復旧(廃道・旧道の復活)"); restoredKm += e.lengthKm; }
    else reusedKm += e.lengthKm;
  }
  let spurs = 0;
  for (const sp of prev.spurs ?? []) { const c = w.cityById.get(sp.city); if (!c || Object.values(sim.edges).some((e) => e.state === "open" && modeOf(e) === "road" && !e.facility && e.cells.includes(c.cell))) continue; layPath(sim, w, sp.cells, { facilities: w.land12, open: true, surface: "gravel", quality: 50, built: 1, month: sim.month }); spurs++; }
  const costBu = Math.round((newKm * ROAD0_NEW_BU + restoredKm * ROAD0_RESTORE_BU) * 100) / 100;
  const r = designate(sim, chain, "national", "JP", `${prev.from.replace(/市$/, "")}〜${prev.to.replace(/市$/, "")}`, "遷都後の開通の儀(国道0号)", false, 0); if (!r) return null;
  ev(sim, "ceremony", `${routeOfficial(r)}が開通(既存道路の転用${Math.round(reusedKm)}km・廃道/旧道の復旧${Math.round(restoredKm)}km・新設${Math.round(newKm)}km)`, `新首都(${prev.from})と新副首都(${prev.to})を結ぶ。工事費相当${costBu}(開通の儀として一括で供用)`, { route: r.id });
  return { routeId: r.id, reusedKm: Math.round(reusedKm), restoredKm: Math.round(restoredKm), newKm: Math.round(newKm), costBu, spurs };
}
/** 国道0号: works cost per km of new road and per km of restored old road (the same scale as the planner's projects: a convert of an old line costs 0.35 per km) */
export const ROAD0_NEW_BU = 1, ROAD0_RESTORE_BU = 0.35;

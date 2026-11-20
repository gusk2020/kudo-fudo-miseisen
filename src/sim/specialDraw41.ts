/**
 * Stage 41 #8 (drawing): what the player can do to a special route from the screen, beyond the plain capital -> sub-capital line.
 *   EXTEND an existing special route: a line drawn from the route (its nearest end, or any place on it) to anywhere on the same land -- or back onto the route, which closes a loop. The symbol stays; the whole must remain one stroke (special41.ts).
 *   A LOOP for a new route: a line drawn from the capital through the sub-capital and back to where it began is built as the capital -> sub-capital line plus the way back, joined into one loop.
 * Detours need nothing new: the line follows what was drawn. Everything is tried on a COPY of the game first (the same deterministic steps), so a line that would break the one-stroke rule is refused before the real game is touched.
 * Honest limit: an extension stays on one land mass (no new sea crossing is made by an extension).
 */
import type { Vec } from "../core/types";
import { lineDist, nearestLandCell, performRoad0, resampleT, type NatPreview } from "./ceremony";
import { buildIndex, layPath, setEdgeState } from "./network";
import { canBuildNext, canExtend, extendSpecial, routeCells, routeStroke, seatsPass, specialFullName, specialRoutes } from "./special41";
import type { SimEdge, SimState } from "./types";
import { cellDistKm, pathfind, type World } from "./world";

export interface ExtPreview { ok: boolean; reasons: string[]; cells: number[]; path: Vec[]; lengthKm: number; passes: string[]; maxGradePct: number; endName: string; ext: true; sym: string; closes: boolean; note?: string }
const bad = (sym: string, r: string): ExtPreview => ({ ok: false, reasons: [r], cells: [], path: [], lengthKm: 0, passes: [], maxGradePct: 0, endName: "", ext: true, sym, closes: false });
const km = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** The cells where the route ends (odd number of sections meet); none for a loop. */
function endCells(sim: SimState, sym: string): number[] {
  const r = specialRoutes(sim)[sym]; if (!r) return []; const deg = new Map<string, number>();
  for (const ref of r.edges) { const e = sim.edges[ref.edgeId]; if (!e) continue; for (const n of [e.a, e.b]) deg.set(n, (deg.get(n) ?? 0) + 1); }
  return [...deg].filter(([, d]) => d % 2).map(([n]) => sim.nodes[n]?.cell).filter((k): k is number => k !== undefined);
}
/** Only the path: where the drawn line would run. The one-stroke rule is checked by `checkExtension` (on a copy). */
export function previewExtension(sim: SimState, w: World, sym: string, drawn: Vec[], opts: { snapKm?: number } = {}): ExtPreview {
  const r = specialRoutes(sim)[sym]; if (!r) return bad(sym, "その特殊路線はまだありません"); if (!r.active) return bad(sym, "廃止された路線は延長できません");
  if (drawn.length < 2) return bad(sym, "線が短すぎます。画面上でなぞってください");
  let len = 0; for (let i = 1; i < drawn.length; i++) len += km(drawn[i - 1], drawn[i]); if (len < 8) return bad(sym, `線が短すぎます(${Math.round(len)}km。8km以上必要)`);
  const R = opts.snapKm ?? 45, rc = [...new Set(routeCells(sim, r))].filter((k) => w.t.land[k] === 1), ends = endCells(sim, sym);
  const nearestOf = (p: Vec, cs: number[]) => { let bk = -1, bd = Infinity; for (const k of cs) { const d = km(w.cellPos(k), p); if (d < bd) { bd = d; bk = k; } } return { k: bk, d: bd }; };
  // the start: an end of the route when one is near, else the nearest place on it
  const e0 = nearestOf(drawn[0], ends), a0 = nearestOf(drawn[0], rc), start = e0.k >= 0 && e0.d <= R ? e0 : a0;
  if (start.k < 0 || start.d > R) return bad(sym, `${specialFullName(sym)}の近くから描き始めてください(路線から${Math.round(R)}km以内)`);
  // the end: back on the route (a loop) when the line comes back to it, else where the finger stopped
  const last = drawn[drawn.length - 1], eE = nearestOf(last, ends.filter((k) => k !== start.k)), aE = nearestOf(last, rc);
  const back = eE.k >= 0 && eE.d <= R ? eE : aE.d <= Math.min(R, 15) && km(w.cellPos(aE.k), w.cellPos(start.k)) > 20 ? aE : null;
  const endK = back ? back.k : nearestLandCell(w, last, (k) => w.lm[k] === w.lm[start.k]);
  if (endK < 0 || (!back && km(w.cellPos(endK), last) > 40)) return bad(sym, "終点が同じ陸地にありません(延長は海を渡れません。同じ島の中で描いてください)");
  if (endK === start.k) return bad(sym, "始点と終点が同じ場所です");
  const bias = (k: number) => 1 + Math.pow(lineDist(w.cellPos(k), drawn) / 25, 2), roadCells = buildIndex(sim, "road").roadCells;
  const vias = resampleT(drawn, 35).slice(1, -1).map((v) => nearestLandCell(w, v.p, (k) => w.lm[k] === w.lm[start.k])).filter((k) => k >= 0);
  let cur = start.k; const cells: number[] = [cur];
  for (const to of [...vias, endK]) { if (to === cur) continue; const seg = pathfind(w, cur, to, { bias, margin: 18, roadCells }); if (!seg) return bad(sym, "経路を作れません(山・海・湖で分断されています。描き直してください)"); for (const k of seg) if (cells[cells.length - 1] !== k) cells.push(k); cur = to; }
  // a line that comes back over itself is cut at the crossing (as 国道1号 is)
  const seen = new Map<number, number>(), flat: number[] = []; for (const k of cells) { const at = seen.get(k); if (at !== undefined) { for (const d of flat.splice(at + 1)) seen.delete(d); } else { seen.set(k, flat.length); flat.push(k); } }
  if (flat.length < 2) return bad(sym, "経路が短すぎます");
  let L = 0; for (let i = 1; i < flat.length; i++) L += cellDistKm(w, flat[i - 1], flat[i]);
  return { ok: true, reasons: [], cells: flat, path: flat.map((k) => w.cellPos(k)), lengthKm: Math.round(L), passes: flat.map((k) => w.cityByCell.get(k)?.name).filter((n): n is string => !!n), maxGradePct: 0, endName: w.cityByCell.get(endK)?.name ?? "", ext: true, sym, closes: !!back };
}
export interface ExtResult { ok: boolean; reason: string; newKm: number; reusedKm: number; sections: number; loop: boolean }
function apply(sim: SimState, w: World, prev: ExtPreview): ExtResult {
  const no = (reason: string): ExtResult => ({ ok: false, reason, newKm: 0, reusedKm: 0, sections: 0, loop: false });
  const r = specialRoutes(sim)[prev.sym]; if (!r || !prev.ok) return no("延長できません");
  const before = new Set(Object.keys(sim.edges)), l = layPath(sim, w, prev.cells, { facilities: w.land12, open: true, surface: "gravel", quality: 50, built: 1, month: sim.month });
  const have = new Set(r.edges.map((x) => x.edgeId)), add = [...new Set(l.chain.map((x) => x.edgeId))].filter((id) => !have.has(id));   // (where the drawn line runs along the route itself, nothing is added twice)
  if (!add.length) return no("延長する区間がありません(すでに路線の上です)");
  const c = canExtend(sim, prev.sym, add); if (!c.ok) return no(c.reason);
  let newKm = 0, reusedKm = 0; for (const id of add) { const e: SimEdge = sim.edges[id]; if (!before.has(id)) { newKm += e.lengthKm; continue; } if (e.state !== "open" || e.built < 1) { e.built = 1; e.open = true; e.quality = Math.max(e.quality, 50); setEdgeState(sim, e, "open", `${specialFullName(prev.sym)}の延長に転用するため復旧`); } reusedKm += e.lengthKm; }
  const x = extendSpecial(sim, prev.sym, add); if (!x.ok) return no(x.reason);
  return { ok: true, reason: "", newKm: Math.round(newKm), reusedKm: Math.round(reusedKm), sections: add.length, loop: routeStroke(sim, r).odd === 0 };
}
const copyOf = (sim: SimState): SimState => JSON.parse(JSON.stringify(sim)) as SimState;
/** Would this extension be accepted? Tried on a copy; the game is not touched. */
export function checkExtension(sim: SimState, w: World, prev: ExtPreview): ExtResult { return apply(copyOf(sim), w, prev); }
/** Extend the route for real -- only after the same steps succeeded on a copy. */
export function performExtension(sim: SimState, w: World, prev: ExtPreview): ExtResult { const t = checkExtension(sim, w, prev); return t.ok ? apply(sim, w, prev) : t; }

/** A new route drawn as a LOOP: the line ends near where it began and passes near the sub-capital on the way. Returns where to cut it (the outward part goes to previewNational as it is, the way back becomes an extension), or null when the line is not a loop. */
export function splitLoop(drawn: Vec[], home: Vec, sub: Vec, snapKm = 45): { out: Vec[]; back: Vec[] } | null {
  if (drawn.length < 4 || km(drawn[0], home) > snapKm || km(drawn[drawn.length - 1], home) > snapKm) return null;
  let bi = -1, bd = Infinity; drawn.forEach((p, i) => { const d = km(p, sub); if (d < bd) { bd = d; bi = i; } });
  if (bd > snapKm + 5 || bi < 1 || bi > drawn.length - 2) return null;
  return { out: drawn.slice(0, bi + 1), back: drawn.slice(bi) };
}
export interface LoopResult { ok: boolean; reason: string; info: ReturnType<typeof performRoad0>; back: ExtResult | null }
function applyLoop(sim: SimState, w: World, nat: NatPreview, back: Vec[], snapKm?: number): LoopResult {
  const gate = canBuildNext(sim), sym = gate.sym; const info = performRoad0(sim, w, nat); if (!info || !sym) return { ok: false, reason: gate.reason || "開通できませんでした", info: null, back: null };
  const key = sim.routes[info.routeId].special ?? String(sim.routes[info.routeId].number), p = previewExtension(sim, w, key, back, { snapKm }); if (!p.ok) return { ok: false, reason: `戻りの区間を作れません: ${p.reasons[0]}`, info, back: null };
  const b = apply(sim, w, p); return { ok: b.ok && b.loop, reason: b.ok ? (b.loop ? "" : "環状になりませんでした") : `戻りの区間を作れません: ${b.reason}`, info, back: b };
}
/** Build a new special route as a loop (tried on a copy first; if the way back cannot be made, nothing is built and the reason is returned). */
export function checkLoop(sim: SimState, w: World, nat: NatPreview, back: Vec[], snapKm?: number): LoopResult { return applyLoop(copyOf(sim), w, nat, back, snapKm); }
export function performLoop(sim: SimState, w: World, nat: NatPreview, back: Vec[], snapKm?: number): LoopResult { const t = checkLoop(sim, w, nat, back, snapKm); return t.ok ? applyLoop(sim, w, nat, back, snapKm) : t; }
/** For the screen: does the whole route (after what was drawn) pass the capital / palace and the sub-capital? Informative for an extension (the rule is enforced for a new route by where its line must begin and end). */
export const routeSeats = (sim: SimState, w: World, sym: string) => { const r = specialRoutes(sim)[sym]; return r ? seatsPass(sim, w, routeCells(sim, r)) : null; };

/**
 * Stage 43 (D): a new special route need not begin at the capital nor end at the sub-capital. One continuous line that PASSES the capital (or the palace) and a sub-capital (either of two) is
 * enough: the part between them is built as the ordinary capital -> sub-capital line, and the parts before and after are joined on as extensions of the same route, in drawing order -- so the
 * whole stays ONE stroke (the extension rule refuses a branch), and a line that comes back to where it began closes into a loop. "Passing" means the line comes within `passKm` of the seat
 * (FREE_PASS_MIN_KM..FREE_PASS_MAX_KM, from the zoom's snapping distance): close enough for a finger, not merely somewhere in the same region.
 */
export const FREE_PASS_MIN_KM = 12, FREE_PASS_MAX_KM = 20, FREE_PART_MIN_KM = 8;   // (20 = SEAT_NEAR_KM: the line must come as close to a seat as the finished route is required to)
export const freePassKm = (snapKm: number) => Math.max(FREE_PASS_MIN_KM, Math.min(FREE_PASS_MAX_KM, snapKm));
export interface FreeSplit { mid: Vec[]; exts: Vec[][]; sub: number; reason: string }
const lineKm = (pts: Vec[]) => { let s = 0; for (let i = 1; i < pts.length; i++) s += km(pts[i - 1], pts[i]); return s; };
/** Where the drawn line passes the capital and the nearest-passed sub-capital; null fields + a reason when it does not pass both. `subs` = the sub-capitals' positions (one or two). */
export function splitFree(drawn: Vec[], home: Vec, subs: Vec[], passKm: number): FreeSplit {
  const near = (p: Vec) => { let bi = -1, bd = Infinity; drawn.forEach((q, i) => { const d = km(p, q); if (d < bd) { bd = d; bi = i; } }); return { i: bi, d: bd }; };
  const no = (reason: string): FreeSplit => ({ mid: [], exts: [], sub: -1, reason });
  if (drawn.length < 2) return no("線が短すぎます");
  const c = near(home), s = subs.map((p, k) => ({ ...near(p), k })).filter((x) => x.d <= passKm).sort((a, b) => a.d - b.d)[0];
  if (c.d > passKm && !s) return no(`首都と副首都の近く(${Math.round(passKm)}km以内)を通っていません`);
  if (c.d > passKm) return no(`首都の近く(${Math.round(passKm)}km以内)を通っていません`);
  if (!s) return no(`副首都${subs.length > 1 ? "(どちらか)" : ""}の近く(${Math.round(passKm)}km以内)を通っていません`);
  if (c.i === s.i) return no("首都と副首都の間の区間がありません");
  const fwd = c.i < s.i, mid = fwd ? drawn.slice(c.i, s.i + 1) : drawn.slice(s.i, c.i + 1).reverse();
  // the parts before and after, each drawn OUTWARD from the seat it starts at (an extension begins on the route)
  const head = drawn.slice(0, Math.min(c.i, s.i) + 1).reverse(), tail = drawn.slice(Math.max(c.i, s.i));
  const exts = [head, tail].filter((p) => p.length >= 2 && lineKm(p) >= FREE_PART_MIN_KM);
  return { mid, exts, sub: s.k, reason: "" };
}
export interface FreeResult { ok: boolean; reason: string; info: ReturnType<typeof performRoad0>; exts: ExtResult[]; loop: boolean }
function applyFree(sim: SimState, w: World, nat: NatPreview, exts: Vec[][], snapKm?: number): FreeResult {
  const gate = canBuildNext(sim), sym = gate.sym; const info = performRoad0(sim, w, nat); if (!info || !sym) return { ok: false, reason: gate.reason || "開通できませんでした", info: null, exts: [], loop: false };
  const key = sim.routes[info.routeId].special ?? String(sim.routes[info.routeId].number), done: ExtResult[] = [];
  for (const part of exts) {
    const p = previewExtension(sim, w, key, part, { snapKm }); if (!p.ok) return { ok: false, reason: `首都・副首都の外側の区間を作れません: ${p.reasons[0]}`, info, exts: done, loop: false };
    const b = apply(sim, w, p); if (!b.ok) return { ok: false, reason: `首都・副首都の外側の区間を作れません: ${b.reason}`, info, exts: done, loop: false }; done.push(b);
  }
  const r = specialRoutes(sim)[key], seats = r ? seatsPass(sim, w, routeCells(sim, r)) : null; if (!seats?.ok) return { ok: false, reason: seats?.reason || "首都と副首都を通っていません", info, exts: done, loop: false };
  return { ok: true, reason: "", info, exts: done, loop: !!r && routeStroke(sim, r).odd === 0 };
}
/** Tried on a copy first; the game is untouched unless the whole line (middle and both outer parts) can be built as one stroke. */
export function checkFree(sim: SimState, w: World, nat: NatPreview, exts: Vec[][], snapKm?: number): FreeResult { return applyFree(copyOf(sim), w, nat, exts, snapKm); }
export function performFree(sim: SimState, w: World, nat: NatPreview, exts: Vec[][], snapKm?: number): FreeResult { const t = checkFree(sim, w, nat, exts, snapKm); return t.ok ? applyFree(sim, w, nat, exts, snapKm) : t; }

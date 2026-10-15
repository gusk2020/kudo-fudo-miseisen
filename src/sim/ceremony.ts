/** 開通の儀: turn two hand-drawn curves into snapped, previewable routes. Pure; no DOM. */
import { dist, pointSegDist } from "../core/geom";
import type { Vec } from "../core/types";
import { designate, ev, routeOfficial } from "./engine";
import { layPath } from "./network";
import { crossingPorts, findFerry, makeFerry, massRoute } from "./ferry";
import { prefOfSeat } from "../core/seat";
import { ERA, eraLabel, type SimState } from "./types";
import { ERAS, eraKeyOf } from "./eras";
import { cellDistKm, pathfind, type World } from "./world";

export type CerKind = "kokudo1" | "fudo1";
export const CER_LABEL: Record<CerKind, string> = { kokudo1: "国道1号(東京府起点)", fudo1: "府道1号(東京府内)" };
export const TOKYO = "JP-13";
export interface CerPreview { ok: boolean; reasons: string[]; cells: number[]; path: Vec[]; lengthKm: number; passes: string[]; maxGradePct: number; endName: string }

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
export interface CerSeg { cells: number[]; ferry: boolean }
export interface NatPreview extends CerPreview { segments: CerSeg[]; ferries: { from: string; to: string; km: number }[]; from: string; to: string }
/**
 * 国道1号: from the capital's 県庁所在地 to the sub-capital's. The player draws strokes (several are fine); the program snaps them to land, joins them, and where the way
 * leaves a land mass it adds the ferry by itself (never a road over water), chaining masses when it must (Okinawa -> Kyushu -> Honshu -> Hokkaido ...).
 */
export function previewNational(w: World, drawn: Vec[], capital?: string, sub?: string): NatPreview {
  const bad = (r: string[]): NatPreview => ({ ok: false, reasons: r, cells: [], path: [], lengthKm: 0, passes: [], maxGradePct: 0, endName: "", segments: [], ferries: [], from: "", to: "" });
  const home = homeCity(w, capital), dest = subCity(w, sub) ?? seatCity(w, "JP-27"); if (!home || !dest) return bad(["首都または副首都の県庁所在地が地図にありません"]);
  if (home.pref === dest.pref) return bad(["首都と副首都は別の府県にしてください"]);
  if (drawn.length < 2) return bad(["線が短すぎます。画面上でなぞってください"]);
  let len = 0; for (let i = 1; i < drawn.length; i++) len += dist(drawn[i - 1], drawn[i]);
  const straight = dist(home.pos, dest.pos), minLen = Math.min(60, Math.max(8, 0.5 * straight)), reasons: string[] = [];
  if (len < minLen) reasons.push(`線が短すぎます(${Math.round(len)}km。${Math.round(minLen)}km以上必要)`);
  const near = (p: Vec, c: typeof home, r: number) => { const k = nearestLandCell(w, p, () => true); return dist(p, c.pos) <= r || (k >= 0 && dist(w.cellPos(k), p) <= 20 && w.prefOf(k) === c.pref); };
  if (!near(drawn[0], home, 45)) reasons.push(`起点が首都(${home.name})の府県にありません。${home.name}の近くから描き始めてください`);
  if (!near(drawn[drawn.length - 1], dest, 50)) reasons.push(`終点が副首都(${dest.name})に届いていません。${dest.name}の近く50km以内で止めてください`);
  if (reasons.length) return bad(reasons);
  const route = massRoute(w, w.lm[home.cell], w.lm[dest.cell]); if (!route) return bad([`${home.name}から${dest.name}へ、航路でも結べません`]);
  // waypoints: the drawn line, resampled, each tied to the land mass it lies on (those on masses the way does not use are ignored)
  const bias = (k: number) => 1 + Math.pow(lineDist(w.cellPos(k), drawn) / 25, 2), vias = resample(drawn, 35).slice(1, -1).map((p) => ({ p, k: nearestLandCell(w, p, () => true) })).filter((v) => v.k >= 0 && dist(w.cellPos(v.k), v.p) <= 40);
  const segments: CerSeg[] = [], ferries: NatPreview["ferries"] = []; let entry = home.cell;
  for (let m = 0; m < route.length; m++) {
    const lm = route[m], cx = m < route.length - 1 ? crossingPorts(w, lm, route[m + 1]) : null; if (m < route.length - 1 && !cx) return bad(["航路の港が見つかりません"]);
    const exitCity = cx ? (cx.la === lm ? cx.a : cx.b) : dest, nextCity = cx ? (cx.la === lm ? cx.b : cx.a) : null;
    const stops: number[] = [entry]; for (const v of vias) if (w.lm[v.k] === lm && v.k !== stops[stops.length - 1]) stops.push(v.k); if (exitCity.cell !== stops[stops.length - 1]) stops.push(exitCity.cell);
    const cells: number[] = [];
    for (let i = 0; i + 1 < stops.length; i++) { const seg = pathfind(w, stops[i], stops[i + 1], { bias, margin: 18 }); if (!seg) return bad(["経路を作れません。途中が海・湖で分断されています(陸地どうしは自動でフェリーを使いますが、陸の途中は描き直してください)"]); for (const k of seg) if (cells[cells.length - 1] !== k) cells.push(k); }
    const seen = new Map<number, number>(), flat: number[] = []; for (const k of cells) { const at = seen.get(k); if (at !== undefined) { for (const d of flat.splice(at + 1)) seen.delete(d); } else { seen.set(k, flat.length); flat.push(k); } }
    if (flat.length >= 2) segments.push({ cells: flat, ferry: false });
    if (cx && nextCity) { segments.push({ cells: [exitCity.cell, nextCity.cell], ferry: true }); ferries.push({ from: exitCity.name, to: nextCity.name, km: cx.km }); entry = nextCity.cell; }
  }
  let length = 0, maxG = 0; const all: number[] = [];
  for (const s of segments) { if (s.ferry) { length += dist(w.cellPos(s.cells[0]), w.cellPos(s.cells[1])); continue; } for (let i = 1; i < s.cells.length; i++) { const dk = cellDistKm(w, s.cells[i - 1], s.cells[i]); length += dk; maxG = Math.max(maxG, Math.abs(w.elevM(s.cells[i]) - w.elevM(s.cells[i - 1])) / (dk * 1000) * 100); } all.push(...s.cells); }
  if (all.length < 2) return bad(["経路が短すぎます"]);
  const passes = all.map((k) => w.cityByCell.get(k)?.name).filter((n): n is string => !!n);
  return { ok: true, reasons: [], cells: all, path: all.map((k) => w.cellPos(k)), lengthKm: Math.round(length), passes, maxGradePct: Math.round(maxG * 10) / 10, endName: dest.name, segments, ferries, from: home.name, to: dest.name };
}
/** Lay 国道1号 from the previewed segments: ordinary road for each land piece, the ferry edge (existing or new) across each strait, all designated as one route. */
export function performNational(sim: SimState, w: World, prev: NatPreview): boolean {
  if (sim.ceremonyDone || !prev.ok) return false;
  ev(sim, "ceremony", sim.stage3 ? `開通の儀。${eraLabel(1950, eraKeyOf(sim.era))}(1950年)。${ERAS[eraKeyOf(sim.era)].summary}` : `開通の儀。${ERA.name}6年(1950)、${ERA.note}`, `プレイヤーが国道1号(${prev.from}→${prev.to})を描いた`, {});
  const chain: { edgeId: string; dir: 1 | -1 }[] = [];
  for (const s of prev.segments) {
    if (s.ferry) {
      const ca = w.cityByCell.get(s.cells[0]), cb = w.cityByCell.get(s.cells[1]); if (!ca || !cb) return false;
      const e = findFerry(sim, w, ca, cb, "road") ?? makeFerry(sim, w, ca, cb, "road", "国道1号を結ぶため、開通の儀で航路を設けた");
      const na = Object.values(sim.nodes).find((n) => n.cell === ca.cell)?.id; chain.push({ edgeId: e.id, dir: e.a === na ? 1 : -1 });
    } else { const l = layPath(sim, w, s.cells, { open: true, surface: "gravel", quality: 55, built: 1, month: 0 }); chain.push(...l.chain); }
  }
  const r = designate(sim, chain, "national", "JP", `${prev.from.replace(/市$/, "")}〜${prev.to.replace(/市$/, "")}`, "開通の儀", false, 1); if (!r) return false;
  ev(sim, "ceremony", `${routeOfficial(r)}が象徴の道として開通${prev.ferries.length ? `(海をまたぐ区間はフェリー${prev.ferries.length}本)` : ""}`, "開通の儀", { route: r.id });
  sim.ceremonyDone = true; return true;
}

/** 開通の儀: turn two hand-drawn curves into snapped, previewable routes. Pure; no DOM. */
import { dist, pointSegDist } from "../core/geom";
import type { Vec } from "../core/types";
import { designate, ev, routeOfficial } from "./engine";
import { layPath } from "./network";
import { ERA, eraLabel, type SimState } from "./types";
import { ERAS, eraKeyOf } from "./eras";
import { cellDistKm, pathfind, type World } from "./world";

export type CerKind = "kokudo1" | "fudo1";
export const CER_LABEL: Record<CerKind, string> = { kokudo1: "国道1号(東京府起点)", fudo1: "府道1号(東京府内)" };
export const TOKYO = "JP-13";
/** Issue #13: the capital can be Tokyo (default), Kyoto or Osaka -- the three cities whose prefecture is a 府, so the 府道1号 keeps its name. */
export const CAPITAL_PREFS = ["JP-13", "JP-26", "JP-27"] as const;
export interface CerPreview { ok: boolean; reasons: string[]; cells: number[]; path: Vec[]; lengthKm: number; passes: string[]; maxGradePct: number; endName: string }

function resample(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1], pts[i]); if (acc >= step) { out.push(pts[i]); acc = 0; } }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > 1) out.push(pts[pts.length - 1]); return out;
}
const lineDist = (p: Vec, line: Vec[]) => { let m = Infinity; for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, pointSegDist(p, line[i], line[i + 1])); return m; };
export function tokyoCity(w: World) { return w.cities.find((c) => c.pref === TOKYO && c.kind === "capital") ?? null; }
/** The capital city of this game: the chosen one if it is a valid capital, else Tokyo. */
export function homeCity(w: World, capId?: string) { const c = capId ? w.cityById.get(capId) : undefined; return c && c.pref && (CAPITAL_PREFS as readonly string[]).includes(c.pref) && c.kind === "capital" ? c : tokyoCity(w); }
export const capitalChoices = (w: World) => CAPITAL_PREFS.map((p) => w.cities.find((c) => c.pref === p && c.kind === "capital")).filter((c): c is NonNullable<typeof c> => !!c);
export const cerLabel = (kind: CerKind, home?: { name: string; pref: string | null } | null): string => { const n = home ? `${home.name.replace(/市$/, "")}府`.replace("東京府", "東京府") : "東京府"; return kind === "kokudo1" ? `国道1号(${n}起点)` : `府道1号(${n}内)`; };
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
  const tokyo = homeCity(w, capId); if (!tokyo) return bad(["首都の都市が地図にありません"]); const HOME = tokyo.pref ?? TOKYO, homeName = capId && HOME !== TOKYO ? `${tokyo.name.replace(/市$/, "")}府` : "東京府";
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

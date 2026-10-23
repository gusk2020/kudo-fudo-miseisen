/**
 * Stage 17 (steps C and D): a game starts with the 49 prefectural capitals as its cities; every other place of the world (the map's other cities and the real provincial towns of Stage 16) is a
 * CANDIDATE: it starts small and the people of its own prefecture's capital city are the ones who settle it as the conditions allow. Nothing is created: a candidate's people move from the
 * capital to the place (or back), so the prefecture's total never changes with the number of places registered.
 *
 * A candidate's weight against the capital is its map-data size times a suitability: flat land, access, the time to the capital, industry, nearness to a seat of government. Its target share of
 * the prefecture's city people is weight / sum of weights; it moves toward that by CITY_RATE of the gap a year. When it is big enough it is shown (name and circle); when it shrinks it keeps
 * its people and loses its name below the hysteresis line. Nothing disappears.
 */
import { ev } from "./engine";
import { homeCity, subCity } from "./ceremony";
import { basePop } from "./roles";
import type { Analysis } from "./demand";
import type { SimState } from "./types";
import type { World } from "./world";

export const LATENT_START = 0.1;     // a candidate starts with this share of its census size; the rest stays in the capital until the conditions bring it out
export const CITY_RATE = 0.1;       // share of the gap to its target a place closes in a year
export const SHOW_ON = 70000, SHOW_OFF = 50000, SHOW_GROWTH = 1.6;   // shown from SHOW_ON (and SHOW_GROWTH x what it started with); named no longer below SHOW_OFF
export const SEAT_REACH_KM = 80;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const isCapitalCity = (c: { kind: string }) => c.kind === "capital";
/** Stage 20: a capital that can only ever be small (a seat put on a tiny island) cannot hold its prefecture's city people: the former 県庁所在地 does, until the new one grows. */
export const HOLDER_MIN_CAP = 1_000_000;
export const smallSeat = (c: { kind: string; capPop?: number }) => c.kind === "capital" && c.capPop !== undefined && c.capPop < HOLDER_MIN_CAP;
/** The city that holds a prefecture's city people (index in w.cities): its capital, or -- when that is a small-island seat -- the former capital. */
const holdMemo = new WeakMap<World, Map<string, number>>();
export function prefHolders(w: World): Map<string, number> {
  let m = holdMemo.get(w); if (m) return m; m = new Map();
  w.cities.forEach((c, i) => { if (c.pref && isCapitalCity(c)) m!.set(c.pref, i); });
  w.cities.forEach((c, i) => { if (c.pref && c.former && m!.has(c.pref) && smallSeat(w.cities[m!.get(c.pref)!])) m!.set(c.pref, i); });
  holdMemo.set(w, m); return m;
}

/** At the start: each prefecture keeps its total, but its candidates hold only LATENT_START of their size; the capital city holds the rest. */
export function startCandidates(sim: SimState, w: World): void {
  const cap = new Map<string, string>(); for (const [p, i] of prefHolders(w)) cap.set(p, w.cities[i].id);
  const moved = new Map<string, number>();
  for (const c of w.cities) { if (isCapitalCity(c) || c.former || !c.pref || !cap.has(c.pref) || cap.get(c.pref) === c.id) continue; const st = sim.cities[c.id], take = Math.round(st.pop * (1 - LATENT_START)); st.pop -= take; moved.set(c.pref, (moved.get(c.pref) ?? 0) + take); }
  for (const [pref, n] of moved) sim.cities[cap.get(pref)!].pop += n;
  const shown = sim.pot17!.shown; for (const c of w.cities) if (isCapitalCity(c) || c.former) shown[c.id] = sim.startYear;
}
/** What the conditions are worth to a candidate: about 1 on average, 0.15 to 2.5. */
export function suitability(sim: SimState, w: World, an: Analysis, i: number, parent: number, seats: { pos: number[] }[]): number {
  const c = w.cities[i], nc = w.cities.length, st = sim.cities[c.id];
  const t = Math.min(an.T[i * nc + parent], an.TT[i * nc + parent]), hours = isFinite(t) ? t : 3;
  let near = 0; for (const s of seats) near = Math.max(near, Math.exp(-Math.hypot(s.pos[0] - c.pos[0], s.pos[1] - c.pos[1]) / SEAT_REACH_KM));
  const plain = 0.5 + c.plains, access = 0.6 + 0.8 * clamp(an.acc[i], 0, 1), commute = clamp(1.5 - 0.6 * hours, 0.4, 1.5), industry = 0.8 + 0.5 * st.industry, seat = 1 + 0.5 * near;
  return clamp(plain * access * commute * industry * seat, 0.15, 2.5);
}
/** Yearly: move people between each prefecture's capital city and its candidates, then update who is shown. Zero-sum within the prefecture. */
export function settleCities(sim: SimState, w: World, an: Analysis, y: number): void {
  const pot = sim.pot17; if (!pot) return; const idx = new Map(w.cities.map((c, i) => [c.id, i])), cap = new Map<string, number>(), by = new Map<string, number[]>();
  const hold = prefHolders(w); w.cities.forEach((c, i) => { if (!c.pref) return; if (hold.get(c.pref) === i) cap.set(c.pref, i); else (by.get(c.pref) ?? by.set(c.pref, []).get(c.pref)!).push(i); });
  const hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital), seats = [sim.capitalPos ? { pos: sim.capitalPos as number[] } : hc, sim.subPos ? { pos: sim.subPos as number[] } : sc].filter(Boolean) as { pos: number[] }[];   // (Stage 19: from the point a seat was put at)
  for (const [pref, list] of by) {
    const p = cap.get(pref); if (p === undefined) continue; const capSt = sim.cities[w.cities[p].id];
    const ws = list.map((i) => Math.max(basePop(sim, w, w.cities[i]), 0.5 * (w.cities[i].capPop ?? 0)) * suitability(sim, w, an, i, p, seats)), wc = basePop(sim, w, w.cities[p]), tot = ws.reduce((a, b) => a + b, wc);
    const U = list.reduce((a, i) => a + sim.cities[w.cities[i].id].pop, capSt.pop); let pay = 0;
    list.forEach((i, k) => { const st = sim.cities[w.cities[i].id], target = (ws[k] / tot) * U; let d = Math.round(CITY_RATE * (target - st.pop)); if (st.pop + d < 2000) d = 2000 - st.pop; pay += d; st.pop += d; });
    capSt.pop -= pay; if (capSt.pop < 2000) { const f = (2000 - capSt.pop) / Math.max(1, pay); capSt.pop = 2000; void f; }
  }
  // who is shown: a place appears when it is big enough and has grown, and loses its name when it shrinks well below that; the people stay either way
  for (const c of w.cities) {
    if (isCapitalCity(c) || (c.former && pot.shown[c.id] === undefined) || y <= sim.startYear) continue; const st = sim.cities[c.id], was = pot.shown[c.id] !== undefined && pot.shown[c.id] > 0;
    const born = startOf(sim, w, c);
    if (!was && st.pop >= SHOW_ON && st.pop >= SHOW_GROWTH * born) { pot.shown[c.id] = y; ev(sim, "city", `${c.name}が都市として現れた(人口${Math.round(st.pop / 1000)}千人)`, `${c.pref ? "同じ府県の県庁所在地から人が移り、" : ""}平地・交通・産業の条件がそろった`, { city: c.id }); }
    else if (was && st.pop < SHOW_OFF) { pot.shown[c.id] = -y; ev(sim, "city", `${c.name}の人口が減り、都市の表示を外れた(人口${Math.round(st.pop / 1000)}千人)`, "条件が悪化し、人は周辺や県庁所在地へ移った(住民は残っている)", { city: c.id }); }
  }
  void idx;
}
const startMemo = new WeakMap<SimState, Map<string, number>>();
function startOf(sim: SimState, w: World, c: { id: string }): number {
  let m = startMemo.get(sim); if (!m) { m = new Map(); startMemo.set(sim, m); } let v = m.get(c.id);
  if (v === undefined) { const wc = w.cityById.get(c.id)!; v = Math.round(basePop(sim, w, wc) * LATENT_START); m.set(c.id, v); } return v;
}
/** Is the city on the map (name and circle) now? Capitals always; the others while they are shown. */
export const isShown = (sim: SimState, id: string): boolean => { const s = sim.pot17?.shown[id]; return !sim.pot17 || (s !== undefined && s > 0); };

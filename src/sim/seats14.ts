/**
 * Stage 14 (Issue #35): the seats of government stand at the head of the city order, and the people who live round them are real towns, not one giant city.
 *
 * AN ARTIFICIAL RULE, stated as one: the capital and the sub-capital the player chose are the two biggest CITIES (single-city population) of the country, always. It is a rule of this game, not a
 * result of the model; the model's own economy still decides the rest. What it never does is delete or invent people: every person moved is moved to somewhere, and the national total is
 * unchanged to the person (the test counts).
 *
 *   1. SUBURBS. A seat's city cannot hold more than SEAT_SHARE_MAX of what it and the cities within a commute (SUBURB_H hours, rail and road by the network as it is) hold together; each year it
 *      sends SEAT_FLOW of the excess to those cities, in proportion to how well they are reached (exp(-hours / SUBURB_TAU)), how much of their land can be built on (siteCapacity, plains),
 *      their industry and their size. So the suburbs grow where the railways and roads, the flat ground and the factories are -- on the plain, across the prefecture line, and not on a range.
 *   2. THE ORDER. A city that is not a seat and is bigger than SEAT_MARGIN x the smaller seat sheds the excess (at most SHED_MAX of its people a year) to the places within reach of it that are
 *      below the line (its own satellites first), or, with none, spread over the country by size. Industry, trade and tourism are NOT limited: a port or a resort town can be the nation's biggest in those
 *      -- only the head count of a single city is held below the seats'.
 * City population (one city) and metropolitan population (metro.ts: the city and its commuter towns, counted once) are two different numbers; this file orders the first.
 */
import { homeCity, subCity } from "./ceremony";
import { basePop } from "./roles";
import { siteCapacity } from "./land";
import type { SimState } from "./types";
import type { World } from "./world";

export const SEAT_SHARE_MAX = 0.6, SEAT_FLOW = 0.08, SUBURB_H = 1.3, SUBURB_TAU = 0.6, MIN_SUBURB_POP = 20000;
/** A suburb stops taking people once it is this big against the seat (so one town does not swallow the flow: the people spread over the towns of the plain). */
export const SUBURB_MAX_RATIO = 0.3, SUBURB_GROWTH = 14, SUBURB_H_FAR = 3.5;
export const SEAT_MARGIN = 0.98, SHED_MAX = 0.08, SHED_H = 1.6;
/** Stage 15 (phone check: the satellites formed but were small and few): in a Stage 15 game the seat holds less of its own commuter belt, sends more of the excess each year, lets a suburb grow bigger against it,
 * and the towns of the prefectures NEXT to the seat's own are reached however far the road is (a prefecture line is a line on the map, not a wall) and take a larger share. */
export const SEAT_SHARE_MAX_15 = 0.5, SEAT_FLOW_15 = 0.12, SUBURB_MAX_RATIO_15 = 0.42, ADJ_BONUS = 1.8, ADJ_H_CAP = 1.5;   // (a town of the next prefecture counts as at most this far away for how much it takes)
const adjMemo = new WeakMap<World, Map<string, Set<string>>>();
/** Which prefectures touch which (an edge of cells), once per world. */
export function prefAdjacency(w: World): Map<string, Set<string>> {
  let m = adjMemo.get(w); if (m) return m; m = new Map();
  const link = (a: string | null, b: string | null) => { if (!a || !b || a === b) return; (m!.get(a) ?? m!.set(a, new Set()).get(a)!).add(b); (m!.get(b) ?? m!.set(b, new Set()).get(b)!).add(a); };
  for (let k = 0; k < w.N; k++) { if (w.t.land[k] !== 1) continue; const p = w.prefOf(k); if (!p) continue; const i = k % w.nx; if (i + 1 < w.nx && w.t.land[k + 1] === 1) link(p, w.prefOf(k + 1)); if (k + w.nx < w.N && w.t.land[k + w.nx] === 1) link(p, w.prefOf(k + w.nx)); }
  adjMemo.set(w, m); return m;
}

/** Moves people between cities, to the person: the deltas are rounded and the rounding left over is put on the biggest receiver, so the sum stays exactly zero. */
function apply(sim: SimState, w: World, delta: Map<number, number>) {
  let sum = 0, big = -1, bd = -Infinity; const r = new Map<number, number>();
  for (const [i, d] of delta) { const v = Math.round(d); r.set(i, v); sum += v; if (d > bd) { bd = d; big = i; } }
  if (sum !== 0 && big >= 0) r.set(big, (r.get(big) ?? 0) - sum);
  for (const [i, v] of r) { const st = sim.cities[w.cities[i].id]; st.pop = Math.max(2000, st.pop + v); }
}
export function applySeatOrder(sim: SimState, w: World, an: { T: Float64Array; TT: Float64Array }, y: number): void {
  const nc = w.cities.length, idx = new Map(w.cities.map((c, i) => [c.id, i])), P = w.cities.map((c) => sim.cities[c.id]?.pop ?? 0);
  const hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital), seats = [hc, sc].filter((c, i, a): c is NonNullable<typeof c> => !!c && a.findIndex((d) => d?.id === c.id) === i).map((c) => idx.get(c.id)!);
  if (!seats.length) return; const isSeat = new Set(seats), t = (i: number, j: number) => Math.min(an.T[i * nc + j], an.TT[i * nc + j] + 0.4);
  const ind = (j: number) => sim.cities[w.cities[j].id]?.industry ?? 0.3;
  const delta = new Map<number, number>(); const add = (i: number, d: number) => delta.set(i, (delta.get(i) ?? 0) + d);
  // 1. suburbs
  const p15 = !!sim.pop15, shareMax = p15 ? SEAT_SHARE_MAX_15 : SEAT_SHARE_MAX, flow = p15 ? SEAT_FLOW_15 : SEAT_FLOW, maxRatio = p15 ? SUBURB_MAX_RATIO_15 : SUBURB_MAX_RATIO;
  for (const s of seats) {
    const home = w.cities[s].pref, near = p15 && home ? prefAdjacency(w).get(home) : undefined;
    let rec: { j: number; wt: number }[] = [], around = 0;
    // a suburb takes people up to the smaller of: SUBURB_MAX_RATIO of the seat, and what its own land and standing in 1950 can hold (SUBURB_GROWTH times, by its site: a small island town never becomes a metropolis)
    const collect = (maxH: number) => {
      rec = []; around = 0;
      for (let j = 0; j < nc; j++) {
        if (j === s || isSeat.has(j) || P[j] < MIN_SUBURB_POP) continue; const h = t(s, j), adj = !!near && !!w.cities[j].pref && (near.has(w.cities[j].pref!) || w.cities[j].pref === home); if (!isFinite(h) || h > (adj ? Math.max(maxH, SUBURB_H_FAR) : maxH)) continue; around += P[j];
        const c = w.cities[j], cap = SUBURB_GROWTH * basePop(sim, w, c) * siteCapacity(w, c) * (1 + c.plains), room = Math.max(0, Math.min(1 - P[j] / (maxRatio * P[s]), 1 - P[j] / Math.max(1, cap)));
        if (room > 0) rec.push({ j, wt: Math.exp(-(adj ? Math.min(h, ADJ_H_CAP) : h) / SUBURB_TAU) * (0.3 + siteCapacity(w, c)) * (0.5 + c.plains) * (0.6 + ind(j)) * Math.pow(P[j] + 5e4, 0.4) * room * (adj ? ADJ_BONUS : 1) });
      }
    };
    collect(SUBURB_H); if (rec.length < 3) collect(SUBURB_H_FAR);   // (a seat with no town within a commute -- an island's capital -- reaches further for its suburbs)
    if (!rec.length) continue; const total = P[s] + around, excess = P[s] - shareMax * total; if (excess <= 0) continue;
    const x = excess * flow, sw = rec.reduce((a, r) => a + r.wt, 0); add(s, -x); for (const r of rec) add(r.j, (x * r.wt) / sw);
  }
  if (delta.size) { apply(sim, w, delta); delta.clear(); for (let i = 0; i < nc; i++) P[i] = sim.cities[w.cities[i].id]?.pop ?? 0; }
  // 2. the order. Everybody who is not a seat stays under the smaller seat; and (Stage 15) the sub-capital stays under the capital: the nation's biggest city is the capital the player chose (phone check: a
  // capital in Kanazawa was second to Osaka, which has the better land). What the sub-capital sheds goes to the towns round it (its metropolis keeps its people; only the head count of the one city falls).
  const capIdx = hc ? idx.get(hc.id)! : -1, subIdx = sc ? idx.get(sc.id)! : -1, ordered = !!sim.pop15 && capIdx >= 0 && subIdx >= 0 && capIdx !== subIdx;
  const line = SEAT_MARGIN * Math.min(...seats.map((s) => P[s]));
  for (let i = 0; i < nc; i++) {
    const lim = ordered && i === subIdx ? SEAT_MARGIN * P[capIdx] : line;
    if ((isSeat.has(i) && !(ordered && i === subIdx)) || P[i] <= lim) continue; const shed = Math.min(P[i] - lim, SHED_MAX * P[i]); if (shed < 1) continue;
    let rec: { j: number; wt: number }[] = [];
    for (let j = 0; j < nc; j++) { if (j === i || isSeat.has(j) || P[j] >= 0.9 * lim || P[j] < MIN_SUBURB_POP) continue; const h = t(i, j); if (isFinite(h) && h <= SHED_H) rec.push({ j, wt: Math.exp(-h / 0.8) * (0.3 + siteCapacity(w, w.cities[j])) * Math.sqrt(P[j] + 5e4) }); }
    if (!rec.length) for (let j = 0; j < nc; j++) if (j !== i && !isSeat.has(j) && P[j] < 0.9 * lim) rec.push({ j, wt: Math.sqrt(P[j] + 5e4) });
    if (!rec.length) continue; const sw = rec.reduce((a, r) => a + r.wt, 0); add(i, -shed); for (const r of rec) add(r.j, (shed * r.wt) / sw);
  }
  if (delta.size) apply(sim, w, delta); void y;
}
/** The standing of the seats: how many cities are bigger than the smaller seat (0 when the rule holds). */
export function cityOrderBreaches(sim: SimState, w: World): number {
  const hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital); const seats = [hc, sc].filter(Boolean).map((c) => sim.cities[c!.id]?.pop ?? 0); if (!seats.length) return 0; const m = Math.min(...seats);
  const ids = new Set([hc?.id, sc?.id]); return w.cities.filter((c) => !ids.has(c.id) && (sim.cities[c.id]?.pop ?? 0) > m).length;
}
/** Stage 15: the capital is the biggest city of the country (a Stage 15 game): true when the capital's city has at least as many people as the sub-capital's. */
export function capitalFirst(sim: SimState, w: World): boolean {
  const hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital); if (!hc || !sc || hc.id === sc.id) return true;
  return (sim.cities[hc.id]?.pop ?? 0) >= (sim.cities[sc.id]?.pop ?? 0);
}

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
  for (const s of seats) {
    let rec: { j: number; wt: number }[] = [], around = 0;
    // a suburb takes people up to the smaller of: SUBURB_MAX_RATIO of the seat, and what its own land and standing in 1950 can hold (SUBURB_GROWTH times, by its site: a small island town never becomes a metropolis)
    const collect = (maxH: number) => {
      rec = []; around = 0;
      for (let j = 0; j < nc; j++) {
        if (j === s || isSeat.has(j) || P[j] < MIN_SUBURB_POP) continue; const h = t(s, j); if (!isFinite(h) || h > maxH) continue; around += P[j];
        const c = w.cities[j], cap = SUBURB_GROWTH * basePop(sim, w, c) * siteCapacity(w, c) * (1 + c.plains), room = Math.max(0, Math.min(1 - P[j] / (SUBURB_MAX_RATIO * P[s]), 1 - P[j] / Math.max(1, cap)));
        if (room > 0) rec.push({ j, wt: Math.exp(-h / SUBURB_TAU) * (0.3 + siteCapacity(w, c)) * (0.5 + c.plains) * (0.6 + ind(j)) * Math.pow(P[j] + 5e4, 0.4) * room });
      }
    };
    collect(SUBURB_H); if (rec.length < 3) collect(SUBURB_H_FAR);   // (a seat with no town within a commute -- an island's capital -- reaches further for its suburbs)
    if (!rec.length) continue; const total = P[s] + around, excess = P[s] - SEAT_SHARE_MAX * total; if (excess <= 0) continue;
    const x = excess * SEAT_FLOW, sw = rec.reduce((a, r) => a + r.wt, 0); add(s, -x); for (const r of rec) add(r.j, (x * r.wt) / sw);
  }
  if (delta.size) { apply(sim, w, delta); delta.clear(); for (let i = 0; i < nc; i++) P[i] = sim.cities[w.cities[i].id]?.pop ?? 0; }
  // 2. the order
  const line = SEAT_MARGIN * Math.min(...seats.map((s) => P[s]));
  for (let i = 0; i < nc; i++) {
    if (isSeat.has(i) || P[i] <= line) continue; const shed = Math.min(P[i] - line, SHED_MAX * P[i]); if (shed < 1) continue;
    let rec: { j: number; wt: number }[] = [];
    for (let j = 0; j < nc; j++) { if (j === i || P[j] >= 0.9 * line || P[j] < MIN_SUBURB_POP) continue; const h = t(i, j); if (isFinite(h) && h <= SHED_H) rec.push({ j, wt: Math.exp(-h / 0.8) * (0.3 + siteCapacity(w, w.cities[j])) * Math.sqrt(P[j] + 5e4) }); }
    if (!rec.length) for (let j = 0; j < nc; j++) if (j !== i && P[j] < 0.9 * line) rec.push({ j, wt: Math.sqrt(P[j] + 5e4) });
    if (!rec.length) continue; const sw = rec.reduce((a, r) => a + r.wt, 0); add(i, -shed); for (const r of rec) add(r.j, (shed * r.wt) / sw);
  }
  if (delta.size) apply(sim, w, delta); void y;
}
/** The standing of the seats: how many cities are bigger than the smaller seat (0 when the rule holds). */
export function cityOrderBreaches(sim: SimState, w: World): number {
  const hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital); const seats = [hc, sc].filter(Boolean).map((c) => sim.cities[c!.id]?.pop ?? 0); if (!seats.length) return 0; const m = Math.min(...seats);
  const ids = new Set([hc?.id, sc?.id]); return w.cities.filter((c) => !ids.has(c.id) && (sim.cities[c.id]?.pop ?? 0) > m).length;
}

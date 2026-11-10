/**
 * Stage 37 (B): a seat of government grows a city wherever it is put -- on an old city, on a plain that had none, on land made from the sea. From the year a seat city takes the role, people
 * move to it from the rest of the country's cities (nobody is created: the national total is what it was) until it holds its share of the national urban population or the land it stands on
 * can hold no more (its `capPop`). Its yearly pull is the world's mood: the economy (growth), the will to build (roads, railways, high-speed lines), the 150-year cycle's phase; the era's
 * character reaches it through those dials. The sub-capitals each count 0.7x when there are two; the palace's own city draws a little. A seat that moves away leaves the old city as an ordinary
 * city with its people (nothing is taken from it by this rule -- it only stops being pulled to), and the new seat starts its own programme.
 * Nothing here touches the terrain, the coastline or Lake Biwa.
 */
import { cycleOf } from "./cycle27";
import { ev, rand } from "./engine";
import { buildIndex, nodeAtCell, pad } from "./network";
import { mayStand, reclaimedCell } from "./muni39sim";
import { CITY_FROM, TOWN_FROM } from "../core/muni39";
import { homeCity, subCity } from "./ceremony";
import { SUB2_SHARE } from "./subs36";
import type { SimState } from "./types";
import type { World, WCity } from "./world";

export const SEAT_SHARE: Record<"capital" | "sub" | "palace", number> = { capital: 0.07, sub: 0.035, palace: 0.01 };
export const MAINTAIN_RATE = 0.7, MAINTAIN_SHARE = 0.6;
/** Satellite towns round a developing seat: up to SAT_MAX (capital) of them, one every SAT_EVERY years while the seat grows, 12-40 km out on the same land. */
export const SAT_MAX = 6, SAT_EVERY = 2, SAT_MIN_KM = 12, SAT_MAX_KM = 40, SAT_POP_MIN = 3500, SAT_POP_SPAN = 4500;
export const DEV_YEARS = 70, DEV_FULL_YEARS = 40, DEV_RATE = 0.09, DONOR_MAX = 0.015, DONOR_FLOOR = 2000;
/** The world's mood for building a city this year (about 1 in an ordinary year, more in a boom with a will to build, less in a slump). */
export function devFactor(sim: SimState): number {
  const dl = sim.dials, will = (dl.hwyBuild + dl.railBuild) / 2 + 0.3 * dl.hsr, cyc = cycleOf(sim), phase = cyc ? (cyc.phase === "rebuild" ? 1.25 : cyc.phase === "decline" ? 0.7 : 1) : 1;
  return Math.max(0.3, Math.min(2.5, dl.growth * (0.7 + 0.3 * Math.min(1.6, will)) * phase));
}
const taper = (age: number) => (age <= DEV_FULL_YEARS ? 1 : Math.max(0, 1 - (age - DEV_FULL_YEARS) / (DEV_YEARS - DEV_FULL_YEARS)));
export interface SeatTarget { role: "capital" | "sub" | "sub2" | "palace"; city: WCity; share: number }
export function seatTargets(sim: SimState, w: World): SeatTarget[] {
  const out: SeatTarget[] = [], add = (role: SeatTarget["role"], c: WCity | null | undefined, share: number) => { if (c && !out.some((o) => o.city.id === c.id)) out.push({ role, city: c, share }); };
  add("capital", homeCity(w, sim.capital), SEAT_SHARE.capital); const two = !!sim.subCapital2;
  add("sub", subCity(w, sim.subCapital), SEAT_SHARE.sub * (two ? SUB2_SHARE : 1)); if (two) add("sub2", subCity(w, sim.subCapital2), SEAT_SHARE.sub * SUB2_SHARE);
  if (sim.palace) { const c = w.cities.find((x) => x.pref === sim.palace!.pref && x.kind === "capital"); add("palace", c, SEAT_SHARE.palace); }
  return out;
}
/** One year. Returns the number of people moved. */
export function developSeats37(sim: SimState, w: World, y: number): number {
  if (!sim.rules1800 || !sim.stage3) return 0;
  const dev = (sim.dev37 ??= {}), seats = seatTargets(sim, w), seatIds = new Set(seats.map((s) => s.city.id)); let total = 0, moved = 0;
  for (const c of w.cities) total += sim.cities[c.id]?.pop ?? 0; if (total <= 0) return 0;
  const f = devFactor(sim);
  for (const s of seats) {
    const key = `${s.role}:${s.city.id}`; if (dev[key] === undefined) { dev[key] = y; ev(sim, "seatdev", `${s.city.name}に${s.role === "capital" ? "首都" : s.role === "palace" ? "皇居" : "副首都"}が置かれ、市街地の開発が始まる`, "施設の周辺に人と産業が集まる(全国の人口は変わらず、ほかの都市から移る)", { city: s.city.id }); }
    const age = y - dev[key], t = Math.max(MAINTAIN_RATE, taper(age));   // (after the building years the pull stays on at a low rate, toward a smaller share: a seat city does not wither once the programme is over)
    const st = sim.cities[s.city.id]; if (!st) continue; const cap = s.city.capPop ?? Infinity, high = highGroundCap(sim, w, s.city.cell, st.pop, y), target = Math.min(high, s.share * (MAINTAIN_SHARE + (1 - MAINTAIN_SHARE) * taper(age)) * total, 0.9 * cap), gap = target - st.pop; if (gap <= 0) continue;
    let want = Math.round(gap * DEV_RATE * f * t); if (want < 1) continue;
    const donors = w.cities.filter((c) => !seatIds.has(c.id) && (sim.cities[c.id]?.pop ?? 0) > DONOR_FLOOR); let room = 0; const gives = donors.map((c) => { const g = Math.max(0, Math.min(DONOR_MAX * sim.cities[c.id].pop, sim.cities[c.id].pop - DONOR_FLOOR)); room += g; return g; });
    if (room <= 0) continue; want = Math.min(want, Math.floor(room));
    // the pull is shared: most goes to the city, a part to the satellite towns round it (the commuter belt of a capital is made of towns)
    const toSat = age >= 1 && age <= DEV_FULL_YEARS && age % SAT_EVERY === 0 ? maybeSatellite(sim, w, s, st.pop / Math.max(1, target), want) : 0, toCity = want - toSat;
    let got = 0; donors.forEach((c, i) => { const take = Math.round((gives[i] / room) * want); sim.cities[c.id].pop -= take; got += take; });
    st.pop += Math.min(got, toCity); moved += got;
  }
  return moved;
}

/** The least a seat city under development keeps when its prefecture shares its people out (0 for any other city, and for any game that is not an 1800 game). */
export function seatFloor37(sim: SimState, w: World, cityId: string, y: number): number {
  if (!sim.rules1800 || !sim.dev37) return 0;
  for (const s of seatTargets(sim, w)) { if (s.city.id !== cityId) continue; const age = y - (sim.dev37[`${s.role}:${s.city.id}`] ?? y); let total = 0; for (const c of w.cities) total += sim.cities[c.id]?.pop ?? 0; return Math.min(0.8 * s.share * (MAINTAIN_SHARE + (1 - MAINTAIN_SHARE) * taper(age)) * total, 0.9 * (s.city.capPop ?? Infinity)) * 0.9; }
  return 0;
}

/** One satellite town, when the seat has fewer than its share of them: returns the people it takes (they are part of this year's pull, so the total is unchanged). */
function maybeSatellite(sim: SimState, w: World, s: SeatTarget, fill: number, budget: number): number {
  const mine = Object.values(sim.settlements).filter((v) => v.city === s.city.id && !v.gone && /近郊/.test(v.name)), cap = Math.round(SAT_MAX * (s.share / SEAT_SHARE.capital)), want = Math.min(cap, Math.ceil(cap * Math.min(1, fill * 1.2)));
  if (mine.length >= want || budget < SAT_POP_MIN) return 0;
  const used = new Set(Object.values(sim.settlements).map((v) => v.cell)); let cell = -1;
  for (let tries = 0; tries < 24 && cell < 0; tries++) {
    const ang = rand(sim) * Math.PI * 2, r = SAT_MIN_KM + rand(sim) * (SAT_MAX_KM - SAT_MIN_KM), q = w.cellOf([s.city.pos[0] + Math.cos(ang) * r, s.city.pos[1] + Math.sin(ang) * r]);
    if (q >= 0 && w.t.land[q] === 1 && w.lm[q] === w.lm[s.city.cell] && !used.has(q) && !w.cityByCell.has(q) && !reclaimedCell(sim, q) && mayStand(sim, w, q, "village", Math.floor(sim.startYear + sim.month / 12), SAT_POP_MIN)) cell = q;   // (Stage 39: no town on made land, and none on ground a 村 may not be founded on)
  }
  if (cell < 0) return 0;
  const pop = Math.min(Math.round(budget), Math.round(SAT_POP_MIN + rand(sim) * SAT_POP_SPAN)), id = `s.${pad(1 + Object.keys(sim.settlements).reduce((m, k) => Math.max(m, parseInt(k.slice(2), 10) || 0), 0), 4)}`;
  sim.settlements[id] = { id, name: `${s.city.name.replace(/市$/, "")}近郊${mine.length + 1}`, cell, city: s.city.id, pop, pop0: pop, isolatedYears: 0, gone: false };
  nodeAtCell(sim, w, buildIndex(sim), cell, "village");
  return pop;
}

/** Stage 39 (E): a seat put on high ground may not grow into a kind of municipality the ground forbids (1300 m: no 市, 1400 m: no 町), unless the 1950 relaxations apply -- its size is held below that kind's size. */
export function highGroundCap(sim: SimState, w: World, cell: number, pop: number, y: number): number {
  if (w.elevM(cell) < 1200) return Infinity;
  if (mayStand(sim, w, cell, "city", y, pop)) return Infinity;
  return mayStand(sim, w, cell, "town", y, pop) ? CITY_FROM - 1 : TOWN_FROM - 1;
}

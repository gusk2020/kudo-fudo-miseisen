/**
 * Stage 40 (Issue #60): the old municipalities of 2000-10-01 take part in the game as places that come into being and are promoted in stages.
 *
 * FOUNDING: every OLD_STEP_YEARS (from 1810, for OLD_UNTIL years) a bounded COHORT of old municipalities becomes a settlement, at the cell of the municipality's own representative point (the point the data gives: the start of the place,
 * not 1800's history). Which ones: the ones not yet used whose point is a land cell of this game's map, free, on ground a 村 may stand on (Stage 39 limit), near the road network and with people to be drawn from a city; a
 * 市 of 2000 before a 町 before a 村, then the nearer to the network. The cohort is limited (COHORT) and so is the total (MAX_ACTIVE): the rest stay in the name pool, so the settlement loops never grow with the 3,000-name list.
 * The people of a new place are taken from the city of its island that is nearest to it (nobody is created), and the city must have plenty (3 times as much).
 *
 * PROMOTION: a settlement with an old name is a 村, a 町 once it has TOWN_FROM people and a 市 once it has CITY_FROM -- the game's own designation (Stage 39's sizes), kept within Stage 39's elevation limits
 * (a place on ground a 町 may not stand on stays a 村). The suffix of the name follows, and the timeline records it. A place that shrinks keeps the designation it earned (no demotion is recorded).
 *
 * LIMITS (not a full city): a promoted 市 here is a settlement the game counts as a city-sized place; it is not one of the simulated cities (`w.cities`: the 55, Stage 39's mountain cities), which carry the economy and the development seats.
 * Only new 1800 games (`sim.oldmuni40`) do any of this: older games keep what they have.
 */
import { gameName, oldPlaces, type OldKind, type OldPlace } from "../core/gazetteer2000";
import { TOWN_FROM, CITY_FROM } from "../core/muni39";
import { ev } from "./engine";
import { mayStand, reclaimedCell } from "./muni39sim";
import { usedNames } from "./names2000";
import type { SimState, Settlement } from "./types";
import type { World } from "./world";

export const OLD_STEP_YEARS = 10, OLD_FROM = 1810, OLD_UNTIL = 2000, COHORT = 40, MAX_ACTIVE = 600, NETWORK_KM = 60;
export const POP_BY_KIND: Record<OldKind, number> = { city: 6000, town: 3000, village: 1200 };
const RANK: Record<OldKind, number> = { village: 0, town: 1, city: 2 };
const KIND_W: Record<OldKind, number> = { city: 3, town: 2, village: 1 };
export const rankOf = (pop: number): OldKind => (pop >= CITY_FROM ? "city" : pop >= TOWN_FROM ? "town" : "village");
const isStep = (sim: SimState, y: number) => y >= OLD_FROM && y <= OLD_UNTIL && (y - sim.startYear) % OLD_STEP_YEARS === 0;
const nextId = (sim: SimState) => `s.${String(1 + Object.keys(sim.settlements).reduce((m, k) => Math.max(m, parseInt(k.slice(2), 10) || 0), 0)).padStart(4, "0")}`;

/** The ones this step would found, best first (pure: nothing is changed). */
export function chooseCohort(sim: SimState, w: World, year: number, max = COHORT): { place: OldPlace; cell: number; city: string; km: number }[] {
  const taken = usedNames(sim, w), occupied = new Set<number>([...Object.values(sim.settlements).map((v) => v.cell), ...w.cities.map((c) => c.cell)]), net = Object.values(sim.nodes).map((n) => w.cellPos(n.cell)), out: { place: OldPlace; cell: number; city: string; km: number; score: number }[] = [];
  for (const p of oldPlaces()) {
    if (taken.has(p.stem) || taken.has(p.name)) continue; const cell = w.cellOf(p.pos); if (cell < 0 || w.t.land[cell] !== 1 || occupied.has(cell) || reclaimedCell(sim, cell) || !mayStand(sim, w, cell, "village", year, POP_BY_KIND[p.kind])) continue;
    const isl = w.t.island[cell]; let city: (typeof w.cities)[number] | null = null, cd = Infinity;
    for (const c of w.cities) { if (c.island !== isl) continue; const d = Math.hypot(c.pos[0] - p.pos[0], c.pos[1] - p.pos[1]); if (d < cd) { cd = d; city = c; } }
    if (!city || (sim.cities[city.id]?.pop ?? 0) < 3 * POP_BY_KIND[p.kind]) continue;
    let nd = Infinity; const cp = w.cellPos(cell); for (const q of net) { const d = Math.hypot(q[0] - cp[0], q[1] - cp[1]); if (d < nd) nd = d; } if (nd > NETWORK_KM && !(cd <= NETWORK_KM)) continue;
    out.push({ place: p, cell, city: city.id, km: Math.round(cd * 10) / 10, score: KIND_W[p.kind] * 100 - Math.min(nd, cd) });
  }
  out.sort((a, b) => b.score - a.score || (a.place.code < b.place.code ? -1 : 1)); return out.slice(0, max);
}
/** Founds this step's cohort (only in a step year, only while there is room). Returns how many were founded. */
export function foundOldMunicipalities(sim: SimState, w: World, year: number): number {
  if (!sim.oldmuni40 || !isStep(sim, year)) return 0; const active = Object.values(sim.settlements).filter((v) => v.origin && !v.gone).length; if (active >= MAX_ACTIVE) return 0;
  const names: string[] = []; let n = 0;
  for (const c of chooseCohort(sim, w, year, Math.min(COHORT, MAX_ACTIVE - active))) {
    const pop = POP_BY_KIND[c.place.kind], donor = sim.cities[c.city]; if (!donor || donor.pop < 3 * pop) continue; donor.pop -= pop;
    const id = nextId(sim), v: Settlement = { id, name: gameName(c.place, rankOf(pop)), cell: c.cell, city: c.city, pop, pop0: pop, isolatedYears: 0, gone: false, origin: { code: c.place.code, name: c.place.name, pref: c.place.pref }, rank: rankOf(pop) };
    sim.settlements[id] = v; if (names.length < 4) names.push(v.name); n++;
  }
  if (n) ev(sim, "muni40", `${year}年: 旧市町村の地点に${n}か所が成立(${names.join("・")}${n > names.length ? "ほか" : ""})`, `2000年10月1日の市町村の名と代表点を地点にした架空の成立(史実の${year}年ではない)。人口は最寄りの市から移った`, {});
  return n;
}
/** Promotes the settlements that have grown into a bigger designation. Returns how many changed. */
export function promoteSettlements(sim: SimState, w: World, year: number): number {
  if (!sim.oldmuni40) return 0; let n = 0; const towns: string[] = [];
  for (const v of Object.values(sim.settlements)) {
    if (v.gone || !v.origin || v.post) continue; const cur = v.rank ?? rankOf(v.pop0 ?? v.pop); let want = rankOf(v.pop);
    while (RANK[want] > RANK[cur] && !mayStand(sim, w, v.cell, want, year, v.pop)) want = want === "city" ? "town" : "village";   /* (a place on ground a 町/市 may not stand on stays lower: Stage 39's limits) */
    if (RANK[want] <= RANK[cur]) continue;
    const place = oldPlaces().find((p) => p.code === v.origin!.code); if (!place) continue; const before = v.name; v.rank = want; v.name = gameName(place, want); n++;
    if (want === "city") ev(sim, "muni40", `${year}年: ${before}が市になった(${v.name})`, `人口${Math.round(v.pop / 1000)}千人に達した旧${v.origin.pref}${v.origin.name}の地(ゲーム上の昇格。史実ではない)`, { settlement: v.id });
    else towns.push(v.name);
  }
  if (towns.length) ev(sim, "muni40", `${year}年: ${towns.length}か所が町になった(${towns.slice(0, 3).join("・")}${towns.length > 3 ? "ほか" : ""})`, "人口が8千人に達した旧市町村の地(ゲーム上の昇格。史実ではない)", {});
  return n;
}

/**
 * Stage 40 / Issue #67, second stage: a settlement that carries an old municipality's name and has grown to city size becomes a SIMULATED city (`w.cities`), in small steps.
 *
 * WHEN: every PROMOTE_STEP years from PROMOTE_FROM, at most PROMOTE_PER_STEP places, and never more than PROMOTE_MAX in all and PROMOTE_PER_PREF in one prefecture (the cap is provisional, set from the measurements in docs/ISSUE67.md).
 * WHICH: settlements with an origin, not a post town, whose people are at least CITY_FROM, on ground a 市 may stand on (Stage 39 limits, made land excluded), on a free land cell, with a land road that can be drawn to the nearest city of the island
 * within NETWORK_KM; largest first, ties by code. A place that fails is skipped for this step (nothing is changed) and tried again at the next one.
 * HOW (all or nothing): the settlement's people become the city's people (nobody is created or counted twice: the settlement is emptied and marked gone), the city is defined (`sim.oldCities40`, id O-<code>) and put in the world, and one paved road
 * joins it to the network. If the road cannot be laid the network, the people and the definition are put back exactly as they were. The city then takes part in everything through `w.cities` like any other; it gets no railway, port or airport: those come by the ordinary rules.
 * The 2000 name is a name and a place to start from, not a claim about 1800 (the promoted name keeps the 市 of the game's own designation).
 */
import { gameName, oldPlaces } from "../core/gazetteer2000";
import { CITY_FROM } from "../core/muni39";
import { ev } from "./engine";
import { layPath } from "./network";
import { mayStand, reclaimedCell } from "./muni39sim";
import { addOldCity, conflictOf, oldCityId, removeOldCityFromWorld, OLDCITY_MAX } from "./oldcity40";
import { pathfind, type World } from "./world";
import type { SimState } from "./types";

export const PROMOTE_FROM = 1850, PROMOTE_STEP = 10, PROMOTE_PER_STEP = 2, PROMOTE_PER_PREF = 3, NETWORK_KM = 80;
export const PROMOTE_MAX = OLDCITY_MAX;   // provisional (see docs/ISSUE67.md)
const isStep = (sim: SimState, y: number) => y >= PROMOTE_FROM && (y - sim.startYear) % PROMOTE_STEP === 0;
/** The places this step would promote, best first (nothing is changed). */
export function promotionCandidates(sim: SimState, w: World, year: number): { id: string; cell: number; near: string; km: number }[] {
  const defs = sim.oldCities40 ?? [], perPref = new Map<string, number>(); for (const d of defs) perPref.set(d.pref, (perPref.get(d.pref) ?? 0) + 1);
  const out: { id: string; pop: number; code: string; cell: number; near: string; km: number }[] = [];
  for (const v of Object.values(sim.settlements)) {
    if (v.gone || !v.origin || v.post || v.pop < CITY_FROM) continue; const code = v.origin.code, id = oldCityId(code);
    if (w.cityById.has(id) || defs.some((d) => d.id === id) || w.cityByCell.has(v.cell) || w.t.land[v.cell] !== 1 || reclaimedCell(sim, v.cell) || !mayStand(sim, w, v.cell, "city", year, v.pop)) continue;
    const pref = w.prefOf(v.cell); if (!pref || (perPref.get(pref) ?? 0) >= PROMOTE_PER_PREF) continue;
    let near: (typeof w.cities)[number] | null = null, nd = Infinity; const p = w.cellPos(v.cell);
    for (const c of w.cities) { if (c.island !== w.t.island[v.cell]) continue; const d = Math.hypot(c.pos[0] - p[0], c.pos[1] - p[1]); if (d < nd) { nd = d; near = c; } }
    if (!near || nd > NETWORK_KM) continue; out.push({ id, pop: v.pop, code, cell: v.cell, near: near.id, km: Math.round(nd * 10) / 10 });
  }
  out.sort((a, b) => b.pop - a.pop || (a.code < b.code ? -1 : 1)); return out;
}
/** Promotes this step's places (only in a step year, only while there is room). Returns how many were promoted. */
export function promoteOldCities(sim: SimState, w: World, year: number, pf: typeof pathfind = pathfind): number {   // (`pf`: a test passes a finder that fails)
  if (!sim.oldmuni40 || !isStep(sim, year) || (sim.oldCities40?.length ?? 0) >= PROMOTE_MAX) return 0; let n = 0; const names: string[] = [];
  for (const c of promotionCandidates(sim, w, year)) {
    if (n >= PROMOTE_PER_STEP || (sim.oldCities40?.length ?? 0) >= PROMOTE_MAX) break;
    const v = Object.values(sim.settlements).find((x) => x.origin?.code === c.id.slice(2) && !x.gone)!, place = oldPlaces().find((p) => p.code === v.origin!.code); if (!v || !place) continue;
    const near = w.cityById.get(c.near)!, path = pf(w, v.cell, near.cell, { margin: 12 }); if (!path || path.length < 2) continue;   // no road can be drawn: no promotion, nothing changed
    /* Order: everything that can fail comes first and is undone as one piece; the people and the city are committed last. The snapshot holds every part of the game the road laying or the definition can touch: the network (edges, nodes, routes,
       projects, links: splitting an edge rewrites the links' edge lists -- found by tests/unit/oldpromote40rollback.test.ts), the id counters (`next`), the random state, the people table, the settlements and the definitions; the world's index and caches are put back by removeOldCityFromWorld. */
    const snap = JSON.stringify({ edges: sim.edges, nodes: sim.nodes, routes: sim.routes, projects: sim.projects, links: sim.links, next: sim.next, rngState: sim.rngState, cities: sim.cities, settlements: sim.settlements, defs: sim.oldCities40 ?? null });
    const undo = () => { const s0 = JSON.parse(snap) as Record<string, any>; sim.edges = s0.edges; sim.nodes = s0.nodes; sim.routes = s0.routes; sim.projects = s0.projects; sim.links = s0.links; sim.next = s0.next; sim.rngState = s0.rngState; sim.cities = s0.cities; sim.settlements = s0.settlements; if (s0.defs) sim.oldCities40 = s0.defs; else delete sim.oldCities40; removeOldCityFromWorld(w, c.id); };
    const name = gameName(place, "city"), pop = v.pop, def = { id: c.id, code: place.code, name, pref: w.prefOf(v.cell)!, cell: v.cell, year, pop0: pop };
    if (conflictOf(w, def)) continue;                                   // nothing has been touched yet
    const lay = layPath(sim, w, path, { open: true, surface: "paved", quality: 70, built: 1, month: sim.month, standard: "standard" });
    if (!lay.chain.length) { undo(); continue; }                         // the road comes back empty: the network and counters are put back
    const err = addOldCity(sim, w, def); if (err) { undo(); continue; }   // (the definition conflicts: the road is undone too)
    sim.settlements[v.id].pop = 0; sim.settlements[v.id].gone = true;     // the people are the city's now (counted once)
    n++; if (names.length < 3) names.push(name);
    ev(sim, "muni40", `${year}年: ${v.name}が都市になった(${name})`, `人口${Math.round(pop / 1000)}千人に達した旧${place.pref}${place.name}の地が、道路で${near.name}につながる都市になった(ゲーム上の昇格。史実ではない)`, { city: c.id });
  }
  return n;
}

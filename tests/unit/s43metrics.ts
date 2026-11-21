import { modeOf, type SimState } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { ISLAND_TAG } from "../../src/sim/islandlink37";
import { corridorCount, isMountainCell } from "../../src/sim/corridor43";
import { airTier, seaTier } from "../../src/render/style24";
/** Stage 43 measures (pure; used by the probe and the tests). */
export function s43Metrics(sim: SimState, w: World) {
  const live = (e: { state: string; built: number }) => e.state === "open" && e.built >= 1;
  let roadKm = 0, railKm = 0, hwyKm = 0, fixedLinks = 0, fixedKm = 0, fixedRoad = 0, fixedRail = 0, bridges = 0, tunnels = 0;
  const massArea = new Map<number, number>(); for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) massArea.set(w.lm[k], (massArea.get(w.lm[k]) ?? 0) + 1);
  for (const e of Object.values(sim.edges)) {
    if (!live(e) || e.facility === "ferry") continue; const rail = modeOf(e) === "rail";
    if (rail) railKm += e.lengthKm; else { roadKm += e.lengthKm; if (e.standard === "highgrade") hwyKm += e.lengthKm; }
    if (e.facility === "bridge" || e.facility === "tunnel") { if (e.facility === "bridge") bridges++; else tunnels++; const a = w.lm[e.cells[0]], b = w.lm[e.cells[e.cells.length - 1]]; if (a !== b) { fixedLinks++; fixedKm += e.lengthKm; if (rail) fixedRail++; else fixedRoad++; } }
  }
  // mountain corridors: for every open road edge mostly in the mountains, how many OTHER roads cross its transects (median); 3+ others = 4 or more side by side
  let mtnEdges = 0, mtnCrowded = 0, mtnMax = 0, mtnKm = 0;
  for (const e of Object.values(sim.edges)) { if (!live(e) || modeOf(e) !== "road" || e.facility === "ferry" || e.cells.length < 6) continue; const m = e.cells.filter((k) => isMountainCell(w, k)).length; if (m < e.cells.length / 2) continue; mtnEdges++; mtnKm += e.lengthKm; const c = corridorCount(sim, w, e.cells, false); if (c.samples && c.median >= 3) mtnCrowded++; mtnMax = Math.max(mtnMax, c.median); }
  const islandLinkProjects = Object.values(sim.projects).filter((p) => p.reason.includes(ISLAND_TAG)).length;
  const h = sim.hubs, aps = h ? Object.values(h.airports).filter((a) => a.until === undefined) : [], ports = h ? Object.values(h.ports).filter((p) => p.until === undefined) : [];
  const apCity = aps.map((a) => w.cityById.get(a.city)).filter((c): c is NonNullable<typeof c> => !!c);
  const mainMass = [...massArea.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]), onIslands = apCity.filter((c) => !mainMass.includes(w.lm[c.cell])).length;
  const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const nn = apCity.map((c) => Math.min(...apCity.filter((o) => o !== c).map((o) => d(c.pos, o.pos)))).filter(Number.isFinite).sort((a, b) => a - b);
  let pop = 0, far = 0, far50 = 0, towns50 = 0; for (const c of w.cities) { const p = sim.cities[c.id]?.pop ?? 0; if (!p) continue; pop += p; const m = apCity.length ? Math.min(...apCity.map((a) => d(a.pos, c.pos))) : Infinity; if (m > 80) far += p; if (m > 50) { far50 += p; towns50++; } }
  const isleMass = new Set<number>(); for (const c of w.cities) if ((sim.cities[c.id]?.pop ?? 0) > 0 && !mainMass.includes(w.lm[c.cell])) isleMass.add(w.lm[c.cell]);
  const isleServed = [...isleMass].filter((m) => apCity.some((a) => w.lm[a.cell] === m)).length;
  const routes = h?.routes ?? [], open = routes.filter((r) => r.state === "open"), served = new Set(open.filter((r) => r.mode === "air").flatMap((r) => [r.a, r.b]));
  const north = (p: string) => { let s = 0; for (const c of w.cities) if (c.pref === p || (w.prefOf(c.cell) === p)) s += sim.cities[c.id]?.pop ?? 0; return Math.round(s / 1000); };
  return {
    mtnEdges, mtnKm: Math.round(mtnKm), mtnCrowded, mtnMax,
    roadKm: Math.round(roadKm), hwyKm: Math.round(hwyKm), railKm: Math.round(railKm), fixedLinks, fixedRoad, fixedRail, fixedKm: Math.round(fixedKm), bridges, tunnels, islandLinkProjects,
    airports: aps.length, airportsOnIslands: onIslands, airportsWithRoute: aps.filter((a) => served.has(a.city)).length, apNearestKmMedian: nn.length ? Math.round(nn[nn.length >> 1]) : null, apNearestKmP10: nn.length ? Math.round(nn[Math.floor(nn.length * 0.1)]) : null,
    popFarFromAirportShare: pop ? Math.round((far / pop) * 1000) / 10 : null, popFar50Share: pop ? Math.round((far50 / pop) * 1000) / 10 : null, townsFar50: towns50, islandsPopulated: isleMass.size, islandsWithAirport: isleServed, ports: ports.length,
    airDomestic: open.filter((r) => r.mode === "air" && !r.intl).length, airIntl: open.filter((r) => r.mode === "air" && r.intl).length, seaDomestic: open.filter((r) => r.mode === "sea" && !r.intl).length, seaIntl: open.filter((r) => r.mode === "sea" && r.intl).length,
    ferries: Object.values(sim.edges).filter((e) => e.facility === "ferry" && live(e)).length,
    airTrunk: open.filter((r) => r.mode === "air" && !r.intl && airTier(r) === "trunk").length, airLocal: open.filter((r) => r.mode === "air" && !r.intl && airTier(r) === "local").length, airLocalOpened: open.filter((r) => r.local).length,
    seaTrunk: Object.values(sim.edges).filter((e) => e.facility === "ferry" && live(e) && seaTier(e) === "trunk").length,
    northK: { 札幌県: north("HK-SAP"), 函館県: north("HK-HAK"), 根室県: north("HK-NEM"), 樺太県: north("KRF") }, popM: Math.round(pop / 1e5) / 10,
  };
}

/** Minimal "scenery" export: where/when/what the road is like, for a future scene generator. No invented detail below the 5 km grid. */
import { edgePoints } from "./network";
import { dist, pointSegDist } from "../core/geom";
import { routeLabel, prefName } from "./engine";
import { GRADE_LABEL, SURFACE_LABEL, eraLabel, monthToYM, type SimState } from "./types";
import type { World } from "./world";
import type { Vec } from "../core/types";

export function exportScenery(sim: SimState, w: World, world: Vec, geo?: { lon: number; lat: number; island?: string }) {
  const k = w.cellOf(world), { year, month } = monthToYM(sim.startYear, sim.month);
  let best: { id: string; d: number } | null = null;
  for (const e of Object.values(sim.edges)) { const pts = edgePoints(w, sim, e); for (let i = 0; i + 1 < pts.length; i++) { const d = pointSegDist(world, pts[i], pts[i + 1]); if (!best || d < best.d) best = { id: e.id, d }; } }
  const e = best && best.d <= w.cell * 1.5 ? sim.edges[best.id] : null;
  const routes = e ? Object.values(sim.routes).filter((r) => r.active && r.edges.some((x) => x.edgeId === e.id)) : [];
  const state = !e ? null : e.lost ? "廃道" : !e.open ? (e.built < 1 ? "未成・工事中" : "廃止") : "供用中";
  return {
    schema: "kfm.scenery.v1",
    when: { year, month, era: eraLabel(year), simMonth: sim.month },
    where: { world, geo: geo ?? null, cell: k >= 0 ? `cell.${w.cell}.${k % w.nx}.${(k / w.nx) | 0}` : null, precisionKm: w.cell, pref: k >= 0 && w.prefOf(k) ? { id: w.prefOf(k), name: prefName(w.prefOf(k)!) } : null },
    terrain: k >= 0 ? { land: ["sea", "land", "lake"][w.t.land[k]], elevationM: Math.round(w.elevM(k)), river: !!w.river[k], ridge: Math.round(w.t.ridge[k] * 100) / 100 } : null,
    road: e && best ? {
      edgeId: e.id, distanceKm: Math.round(best.d * 10) / 10, state, surface: SURFACE_LABEL[e.surface], quality: Math.round(e.quality), weathering: Math.round(e.weathering), maxGradePct: e.maxGradePct, lengthKm: Math.round(e.lengthKm * 10) / 10, builtYear: e.builtMonth === null ? null : monthToYM(sim.startYear, e.builtMonth).year,
      routes: routes.map((r) => ({ id: r.id, label: routeLabel(r), grade: GRADE_LABEL[r.grade] })),
    } : null,
    nearbyCities: w.cities.filter((c) => dist(c.pos, world) <= 60).map((c) => ({ id: c.id, name: c.name, km: Math.round(dist(c.pos, world)), pop: sim.cities[c.id]?.pop ?? null })).sort((a, b) => a.km - b.km).slice(0, 5),
    notes: "標高・道路位置は5km格子に基づく概算です。峠・橋梁・道幅の細部は含みません。人口等は合成値です。",
  };
}

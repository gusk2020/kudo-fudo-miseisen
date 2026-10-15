/** 1950 starting network: thin ordinary roads already exist all over the country (synthetic, deterministic from the seed). */
import { dist } from "../core/geom";
import { FU_PREFS, type Grade, type SimState } from "./types";
import { layPath, newId, nodeAtCell, buildIndex, pad } from "./network";
import { designate, ev, rand } from "./engine";
import { pathfind, type World, type WCity } from "./world";
import { refBias, referenceGrids } from "./reference";
import { seedRailGen } from "./seedRail";
import { openStraits } from "./straits";

export const RESERVED = { national: 1, fuTokyo: 1 };   // numbers kept for the 開通の儀 roads
export function* seedInitialNetworkGen(sim: SimState, w: World): Generator<number> {
  sim.routeCounters["national:JP"] = RESERVED.national; sim.routeCounters["fu:JP-13"] = RESERVED.fuTokyo;
  // 1) settlements around every city (synthetic)
  let sid = 0; const used = new Set<number>(w.cities.map((c) => c.cell)); let idx = buildIndex(sim);
  for (const c of w.cities) {
    const n = 2 + Math.floor(rand(sim) * 3) + (c.pop0 > 500000 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      let cell = -1;
      for (let tries = 0; tries < 10 && cell < 0; tries++) {
        const ang = rand(sim) * Math.PI * 2, r = 15 + rand(sim) * 30, q = w.cellOf([c.pos[0] + Math.cos(ang) * r, c.pos[1] + Math.sin(ang) * r]);
        if (q >= 0 && w.t.land[q] === 1 && w.t.island[q] === c.island && !used.has(q)) cell = q;
      }
      const popv = Math.round((350 + rand(sim) * 3600) * (c.pop0 > 1e6 ? 1.5 : 1)); if (cell < 0) continue;
      used.add(cell); const id = `s.${pad(++sid, 4)}`;
      sim.settlements[id] = { id, name: `${c.name.replace(/市$/, "")}近郊${k + 1}`, cell, city: c.id, pop: popv, pop0: popv, isolatedYears: 0, gone: false };
      nodeAtCell(sim, w, idx, cell, "village");
    }
    yield 0.05;
  }
  // 2) city-to-city roads: minimum spanning forest per island, plus each city's nearest unlinked neighbour
  const links: [WCity, WCity][] = [], key = new Set<string>(), add = (a: WCity, b: WCity) => { const k = a.id < b.id ? a.id + b.id : b.id + a.id; if (key.has(k)) return; key.add(k); links.push([a, b]); };
  for (const isl of [...new Set(w.cities.map((c) => c.island))].sort((a, b) => a - b)) {
    const cs = w.cities.filter((c) => c.island === isl); if (cs.length < 2) continue; const inT = new Set([cs[0].id]);
    while (inT.size < cs.length) {
      let best: [WCity, WCity] | null = null, bd = Infinity;
      for (const a of cs) if (inT.has(a.id)) for (const b of cs) if (!inT.has(b.id)) { const d = dist(a.pos, b.pos); if (d < bd) { bd = d; best = [a, b]; } }
      if (!best || bd > 230) break; add(best[0], best[1]); inT.add(best[1].id);
    }
    for (const a of cs) { let nb: WCity | null = null, nd = Infinity; for (const b of cs) if (b !== a && !key.has(a.id < b.id ? a.id + b.id : b.id + a.id)) { const d = dist(a.pos, b.pos); if (d < nd) { nd = d; nb = b; } } if (nb && nd <= 90) add(a, nb); }
  }
  let nRoutes = 0;
  for (const [a, b] of links) {
    const path = pathfind(w, a.cell, b.cell, sim.stage3 ? { margin: 16, bias: refBias(referenceGrids(w).road) } : { margin: 16 }); if (!path) continue;
    const l = layPath(sim, w, path, { open: true, surface: a.pop0 + b.pop0 > 400000 ? "gravel" : "unpaved", quality: 38 + rand(sim) * 27, built: 1, month: 0, standard: "rural" });
    if (!l.chain.length) continue;
    const national = a.pref !== b.pref || (a.pop0 > 150000 && b.pop0 > 150000), pf = a.pref ?? "JP-13";
    const g: Grade = national ? "national" : FU_PREFS.has(pf) ? "fu" : "ken";
    if (designate(sim, l.chain, g, national ? "JP" : pf, `${a.name}〜${b.name}`, "1950年の既存道路網(合成)", true)) nRoutes++;
    yield 0.3;
  }
  // 3) every settlement is tied to its city by a lane; some are prefectural roads
  idx = buildIndex(sim);
  for (const v of Object.values(sim.settlements)) {
    const c = w.cityById.get(v.city)!, path = pathfind(w, v.cell, c.cell, { roadCells: buildIndex(sim).roadCells, margin: 10 }); if (!path) continue;
    const l = layPath(sim, w, path, { open: true, surface: "unpaved", quality: 30 + rand(sim) * 25, built: 1, month: 0, standard: "rural" });
    if (l.chain.length && v.pop >= 3000 && rand(sim) < 0.35) { const pf = c.pref ?? "JP-13"; if (designate(sim, l.chain, FU_PREFS.has(pf) ? "fu" : "ken", pf, `${v.name}〜${c.name}`, "1950年の既存道路網(合成)", true)) nRoutes++; }
    else rand(sim);
    yield 0.9;
  }
  ev(sim, "seed", `1950年の既存道路網: 都市間${links.length}線・集落${Object.keys(sim.settlements).length}か所(合成)・路線${nRoutes}本`, "初期条件(実在の道路網ではない)", {});
  void newId;
  if (sim.stage3) { yield* seedRailGen(sim, w); openStraits(sim, w, sim.startYear, true); yield 0.95; }
}

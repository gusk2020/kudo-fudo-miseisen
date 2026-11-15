import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { analyze } from "../../src/sim/demand";
import { checkIntegrity, layPath } from "../../src/sim/network";
import { addOldCity, oldCityId, restoreOldCities, syncOldCities } from "../../src/sim/oldcity40";
import { promotionCandidates } from "../../src/sim/oldpromote40";
import { pathfind } from "../../src/sim/world";
import { gameName, oldPlaces } from "../../src/core/gazetteer2000";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "../unit/simhelp";

/** Issue #67 work A (study, not CI): cost of promoted cities in the simulation. Two series, kept apart:
 *  NATURAL  = the game's own promotions, which then take part in rail/port/air/plans by the ordinary rules (state at 1900/2000/2050/2100);
 *  ROADONLY = from the 1950 state with natural promotion off, K synthetic promoted cities (size 60,000, one paved road each), nothing else.
 *  Medians of 3 (5-year advance, analyze, save, restore) and of 2 (50-year advance). Memory: heapUsed after a forced gc when node runs with --expose-gc.
 *  STUDY=1 NODE_OPTIONS=--expose-gc OUT=dir npx vitest run tests/study/perf67.test.ts */
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const t = <T>(f: () => T): [number, T] => { const t0 = performance.now(); const r = f(); return [performance.now() - t0, r]; };
const heap = () => { (globalThis as any).gc?.(); return Math.round(process.memoryUsage().heapUsed / 1048576); };
describe.skipIf(!process.env.STUDY)("perf67", () => { it("x", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never); sim.policy!.mode = "auto"; const out: string[] = [];
  const measure = (label: string, base: SimState, nat: boolean) => {
    const fresh = () => { const s = JSON.parse(JSON.stringify(base)) as SimState; syncOldCities(s, w); s.policy!.mode = "auto"; if (!nat) delete s.promote40; return s; };
    const k = base.oldCities40?.length ?? 0, a5: number[] = [], an: number[] = [], sv: number[] = [], rs: number[] = [], a50: number[] = []; let size = 0;
    for (let i = 0; i < 3; i++) { const s = fresh(); an.push(t(() => analyze(s, w))[0]); const [ts, str] = t(() => JSON.stringify(s)); sv.push(ts); size = str.length; rs.push(t(() => { const p = JSON.parse(str) as SimState; restoreOldCities(p, w); })[0]); syncOldCities(fresh(), w); const s5 = fresh(); a5.push(t(() => advance(s5, w, 60))[0]); }
    for (let i = 0; i < 2; i++) { const s = fresh(); a50.push(t(() => advance(s, w, 600))[0]); }
    const h0 = heap(); const keep = fresh(); const h1 = heap();
    out.push(`${label} promoted=${k} cities=${w.cities.length} analyze=${Math.round(med(an))}ms adv5y=${Math.round(med(a5))}ms adv50y=${Math.round(med(a50))}ms (runs ${a50.map((x) => Math.round(x)).join("/")}) save=${Math.round(med(sv))}ms ${(size / 1048576).toFixed(2)}MB restore=${Math.round(med(rs))}ms heap+${h1 - h0}MB(one more copy; ${(globalThis as any).gc ? "gc forced" : "no gc: unreliable"}) integrity=${checkIntegrity(keep).length}`); syncOldCities(sim, w);
  };
  // NATURAL: snapshots on the way
  for (const y of [1900, 2000, 2050, 2100]) { advance(sim, w, 12 * (y - yearOf(sim))); const snap = JSON.parse(JSON.stringify(sim)) as SimState; measure(`NATURAL ${y}`, snap, true); syncOldCities(sim, w); }
  // ROADONLY from 1950 (natural off)
  const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), s0 = g.sim, w0 = g.w; s0.policy!.mode = "auto"; advance(s0, w0, 12 * (1950 - yearOf(s0))); delete s0.promote40;
  const addRoadOnly = (s: SimState, K: number) => { let n = 0; const saved: Record<string, number> = {}; for (const v of Object.values(s.settlements)) if (!v.gone && v.origin && !v.post && v.pop < 50000) { saved[v.id] = v.pop; v.pop = 60000; }
    while ((s.oldCities40?.length ?? 0) < K) { const c = promotionCandidates(s, w0, 1950)[0]; if (!c) break; const v = Object.values(s.settlements).find((x) => x.origin?.code === c.id.slice(2) && !x.gone)!, place = oldPlaces().find((p) => p.code === v.origin!.code)!, near = w0.cityById.get(c.near)!, path = pathfind(w0, v.cell, near.cell, { margin: 12 });
      if (!path || path.length < 2) { v.gone = true; continue; } layPath(s, w0, path, { open: true, surface: "paved", quality: 70, built: 1, month: s.month, standard: "standard" }); addOldCity(s, w0, { id: c.id, code: place.code, name: gameName(place, "city"), pref: w0.prefOf(v.cell)!, cell: v.cell, year: 1950, pop0: v.pop }); v.pop = 0; v.gone = true; n++; }
    for (const [id, p] of Object.entries(saved)) if (!s.settlements[id].gone) s.settlements[id].pop = p; return n; };
  for (const K of [0, 10, 20, 40, 60]) { const s = JSON.parse(JSON.stringify(s0)) as SimState; syncOldCities(s, w0); delete s.promote40; const n = addRoadOnly(s, K); measure(`ROADONLY K=${K}(got ${n})`, s, false); }
  writeFileSync(`${process.env.OUT ?? "/tmp"}/perf67-node.txt`, out.join("\n") + "\n");
}, 9000000); });

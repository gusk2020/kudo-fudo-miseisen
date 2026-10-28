import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { run14 } from "../study/lib14";
it("probe growth", () => {
  const years = [1960, 2000, 2050, 2100, 2150, 2210, 2260, 2310], rows: any[] = []; let t0 = Date.now(), last = 1950;
  const keep = (sim: any, w: any) => ({ edges: Object.keys(sim.edges).length, routes: Object.keys(sim.routes).length, nodes: Object.keys(sim.nodes).length, projects: Object.keys(sim.projects).length, events: sim.events.length, stats: sim.stats.length, snaps: sim.snaps.length, cities: Object.keys(sim.cities).length, settlements: Object.keys(sim.settlements).length, histTotal: Object.values(sim.edges).reduce((a: number, e: any) => a + (e.hist?.length ?? 0), 0), routeHist: Object.values(sim.routes).reduce((a: number, r: any) => a + (r.history?.length ?? 0), 0) });
  run14({ seed: 5, until: 2320, islets: true, choose: () => null as never, hook: (sim, w, y) => {
    if (years.includes(y)) {
      const dt = Date.now() - t0, per = dt / (y - last); const keys: Record<string, number> = {}; let total = 0; const t1 = Date.now(); const s = JSON.stringify(sim); total = s.length; const stringifyMs = Date.now() - t1;
      for (const k of Object.keys(sim)) { const l = JSON.stringify((sim as any)[k])?.length ?? 0; if (l > 150000) keys[k] = l; }
      global.gc?.(); rows.push({ y, msPerYear: Math.round(per), bytes: total, stringifyMs, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6), counts: keep(sim, w), bigKeys: keys });
      t0 = Date.now(); last = y;
    }
  } });
  writeFileSync("/tmp/claude-0/-home-user/109baf63-fe83-5bb5-8529-ffea0ae6bce3/scratchpad/growth.json", JSON.stringify(rows, null, 1));
}, 3000000);

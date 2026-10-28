import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { run14 } from "../study/lib14";
import { summary } from "../../src/sim/engine";
import { cycleOf } from "../../src/sim/cycle27";
it("cycle probe", () => {
  const out: any = {}; const at = [2190, 2200, 2210, 2225, 2250, 2275, 2300, 2325, 2349, 2360, 2375, 2400, 2425];
  for (const seed of [3, 11, 29]) {
    const rows: any[] = [], seen = new Set<number>();
    run14({ seed, until: 2427, islets: true, hook: (sim, w, y) => { if (!at.includes(y) || seen.has(y)) return; seen.add(y); const m = summary(sim), hubs: any = sim.hubs, air = hubs ? hubs.routes.filter((r: any) => r.mode === "air" && !r.intl && r.state === "open").length : 0, sea = hubs ? hubs.routes.filter((r: any) => r.mode === "sea" && !r.intl && r.state === "open").length : 0, ferry = Object.values(sim.edges).filter((e: any) => e.facility === "ferry" && e.state === "open").length, pop = Object.values(sim.cities).reduce((a, c) => a + c.pop, 0), c = cycleOf(sim);
      rows.push({ y, phase: c?.phase ?? "-", budgetBu: sim.macro.budgetBu, roadKm: m.roadKm, railKm: m.railKm, routes: m.routes, building: m.building, unbuilt: m.unbuilt, lost: m.lost, closed: m.closed, dormant: m.dormant, air, sea, ferry, pop: Math.round(pop / 1e3), edges: Object.keys(sim.edges).length }); } });
    out[seed] = rows;
  }
  writeFileSync("/tmp/claude-0/-home-user/109baf63-fe83-5bb5-8529-ffea0ae6bce3/scratchpad/cycle.json", JSON.stringify(out, null, 1));
}, 3000000);

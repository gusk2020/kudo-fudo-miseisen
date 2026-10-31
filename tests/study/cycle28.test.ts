/** Stage 28 study (not part of the normal run): how the 150-year cycle moves the network, the people and the traffic, over several seeds. Run: STUDY28=1 SEEDS=3,11,29 UNTIL=2410 npx vitest run tests/study/cycle28.test.ts */
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { run14 } from "./lib14";
import { summary } from "../../src/sim/engine";
import { modeOf } from "../../src/sim/types";
import { cycleOf } from "../../src/sim/cycle27";

const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user/109baf63-fe83-5bb5-8529-ffea0ae6bce3/scratchpad/cycle28.json";
const SEEDS = (process.env.SEEDS ?? "3,11,29").split(",").map(Number), UNTIL = Number(process.env.UNTIL ?? 2410), FIRST = Number(process.env.FIRST ?? 2100), STEP = Number(process.env.STEP ?? 10);
it.skipIf(!process.env.STUDY28)("cycle study", () => {
  const out: Record<string, any[]> = {};
  for (const seed of SEEDS) {
    const rows: any[] = [], seen = new Set<number>(); let lastMonth = 0;
    run14({ seed, until: UNTIL, islets: true, relocFirst: FIRST, hook: (sim, w, y) => {
      if (y < FIRST - 10 || (y - FIRST) % STEP !== 0 || seen.has(y)) return; seen.add(y);
      const m = summary(sim), hubs: any = sim.hubs, c = cycleOf(sim);
      const air = hubs ? hubs.routes.filter((r: any) => r.mode === "air" && !r.intl && r.state === "open").length : 0, sea = hubs ? hubs.routes.filter((r: any) => r.mode === "sea" && !r.intl && r.state === "open").length : 0;
      const ferry = Object.values(sim.edges).filter((e: any) => e.facility === "ferry" && e.state === "open").length;
      let pop = 0, top = 0; for (const ct of Object.values(sim.cities)) { pop += ct.pop; top = Math.max(top, ct.pop); }
      let traffic = 0, roadOpen = 0, railOpen = 0; for (const e of Object.values(sim.edges)) if (e.built >= 1 && e.state === "open") { traffic += e.traffic * e.lengthKm; if (modeOf(e) === "rail") railOpen++; else roadOpen++; }
      const ev: Record<string, number> = {}; for (const e of sim.events) if (e.month > lastMonth) ev[e.kind] = (ev[e.kind] ?? 0) + 1; lastMonth = sim.month;
      const ports = hubs ? Object.values(hubs.ports).filter((p: any) => p.until === undefined && p.tier >= 2).length : 0, airports = hubs ? Object.values(hubs.airports).filter((a: any) => a.until === undefined).length : 0, intl = hubs ? hubs.routes.filter((r: any) => r.intl && r.state === "open").length : 0;
      rows.push({ ports, airports, intl, ev, y, phase: c?.phase ?? "-", budgetBu: Math.round(sim.macro.budgetBu * 10) / 10, roadKm: m.roadKm, railKm: m.railKm, building: m.building, unbuilt: m.unbuilt, lost: m.lost, closed: m.closed, dormant: m.dormant, air, sea, ferry, pop: Math.round(pop / 1e3), topCity: Math.round(top / 1e3), traffic: Math.round(traffic / 1e3), nEdges: Object.keys(sim.edges).length, events: sim.events.length });
    } });
    out[seed] = rows; writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
}, 6000000);

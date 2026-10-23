import { it } from "vitest";
import { run14 } from "./lib14";
it.skipIf(!process.env.STUDY)("perf islets", () => {
  const out: any[] = [];
  for (const islets of [false, true]) { const r = run14({ seed: 3, until: 1985, islets }); out.push({ islets, wallS: r.wallS, edges: Object.keys(r.sim.edges).length, isl20: r.sim.isl20 }); }
  require("fs").writeFileSync("/tmp/claude-0/s/perf.txt", JSON.stringify(out));
}, 1800000);

import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { modeOf } from "../../src/sim/types";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("seed15", () => { it("x", () => {
  const r = run14({ seed: 7, firstEra: +(process.env.ERA ?? 1), until: 1951 }), sim = r.sim, w = r.w; const out: string[] = [];
  const nm = new Map(Object.values(sim.nodes).map((n) => [n.id, w.cityByCell.get(n.cell)?.name ?? ""]));
  const cityPairs = new Set<string>();
  for (const e of Object.values(sim.edges)) { if (modeOf(e) !== "rail" || e.facility === "ferry" || e.built < 1) continue; const a = nm.get(e.a), b = nm.get(e.b); if (a && b) cityPairs.add(`${a}-${b}(${Math.round(e.lengthKm)})`); }
  out.push("rail city-city edges: " + [...cityPairs].sort().join(" "));
  const js = w.cities.filter((c) => /-(05|06|15|16|17|18|31|32)$/.test(c.pref ?? "")).map((c) => c.name + ":" + Math.round(sim.cities[c.id].pop / 1000));
  out.push("JS cities: " + js.join(" "));
  writeFileSync("/tmp/claude-0/seed15.txt", out.join("\n"));
}, 300000); });

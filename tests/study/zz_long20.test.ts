import { it } from "vitest";
import { run14 } from "./lib14";
import { ISLETS, isletPos } from "../../src/core/islets";
it.skipIf(!process.env.STUDY)("long islet runs", () => {
  const out: any[] = [];
  const cases: [string, string, string, number][] = [["硫黄島", "JP-13", "JP-27", 1], ["魚釣島", "JP-47", "JP-27", 2], ["竹島", "JP-32", "JP-27", 3], ["択捉島", "HK-NEM", "JP-27", 4], ["父島", "JP-13", "JP-27", 5], [" ", "JP-13", "JP-27", 1], ["2210", "JP-13", "JP-27", 2]];
  for (const [nm, cap, sub, seed] of cases) {
    const s = ISLETS.find((x) => x.name === nm), pos = s ? isletPos(s) : undefined;
    try {
      const r = run14({ seed, until: nm === "2210" ? 2210 : 2100, ...(nm === "2210" ? { e2200: { era: 0, stance: "kairo", coast: "japansea", focus: "disperse", capital: "JP-17", sub: "JP-40" } } : {}), capital: cap, sub, islets: true, ...(pos ? { capPos: pos, moves: [{ pref: cap, pos, by: "capital" as const }] } : {}) });
      const w = r.w, c = w.cities.find((x) => x.kind === "capital" && x.pref === cap)!, st = r.sim.cities[c.id], tot = w.cities.reduce((a, x) => a + r.sim.cities[x.id].pop, 0);
      const bad = w.cities.filter((x) => !Number.isFinite(r.sim.cities[x.id].pop) || r.sim.cities[x.id].pop < 0).length;
      const ferries = Object.values(r.sim.edges).filter((e: any) => e.facility === "ferry").length;
      out.push({ nm, seed, city: c.name, capPop: c.capPop, pop: st.pop, tot, bad, wallS: r.wallS, edges: Object.keys(r.sim.edges).length, ferries, top: w.cities.map((x) => [x.name, r.sim.cities[x.id].pop]).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3) });
    } catch (e: any) { out.push({ nm, err: String(e.message).slice(0, 300) }); }
  }
  require("fs").writeFileSync("/tmp/claude-0/s/long.json", JSON.stringify(out, null, 1));
}, 3000000);

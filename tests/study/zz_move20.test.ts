import { it } from "vitest";
import { lonLatToReal } from "../../src/core/data";
import { run14 } from "./lib14";
import { ISLETS, isletPos } from "../../src/core/islets";
it.skipIf(!process.env.STUDY)("islet capital", () => {
  const out: any[] = [];
  for (const [nm, cap, sub] of [["硫黄島", "JP-13", "JP-27"], ["魚釣島", "JP-47", "JP-27"], ["竹島", "JP-32", "JP-27"], ["択捉島", "HK-NEM", "JP-27"]] as const) {
    const s = ISLETS.find((x) => x.name === nm)!, pos = isletPos(s);
    try { const r = run14({ seed: 3, until: 1990, capital: cap, sub, islets: true, capPos: pos, moves: [{ pref: cap, pos, by: "capital" }] }); const w = r.w, c = w.cities.find((x) => x.kind === "capital" && x.pref === cap)!, st = r.sim.cities[c.id];
      const tot = w.cities.reduce((a, x) => a + r.sim.cities[x.id].pop, 0);
      out.push({ nm, city: c.name, cap: c.capPop, pop: st.pop, tot, wallS: r.wallS, edges: Object.keys(r.sim.edges).length, moves: w.moves20, big: w.cities.map((x) => [x.name, r.sim.cities[x.id].pop]).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3) });
    } catch (e: any) { out.push({ nm, err: String(e.message).slice(0, 300) }); }
  }
  require("fs").writeFileSync("/tmp/claude-0/s/move.txt", JSON.stringify(out, null, 1));
}, 3000000);

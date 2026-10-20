import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { createSim, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { realWorld } from "../unit/simhelp";
const on = process.env.STUDY === "1";
(on ? it : it.skip)("prof", () => {
  const { w, hash } = realWorld(true), out: string[] = [];
  for (const s14 of [true]) {
    const sim = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", seats14: s14 });
    const a = homeCity(w, sim.capital)!.pos, b = subCity(w, sim.subCapital)!.pos;
    const p = previewNational(w, Array.from({ length: 21 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 20, a[1] + ((b[1] - a[1]) * i) / 20] as [number, number]), sim.capital, sim.subCapital); performNational(sim, w, p);
    sim.policy!.mode = "priority"; const ts: [number, number][] = []; let tot = 0;
    while (yearOf(sim) < 1990) { const t = performance.now(); stepMonth(sim, w); const d = performance.now() - t; tot += d; ts.push([yearOf(sim) * 100 + sim.month % 12, d]); if (sim.kaigen?.pending) settleKaigen(sim, 0, true); if (sim.policy?.pending) autoResolve(sim, w); }
    ts.sort((x, y) => y[1] - x[1]);
    out.push(`seats14=${s14} total ${(tot / 1000).toFixed(1)}s top: ` + ts.slice(0, 8).map((x) => `${x[0]}:${x[1].toFixed(0)}ms`).join(" "));
  }
  writeFileSync("/tmp/claude-0/prof14.txt", out.join("\n"));
}, 1800000);

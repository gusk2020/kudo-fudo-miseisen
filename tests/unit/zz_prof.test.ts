import { it } from "vitest"; import { appendFileSync } from "fs";
import { stepMonthGen, settleKaigen, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { stage3Sim } from "./simhelp";
it("prof", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); sim.policy!.mode = "priority";
  const by: Record<string, number[]> = {};
  while (yearOf(sim) < 2060) {
    const g = stepMonthGen(sim, w); for (;;) { (globalThis as any).__atom = "start"; const t = performance.now(); const r = g.next(); const dt = performance.now() - t; const k = (globalThis as any).__atom; (by[k] ??= []).push(dt); if (r.done) break; }
    if (sim.kaigen?.pending) settleKaigen(sim, 0, true); if (sim.policy?.pending) autoResolve(sim, w);
  }
  const out = Object.entries(by).map(([k, v]) => [k, v.length, Math.round(Math.max(...v)), Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10, Math.round(v.sort((a, b) => b - a)[Math.floor(v.length * 0.01)])]);
  appendFileSync("/tmp/claude-0/prof.out", JSON.stringify(out) + "\n");
}, 600000);

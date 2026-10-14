import { test } from "vitest";
import { stepMonthGen } from "../../src/sim/engine"; import { autoResolve } from "../../src/sim/policy";
import { stage3Sim } from "./simhelp";
test("t", () => {
  for (const era of ["heisei", "shoka"] as const) {
    const { sim, w } = stage3Sim(era, 9); const top: [number, number][] = [];
    for (let m = 0; m < 12 * 100; m++) { const g = stepMonthGen(sim, w); let k = 0; for (;;) { const t0 = performance.now(), r = g.next(), d = performance.now() - t0; top.push([d, sim.month]); k++; if (r.done) break; } if (sim.policy?.pending) autoResolve(sim, w); }
    top.sort((a, b) => b[0] - a[0]); console.log(era, top.slice(0, 8).map(x => `${x[0].toFixed(0)}ms@${1950 + Math.floor(x[1] / 12)}`).join(" "));
  }
});

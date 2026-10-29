import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { run14 } from "./lib14";
import { stepMonthGen, yearOf, settleKaigen } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { apply2200, close2200 } from "../../src/sim/event2200";
it.skipIf(!process.env.STUDY28)("slice timing", () => {
  const { sim, w } = run14({ seed: 3, until: 2100, islets: true, relocFirst: 2100 });
  const bySlice: Record<string, number[]> = {}; let months = 0, yearMs = 0, monthMs = 0, nYear = 0;
  while (yearOf(sim) < 2130) {
    const yb = sim.month % 12 === 0, g = stepMonthGen(sim, w); let i = 0, t = performance.now(), tot = 0;
    for (;;) { const r = g.next(); const dt = performance.now() - t; t = performance.now(); tot += dt; const k = `${yb ? "Y" : "m"}${i}`; (bySlice[k] ??= []).push(dt); i++; if (r.done) break; }
    if (yb) { yearMs += tot; nYear++; } else monthMs += tot; months++;
    if (sim.kaigen?.pending) settleKaigen(sim, Math.max(0, sim.kaigen.pending.cands.findIndex((c: any) => c.stance === "heisei")), true); if (sim.policy?.pending) autoResolve(sim, w);
    if (sim.e2200?.state === "pending") apply2200(sim, null, true); if ((sim.e2200?.state as string) === "road0") close2200(sim);
  }
  const rows = Object.entries(bySlice).map(([k, v]) => ({ k, n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), total: Math.round(v.reduce((a, b) => a + b, 0)) })).sort((a, b) => b.total - a.total);
  writeFileSync("/tmp/claude-0/-home-user/109baf63-fe83-5bb5-8529-ffea0ae6bce3/scratchpad/slice28.json", JSON.stringify({ months, nYear, yearMs: Math.round(yearMs), monthMs: Math.round(monthMs), rows: rows.slice(0, 20) }, null, 1));
}, 3000000);

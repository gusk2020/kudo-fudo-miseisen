import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { advance, yearOf } from "../../src/sim/engine";
import { stage3Sim } from "./simhelp";

/** Issue #88-5 measurement (runs only with KFM_LONG=<out.json>): a fully automatic 1800 game, per century: wall time, heap, save size, the biggest lists. KFM_LONG_YEARS (default 1000), KFM_LONG_SEED (7). */
const out = process.env.KFM_LONG;
(out ? describe : describe.skip)("long run probe", () => {
  it("century by century", () => {
    const years = Number(process.env.KFM_LONG_YEARS ?? 1000), g = stage3Sim("heisei", Number(process.env.KFM_LONG_SEED ?? 7), true, 0, 2, true, undefined, undefined, { start1800: true, era86: { name: "天興", stance: "heisei", coast: "pacific", focus: "concentrate" } } as never), { sim, w } = g; sim.policy!.mode = "auto"; const rows: unknown[] = [];
    for (let y = 1900; y <= 1800 + years; y += 100) {
      const t0 = Date.now(); advance(sim, w, 12 * (y - yearOf(sim))); const ms = Date.now() - t0, json = JSON.stringify(sim), sizes = Object.entries(sim as unknown as Record<string, unknown>).map(([k, v]) => [k, JSON.stringify(v ?? null).length] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 8);
      rows.push({ year: yearOf(sim), reached: yearOf(sim) >= y, secPerCentury: Math.round(ms / 100) / 10, saveMB: Math.round(json.length / 1e5) / 10, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6), edges: Object.keys(sim.edges).length, routes: Object.keys(sim.routes).length, projects: Object.keys(sim.projects).length, events: sim.events.length, eras: sim.kaigen!.eras.length, specials: Object.values(sim.routes).filter((r) => r.special).map((r) => r.special).join(""), top: sizes });
      writeFileSync(out!, JSON.stringify(rows, null, 1)); if (yearOf(sim) < y) break;
    }
  }, 7200000);
});

import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { advance, yearOf } from "../../src/sim/engine";
import { trunkStatus } from "../../src/sim/trunk42";
import { stage3Sim } from "./simhelp";
/** Measurement (only with KFM_TRUNK=<out.json>): capital / sub-capital connection by mode, per policy, seed and year. */
const out = process.env.KFM_TRUNK;
(out ? describe : describe.skip)("trunk probe", () => {
  it("by policy", () => {
    const rows: unknown[] = [];
    for (const stance of (process.env.KFM_STANCES ?? "heisei,shubun,shoka,kairo,kuuro").split(",")) for (const seed of (process.env.KFM_SEEDS ?? "7").split(",").map(Number)) for (const seats of [{ capital: "JP-13", sub: "JP-27" }, { capital: "JP-13", sub: "HK-SAP" }]) {
      const g = stage3Sim("heisei", seed, true, 0, 2, true, seats, undefined, { start1800: true, era86: { name: "天興", stance, coast: "pacific", focus: "concentrate" } } as never); g.sim.policy!.mode = "auto";
      for (const y of [1850, 1900, 1950, 2000, 2050]) { advance(g.sim, g.w, 12 * (y - yearOf(g.sim))); for (const p of trunkStatus(g.sim, g.w)) rows.push({ stance, seed, sub: seats.sub, year: y, road: p.road, rail: p.rail, sea: p.sea, air: p.air, missing: p.missing }); writeFileSync(out!, JSON.stringify(rows, null, 1)); }
    }
  }, 7200000);
});

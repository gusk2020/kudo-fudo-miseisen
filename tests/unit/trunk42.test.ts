import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { trunkStatus, TRUNK_TAG } from "../../src/sim/trunk42";
import { stage3Sim } from "./simhelp";
import { mayScheduleServiceFor } from "../../src/sim/rules1800";
/** Stage 42: the capital / sub-capital railway is built whatever the policy (ordinary checks; nothing free); a game without the flag is unchanged. Measured over policies, seeds and years: docs/TRUNK42.md. */
const game = (stance: string, flag = true) => { const g = stage3Sim("heisei", 7, true, 0, 2, true, { capital: "JP-13", sub: "JP-27" }, undefined, { start1800: true, era86: { name: "天興", stance, coast: "pacific", focus: "concentrate" } } as never); if (!flag) delete g.sim.trunk42; g.sim.policy!.mode = "auto"; return g; };
describe("Stage 42: trunk railway between capital and sub-capital", () => {
  it("road-first policy: 東京–大阪 joined by rail by 1900 (it was not even by 2050 before), through trunk projects; the same game without the duty is not", () => {
    const g = game("shubun"); let seen = false;   // (finished projects are dropped from the record after some years, so look on the way: the trunk may well be joined long before 1900)
    for (const y of [1830, 1850, 1870, 1890, 1900]) { advance(g.sim, g.w, 12 * (y - yearOf(g.sim))); if (Object.values(g.sim.projects).some((p) => p.reason.startsWith(TRUNK_TAG))) seen = true; }
    const st = trunkStatus(g.sim, g.w)[0]; expect(st.rail).toBe(true); expect(st.road).toBe(true);
    expect(seen, "the trunk projects are on record").toBe(true);
    const o = game("shubun", false); advance(o.sim, o.w, 12 * (1900 - yearOf(o.sim))); expect(trunkStatus(o.sim, o.w)[0].rail, "without the duty").toBe(false); expect(Object.values(o.sim.projects).some((p) => p.reason.startsWith(TRUNK_TAG))).toBe(false);
  }, 3000000);
  it("no trunk railway is planned before the game's own railway service era (rules1800: 1830, earlier under a rail-first policy -- that game's technology)", () => {
    for (const st of ["shoka", "shubun"]) { const g = game(st); advance(g.sim, g.w, 12 * (1860 - yearOf(g.sim))); let first = 1800; while (!mayScheduleServiceFor(g.sim, "rail", first)) first++;
      const tr = Object.values(g.sim.projects).filter((p) => p.reason.startsWith(TRUNK_TAG)), at = (p: { startMonth: number }) => g.sim.startYear + Math.floor(p.startMonth / 12); console.log(`T42 ${st}: rail service from ${first}; trunk projects begun ${tr.map(at).join(",")}`);
      for (const p of tr) expect(at(p), st).toBeGreaterThanOrEqual(first); }
  }, 3000000);
});

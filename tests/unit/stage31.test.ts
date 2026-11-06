import { describe, expect, it } from "vitest";
import { CATCHUP_CAP_MONTHS, MS_PER_MONTH_X1, noteSkipped, planCatchUp, skippedLabel, skippedWallMsOf } from "../../src/sim/engine";
import { INTRO_SECTIONS } from "../../src/ui/intro";
import { exportGame, makeSave, mapStateHash, parseSave } from "../../src/core/save2";
import { defaultState } from "../../src/core/state";
import { startedSim } from "./simhelp";

describe("Stage 31: skipped time is real time", () => {
  it("the skipped share of the measured away time: nothing below the cap, elapsed x skipped / (simulated + skipped) above it", () => {
    const x20 = 20, hours = 10, ms = hours * 3600000, plan = planCatchUp(ms, x20);
    expect(plan.months).toBe(CATCHUP_CAP_MONTHS); expect(plan.skipped).toBeGreaterThan(0);
    const wall = skippedWallMsOf(ms, plan); expect(wall).toBe(Math.round((ms * plan.skipped) / (plan.months + plan.skipped)));
    expect(wall).toBeLessThan(ms); expect(wall).toBeGreaterThan(0);
    const raw = Math.floor((ms * x20) / MS_PER_MONTH_X1); expect(plan.months + plan.skipped).toBe(raw);   // the split is of the same elapsed time
    expect(skippedWallMsOf(ms, planCatchUp(60000, x20))).toBe(0); expect(skippedWallMsOf(-5, { months: 0, skipped: 0 })).toBe(0); expect(skippedWallMsOf(ms, { months: 0, skipped: 0 })).toBe(0);
  });
  it("the label speaks in hours of real time; an old skip with no measured duration says so; no skip says nothing", () => {
    expect(skippedLabel({ skippedMonths: 0 })).toBe(""); expect(skippedLabel({ skippedMonths: 600 })).toBe("省略あり(実時間は未計測)");
    expect(skippedLabel({ skippedMonths: 600, skippedWallMs: 3.5 * 3600000 })).toBe("省略 約3.5時間"); expect(skippedLabel({ skippedMonths: 1, skippedWallMs: 60000 })).toBe("省略 0.1時間未満");
    expect(skippedLabel({ skippedMonths: 1, skippedWallMs: 250 * 3600000 })).toBe("省略 約250時間"); expect(skippedLabel({ skippedMonths: 600, skippedWallMs: 3.5 * 3600000 })).not.toMatch(/年/);
  });
  it("noteSkipped accumulates the real milliseconds beside the months, and the save keeps them", () => {
    const { sim } = startedSim(1), m = defaultState(); m.finalized = true; m.step = 5; sim.mapHash = mapStateHash(m);
    noteSkipped(sim, 100, 1000); noteSkipped(sim, 20, 500); noteSkipped(sim, 5); expect(sim.skippedMonths).toBe(125); expect(sim.skippedWallMs).toBe(1500);
    const p = parseSave(exportGame(makeSave(m, sim))); expect(p.sim!.skippedWallMs).toBe(1500);
    delete sim.skippedWallMs; expect(parseSave(exportGame(makeSave(m, sim))).sim!.skippedWallMs).toBeUndefined();
  });
});
describe("Stage 31: the startup window", () => {
  it("says it is a fictional-world Japan with 50 prefectures, carries the save cautions, and has no territorial note", () => {
    const text = INTRO_SECTIONS.flatMap((s) => [s.title, ...s.lines]).join("\n");
    expect(text).toContain("架空の世界線の日本"); expect(text).toContain("50府県"); expect(text).toMatch(/自動セーブポイント/); expect(text).toMatch(/JSONエクスポート/);
    expect(text).not.toMatch(/北方|領有|実効支配|竹島|尖閣/);
  });
});

import { describe, expect, it } from "vitest";
import { budgetAt, cycleOf, cycleShape, BUDGET_POINTS, CYCLE_YEARS } from "../../src/sim/cycle27";

const at = (year: number, ev = 2200) => cycleOf({ startYear: year, month: 0, e2200: { year: ev } as any });
describe("Stage 27: 150年周期", () => {
  it("初回遷都前は従来どおり(周期なし・補正なし)", () => {
    expect(cycleOf({ startYear: 2100, month: 0, e2200: undefined } as any)).toBeNull();
    expect(cycleShape(undefined, 2100)).toBeNull();
  });
  it("2200/2350/2500 を起点に復興→平衡→衰退が繰り返す", () => {
    for (const ev of [2200, 2350, 2500]) {
      expect(at(ev, ev)!.phase).toBe("rebuild"); expect(at(ev + 49, ev)!.phase).toBe("rebuild");
      expect(at(ev + 50, ev)!.phase).toBe("balance"); expect(at(ev + 99, ev)!.phase).toBe("balance");
      expect(at(ev + 100, ev)!.phase).toBe("decline"); expect(at(ev + 149, ev)!.phase).toBe("decline");
    }
  });
  it("予算は連続で、復興期に最大、衰退期に縮む", () => {
    let prev = budgetAt(0); for (let y = 0.25; y <= CYCLE_YEARS; y += 0.25) { const b = budgetAt(y); expect(Math.abs(b - prev)).toBeLessThan(0.1); prev = b; }
    expect(budgetAt(25)).toBeGreaterThan(budgetAt(0) * 10); expect(budgetAt(25)).toBeGreaterThan(budgetAt(75)); expect(budgetAt(75)).toBeGreaterThan(budgetAt(140));
    expect(BUDGET_POINTS[BUDGET_POINTS.length - 1][1]).toBeLessThan(BUDGET_POINTS[0][1] * 2);
  });
  it("人口移動の強さは 50/100 年の境で飛ばない", () => {
    for (const k of [50, 100]) expect(Math.abs(at(2200 + k - 0.01)!.growth - at(2200 + k + 0.01)!.growth)).toBeLessThan(0.05);
  });
  it("建設意欲は復興で上がり、衰退の終わりに抑えられる", () => {
    const a = cycleShape({ year: 2200 } as any, 2225)!, b = cycleShape({ year: 2200 } as any, 2345)!;
    expect(a.build).toBeGreaterThanOrEqual(1); expect(a.damp).toBe(1); expect(b.build).toBe(0); expect(b.damp).toBeLessThan(0.3);
  });
});

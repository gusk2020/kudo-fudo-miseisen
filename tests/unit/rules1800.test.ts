import { describe, expect, it } from "vitest";
import { econPhase, econProgress, mayScheduleService, nextReloc1800, pickEraName, relocYears1800, techStage } from "../../src/sim/rules1800";

describe("1800年規則(土台)", () => {
  it("経済周期: 世紀ごとに好況50・停滞30・不況20、1900年に好況へ戻る", () => {
    for (const base of [1800, 1900, 2000]) { expect(econPhase(base)).toBe("boom"); expect(econPhase(base + 49)).toBe("boom"); expect(econPhase(base + 50)).toBe("stagnation"); expect(econPhase(base + 79)).toBe("stagnation"); expect(econPhase(base + 80)).toBe("recession"); expect(econPhase(base + 99)).toBe("recession"); }
    expect(econProgress(1800)).toBe(0); expect(econProgress(1825)).toBeCloseTo(0.5); expect(econProgress(1999)).toBeCloseTo(0.95);
  });
  it("交通技術: 固定年。1800は鉄道なし、1860の飛行船は試験のみで定期路線なし、1920に定期空路", () => {
    expect(techStage("rail", 1800)).toBe("none"); expect(techStage("rail", 1810)).toBe("experimental"); expect(techStage("rail", 1830)).toBe("service");
    expect(techStage("airship", 1860)).toBe("experimental"); expect(mayScheduleService("airship", 1950)).toBe(false);
    expect(mayScheduleService("plane", 1919)).toBe(false); expect(mayScheduleService("plane", 1920)).toBe(true);
    expect(techStage("car", 1890)).toBe("experimental"); expect(techStage("expressway", 1929)).toBe("none"); expect(techStage("expressway", 1930)).toBe("service");
  });
  it("遷都: 1800年から100年ごと(1900,2000,...)", () => { expect(relocYears1800(2200)).toEqual([1900, 2000, 2100, 2200]); expect(nextReloc1800(1800)).toBe(1900); expect(nextReloc1800(1899)).toBe(1900); expect(nextReloc1800(1900)).toBe(2000); });
  it("元号名: 使用済みは二度と出ない。史実→ランダム→決定的な連番。同じ入力は同じ結果", () => {
    const used = new Set<string>(), got: string[] = [];
    for (let i = 0; i < 8; i++) { const n = pickEraName(used, ["甲", "乙"], ["丙"], 1); expect(used.has(n)).toBe(false); used.add(n); got.push(n); }
    expect(got.slice(0, 3)).toEqual(["甲", "乙", "丙"]); expect(new Set(got).size).toBe(8);
    expect(pickEraName(new Set(["甲", "乙", "丙", "新1"]), ["甲", "乙"], ["丙"], 1)).toBe("新2");
  });
});

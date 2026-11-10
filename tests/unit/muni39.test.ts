import { describe, expect, it } from "vitest";
import { LIMIT_M, allowedAt, aptitudeOf, eligible, exceptionAllowanceM, kindByPop, maxKindAt, peakStem, townName, RANGE_PEAKS } from "../../src/core/muni39";
import { RANGES } from "../../src/core/ranges";

describe("Stage 39 E: the elevation limits (the limit itself is on the forbidden side)", () => {
  it("1300 m forbids a 市, 1400 m a 町, 1500 m a 村 -- and one metre less allows it", () => {
    for (const [k, lim] of [["city", 1300], ["town", 1400], ["village", 1500]] as const) { expect(LIMIT_M[k]).toBe(lim); expect(allowedAt(k, lim - 1)).toBe(true); expect(allowedAt(k, lim)).toBe(false); expect(allowedAt(k, lim + 1)).toBe(false); }
    expect(maxKindAt(1299)).toBe("city"); expect(maxKindAt(1300)).toBe("town"); expect(maxKindAt(1399)).toBe("town"); expect(maxKindAt(1400)).toBe("village"); expect(maxKindAt(1499)).toBe("village"); expect(maxKindAt(1500)).toBeNull();
  });
  it("the kind follows the size", () => { expect(kindByPop(500)).toBe("village"); expect(kindByPop(8000)).toBe("town"); expect(kindByPop(49999)).toBe("town"); expect(kindByPop(50000)).toBe("city"); });
});
describe("Stage 39 F: from 1950 transport, demand and technology relax the limits step by step", () => {
  const at = (elevM: number, year: number, access: number, demand: number, kind: "city" | "town" | "village" = "city") => eligible({ kind, elevM, year, access, demand });
  it("never before 1950, whatever the road and the demand", () => { expect(at(1400, 1949, 1, 1)).toBe(false); expect(exceptionAllowanceM(1949, 1, 1)).toBe(0); });
  it("after 1950 only with a connection AND demand, and the higher the harder", () => {
    expect(at(1400, 2030, 0, 1)).toBe(false); expect(at(1400, 2030, 1, 0)).toBe(false);
    const a = exceptionAllowanceM(2000, 1, 1), b = exceptionAllowanceM(2050, 1, 1); expect(b).toBeGreaterThan(a); expect(a).toBeGreaterThan(0);
    expect(at(1300 + a * 0.5, 2000, 1, 1)).toBe(true); expect(at(1300 + a + 1, 2000, 1, 1)).toBe(false);   // too high for that year's technology
    expect(at(1300 + a * 0.5, 2000, 0.3, 0.3)).toBe(false);                                            // a poor road and little demand give a small allowance only
  });
  it("technology and access raise it monotonically; never past the cap", () => { let prev = 0; for (const y of [1950, 1975, 2000, 2050, 2200]) { const v = exceptionAllowanceM(y, 1, 1); expect(v).toBeGreaterThanOrEqual(prev); prev = v; } expect(prev).toBeLessThanOrEqual(700); expect(exceptionAllowanceM(2000, 0.5, 1)).toBeLessThan(exceptionAllowanceM(2000, 1, 1)); });
  it("water and made land get no exception at any year", () => { expect(eligible({ kind: "city", elevM: 1400, year: 2100, access: 1, demand: 1, noException: true })).toBe(false); });
});
describe("Stage 39 D: the original elevation bounds the aptitude but never kills it", () => {
  it("high ground is less apt, never below the floor", () => { expect(aptitudeOf(0)).toBe(1); expect(aptitudeOf(3776)).toBeGreaterThan(0.3); expect(aptitudeOf(3776)).toBeLessThan(aptitudeOf(500)); expect(aptitudeOf(9000)).toBe(0.35); });
});
describe("Stage 39 C: names from the highest peak", () => {
  const none = new Set<string>();
  it("the mountain word is taken off, the rest is a name", () => {
    expect(peakStem("富士山")).toBe("富士"); expect(peakStem("八ヶ岳")).toBe("八ヶ"); expect(peakStem("幌尻岳")).toBe("幌尻"); expect(peakStem("雲取山")).toBe("雲取"); expect(peakStem("木曽駒ヶ岳")).toBe("木曽駒ヶ"); expect(peakStem("奥穂高岳")).toBe("奥穂高");
    expect(peakStem("大山")).toBe("大山"); expect(peakStem("北岳")).toBe("北岳"); expect(peakStem("山")).toBeNull(); expect(peakStem("")).toBeNull();
  });
  it("the town takes the stem and its kind", () => { expect(townName("富士山", 0, "city", none)).toBe("富士市"); expect(townName("八ヶ岳", 0, "town", none)).toBe("八ヶ町"); expect(townName("雲取山", 0, "village", none)).toBe("雲取村"); expect(townName("大山", 0, "city", none)).toBe("大山市"); });
  it("more towns of one zone are told apart by direction; a taken name changes by a fixed rule; same input, same names", () => {
    const names = [0, 1, 2, 3].map((i) => townName("幌尻岳", i, "city", none)); expect(new Set(names).size).toBe(4); expect(names[0]).toBe("幌尻市"); expect(names[1]).toBe("北幌尻市");
    expect(townName("幌尻岳", 0, "city", new Set(["幌尻市"]))).toBe("幌尻山市"); expect(townName("幌尻岳", 0, "city", new Set(["幌尻市", "幌尻山市"]))).toBe("新幌尻市");
    expect([0, 1, 2, 3].map((i) => townName("幌尻岳", i, "city", none))).toEqual(names);
    expect(townName("山", 0, "city", none)).toBeNull();   // nothing is invented
  });
  it("every range of the game has a peak of its own, and a usable stem", () => { for (const r of RANGES) { const p = RANGE_PEAKS[r.id]; expect(p, r.id).toBeTruthy(); expect(peakStem(p.name), r.id).toBeTruthy(); expect(p.elevM).toBeGreaterThan(1500); } });
});

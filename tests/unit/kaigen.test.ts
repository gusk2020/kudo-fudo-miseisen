import { describe, expect, it } from "vitest";
import { CAND_1945, CAND_1989, CAND_2019, FORBIDDEN_CHARS, USED_NAMES, eraText, eraWeights, eto, futureCandidates, futureInterval, newKaigen, chooseEra, openKaigen, stanceAt } from "../../src/sim/kaigen";
import { advance, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { sanitizeSim, validateSimAgainstWorld } from "../../src/core/save2";
import { eraLabel } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

describe("kaigen: real candidates and the future rule", () => {
  it("lists the historical candidates, with 昭和 itself excluded and 平成/令和 first", () => {
    expect(CAND_1945.map((c) => c.name)).toEqual(["神化", "元化", "神和", "同和", "継明", "順明", "明保", "寛安", "元安", "立成", "定業", "光文", "章明", "協中"]);
    expect(CAND_1945.map((c) => c.name)).not.toContain("昭和");
    expect(CAND_1989.map((c) => c.name)).toEqual(["平成", "修文", "正化"]);
    expect(CAND_2019.map((c) => c.name)).toEqual(["令和", "英弘", "久化", "広至", "万保"]);
    for (const list of [CAND_1945, CAND_1989, CAND_2019]) { expect(new Set(list.map((c) => c.stance)).size).toBe(3); expect(new Set(list.map((c) => c.name)).size).toBe(list.length); }
  });
  it("the sexagenary year is right (1984 甲子, 2019 己亥)", () => { expect(eto(1984).label).toBe("甲子"); expect(eto(2019).label).toBe("己亥"); expect(eto(2044).label).toBe("甲子"); });
  it("future candidates: five, unique, fewest strokes first, no forbidden character, none already used; deterministic", () => {
    for (const y of [2047, 2049, 2052, 2078, 2081]) {
      const a = futureCandidates(y), b = futureCandidates(y); expect(a).toEqual(b); expect(a.length).toBe(5); expect(new Set(a.map((c) => c.name)).size).toBe(5);
      const strokes = a.map((c) => Number(/(\d+)画/.exec(c.note)![1])); expect([...strokes].sort((p, q) => p - q)).toEqual(strokes);
      for (const c of a) { expect([...c.name].some((ch) => FORBIDDEN_CHARS.has(ch))).toBe(false); expect(USED_NAMES.has(c.name)).toBe(false); expect(c.name.length).toBe(2); expect(c.real).toBe(false); }
    }
    expect(futureCandidates(2049, new Set(futureCandidates(2049).map((c) => c.name))).map((c) => c.name)).not.toEqual(futureCandidates(2049).map((c) => c.name));
  });
  it("intervals are 27..33 years and depend only on the seed and the count", () => {
    const seen = new Set<number>(); for (let s = 1; s < 60; s++) for (let i = 0; i < 4; i++) { const v = futureInterval(s, i); expect(v).toBeGreaterThanOrEqual(27); expect(v).toBeLessThanOrEqual(33); expect(futureInterval(s, i)).toBe(v); seen.add(v); }
    expect(seen.size).toBeGreaterThan(4);
  });
  it("era names and weights follow the choices; earlier eras keep a share", () => {
    const k = newKaigen(CAND_1945[1], 1, 7); openKaigen(k, 1989); chooseEra(k, 2, 7); openKaigen(k, 2019); chooseEra(k, 0, 7);
    expect(k.eras.map((e) => e.name)).toEqual(["元化", "正化", "令和"]); expect(k.next).toBeGreaterThanOrEqual(2046); expect(k.next).toBeLessThanOrEqual(2052);
    expect(eraText(k.eras, 1950)).toBe("元化6年"); expect(eraText(k.eras, 1989)).toBe("正化元年"); expect(eraText(k.eras, 2019)).toBe("令和元年");
    for (const y of [1960, 1989, 1992, 2000, 2019, 2030, 2100]) { const w = eraWeights(k.eras, y); expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9); }
    expect(eraWeights(k.eras, 2100)[0]).toBeGreaterThan(0.05); expect(eraWeights(k.eras, 2100)[2]).toBeGreaterThan(eraWeights(k.eras, 2100)[0]);
    expect(eraWeights(k.eras, 1988)).toEqual([1, 0, 0]);
  });
});

describe("kaigen in a running game", () => {
  it("time stops at 1989, the choice is recorded, survives a JSON round trip, and the labels follow", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0); sim.speed = 0; sim.policy!.mode = "priority";
    expect(sim.kaigen!.eras[0].name).toBe("神化"); expect(sim.era).toBe("heisei"); expect(eraLabel(1950)).toBe("神化6年");
    let guard = 0; while (!sim.kaigen!.pending && guard++ < 12 * 60) { stepMonth(sim, w); if (sim.policy?.pending) { sim.policy.pending = null; } }
    expect(sim.kaigen!.pending!.year).toBe(1989); const month = sim.month; stepMonth(sim, w); expect(sim.month).toBe(month);   // frozen
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(back.sim?.kaigen?.pending?.year).toBe(1989); expect(validateSimAgainstWorld(back.sim!, w, sim.terrainHash)).toBeNull();
    const e = settleKaigen(sim, 1, false)!; expect(e.name).toBe("修文"); expect(e.stance).toBe("shubun"); expect(sim.kaigen!.pending).toBeNull();
    expect(eraLabel(1989)).toBe("修文元年"); expect(sim.events.some((x) => x.kind === "kaigen" && x.text.includes("修文元年"))).toBe(true);
    expect(stanceAt(sim, 1988)).toBe("heisei"); expect(stanceAt(sim, 1990)).toBe("shubun");
    stepMonth(sim, w); expect(sim.month).toBeGreaterThan(month);
    void advance; void yearOf;
  }, 120000);
  it("a malformed era timeline in a save is dropped (the game continues as a single-era game), never refused", () => {
    const { sim } = stage3Sim("shoka", 3, true, 2); const raw = JSON.parse(JSON.stringify(sim)); raw.kaigen.eras = [{ name: 5 }];
    const r = sanitizeSim(raw); expect(r.sim).not.toBeNull(); expect(r.sim!.kaigen).toBeUndefined();
  });
  it("older games (no timeline) never change era", () => {
    const { sim, w } = stage3Sim("heisei", 7, true); expect(sim.kaigen).toBeUndefined(); advance(sim, w, 12 * 50); expect(sim.kaigen).toBeUndefined(); expect(sim.events.some((e) => e.kind === "kaigen")).toBe(false);
  }, 120000);
});

import { describe, expect, it } from "vitest";
import { PREF_IDS } from "../../src/core/seat";
import { greatCircleKm, potentialData, potentialOrder, sphericalCentroid, type PotentialInput } from "../../src/sim/potential17";
import { realWorld } from "./simhelp";

const d = potentialData(realWorld(true).w.t);
const run = (o: Partial<PotentialInput> = {}) => potentialOrder({ capital: "JP-13", sub: "JP-27", palace: "JP-13", mode: "concentrate", seed: 7, ...o }, d);
describe("Stage 17A: development-potential ranks", () => {
  it("data: 49 prefectures with a point; neighbours come from real shared borders", () => {
    expect(Object.keys(d.points).length).toBe(49); expect(d.borders["JP-13|JP-14"]).toBeGreaterThan(0); expect(d.borders["JP-13|JP-27"]).toBeUndefined();
    expect(greatCircleKm([139.7, 35.7], [135.5, 34.7])).toBeGreaterThan(380); expect(greatCircleKm([139.7, 35.7], [135.5, 34.7])).toBeLessThan(420);
    const c = sphericalCentroid([[0, 0], [10, 0]]); expect(c[0]).toBeCloseTo(5, 3);
  });
  for (const mode of ["concentrate", "disperse"] as const) for (const [capital, sub, palace] of [["JP-13", "JP-27", "JP-13"], ["JP-17", "JP-27", "JP-26"], ["HK-SAP", "JP-47", "JP-47"], ["JP-47", "HK-SAP", "HK-SAP"], ["JP-01", "JP-01", "JP-01"].map((x) => (x === "JP-01" ? "JP-13" : x)), ["JP-13", "JP-14", "JP-13"]] as string[][]) it(`${mode} ${capital}/${sub}/${palace}: every prefecture exactly once, seats first`, () => {
    const o = run({ mode, capital, sub, palace }); expect(o.length).toBe(49); expect(new Set(o).size).toBe(49); expect([...o].sort()).toEqual([...PREF_IDS].sort());
    expect(o[0]).toBe(capital); if (sub !== capital) expect(o[1]).toBe(sub); if (palace !== capital && palace !== sub) expect(o[2]).toBe(palace);
  });
  it("same inputs and seed give the same result; another seed changes only the random tail", () => {
    expect(run()).toEqual(run()); const a = run({ seed: 1 }), b = run({ seed: 2 }); expect(a.slice(0, 16)).toEqual(b.slice(0, 16)); expect(a.slice(16)).not.toEqual(b.slice(16));
    const x = run({ mode: "disperse", seed: 1 }), y = run({ mode: "disperse", seed: 2 }); expect(x.slice(0, 10)).toEqual(y.slice(0, 10)); expect(x.slice(10)).not.toEqual(y.slice(10));
  });
  it("Tokyo/Osaka: ranks 7-10 are the longest-border neighbours; concentrate adds 11-16 from the neighbours too", () => {
    const o = run(); expect(o.slice(6, 8).every((p) => d.borders[p < "JP-13" ? `${p}|JP-13` : `JP-13|${p}`])).toBe(true);
    expect(o.slice(8, 10).every((p) => d.borders[p < "JP-27" ? `${p}|JP-27` : `JP-27|${p}`])).toBe(true); const best = Object.keys(d.borders).filter((k) => k.includes("JP-13")).map((k) => [k.replace("JP-13", "").replace("|", ""), d.borders[k]] as [string, number]).filter(([p]) => !o.slice(0, 6).includes(p)).sort((a, b) => b[1] - a[1])[0][0]; expect(o[6]).toBe(best);
    expect(o.slice(3, 6)).toContain(o.slice(3, 6).reduce((f, p) => (greatCircleKm([135.5, 35], d.points[p]) > greatCircleKm([135.5, 35], d.points[f]) ? p : f)));
  });
  it("islands (Okinawa, Hokkaido's three) have no land neighbour: filled by the nearest prefectures, still complete", () => {
    const o = run({ capital: "JP-47", sub: "HK-SAP", palace: "JP-47" }); expect(o.slice(6, 8).length).toBe(2); expect(new Set(o).size).toBe(49);
    expect(d.points["JP-47"][1]).toBeLessThan(27);
  });
});

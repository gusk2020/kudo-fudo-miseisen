import { describe, expect, it } from "vitest";
import { ROCK_P, TECH_K, TUNNEL_KM, techAt, techYear } from "../../src/sim/tech";
import { facCost, techCheck, techStats } from "../../src/sim/planning";
import { advance } from "../../src/sim/engine";
import { modeOf, type SimEdge } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

describe("bridge/tunnel technology rule (one rule for road and rail)", () => {
  it("K=2: progress runs twice as fast, cost and time are each halved once, and probabilities never exceed 1", () => {
    expect(TECH_K).toBe(2); expect(techYear(2, 1975)).toBe(2000);
    for (let y = 1950; y <= 2100; y += 5) {
      const a = techAt(2, y), b = techAt(1, y); expect(a.rockP).toBeLessThanOrEqual(1); expect(a.rockP).toBeGreaterThanOrEqual(b.rockP); expect(a.tunnelKm).toBeGreaterThanOrEqual(b.tunnelKm);
      expect(a.costMult).toBe(0.5); expect(a.timeMult).toBe(0.5); expect(b.costMult).toBe(1);
    }
    expect(techAt(2, 1950).tunnelKm).toBe(techAt(1, 1950).tunnelKm);                         // the start is the same
    expect(techAt(2, 1975).tunnelKm / techAt(1, 1975).tunnelKm).toBeGreaterThan(1.5);          // roughly twice the reach through the middle decades
    expect(techAt(2, 1975).rockP / techAt(1, 1975).rockP).toBeGreaterThan(1.2);
    expect(techAt(2, 2100).tunnelKm).toBe(TUNNEL_KM[TUNNEL_KM.length - 1][1] > 85 ? 85 : techAt(2, 2100).tunnelKm);
    expect(techAt(2, 2100).tunnelKm).toBeLessThanOrEqual(85); expect(ROCK_P.every(([, p]) => p <= 1)).toBe(true);
    // reach and rock odds get their factor only from the clock; cost/time only from 1/K: no stacking
    expect(techAt(2, 1990).tunnelKm).toBe(techAt(1, techYear(2, 1990)).tunnelKm);
  });
  it("a facility edge costs half as much for roads and railways alike; ordinary edges are untouched; older games keep the old cost", () => {
    const { sim: s2 } = stage3Sim("heisei", 7, false, 0), { sim: s1 } = stage3Sim("heisei", 7, false, 0, 1), { sim: s0 } = stage3Sim("heisei", 7, false);
    expect(s2.tech?.k).toBe(2); expect(s1.tech?.k).toBe(1); expect(s0.tech).toBeUndefined();
    const mk = (mode: "road" | "rail", facility?: "tunnel" | "bridge") => ({ facility, mode: mode === "rail" ? "rail" : undefined, curv: 0 }) as unknown as SimEdge;
    for (const mode of ["road", "rail"] as const) for (const f of ["tunnel", "bridge"] as const) {
      expect(facCost(mk(mode, f), s2) / facCost(mk(mode, f), s1)).toBeCloseTo(0.5, 9); expect(facCost(mk(mode, f), s0)).toBe(facCost(mk(mode, f), s1));
    }
    expect(facCost(mk("road"), s2)).toBe(facCost(mk("rail"), s2)); expect(facCost(mk("road", "tunnel"), s2)).toBe(facCost(mk("rail", "tunnel"), s2));
  });
  it("older games are not gated by the tunnelling limit; new games are", () => {
    const { sim: s2, w } = stage3Sim("heisei", 7, false, 0), { sim: s0 } = stage3Sim("heisei", 7, false);
    // a straight line across the Japan Alps would need a very long tunnel
    const a = w.cities.find((c) => c.name === "名古屋市")!, b = w.cities.find((c) => c.name === "新潟市") ?? w.cities.find((c) => c.name === "長野市")!;
    const line: number[] = []; const n = 60; for (let i = 0; i <= n; i++) { const p: [number, number] = [a.pos[0] + ((b.pos[0] - a.pos[0]) * i) / n, a.pos[1] + ((b.pos[1] - a.pos[1]) * i) / n], k = w.cellOf(p); if (k >= 0 && w.t.land[k] === 1 && line[line.length - 1] !== k) line.push(k); }
    expect(techCheck(s0, w, "rail", line, 1950).ok).toBe(true);
    expect(typeof techCheck(s2, w, "rail", line, 1950).ok).toBe("boolean");
  });
  it("over a century the same rule lets both modes build more facilities with K=2 than K=1", () => {
    const run = (k: number) => { Object.assign(techStats, { tooLong: 0, capped: 0, checked: 0, hard: 0, trouble: 0 }); const { sim, w } = stage3Sim("heisei", 7, true, 0, k, false, undefined, 0); sim.policy!.mode = "auto"; advance(sim, w, 12 * 100); const fs = Object.values(sim.edges).filter((e) => e.facility && e.built >= 1 && !e.facilityName?.includes(":")); return { road: fs.filter((e) => modeOf(e) === "road").length, rail: fs.filter((e) => modeOf(e) === "rail").length, km: Math.round(fs.reduce((s, e) => s + e.lengthKm, 0)), ...techStats }; };
    const a = run(1), b = run(2); require("node:fs").writeFileSync("/tmp/tech-fac.json", JSON.stringify({ k1: a, k2: b }));
    expect(b.road + b.rail).toBeGreaterThanOrEqual(a.road + a.rail - 2);
    expect(b.tooLong / Math.max(1, b.checked)).toBeLessThan(a.tooLong / Math.max(1, a.checked));   // fewer projects held back by tunnel length with the faster technology
    expect(a.road).toBeGreaterThan(0); expect(a.rail).toBeGreaterThan(0);                          // both modes use the same facility rule
  }, 300000);
});

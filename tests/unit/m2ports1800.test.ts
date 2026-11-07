import { describe, expect, it } from "vitest";
import { ensureHubs } from "../../src/sim/hubs";
import { stage3Sim } from "./simhelp";

describe("Stage 36: the ports of an 1800 start", () => {
  const g = stage3Sim("heisei", 7, false, 0, 2, true, undefined, undefined, { start1800: true }), { sim, w } = g as any;
  it("there are coastal ports from the first year, none of them has a container berth, and there is no airport", () => {
    const h = ensureHubs(sim, w, sim.startYear)!, ps = Object.values(h.ports);
    expect(ps.length).toBeGreaterThanOrEqual(8); expect(Math.max(...ps.map((p) => p.tier))).toBeLessThanOrEqual(3); expect(Object.keys(h.airports).length).toBe(0);
    for (const p of ps) expect(w.cityById.get(p.city)!.coastal).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { KAIDO_1800 } from "../../src/sim/kaido1800";
import { routeOfficial } from "../../src/sim/engine";
import { checkIntegrity } from "../../src/sim/network";
import { stage3Sim } from "./simhelp";

describe("Stage 36: the main highways and post towns of an 1800 start", () => {
  const g = stage3Sim("heisei", 7, false, 0, 2, true, undefined, undefined, { start1800: true }), { sim } = g;
  it("the highways exist as national routes that carry their old names, and there are post towns on them; no railway and no air route", () => {
    const k = Object.values(sim.routes).filter((r) => r.kaido); expect(k.length).toBeGreaterThanOrEqual(4); expect(new Set(k.map((r) => r.kaido)).size).toBe(k.length);
    for (const r of k) { expect(KAIDO_1800.map((x) => x.name)).toContain(r.kaido); expect(r.grade).toBe("national"); expect(routeOfficial(r)).toMatch(new RegExp(`^${r.kaido}\\(国道\\d+号\\)$`)); expect(r.edges.length).toBeGreaterThan(3); }
    const posts = Object.values(sim.settlements).filter((s) => s.post); expect(posts.length).toBeGreaterThan(10); for (const s of posts) expect(s.name).toMatch(/宿$/); expect(new Set(posts.map((s) => s.name)).size).toBe(posts.length);
    expect(Object.values(sim.edges).some((e) => e.mode === "rail")).toBe(false); expect(Object.keys(sim.hubs?.airports ?? {}).length).toBe(0);
    expect(sim.events.some((e) => e.kind === "seed" && /主要街道/.test(e.text))).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
  });
  it("a 1950 game has no highways of this kind and keeps its numbered routes", () => {
    const b = stage3Sim("heisei", 7, false, 0, 2, true).sim; expect(Object.values(b.routes).some((r) => r.kaido)).toBe(false); expect(Object.values(b.settlements).some((s) => s.post)).toBe(false);
  });
});

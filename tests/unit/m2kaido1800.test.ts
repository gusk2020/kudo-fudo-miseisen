import { describe, expect, it } from "vitest";
import { KAIDO_1800 } from "../../src/sim/kaido1800";
import { advance, routeOfficial } from "../../src/sim/engine";
import { checkIntegrity, repairRouteChains } from "../../src/sim/network";
import { exportGame, makeSave, mapStateHash, parseSave } from "../../src/core/save2";
import { defaultState } from "../../src/core/state";
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
  it("Stage 37 (A1): every route chain is connected right after seeding, for several seeds (a later leg splitting an earlier leg's edge used to break it)", () => {
    for (const seed of [7, 11, 23, 31, 42, 59]) { const s = stage3Sim("heisei", seed, false, 0, 2, true, undefined, undefined, { start1800: true }).sim; expect(checkIntegrity(s), `seed ${seed}`).toEqual([]); }
  });
  it("Stage 37 (A1): a save that carries a stale route chain is repaired in memory on load (and reported), never reported as a plain success", () => {
    const g = stage3Sim("heisei", 23, false, 0, 2, true, undefined, undefined, { start1800: true }), s = JSON.parse(JSON.stringify(g.sim)); const r = Object.values(s.routes).find((x: any) => x.kaido && x.edges.length > 6) as any;
    r.edges.splice(3, 1);   // an edge goes missing from the middle of the chain
    expect(checkIntegrity(s).length).toBeGreaterThan(0);
    const n = repairRouteChains(s); expect(n).toBeGreaterThan(0); expect(checkIntegrity(s)).toEqual([]); expect(s.routes[r.id].edges.length).toBe(3);
  });
  it("Stage 37 (A1): a game that has run for decades survives save -> export -> parse with nothing quarantined and no repair needed", () => {
    for (const seed of [11, 23]) {
      const g = stage3Sim("heisei", seed, false, 0, 2, true, undefined, undefined, { start1800: true }), m = defaultState(); m.finalized = true; m.step = 5; g.sim.mapHash = mapStateHash(m);
      advance(g.sim, g.w, 12 * 60); const p = parseSave(exportGame(makeSave(m, g.sim)));
      expect(p.quarantine, `seed ${seed}`).toBeNull(); expect(p.sim).not.toBeNull(); expect(p.problems).toEqual([]);
    }
  });
});

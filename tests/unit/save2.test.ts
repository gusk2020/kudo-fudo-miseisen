import { describe, expect, test } from "vitest";
import { exportJson } from "../../src/core/save";
import { exportGame, makeSave, mapStateHash, parseSave, sanitizeSim, validateSimAgainstWorld } from "../../src/core/save2";
import { Store, clone, defaultState } from "../../src/core/state";
import { startedSim } from "./simhelp";

const finalized = () => { const s = defaultState(); s.finalized = true; s.step = 5; return s; };
describe("map lock", () => {
  test("a finalised map refuses edits and undo until explicitly unlocked", () => {
    const st = new Store(finalized()); let blocked = 0; st.onBlocked = () => blocked++;
    expect(st.commit((s) => s.bodies.honshu.ops.push({ t: "bulge", c: [0, 0], r: 50, k: 0.1 }))).toBe(false);
    expect(st.state.bodies.honshu.ops).toHaveLength(0); expect(st.undo()).toBe(false); expect(blocked).toBe(2); expect(st.locked).toBe(true);
    st.set((s) => { s.step = 2; s.layers.coast = false; });   // viewing and view prefs stay free
    expect(st.state.step).toBe(2); st.unlock(); expect(st.commit((s) => { s.seed = 5; })).toBe(true); expect(st.state.seed).toBe(5);
  });
  test("map hash changes with any map edit and ignores view prefs", () => {
    const a = defaultState(), h = mapStateHash(a); const b = clone(a); b.step = 4; b.layers.coast = false; expect(mapStateHash(b)).toBe(h);
    b.bodies.kyushu.place.rot = 0.1; expect(mapStateHash(b)).not.toBe(h); const c = clone(a); c.ridges.sw = [[0, 0], [1, 1]]; expect(mapStateHash(c)).not.toBe(h);
  });
});
describe("v1 -> v2 migration", () => {
  test("a v1 export and a bare v1 state load intact as v2 without road data", () => {
    const m = defaultState(); m.bodies.honshu.ops.push({ t: "pull", c: [1, 2], d: [3, 4], r: 100 }); m.finalized = true; m.step = 5;
    for (const raw of [exportJson(m), JSON.stringify(m), JSON.parse(exportJson(m))]) {
      const p = parseSave(raw); expect(p.ok).toBe(true); expect(p.migratedFrom).toBe(1); expect(p.sim).toBeNull(); expect(p.map.bodies.honshu.ops).toEqual(m.bodies.honshu.ops); expect(p.map.finalized).toBe(true); expect(p.map.step).toBe(5);
    }
  });
  test("v2 round trip keeps map and sim", () => {
    const { sim } = startedSim(1), m = finalized(); sim.mapHash = mapStateHash(m);
    const p = parseSave(exportGame(makeSave(m, sim))); expect(p.migratedFrom).toBe(2); expect(p.sim).not.toBeNull(); expect(p.sim!.edges).toEqual(sim.edges); expect(p.quarantine).toBeNull();
  });
  test("garbage never throws", () => { for (const b of [null, 1, "{", "[]", { schemaVersion: 2 }, { schemaVersion: 2, map: 5 }, { schemaVersion: 2, map: {}, sim: 7 }]) expect(() => parseSave(b as any)).not.toThrow(); });
});
describe("road data protection", () => {
  test("a road save whose map does not match is quarantined, not applied", () => {
    const { sim } = startedSim(1), m = finalized(); sim.mapHash = mapStateHash(m);
    const save = JSON.parse(exportGame(makeSave(m, sim))); save.map.bodies.honshu.place.rot = 0.3;   // map edited behind the roads' back
    const p = parseSave(save); expect(p.sim).toBeNull(); expect(p.quarantine).not.toBeNull(); expect(p.problems.join()).toContain("一致しない");
    expect((p.quarantine as any).edges).toEqual(JSON.parse(JSON.stringify(sim.edges)));   // preserved, not destroyed
  });
  test("roads on a map that is not finalised are quarantined", () => {
    const { sim } = startedSim(1), m = defaultState(); sim.mapHash = mapStateHash(m); expect(parseSave(exportGame(makeSave(m, sim))).sim).toBeNull();
  });
  test("corrupt road data is quarantined while the map still loads", () => {
    const { sim } = startedSim(1), m = finalized(); sim.mapHash = mapStateHash(m); const s = JSON.parse(exportGame(makeSave(m, sim))); Object.values<any>(s.sim.edges)[0].cells = "bad";
    const p = parseSave(s); expect(p.sim).toBeNull(); expect(p.quarantine).not.toBeNull(); expect(p.map.finalized).toBe(true);
  });
  test("terrain mismatch and out-of-land cells are detected against the world", () => {
    const { sim, w } = startedSim(1); expect(validateSimAgainstWorld(sim, w, sim.terrainHash)).toBeNull();
    expect(validateSimAgainstWorld(sim, w, "other")).toContain("地形"); const j = JSON.parse(JSON.stringify(sim)); const e = Object.values<any>(j.edges)[0]; e.cells[1] = 0;
    expect(validateSimAgainstWorld(sanitizeSim(j).sim ?? j, w, sim.terrainHash)).toContain("地形の外");
  });
});

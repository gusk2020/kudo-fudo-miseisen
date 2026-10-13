import { describe, expect, test } from "vitest";
import { JAPAN } from "../../src/core/data";
import { axisFrame } from "../../src/core/constraints";
import { defaultState } from "../../src/core/state";
import { suggestRidge } from "../../src/core/suggest";
import { generateTerrain } from "../../src/core/terrain";
import type { ProjectState } from "../../src/core/types";
import { derive } from "../../src/core/validate";
import { loadDem } from "./helpers";

const dem = loadDem();
function ready(): ProjectState {
  const s = defaultState(), d = derive(s), f = axisFrame(d.parts.honshu[0], [Math.SQRT1_2, Math.SQRT1_2]);
  s.ridges.sw = suggestRidge(d.parts.honshu[0], f, "sw"); s.ridges.ne = suggestRidge(d.parts.honshu[0], f, "ne"); return s;
}
describe("terrain generation", () => {
  const s = ready(), t = generateTerrain(s, dem);
  test("same seed and edits give the identical result; another seed differs", () => {
    expect(generateTerrain(ready(), dem).hash).toBe(t.hash);
    const o = ready(); o.seed = 7; expect(generateTerrain(o, dem).hash).not.toBe(t.hash);
  });
  test("elevation is real-ish: Fuji summit 3776 m, mountains high, coast low", () => {
    expect(t.stats.maxElevM).toBe(3776); expect(t.stats.fujiTopCell).toBeGreaterThan(0);
    let landMax = 0, seaPositive = 0; for (let k = 0; k < t.land.length; k++) { if (t.land[k] === 0 && t.elev[k] >= 0) seaPositive++; if (t.land[k] === 1) landMax = Math.max(landMax, t.elev[k]); }
    expect(seaPositive).toBe(0); expect(landMax).toBeGreaterThan(2500);
  });
  test("49 prefectures all present, every land cell assigned (up to a few orphans)", () => {
    expect(t.stats.prefCount).toBe(49);
    const seen = new Set<number>(); let orphan = 0; for (let k = 0; k < t.land.length; k++) if (t.land[k]) { if (t.pref[k]) seen.add(t.pref[k]); else orphan++; }
    expect(seen.size).toBe(49); expect(orphan).toBeLessThan(20);
    expect(t.prefOrder).toEqual(JAPAN.prefectures.map((p) => p.id));
  });
  test("prefectures never span two islands", () => {
    const isl = new Map<number, number>(); for (let k = 0; k < t.land.length; k++) if (t.land[k] && t.pref[k]) { const prev = isl.get(t.pref[k]); if (prev && prev !== t.island[k]) throw new Error("pref spans islands"); isl.set(t.pref[k], t.island[k]); }
  });
  test("rivers reach the sea and do not climb in any significant way", () => {
    const { nx, x0, y0, cell } = t.grid; expect(t.rivers.length).toBeGreaterThan(8);
    let worst = 0;
    for (const r of t.rivers) {
      const el = r.path.map((p) => t.elev[Math.floor((p[1] - y0) / cell) * nx + Math.floor((p[0] - x0) / cell)]);
      for (let i = 1; i < el.length; i++) worst = Math.max(worst, el[i] - el[i - 1]);
      const m = r.mouth, k = Math.floor((m[1] - y0) / cell) * nx + Math.floor((m[0] - x0) / cell), i = k % nx, j = (k / nx) | 0;
      let coastal = false; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (t.land[(j + b) * nx + i + a] === 0) coastal = true;
      expect(coastal).toBe(true);
    }
    expect(worst).toBeLessThanOrEqual(1);   // carved: monotone downstream (lake flats excepted)
  });
  test("Lake Biwa exists on the grid and cities follow the island (few corrections)", () => {
    expect(t.stats.lakeCells).toBeGreaterThan(10); expect(t.cities.length).toBeGreaterThanOrEqual(49); expect(t.stats.citiesMoved).toBeLessThan(10);
    for (const c of t.cities) expect(Number.isFinite(c.pos[0] + c.pos[1])).toBe(true);
  });
  test("a deformed Honshu still generates a coherent map", () => {
    const d = ready(); d.bodies.honshu.ops.push({ t: "pull", c: [0, 0], d: [50, 40], r: 180 }, { t: "bulge", c: [150, 100], r: 120, k: -0.3 }); d.bodies.honshu.place.rot = 0.2;
    const r = generateTerrain(d, dem); expect(r.stats.landCells).toBeGreaterThan(8000); expect(r.stats.prefCount).toBe(49);
  });
}, 120000);

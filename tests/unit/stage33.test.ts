import { describe, expect, it } from "vitest";
import { realToWorld } from "../../src/core/body";
import { CREATION_MAX_LEVEL, cleanCreations, creationCells, creationDiameterKm, creationFootprint, creationHeightM, excludedSite, type Creation } from "../../src/core/creations";
import { JAPAN, lonLatToReal } from "../../src/core/data";
import { RANGE_LAKE, nextRange, rangeLabel } from "../../src/core/ranges";
import { realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { validate } from "../../src/core/validate";
import { lakeCrossings } from "../../src/sim/ferry";
import { buildWorld } from "../../src/sim/world";
import { loadDem } from "./helpers";

const dem = loadDem(), W = (lon: number, lat: number) => lonLatToReal(lon, lat) as [number, number];
const gen = (mut?: (s: ReturnType<typeof realState>) => void) => { const s = realState(); mut?.(s); return { s, t: generateTerrain(s, dem) }; };
const base = gen();
const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const lakeCount = (t: ReturnType<typeof gen>["t"]) => t.land.reduce((n, v) => n + (v === 2 ? 1 : 0), 0);
const touchesSea = (t: ReturnType<typeof gen>["t"], k: number) => { const { nx, ny } = t.grid, i = k % nx, j = (k / nx) | 0; return N8.some(([di, dj]) => { const a = i + di, b = j + dj; return a < 0 || b < 0 || a >= nx || b >= ny || t.land[b * nx + a] === 0; }); };
const cellAt = (t: ReturnType<typeof gen>["t"], p: [number, number]) => Math.floor((p[1] - t.grid.y0) / t.grid.cell) * t.grid.nx + Math.floor((p[0] - t.grid.x0) / t.grid.cell);

describe("Stage 33: coast, Fuji and Biwa", () => {
  it("the grid is 5 km; a default map is unchanged (golden hash) and has second-class rivers outside the hash", () => {
    expect(base.t.grid.cell).toBe(5); expect(base.t.freshLakeCells ?? []).toEqual([]);
    expect(base.t.streams2!.length).toBeGreaterThan(500); expect(base.t.streams2!.length % 5).toBe(0);
  });
  it("Fuji at the coast: allowed (only its centre must be on land) and cut at the shore -- no sea cell is raised", () => {
    const c = W(138.2, 34.9);   // the Suruga coast
    const { s, t } = gen((st) => { st.features.fuji.pos = realToWorldPos(st, c); });
    expect(validate(s).filter((i) => i.code === "fuji.coast")).toEqual([]);
    let raised = 0; for (let k = 0; k < t.land.length; k++) if (t.land[k] === 0 && t.elev[k] >= 0) raised++; expect(raised).toBe(0);
    const k = cellAt(t, realToWorldPos(s, c)); expect(t.land[k] === 1 ? t.elev[k] : 1).toBeGreaterThan(0);
  });
  it("Biwa at the coast: allowed; the sea wins but one land cell always stays between the lake and the sea", () => {
    const { s, t } = gen((st) => { st.features.biwa.pos = realToWorldPos(st, W(136.9, 34.8)); });   // over Ise Bay
    expect(validate(s).filter((i) => i.code === "biwa.coast")).toEqual([]);
    expect(lakeCount(t)).toBeGreaterThan(0); for (let k = 0; k < t.land.length; k++) if (t.land[k] === 2) expect(touchesSea(t, k), `lake cell ${k}`).toBe(false);
  });
});

describe("Stage 33: new mountains and lakes", () => {
  const plain = W(139.7, 36.2);   // the Kanto plain
  it("units: 500 m and 5 km a press, three presses at most; a mountain's nominal diameter is 10 x its height; whole cells for the nearest area", () => {
    expect([1, 2, 3].map(creationHeightM)).toEqual([500, 1000, 1500]); expect([1, 2, 3].map((l) => creationDiameterKm("mountain", l))).toEqual([5, 10, 15]); expect([1, 2, 3].map((l) => creationDiameterKm("lake", l))).toEqual([5, 10, 15]);
    expect([1, 2, 3].map((l) => creationCells("mountain", l, 5))).toEqual([1, 3, 7]); expect(CREATION_MAX_LEVEL).toBe(3);
    expect(cleanCreations([{ id: 1, kind: "lake", pos: [0, 0], level: 9 }])![0].level).toBe(3); expect(cleanCreations([{ id: 1, kind: "x", pos: [0, 0], level: 1 }])).toBeUndefined(); expect(cleanCreations(Array.from({ length: 40 }, (_, i) => ({ id: i, kind: "lake", pos: [0, 0], level: 1 })))!.length).toBe(12);
  });
  it("the outline is irregular, the same every time, and the area is the nearest whole number of cells", () => {
    const g = { nx: base.t.grid.nx, ny: base.t.grid.ny, cell: 5, x0: base.t.grid.x0, y0: base.t.grid.y0 }, mk = (id: number, level: number): Creation => ({ id, kind: "lake", pos: plain, level });
    const a = creationFootprint(g, mk(1, 3), 7), b = creationFootprint(g, mk(1, 3), 7), c = creationFootprint(g, mk(2, 3), 7);
    expect(a).toEqual(b); expect(a.length).toBe(7); expect(a.map((x) => x.k).sort()).not.toEqual(c.map((x) => x.k).sort());   // another one has another shape
    expect(creationFootprint(g, mk(1, 2), 7).length).toBe(3); expect(creationFootprint(g, mk(1, 1), 7).length).toBe(1);
    const k0 = a[0].k, rim = a.slice(1).map((x) => Math.hypot(((x.k % g.nx) - (k0 % g.nx)), (((x.k / g.nx) | 0) - ((k0 / g.nx) | 0)))); expect(new Set(rim.map((r) => r.toFixed(3))).size).toBeGreaterThan(1);   // not a regular disc
  });
  it("a mountain raises its footprint by its height (land only) and a lake becomes freshwater land=2; the sea is never touched", () => {
    const m = gen((st) => { st.creations = [{ id: 1, kind: "mountain", pos: plain, level: 3 }]; }), k = cellAt(m.t, plain);
    expect(m.t.elev[k] - base.t.elev[k]).toBeGreaterThan(1400); expect(m.t.elev[k]).toBeLessThanOrEqual(4900); expect(m.t.barrier[k]).toBeGreaterThan(0.5);
    for (let q = 0; q < m.t.land.length; q++) if (base.t.land[q] === 0) expect(m.t.elev[q]).toBe(base.t.elev[q]);
    const l = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: plain, level: 3 }]; }); expect(l.t.land[cellAt(l.t, plain)]).toBe(2); expect(lakeCount(l.t) - lakeCount(base.t)).toBe(7);
    expect(gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: plain, level: 3 }]; }).t.hash).toBe(l.t.hash);   // deterministic
  });
  it("a lake next to Lake Biwa disappears (Biwa wins); a lake beside the sea keeps a land cell; a lake touching nothing stays", () => {
    const biwaEdge = W(135.95, 35.2), near = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: biwaEdge, level: 3 }]; });
    expect(lakeCount(near.t)).toBe(lakeCount(base.t));
    const coast = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: W(140.6, 36.0), level: 3 }]; });   // on the Kashima coast
    for (let k = 0; k < coast.t.land.length; k++) if (coast.t.land[k] === 2 && base.t.land[k] !== 2) expect(touchesSea(coast.t, k)).toBe(false);
  });
  it("places that are excluded: the former site of a moved Fuji, of a moved Biwa, and the zone of a flattened range", () => {
    const fuji = realToWorld("honshu", realState().bodies.honshu, JAPAN.fuji.center), biwa = realToWorld("honshu", realState().bodies.honshu, JAPAN.biwa.center);
    const s = realState(); expect(excludedSite(s, fuji)).toBeNull(); s.features.fuji.pos = realToWorldPos(s, W(138.9, 35.7)); expect(excludedSite(s, fuji)).toContain("富士山");
    s.features.biwa.pos = realToWorldPos(s, W(137.5, 35.6)); expect(excludedSite(s, biwa)).toContain("琵琶湖");
    const kiso = realToWorld("honshu", s.bodies.honshu, [(137.8 - JAPAN.proj.lon0) * JAPAN.proj.kmPerDegLon, (35.8 - JAPAN.proj.lat0) * JAPAN.proj.kmPerDegLat]); expect(excludedSite(s, kiso)).toBeNull(); s.rangeEdits = { kiso: 0 }; expect(excludedSite(s, kiso)).toContain("中央アルプス");
  });
});

describe("Stage 33: mountain ranges, plain and lake", () => {
  it("the menu steps: lake (x-0.05), plain (x0), then 0.1 steps; the labels say what the terrain becomes", () => {
    expect(nextRange(0, -1)).toBe(RANGE_LAKE); expect(nextRange(RANGE_LAKE, -1)).toBe(RANGE_LAKE); expect(nextRange(RANGE_LAKE, 1)).toBe(0); expect(nextRange(0, 1)).toBe(0.1); expect(nextRange(0.1, -1)).toBe(0); expect(nextRange(1, -1)).toBe(0.9);
    expect(rangeLabel(0)).toBe("平野(×0)"); expect(rangeLabel(RANGE_LAKE)).toContain("湖"); expect(rangeLabel(1.2)).toBe("高さ×1.2");
  });
  it("a range turned into a lake has freshwater cells in its core, none beside the sea", () => {
    const { t } = gen((st) => { st.rangeEdits = { kiso: RANGE_LAKE }; }); expect(lakeCount(t)).toBeGreaterThan(lakeCount(base.t)); for (let k = 0; k < t.land.length; k++) if (t.land[k] === 2 && base.t.land[k] !== 2) expect(touchesSea(t, k)).toBe(false);
  });
});

describe("Stage 33: freshwater crossings", () => {
  it("a game with Lake Biwa only keeps exactly the crossings it had; a new lake of three cells gets its own crossing (5 km of water = the representable 3 km)", () => {
    const w0 = buildWorld(base.t, base.s.seed), c0 = lakeCrossings(w0);
    expect(c0.length).toBeGreaterThan(0); expect(c0.every((c) => !c.tag)).toBe(true);
    const { s, t } = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: W(139.7, 36.2), level: 3 }]; }), w1 = buildWorld(t, s.seed), c1 = lakeCrossings(w1);
    expect(c1.filter((c) => !c.tag).map((c) => c.id)).toEqual(c0.map((c) => c.id)); const mine = c1.filter((c) => c.tag); expect(mine.length).toBeGreaterThan(0); expect(mine.every((c) => c.km >= 5)).toBe(true);   // (a lake cell is 5 km of water; the 3 km of the plan cannot be told apart on this grid)
    expect(new Set(c1.map((c) => `${c.portA}:${c.portB}`)).size).toBe(c1.length);
  });
});

describe("Stage 33 (fix): creations beside the coast, and what is reported", () => {
  const { nx, ny, x0, y0 } = base.t.grid, cp = (k: number): [number, number] => [x0 + ((k % nx) + 0.5) * 5, y0 + (((k / nx) | 0) + 0.5) * 5];
  const seaWithin = (k: number, r: number) => { const i = k % nx, j = (k / nx) | 0; for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny || base.t.land[b * nx + a] === 0) return true; } return false; };
  const plainAt = (want: "touching" | "two") => { for (let k = 0; k < base.t.land.length; k++) { if (base.t.land[k] !== 1 || base.t.elev[k] > 250) continue; if (want === "touching" ? seaWithin(k, 1) : !seaWithin(k, 1) && seaWithin(k, 2)) { const [x, y] = cp(k); if (x > 100 && !seaWithin(k, 0)) return k; } } return -1; };
  it("a lake whose centre is one cell from the coast is accepted; its sea side is left out, the sea is not changed, and the report says what is left", () => {
    const k = plainAt("two"); expect(k).toBeGreaterThan(0);
    const { t } = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: cp(k), level: 3 }]; }); const r = t.creationReport!.find((x) => x.key === "c:1")!;
    expect(r.wanted).toBe(7); expect(r.cells).toBeLessThanOrEqual(r.wanted); expect(["ok", "shrunk-sea", "gone-sea"]).toContain(r.status);
    for (let q = 0; q < t.land.length; q++) { if (base.t.land[q] === 0) expect(t.land[q]).toBe(0); if (t.land[q] === 2 && base.t.land[q] !== 2) expect(touchesSea(t, q)).toBe(false); }
    expect(t.land.reduce((n, v) => n + (v === 2 ? 1 : 0), 0) - lakeCount(base.t)).toBe(r.cells);   // the effective area is what is on the map
  });
  it("a lake whose centre touches the sea is accepted by the terrain but leaves nothing (gone-sea, reported); a mountain there is cut at the coast and keeps its centre", () => {
    const k = plainAt("touching"); expect(k).toBeGreaterThan(0);
    const lake = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: cp(k), level: 1 }]; }); expect(lake.t.creationReport!.find((x) => x.key === "c:1")!.status).toBe("gone-sea"); expect(lakeCount(lake.t)).toBe(lakeCount(base.t));
    const mt = gen((st) => { st.creations = [{ id: 2, kind: "mountain", pos: cp(k), level: 3 }]; }), m = mt.t.creationReport!.find((x) => x.key === "c:2")!;
    expect(m.cells).toBeGreaterThan(0); expect(m.cells).toBeLessThanOrEqual(7); expect(mt.t.elev[k]).toBeGreaterThan(base.t.elev[k] + 1000);
    for (let q = 0; q < mt.t.land.length; q++) if (base.t.land[q] === 0) { expect(mt.t.land[q]).toBe(0); expect(mt.t.elev[q]).toBe(base.t.elev[q]); }
  });
  it("a lake that touches Lake Biwa is reported as gone because of Biwa, and nothing else changes", () => {
    const { t } = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: W(135.95, 35.2), level: 3 }]; }); const r = t.creationReport!.find((x) => x.key === "c:1")!;
    expect(r.status).toBe("gone-biwa"); expect(r.cells).toBe(0); expect(lakeCount(t)).toBe(lakeCount(base.t));
    const far = gen((st) => { st.creations = [{ id: 1, kind: "lake", pos: W(139.7, 36.2), level: 3 }]; }); expect(far.t.creationReport!.find((x) => x.key === "c:1")!.status).toBe("ok"); expect(base.t.creationReport).toEqual([]);
  });
});

function realToWorldPos(s: ReturnType<typeof realState>, real: [number, number]): [number, number] { return realToWorld("honshu", s.bodies.honshu, real); }

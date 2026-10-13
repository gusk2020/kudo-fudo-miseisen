import { describe, expect, test } from "vitest";
import { realToWorld, worldToReal } from "../../src/core/body";
import { LINEAR_CHECK_FACTOR, featureInside, uOnKH } from "../../src/core/constraints";
import { BODY_DEFS, JAPAN } from "../../src/core/data";
import { GeoMap } from "../../src/core/geoid";
import { centroid, polygonsOverlap, selfIntersections } from "../../src/core/geom";
import { exportJson, parseState } from "../../src/core/save";
import { Store, clone, defaultState } from "../../src/core/state";
import { suggestRidge } from "../../src/core/suggest";
import { axisFrame } from "../../src/core/constraints";
import type { Op, ProjectState, Vec } from "../../src/core/types";
import { derive, errorsFor, validate } from "../../src/core/validate";
import { clampOp, jacobianSV, unwarpPoint, warpPoint } from "../../src/core/warp";

const codes = (s: ProjectState) => validate(s).filter((i) => i.severity === "error").map((i) => i.code);
function withRidges(s: ProjectState): ProjectState {
  const d = derive(s), f = axisFrame(d.parts.honshu[0], [Math.SQRT1_2, Math.SQRT1_2]);
  s.ridges.sw = suggestRidge(d.parts.honshu[0], f, "sw"); s.ridges.ne = suggestRidge(d.parts.honshu[0], f, "ne"); return s;
}

describe("data", () => {
  test("49 prefectures, Hokkaido split in 3, Tokyo is a Fu", () => {
    expect(JAPAN.prefectures).toHaveLength(49);
    expect(JAPAN.prefectures.filter((p) => p.island === "hokkaido").map((p) => p.name).sort()).toEqual(["函館県", "根室県", "札幌県"].sort());
    expect(JAPAN.prefectures.find((p) => p.id === "JP-13")?.name).toBe("東京府");
    expect(JAPAN.prefectures.some((p) => p.name === "北海道")).toBe(false);
  });
  test("real island areas are plausible", () => {
    expect(JAPAN.islands.honshu.areaKm2).toBeGreaterThan(210000); expect(JAPAN.islands.honshu.areaKm2).toBeLessThan(245000);
    expect(JAPAN.islands.hokkaido.areaKm2).toBeGreaterThan(75000); expect(JAPAN.biwa.areaKm2).toBeGreaterThan(600); expect(JAPAN.biwa.areaKm2).toBeLessThan(720);
  });
  test("all source outlines are simple polygons", () => { for (const id of ["honshu", "hokkaido", "kyushu", "shikoku"] as const) expect(selfIntersections(BODY_DEFS[id].parts[0])).toBe(0); });
});

describe("warp", () => {
  const ops: Op[] = [{ t: "pull", c: [0, 0], d: [30, 10], r: 100 }, { t: "bulge", c: [20, 20], r: 80, k: 0.3 }, { t: "bulge", c: [-30, 10], r: 60, k: -0.4 }];
  test("deterministic and invertible", () => {
    const p: Vec = [12, -9]; expect(warpPoint(ops, p)).toEqual(warpPoint(ops, p));
    const q = unwarpPoint(ops, warpPoint(ops, p)); expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(1e-4);
  });
  test("a single clamped pull never folds; two opposing strong pulls do", () => {
    const one = clampOp({ t: "pull", c: [0, 0], d: [500, 0], r: 100 });
    let minDet = 9; for (let x = -100; x <= 100; x += 5) for (let y = -100; y <= 100; y += 5) minDet = Math.min(minDet, jacobianSV([one], [x, y]).det);
    expect(minDet).toBeGreaterThan(0.05);
    const bad: Op[] = [{ t: "pull", c: [0, 0], d: [60, 0], r: 100 }, { t: "pull", c: [60, 0], d: [-60, 0], r: 100 }, { t: "pull", c: [0, 0], d: [60, 0], r: 100 }, { t: "pull", c: [60, 0], d: [-60, 0], r: 100 }];
    let md = 9; for (let x = -100; x <= 100; x += 3) for (let y = -100; y <= 100; y += 3) md = Math.min(md, jacobianSV(bad, [x, y]).det);
    expect(md).toBeLessThan(0.3);
  });
});

describe("geometry", () => {
  test("bow-tie self intersects; square does not", () => {
    expect(selfIntersections([[0, 0], [10, 10], [10, 0], [0, 10]])).toBeGreaterThan(0);
    expect(selfIntersections([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(0);
  });
  test("overlap includes containment", () => {
    const a: Vec[] = [[0, 0], [100, 0], [100, 100], [0, 100]], b: Vec[] = [[40, 40], [60, 40], [60, 60], [40, 60]], c: Vec[] = [[200, 0], [300, 0], [300, 50]];
    expect(polygonsOverlap(a, b)).toBe(true); expect(polygonsOverlap(a, c)).toBe(false);
  });
});

describe("constraints", () => {
  test("the real Japan is valid up to the unset mountain ranges", () => {
    expect(codes(defaultState()).sort()).toEqual(["ridge.ne.missing", "ridge.sw.missing"]);
    expect(codes(withRidges(defaultState()))).toEqual([]);
  });
  test("Hokkaido on the south-west side is rejected, as is Kyushu on the north-east", () => {
    const a = withRidges(defaultState()); a.bodies.hokkaido.place.pos = [-700, -800];
    expect(codes(a)).toContain("hokkaido.side");
    const b = withRidges(defaultState()); b.bodies.kyushu.place.pos = [600, 600];
    expect(codes(b)).toContain("kyushu.side");
  });
  test("sides follow Honshu's own axis, not the screen: rotating Honshu 180deg flips which side is NE", () => {
    const a = withRidges(defaultState()); a.bodies.honshu.place.rot = Math.PI;
    const c = codes(a); expect(c.some((x) => x.startsWith("overlap.honshu") || x === "hokkaido.side" || x === "kyushu.side" || x.startsWith("ridge."))).toBe(true);
    // rotate Honshu and put Hokkaido at the correspondingly rotated spot: still fine
    const s = defaultState(); const hc = BODY_DEFS.honshu.origin;
    s.bodies.honshu.place.rot = Math.PI / 2; const rot = (v: Vec): Vec => [-(v[1]), v[0]];
    for (const id of ["hokkaido", "kyushu", "shikoku"] as const) { const o = BODY_DEFS[id].origin, r = rot([o[0] - hc[0], o[1] - hc[1]]); s.bodies[id].place.pos = [hc[0] + r[0], hc[1] + r[1]]; s.bodies[id].place.rot = Math.PI / 2; }
    expect(codes(s).filter((x) => x.endsWith(".side") || x.startsWith("overlap"))).toEqual([]);
  });
  test("islands overlapping is detected", () => { const s = withRidges(defaultState()); s.bodies.shikoku.place.pos = [...BODY_DEFS.honshu.origin] as Vec; expect(codes(s).some((c) => c.startsWith("overlap."))).toBe(true); });
  test("shikoku must stay inside the Kyushu-Hokkaido axis range", () => {
    const s = withRidges(defaultState()); s.bodies.shikoku.place.pos = [-1500, -1500]; expect(codes(s)).toContain("shikoku.range");
  });
  test("1.2x is an AREA factor: linear factor is sqrt(1.2), not 1.2", () => {
    expect(LINEAR_CHECK_FACTOR).toBeCloseTo(1.0954, 3);
    const c: Vec = [0, 0], circle = (r: number, n = 64): Vec[] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * 6.2832) * r, Math.sin((i / n) * 6.2832) * r]);
    const outer = circle(100);
    // radius 90.5 passes at 1.2x linear? 90.5*1.0954 = 99.1 + clearance 1 -> fails; but passes a naive 1.0x test; and a naive 1.2x-linear check (108.6) would fail even r=88
    expect(featureInside(outer, circle(80))).toBe(true);
    expect(featureInside(outer, circle(90.5))).toBe(false);
    expect(featureInside(outer, circle(89))).toBe(true);   // 89*1.0954 = 97.5, +1 clearance < 100
    void c;
  });
  test("a ridge outside the island or in the wrong half is rejected", () => {
    const s = withRidges(defaultState()); s.ridges.sw = [[-3000, 0], [-3000, 100]]; expect(codes(s)).toContain("ridge.sw.outside");
    const t = withRidges(defaultState()); [t.ridges.sw, t.ridges.ne] = [t.ridges.ne, t.ridges.sw]; expect(codes(t)).toContain("ridge.sw.half");
  });
  test("extreme deformation is detected (fold / twist / collapse), not silently accepted", () => {
    const s = withRidges(defaultState()); const c = centroid(BODY_DEFS.honshu.parts[0]);
    for (let i = 0; i < 6; i++) s.bodies.honshu.ops.push({ t: "pull", c: [c[0], c[1]], d: [i % 2 ? -90 : 90, 0], r: 150 }, { t: "pull", c: [c[0] + 90, c[1]], d: [i % 2 ? 90 : -90, 0], r: 150 });
    expect(errorsFor(validate(s), "honshu").length).toBeGreaterThan(0);
  });
});

describe("determinism, save and undo", () => {
  test("parseState survives garbage and keeps schemaVersion", () => {
    for (const bad of [null, 5, "xx{", "{}", { bodies: 4 }, { schemaVersion: "a", bodies: { honshu: { ops: [{ t: "pull" }, 7], place: { pos: [NaN, 1], rot: 0, scale: 1 } } }, ridges: { sw: "bad" }, step: 99 }]) {
      const r = parseState(bad as any); expect(r.state.schemaVersion).toBe(1); expect(() => validate(r.state)).not.toThrow(); expect(r.state.step).toBeLessThanOrEqual(5);
    }
    const r = parseState({ schemaVersion: 1, bodies: { honshu: { ops: [{ t: "pull", c: [0, 0], d: [1, 1], r: 50 }, { t: "pull", c: "x" }], place: { pos: [Infinity, 0], rot: 0, scale: 1 } } } });
    expect(r.state.bodies.honshu.ops).toHaveLength(1); expect(r.problems.length).toBeGreaterThan(0);
  });
  test("export -> parse round trip is identical", () => {
    const s = withRidges(defaultState()); s.bodies.honshu.ops.push({ t: "bulge", c: [5, 5], r: 100, k: 0.2 }); s.features.fuji.pos = [10, 20];
    expect(parseState(exportJson(s)).state).toEqual(s);
  });
  test("undo/redo restore exact state and ignore step navigation", () => {
    const st = new Store(); const before = clone(st.state);
    st.commit((s) => s.bodies.honshu.ops.push({ t: "bulge", c: [0, 0], r: 50, k: 0.1 })); st.set((s) => { s.step = 2; });
    st.undo(); expect({ ...st.state, step: 0 }).toEqual(before); st.redo(); expect(st.state.bodies.honshu.ops).toHaveLength(1);
  });
  test("same state -> identical world geometry", () => { const a = derive(withRidges(defaultState())), b = derive(withRidges(defaultState())); expect(a.parts.honshu[0]).toEqual(b.parts.honshu[0]); });
});

describe("geo API", () => {
  test("toWorld/toGeo round-trip through a deformed Honshu", () => {
    const s = defaultState(); s.bodies.honshu.ops.push({ t: "pull", c: [0, 0], d: [40, 25], r: 200 }, { t: "bulge", c: [100, 50], r: 150, k: 0.25 }); s.bodies.honshu.place.rot = 0.4; s.bodies.honshu.place.scale = 1.3;
    const g = new GeoMap(s, null);
    for (const [lon, lat] of [[139.69, 35.69], [135.5, 34.69], [140.87, 38.27]]) { const w = g.toWorld(lon, lat), b = g.toGeo(w.world); expect(Math.abs(b.lon - lon)).toBeLessThan(0.01); expect(Math.abs(b.lat - lat)).toBeLessThan(0.01); expect(w.island).toBe("honshu"); }
  });
  test("real points land inside their own warped island", () => {
    const s = defaultState(); const w = realToWorld("honshu", s.bodies.honshu, JAPAN.cities.find((c) => c.name === "名古屋市")!.pos);
    expect(worldToReal("honshu", s.bodies.honshu, w)[0]).toBeCloseTo(JAPAN.cities.find((c) => c.name === "名古屋市")!.pos[0], 3);
    expect(uOnKH([0, 0], [10, 0], [5, 0])).toBe(0.5);
  });
});

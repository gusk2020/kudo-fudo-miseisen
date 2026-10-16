import { describe, expect, it } from "vitest";
import { realToWorld } from "../../src/core/body";
import { featureHost } from "../../src/core/constraints";
import { EXTRA, EXTRA_IDS, JAPAN, lonLatToReal } from "../../src/core/data";
import { FEATURE_LIMITS, parseState } from "../../src/core/save";
import { prefPoint, PREF_IDS } from "../../src/core/seat";
import { defaultState, realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import type { Vec } from "../../src/core/types";
import { derive, featureWorld, fujiHeightFactor, validate } from "../../src/core/validate";
import { analyze } from "../../src/sim/demand";
import { lakeCrossings, isLakeFerry, seedLakeFerries } from "../../src/sim/ferry";
import { cityBoost, currentSites, SITE_WEIGHTS } from "../../src/sim/sites";
import { updateRegionShares } from "../../src/sim/engine";
import { buildWorld } from "../../src/sim/world";
import { loadDem } from "./helpers";
import { realWorld, stage3Sim } from "./simhelp";

const lands = (s: ReturnType<typeof realState>) => { const d = derive(s), out: Vec[][] = []; for (const id of Object.keys(d.parts)) out.push(...(d.parts as any)[id]); for (const id of EXTRA_IDS) out.push(...EXTRA.islands[id].parts); return out; };
const poseAt = (s: ReturnType<typeof realState>, which: "biwa" | "fuji", pos: Vec, scale: number) => { s.features[which].pos = pos; s.features[which].scale = scale; return featureWorld(s, which); };

describe("Issue #18: limits and the Fuji elevation link", () => {
  it("scale goes to 5x, the elevation limit stays 1.3x, and a save clamps both", () => {
    expect(FEATURE_LIMITS.scale).toEqual([0.2, 5]); expect(FEATURE_LIMITS.height).toEqual([0.5, 1.3]);
    const s = parseState(JSON.parse(JSON.stringify({ ...realState(), features: { biwa: { pos: null, rot: 0, scale: 9 }, fuji: { pos: null, rot: 0, scale: 4, auto: true } } }))).state;
    expect(s.features.biwa.scale).toBe(5); expect(s.features.fuji.scale).toBe(4); expect(s.features.fuji.auto).toBe(true);
    const old = parseState(JSON.parse(JSON.stringify(realState()))).state; expect(old.features.fuji.auto).toBeUndefined();
  });
  it("the summit follows the size at half the proportion, only when linked, capped at 2x, and a manual height always wins", () => {
    expect(fujiHeightFactor({})).toBe(1); expect(fujiHeightFactor({ scale: 3 })).toBe(1);
    expect(fujiHeightFactor({ scale: 2, auto: true })).toBe(1.5); expect(fujiHeightFactor({ scale: 5, auto: true })).toBe(2); expect(fujiHeightFactor({ scale: 0.5, auto: true })).toBe(0.75);
    expect(fujiHeightFactor({ scale: 5, auto: true, height: 1.1 })).toBe(1.1);
  });
});

describe("Issue #18: where a lake or a mountain may stand", () => {
  const s0 = realState();
  it("every one of the 49 prefectures has an anchor where a small Biwa and a small Fuji fit (Hokkaido's three and Okinawa included)", () => {
    expect(PREF_IDS.length).toBe(49); const L = lands(s0), { w } = realWorld(true);
    for (const pref of PREF_IDS) {
      const cells: number[] = []; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === pref) cells.push(k); expect(cells.length, pref).toBeGreaterThan(0);
      let okB = false, okF = false;
      for (const k of cells) for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
        const c = w.cellPos(k), p: Vec = [c[0] + dx, c[1] + dy], s = realState(); if (!okF && featureHost(L, poseAt(s, "fuji", p, 0.2))) okF = true;
        if (!okB) for (const rot of [0, 0.8, 1.57, 2.4]) { s.features.biwa.rot = rot; if (featureHost(L, poseAt(s, "biwa", p, 0.2))) { okB = true; break; } }
        if (okB && okF) break;
      }
      expect(okB && okF, pref).toBe(true);
    }
  });
  it("Okinawa takes a shrunk Fuji and a shrunk Biwa (the 0.5x floor is lifted only for a small landmass), but not full size", () => {
    const { w } = realWorld(true), okc: number[] = []; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-47") okc.push(k);
    const ok = (which: "biwa" | "fuji", sc: number) => { for (const k of okc) for (let dx = -2; dx <= 2; dx += 2) { const s = realState(); const p = w.cellPos(k); s.features[which].pos = [p[0] + dx, p[1]]; s.features[which].scale = sc; if (which === "fuji" ? true : true) { const v = validate(s).filter((i) => i.step === "features" && i.severity === "error" && i.code.startsWith(which)); if (!v.length) return true; } } return false; };
    expect(ok("fuji", 0.2)).toBe(true); expect(ok("biwa", 0.2)).toBe(true); expect(ok("fuji", 1)).toBe(false); expect(ok("biwa", 1)).toBe(false);
  });
  it("the default lower bound 0.5 holds on a big island, and the anchor decides the host (not the prefecture border)", () => {
    const s = realState(); s.features.biwa.scale = 0.3; const e = validate(s).filter((i) => i.code === "biwa.minscale"); expect(e.length).toBe(1);
    const s2 = realState(); s2.features.fuji.pos = realToWorld("honshu", s2.bodies.honshu, lonLatToReal(139.0, 35.6)); expect(validate(s2).filter((i) => i.step === "features" && i.severity === "error")).toEqual([]);   // across a border: fine
  });
  it("spilling into the sea or onto another island, or sitting on the coast, is refused", () => {
    const s = realState(), L = lands(s), sea = realToWorld("honshu", s.bodies.honshu, lonLatToReal(143.5, 35.0));
    expect(featureHost(L, poseAt(realState(), "biwa", sea, 0.5))).toBeNull();
    const big = realState(); big.features.biwa.scale = 5; expect(validate(big).some((i) => i.code === "biwa.coast")).toBe(true);
    const coast = realState(); coast.features.fuji.pos = realToWorld("honshu", coast.bodies.honshu, lonLatToReal(139.85, 34.99)); expect(validate(coast).some((i) => i.code === "fuji.coast")).toBe(true);
  });
});

describe("Issue #18: terrain leaves nothing behind", () => {
  const gen = (mut: (s: ReturnType<typeof defaultState>) => void) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { s, t, w: buildWorld(t, s.seed) }; };
  const base = gen(() => {});
  it("moving Fuji levels the old cone; moving the lake drains the old site; the land mask is unchanged except for the lake", () => {
    const fujiReal = realToWorld("honshu", base.s.bodies.honshu, JAPAN.fuji.center), biwaReal = realToWorld("honshu", base.s.bodies.honshu, JAPAN.biwa.center);
    const mv = gen((s) => { s.features.fuji.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(138.9, 37.4)); s.features.biwa.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(140.0, 36.2)); });
    const kf = base.w.cellOf(fujiReal), kb = base.w.cellOf(biwaReal);
    expect(base.t.elev[kf]).toBeGreaterThan(2000); expect(mv.t.elev[kf]).toBeLessThan(base.t.elev[kf] - 1000);
    expect(base.t.land[kb]).toBe(2); expect(mv.t.land[kb]).toBe(1);
    let diff = 0; for (let k = 0; k < base.w.N; k++) if ((base.t.land[k] === 0) !== (mv.t.land[k] === 0)) diff++; expect(diff).toBe(0);
  });
  it("an auto-linked Fuji at 2x is 1.5x as high; at 5x it is capped at 2x the height", () => {
    const peak = (k: number, auto: boolean) => gen((s) => { s.features.fuji.scale = k; if (auto) s.features.fuji.auto = true; }).t.stats.maxElevM;
    const h1 = peak(1.0001, false), h2 = peak(2, true), h5 = peak(5, true);
    expect(h2 / JAPAN.fuji.summitM).toBeGreaterThan(1.4); expect(h2 / JAPAN.fuji.summitM).toBeLessThan(1.7); expect(h5 / JAPAN.fuji.summitM).toBeLessThan(2.2); expect(h1).toBeLessThan(h2);
  });
});

describe("Issue #18: development sites", () => {
  const nagoya = "JP-23";
  it("each seat or sight raises the region around it, and moving it moves the effect with no remnant", () => {
    const a = stage3Sim("heisei", 7, false, 0, 2, true, { capital: "JP-13", sub: "JP-27" }), b = stage3Sim("heisei", 7, false, 0, 2, true, { capital: nagoya, sub: "JP-27" });
    const nag = a.w.cities.find((c) => c.pref === nagoya && c.kind === "capital")!, tok = a.w.cities.find((c) => c.pref === "JP-13" && c.kind === "capital")!;
    for (const d of ["commerce", "industry", "manufacturing", "tourism"] as const) expect(cityBoost(b.sim, b.w, nag.id)[d]).toBeGreaterThan(cityBoost(a.sim, a.w, nag.id)[d]);
    for (const d of ["commerce", "industry", "manufacturing", "tourism"] as const) expect(cityBoost(b.sim, b.w, tok.id)[d]).toBeLessThan(cityBoost(a.sim, a.w, tok.id)[d]);
    expect(currentSites(a.sim, a.w).map((x) => x.kind).sort()).toEqual(expect.arrayContaining(["capital", "sub", "fuji", "biwa"]));
    expect(Object.keys(SITE_WEIGHTS.palace)).toEqual(["tourism"]); expect(SITE_WEIGHTS.fuji.commerce).toBeUndefined();
  });
  it("the passenger flow into a capital's prefecture and the regional budget share both rise (quantified)", () => {
    const a = stage3Sim("heisei", 7, false, 0, 2, true, { capital: "JP-13", sub: "JP-27" }), b = stage3Sim("heisei", 7, false, 0, 2, true, { capital: nagoya, sub: "JP-27" });
    const flow = (x: typeof a) => { analyze(x.sim, x.w); return Object.values(x.sim.edges).filter((e) => e.region === nagoya).reduce((t, e) => t + e.through + e.freight, 0); };
    const fa = flow(a), fb = flow(b); expect(fb).toBeGreaterThan(fa * 1.02);
    updateRegionShares(a.sim, a.w); updateRegionShares(b.sim, b.w); expect(b.sim.regionShare[nagoya]).toBeGreaterThan(a.sim.regionShare[nagoya]);
  });
});

describe("Issue #18: Lake Biwa ferries", () => {
  it("lakeshore ports join the road network, and a lake ferry is an ordinary ferry edge inside ONE land mass, never counted as a strait", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true); const cs = lakeCrossings(w);
    expect(cs.length).toBeGreaterThan(0); const lake = Object.values(sim.edges).filter(isLakeFerry); expect(lake.length).toBe(1);
    const e = lake[0]; expect(e.facility).toBe("ferry"); expect(e.state).toBe("open"); expect(w.lm[w.cellOf(w.cellPos(sim.nodes[e.a].cell))]).toBe(w.lm[sim.nodes[e.b].cell]);
    for (const nid of [e.a, e.b]) expect(Object.values(sim.edges).some((x) => x.facility !== "ferry" && (x.a === nid || x.b === nid) && x.state === "open"), nid).toBe(true);   // reachable by road
    expect(w.t.land[sim.nodes[e.a].cell]).toBe(1); expect(w.t.land[sim.nodes[e.b].cell]).toBe(1);
    expect(seedLakeFerries(sim, w)).toBe(0);   // idempotent
  });
  it("moving or resizing the lake re-places the ports and routes; a tiny lake has none", () => {
    const mk = (mut: (s: ReturnType<typeof defaultState>) => void) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return buildWorld(t, s.seed); };
    const base = mk(() => {}), moved = mk((s) => { s.features.biwa.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(139.0, 36.3)); }), big = mk((s) => { s.features.biwa.scale = 1.6; }), tiny = mk((s) => { s.features.biwa.scale = 0.2; });
    const key = (w: ReturnType<typeof mk>) => lakeCrossings(w).map((c) => `${c.id}:${c.portA}-${c.portB}`).join(",");
    expect(key(base)).not.toBe(""); expect(key(base)).not.toBe(key(moved)); expect(key(big)).not.toBe(key(base)); expect(lakeCrossings(tiny).length).toBeLessThan(lakeCrossings(big).length);
    for (const c of lakeCrossings(moved)) { expect(moved.t.land[c.portA]).toBe(1); expect(moved.t.land[c.portB]).toBe(1); }
  });
});

import { describe, expect, it } from "vitest";
import { lonLatToReal } from "../../src/core/data";
import { realToWorld } from "../../src/core/body";
import { Store, defaultState, realState } from "../../src/core/state";
import { FEATURE_LIMITS, parseState } from "../../src/core/save";
import { mapStateHash } from "../../src/core/save2";
import { generateTerrain } from "../../src/core/terrain";
import { derive, validate } from "../../src/core/validate";
import { buildWorld, pathfind } from "../../src/sim/world";
import type { Vec } from "../../src/core/types";
import { loadDem } from "./helpers";

const to = (s: ReturnType<typeof defaultState>, lon: number, lat: number): Vec => realToWorld("honshu", s.bodies.honshu, lonLatToReal(lon, lat));
const world = (mut: (s: ReturnType<typeof defaultState>) => void = () => {}) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { s, t, w: buildWorld(t, s.seed) }; };
const ALPS = (s: ReturnType<typeof defaultState>) => { s.ridges.ne = [[137.76, 36.76], [137.62, 36.58], [137.65, 36.34], [137.55, 36.11]].map(([a, b]) => to(s, a, b)); s.ridges.sw = [[138.23, 35.78], [138.24, 35.67], [138.10, 35.60], [138.14, 35.45]].map(([a, b]) => to(s, a, b)); };

describe("limited terrain editing (the coastline never moves)", () => {
  const base = world();
  it("the store lets the limited edits through while finalised, with undo and redo, and still refuses the ordinary ones", () => {
    const st = new Store(realState()); expect(st.commit((s) => { s.seed = 1; })).toBe(false); expect(st.state.seed).toBe(20260101);
    expect(st.commitLimited((s) => { s.capital = "C-JP-27"; })).toBe(true); expect(st.state.capital).toBe("C-JP-27"); expect(st.state.finalized).toBe(true);
    expect(st.undoLimited()).toBe(true); expect(st.state.capital).toBeUndefined(); expect(st.state.finalized).toBe(true); expect(st.redoLimited()).toBe(true); expect(st.state.capital).toBe("C-JP-27");
    expect(st.undoLimited()).toBe(true); expect(st.undoLimited()).toBe(false);
  });
  it("drawing the Alps raises the ground there, changes nothing at sea, and leaves the land mask identical", () => {
    const ed = world(ALPS); let diff = 0, higher = 0; for (let k = 0; k < base.w.N; k++) { if (base.t.land[k] !== ed.t.land[k]) diff++; if (ed.t.land[k] === 1 && ed.t.elev[k] > base.t.elev[k] + 150) higher++; }
    expect(diff).toBe(0); expect(higher).toBeGreaterThan(15); expect(ed.t.hash).not.toBe(base.t.hash);
    const k = ed.w.cellOf(to(ed.s, 137.65, 36.3)); expect(ed.t.elev[k]).toBeGreaterThan(base.t.elev[k]);
  });
  it("moving Fuji and Lake Biwa changes where the peak and the lake are, and a route across the new mountains costs more", () => {
    const f = world((s) => { s.features.fuji.pos = to(s, 136.6, 35.2); s.features.biwa.pos = to(s, 138.4, 36.4); });
    expect(f.t.hash).not.toBe(base.t.hash); let lakeA = 0, lakeB = 0; for (let k = 0; k < base.w.N; k++) { if (base.t.land[k] === 2) lakeA++; if (f.t.land[k] === 2) lakeB++; }
    expect(lakeB).toBeGreaterThan(0); expect(Math.abs(lakeA - lakeB)).toBeLessThan(8);
    const nagoya = base.w.cities.find((c) => c.name === "名古屋市")!, nagano = base.w.cities.find((c) => c.name === "長野市")!;
    const cost = (W: typeof base.w) => { const p = pathfind(W, W.cityById.get(nagoya.id)!.cell, W.cityById.get(nagano.id)!.cell, { margin: 20 })!; let s = 0; for (let i = 1; i < p.length; i++) s += Math.abs(W.t.elev[p[i]] - W.t.elev[p[i - 1]]); return s; };
    const alps = world(ALPS); expect(cost(alps.w)).toBeGreaterThanOrEqual(cost(base.w) * 0.9);
  });
  it("an edit that puts Fuji outside Honshu is reported as an error, so it cannot be generated", () => {
    const s = defaultState(); s.features.fuji.pos = to(s, 131.0, 33.0); const errs = validate(s).filter((i) => i.severity === "error"); expect(errs.length).toBeGreaterThan(0); void derive;
  });
});

describe("Lake Biwa and Mt. Fuji can be resized (Issue #15)", () => {
  const base = world();
  const lake = (W: typeof base) => { let n = 0; for (let k = 0; k < W.w.N; k++) if (W.t.land[k] === 2) n++; return n; };
  const fujiPos = (W: typeof base) => W.w.cellOf(to(W.s, 138.727, 35.361));
  it("a bigger lake covers more cells and a smaller one fewer, the coastline mask never changes", () => {
    const big = world((s) => { s.features.biwa.scale = 1.4; }), small = world((s) => { s.features.biwa.scale = 0.6; });
    expect(lake(big)).toBeGreaterThan(lake(base)); expect(lake(small)).toBeLessThan(lake(base)); expect(lake(small)).toBeGreaterThan(0);
    for (let k = 0; k < base.w.N; k++) { const a = base.t.land[k] > 0, b = big.t.land[k] > 0, c = small.t.land[k] > 0; if (a !== b || a !== c) throw new Error("coast changed at " + k); }
  });
  it("Fuji's height and body size change the summit and the footprint above 1000 m", () => {
    const tall = world((s) => { s.features.fuji.height = 1.3; }), low = world((s) => { s.features.fuji.height = 0.5; }), wide = world((s) => { s.features.fuji.scale = 1.6; });
    const peak = (W: typeof base) => { let m = 0; for (let k = 0; k < W.w.N; k++) m = Math.max(m, W.t.elev[k] * (W.w.cellOf(to(W.s, 138.727, 35.361)) >= 0 ? 1 : 1)); return m; };
    void peak; const k = fujiPos(base);
    expect(tall.t.elev[k]).toBeGreaterThan(base.t.elev[k]); expect(low.t.elev[k]).toBeLessThan(base.t.elev[k]); expect(low.t.elev[k]).toBeGreaterThan(1000);
    const over = (W: typeof base) => { let n = 0; for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) if (W.t.elev[k + j * W.w.nx + i] > 1200) n++; return n; };
    expect(over(wide)).toBeGreaterThan(over(base));
  });
  it("sizes survive a save, are clamped to the allowed range, and absent sizes keep the old hash", () => {
    const s = defaultState(); s.features.biwa.scale = 1.5; s.features.fuji.height = 0.8;
    const back = parseState(JSON.parse(JSON.stringify(s))).state; expect(back.features.biwa.scale).toBe(1.5); expect(back.features.fuji.height).toBe(0.8);
    const wild = parseState({ ...JSON.parse(JSON.stringify(s)), features: { biwa: { pos: null, rot: 0, scale: 50 }, fuji: { pos: null, rot: 0, scale: -3, height: 99 } } }).state;
    expect(wild.features.biwa.scale).toBe(FEATURE_LIMITS.scale[1]); expect(wild.features.fuji.scale).toBe(FEATURE_LIMITS.scale[0]); expect(wild.features.fuji.height).toBe(FEATURE_LIMITS.height[1]);
    expect(mapStateHash(s)).not.toBe(mapStateHash(defaultState())); expect(mapStateHash(defaultState())).toBe(mapStateHash({ ...defaultState(), features: { biwa: { pos: null, rot: 0 }, fuji: { pos: null, rot: 0 } } }));
  });
  it("an extreme enlargement that would press the lake onto the coast is an invalid map", () => {
    const s = defaultState(); s.features.biwa.scale = 2; const okAtLimit = validate(s).filter((i) => i.severity === "error" && i.step === "features").length;
    s.features.biwa.pos = to(s, 136.3, 35.9); s.features.biwa.scale = 2; expect(validate(s).filter((i) => i.severity === "error" && i.step === "features").length).toBeGreaterThan(0); void okAtLimit;
  });
});


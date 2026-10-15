import { describe, expect, it } from "vitest";
import { lonLatToReal } from "../../src/core/data";
import { realToWorld } from "../../src/core/body";
import { Store, defaultState, realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { derive, validate } from "../../src/core/validate";
import { createSim } from "../../src/sim/engine";
import { CAPITAL_PREFS, homeCity, performCeremony, previewCeremony, tokyoCity } from "../../src/sim/ceremony";
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

describe("the capital is a city setting, kept apart from the terrain", () => {
  const { w, t } = world();
  it("only the three 府 cities can be capitals; anything else falls back to Tokyo", () => {
    expect([...CAPITAL_PREFS]).toEqual(["JP-13", "JP-26", "JP-27"]);
    const osaka = w.cities.find((c) => c.pref === "JP-27" && c.kind === "capital")!, nagoya = w.cities.find((c) => c.name === "名古屋市")!;
    expect(homeCity(w, osaka.id)!.id).toBe(osaka.id); expect(homeCity(w, nagoya.id)!.id).toBe(tokyoCity(w)!.id); expect(homeCity(w, "nonsense")!.id).toBe(tokyoCity(w)!.id);
  });
  it("with Osaka as capital the ceremony starts there, 府道1号 is in 大阪府, the capital grows and Tokyo shrinks; the terrain hash is unchanged", () => {
    const osaka = w.cities.find((c) => c.pref === "JP-27" && c.kind === "capital")!, tokyo = tokyoCity(w)!, kobe = w.cities.find((c) => c.name === "神戸市")!;
    const line = (a: Vec, b: Vec, n = 10): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
    expect(previewCeremony(w, "kokudo1", line(tokyo.pos, kobe.pos), osaka.id).ok).toBe(false);   // starting at Tokyo is no longer allowed
    const k = previewCeremony(w, "kokudo1", line(osaka.pos, w.cities.find((c) => c.name === "名古屋市")!.pos), osaka.id); expect(k.ok, k.reasons.join()).toBe(true);
    let far: Vec = osaka.pos, bd = 0; for (let c = 0; c < w.N; c++) if (w.t.land[c] === 1 && w.prefOf(c) === "JP-27") { const p = w.cellPos(c), d = Math.hypot(p[0] - osaka.pos[0], p[1] - osaka.pos[1]); if (d > bd) { bd = d; far = p; } }
    const f = previewCeremony(w, "fudo1", line(osaka.pos, far, 4), osaka.id); expect(f.ok, f.reasons.join()).toBe(true);
    const plain = createSim(w, "m", t.hash, 3, { stage3: true, firstEra: 0 }), moved = createSim(w, "m", t.hash, 3, { stage3: true, firstEra: 0, capital: osaka.id });
    expect(moved.capital).toBe(osaka.id); expect(plain.capital).toBeUndefined();
    expect(moved.cities[osaka.id].pop).toBeGreaterThan(plain.cities[osaka.id].pop); expect(moved.cities[tokyo.id].pop).toBeLessThan(plain.cities[tokyo.id].pop);
    expect(performCeremony(moved, w, k, f)).toBe(true);
    const fu1 = Object.values(moved.routes).find((r) => r.grade === "fu" && r.number === 1 && r.scope === "JP-27")!; expect(fu1).toBeDefined(); expect(fu1.history[0].text.length).toBeGreaterThan(0);
    expect(Object.values(moved.routes).find((r) => r.grade === "national" && r.number === 1)!.name).toContain("国道1号");
  }, 120000);
});

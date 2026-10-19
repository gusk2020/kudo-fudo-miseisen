import { describe, expect, it } from "vitest";
import { realToWorld } from "../../src/core/body";
import { lonLatToReal } from "../../src/core/data";
import { FEATURE_LIMITS, parseState } from "../../src/core/save";
import { mapStateHash } from "../../src/core/save2";
import { defaultState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { featureScales, featureShape, featureWorld, fujiHeightFactor, validate } from "../../src/core/validate";
import { advance } from "../../src/sim/engine";
import { BRIDGE_PREF, MAX_ACTIVE_PER_MODE, PLAN_TUNNEL_MAX_KM, chooseStructure, corridorTaken, corridorsOf, isCrossingProject, localGapKm } from "../../src/sim/crossing";
import { modeOf } from "../../src/sim/types";
import { MTN_EASE_FLOOR, buildWorld, mountainBarrier, mountainCost, pathfind } from "../../src/sim/world";
import { loadDem } from "./helpers";
import { city, realWorld, ridgeWorld, stage3Sim } from "./simhelp";

describe("Stage 11: straits are crossed by bridges and tunnels, corridor by corridor", () => {
  const { sim: sim0, w } = stage3Sim("heisei", 7, false, 0, 2, true);
  it("every ferry between two land masses is a candidate, with the narrowest strait between ITS two shores as the span", () => {
    const cs = corridorsOf(sim0, w, "road"), name = (c: (typeof cs)[0]) => `${c.a.name}-${c.b.name}`, by = new Map(cs.map((c) => [name(c), c]));
    for (const n of ["高松市-岡山市", "松山市-広島市", "徳島市-神戸市", "青森市-函館市"]) expect(by.has(n) || by.has(n.split("-").reverse().join("-")), n).toBe(true);
    const span = (a: string, b: string) => { const c = by.get(`${a}-${b}`) ?? by.get(`${b}-${a}`)!; return c.span; };
    expect(span("青森市", "函館市")).toBeGreaterThan(18); expect(span("青森市", "函館市")).toBeLessThan(35);          // the Tsugaru strait, not the 100 km between the two cities
    expect(span("高松市", "岡山市")).toBeLessThan(20); expect(span("高松市", "岡山市")).toBeGreaterThan(5);
    expect(localGapKm(w, city(w, "高松市").cell, city(w, "岡山市").cell)).toBe(span("高松市", "岡山市"));
    expect(new Set(cs.map((c) => w.lm[c.a.cell] + "-" + w.lm[c.b.cell])).size).toBeLessThan(cs.length);              // several corridors between one pair of land masses
  });
  it("a bridge is chosen wherever technology can span the water at a price within BRIDGE_PREF of a tunnel; a tunnel where it cannot; nothing beyond the longest tunnel", () => {
    const { sim } = stage3Sim("heisei", 7, false, 0, 2, true, undefined, 0);   // the Stage 11 structure rule (waterK 0); the water-tunnel rule of Stage 13 is tested in stage13.test.ts
    const at = (gap: number, y: number) => chooseStructure(sim, gap, gap * 3, "road", y);
    expect(at(8, 1990)?.fac).toBe("bridge"); expect(at(14, 2000)?.fac).toBe("bridge");
    expect(at(30, 1960)).toBeNull();                         // a tunnel will not come for decades and a bridge is not yet possible, but neither is wanted now: it waits
    expect(at(30, 2000)?.fac).toBeTruthy(); expect(at(PLAN_TUNNEL_MAX_KM + 1, 2100)).toBeNull(); expect(at(560, 2100)).toBeNull();
    expect(BRIDGE_PREF).toBeGreaterThan(1);
    // the long strait waits for a bridge only while one is within reach (30 technology years); with no bridge in sight a tunnel is taken
    expect(at(36, 1975)?.fac).toBe("tunnel");
  });
  it("1950-2100: the planner now builds bridges as well as tunnels, over several corridors between the same land masses, and records what it started and what it finished", () => {
    const { sim, w: ww } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, 0); sim.policy!.mode = "auto";
    let ideas = 0, opened = 0; const seen = new Set<number>();
    for (let y = 1951; y <= 2100; y++) { advance(sim, ww, 12); for (const e of sim.events) if (!seen.has(e.id)) { seen.add(e.id); if (e.kind === "crossing") ideas++; else if (e.kind === "open" && e.text.includes("海峡連絡が開通")) opened++; } }
    const links = Object.values(sim.edges).filter((e) => (e.facility === "bridge" || e.facility === "tunnel") && (e.facilityName ?? "").startsWith("link:") && e.built >= 1);
    const bridges = links.filter((e) => e.facility === "bridge"), tunnels = links.filter((e) => e.facility === "tunnel");
    expect(ideas).toBeGreaterThanOrEqual(6); expect(opened).toBeGreaterThanOrEqual(5); expect(bridges.length).toBeGreaterThanOrEqual(2); expect(tunnels.length).toBeGreaterThanOrEqual(2);
    expect(new Set(links.map((e) => `${Math.min(ww.lm[e.cells[0]], ww.lm[e.cells[e.cells.length - 1]])}-${Math.max(ww.lm[e.cells[0]], ww.lm[e.cells[e.cells.length - 1]])}`)).size).toBeGreaterThanOrEqual(2);
    const shikoku = ww.lm[city(ww, "高松市").cell], toShikoku = Object.values(sim.edges).filter((e) => (e.facility === "bridge" || e.facility === "tunnel") && e.built >= 1 && e.state !== "lost" && (ww.lm[e.cells[0]] === shikoku) !== (ww.lm[e.cells[e.cells.length - 1]] === shikoku) && ww.lm[e.cells[0]] !== 0 && ww.lm[e.cells[e.cells.length - 1]] !== 0);
    expect(new Set(toShikoku.map((e) => modeOf(e) + e.facilityName)).size).toBeGreaterThanOrEqual(3);          // Honshu-Shikoku: more than one fixed link
    for (const mode of ["road", "rail"] as const) expect(Object.values(sim.projects).filter((p) => isCrossingProject(p) && modeOf(p) === mode && ["concept", "planned", "building", "suspended"].includes(p.status)).length).toBeLessThanOrEqual(MAX_ACTIVE_PER_MODE);
    for (const c of corridorsOf(sim, ww, "road")) if (links.some((l) => modeOf(l) === "road" && l.state === "open")) void corridorTaken(sim, ww, c, "road");
  }, 900000);
});

describe("Stage 11: a moved or stretched Mt. Fuji is a barrier all the way down its foot; the untouched one is not", () => {
  const field = (mut: (s: ReturnType<typeof defaultState>) => void) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { s, t, w: buildWorld(t, s.seed) }; };
  const here = [140.2, 36.0] as [number, number];   // the Kanto plain: flat ground, no real mountain
  const moved = field((s) => { s.features.fuji.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(here[0], here[1])); s.features.fuji.scale = 1.4; s.features.fuji.auto = true; }), plain = field(() => {});
  it("the barrier field covers the cone and its foot; the drawn-ridge field (which steers rivers) and the terrain hash stay as they were", () => {
    const k = moved.w.cellOf(realToWorld("honshu", moved.s.bodies.honshu, lonLatToReal(here[0], here[1])));
    expect(moved.t.barrier[k]).toBeGreaterThan(0.95); expect(moved.t.ridge[k]).toBe(0);
    const ring = (r: number) => { let m = 0; for (let q = 0; q < 24; q++) { const a = (q / 24) * Math.PI * 2, c = moved.w.cellOf(realToWorld("honshu", moved.s.bodies.honshu, lonLatToReal(here[0] + (Math.cos(a) * r) / 91, here[1] + (Math.sin(a) * r) / 111))); if (c >= 0) m = Math.max(m, moved.t.barrier[c]); } return m; };
    expect(ring(15)).toBeGreaterThan(0.2); expect(ring(30)).toBeGreaterThan(0.05);            // the foot, well down the slope
    expect(plain.t.barrier.reduce((m, v) => (v > m ? v : m), 0)).toBe(0);                                              // the untouched Fuji: no barrier at all (the real Tokaido skirts it)
    expect(plain.t.hash).toBe("6ab9fd85");                                                     // the terrain of an older save is bit-for-bit what it was
  });
  it("a road or railway across the moved Fuji goes round it or pays for it; the same crossing on the untouched plain is free", () => {
    const a = city(moved.w, "水戸市").cell, b = city(moved.w, "千葉市").cell; moved.w.barrier = true; plain.w.barrier = true;
    for (const rail of [false, true]) {
      const p1 = pathfind(moved.w, a, b, { rail })!, p0 = pathfind(plain.w, a, b, { rail })!;
      expect(mountainCost(plain.w, p0)).toBe(1);
      const mb = Math.max(...p1.map((k) => mountainBarrier(moved.t.barrier[k], moved.t.elev[k])));
      expect(p1.length > p0.length || mountainCost(moved.w, p1) > 1.3, `rail=${rail}`).toBe(true);          // a detour, or an expensive crossing
      expect(mb).toBeLessThan(25);                                                                          // never straight over the summit
    }
  });
  it("tunnel technology helps but never makes a high range free", () => {
    expect(MTN_EASE_FLOOR).toBeGreaterThanOrEqual(0.3);
    const cost = (ease: number, steep: number) => { const w = moved.w, mb = mountainBarrier(0.9, 2400) * (1 + steep / 8); return mb * Math.max(MTN_EASE_FLOOR, 1 - 1.4 * ease); };
    expect(cost(0.6, 0)).toBeGreaterThan(0.3 * cost(0, 0)); expect(cost(0, 12)).toBeGreaterThan(2 * cost(0, 0));
  });
});

describe("Stage 11: Lake Biwa and Mt. Fuji take two independent sizes, never sheared", () => {
  const s0 = () => { const s = defaultState(); s.real = true; return s; };
  it("the outline is exactly rotation * diag(sx, sy) of the fixed shape: columns orthogonal, no shear; both axes up to 5x; a uniform size is the old arithmetic", () => {
    const s = s0(); Object.assign(s.features.biwa, { rot: 0.7, scale: 3, scaleY: 1.5 });
    const out = featureWorld(s, "biwa"), shape = featureShape("biwa"), pos = out[0].map((v, i) => v - 0 * i), c = (s.features.biwa.pos ?? null);
    const o0: [number, number] = [out[0][0], out[0][1]];
    // M from two shape points: solve [out_i - pos] = M * shape_i
    const base = featureWorld({ ...s, features: { ...s.features, biwa: { ...s.features.biwa, scale: undefined, scaleY: undefined, rot: 0 } } }, "biwa");   // unscaled, unrotated: pos + shape
    const pc: [number, number] = [base[0][0] - shape[0][0], base[0][1] - shape[0][1]];
    const rel = out.map((q) => [q[0] - pc[0], q[1] - pc[1]] as [number, number]), cs = Math.cos(0.7), sn = Math.sin(0.7);
    shape.forEach((q, i) => { const ex = cs * 3 * q[0] - sn * 1.5 * q[1], ey = sn * 3 * q[0] + cs * 1.5 * q[1]; expect(rel[i][0]).toBeCloseTo(ex, 6); expect(rel[i][1]).toBeCloseTo(ey, 6); });
    void pos; void c; void o0;
    expect(FEATURE_LIMITS.scale[1]).toBe(5);
    const old = s0(); old.features.biwa.scale = 1.7; const o1 = featureWorld(old, "biwa"), p1 = featureWorld({ ...old, features: { ...old.features, biwa: { ...old.features.biwa, scale: undefined } } }, "biwa");
    expect(featureScales(old.features.biwa)).toEqual([1.7, 1.7]); expect(o1.length).toBe(p1.length);
  });
  it("Fuji's summit follows the AREA-EQUIVALENT size sqrt(sx*sy): 1 + (eq - 1) / 2, at most 3x; a plain size gives the old value", () => {
    expect(fujiHeightFactor({ auto: true, scale: 3 })).toBe(2); expect(fujiHeightFactor({ auto: true, scale: 5 })).toBe(3);
    expect(fujiHeightFactor({ auto: true, scale: 4, scaleY: 1 })).toBeCloseTo(1.5, 9);                    // sqrt(4 * 1) = 2 -> 1.5
    expect(fujiHeightFactor({ auto: true, scale: 1, scaleY: 4 })).toBeCloseTo(1.5, 9);
    expect(fujiHeightFactor({ auto: true, scale: 5, scaleY: 5 })).toBe(3); expect(fujiHeightFactor({ auto: true, scale: 0.2, scaleY: 1 })).toBeGreaterThanOrEqual(0.5);
    expect(fujiHeightFactor({ scale: 3 })).toBe(1); expect(fujiHeightFactor({ height: 1.2, auto: true, scale: 4, scaleY: 1 })).toBe(1.2);   // a hand-set height always wins
  });
  it("the terrain follows: the lake is the stretched outline (its area is sx*sy times), the cone reaches further along the long axis; sizes survive save and load; older saves are unchanged", () => {
    const area = (mut: (s: ReturnType<typeof defaultState>) => void) => { const s = defaultState(); mut(s); const t = generateTerrain(s, loadDem()); let n = 0; for (let k = 0; k < t.land.length; k++) if (t.land[k] === 2) n++; return { n, t, s }; };
    const one = area(() => {}), wide = area((s) => { s.features.biwa.scale = 1.8; s.features.biwa.scaleY = 1; });
    expect(wide.n).toBeGreaterThan(one.n * 1.3); expect(wide.n).toBeLessThan(one.n * 2.4);
    const fuji = area((s) => { s.features.fuji.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(140.2, 36.0)); s.features.fuji.scale = 3; s.features.fuji.scaleY = 1; s.features.fuji.auto = true; });
    const along = (t: ReturnType<typeof generateTerrain>, dx: number, dy: number) => { const { x0, y0, cell, nx } = t.grid; const c = t.stats.fujiTopCell, i0 = c % nx, j0 = (c / nx) | 0; let reach = 0; for (let r = 1; r < 30; r++) { const i = i0 + Math.round(dx * r), j = j0 + Math.round(dy * r), k = j * nx + i; if (t.land[k] === 1 && t.elev[k] > 600) reach = r * cell; } void x0; void y0; return reach; };
    expect(along(fuji.t, 1, 0)).toBeGreaterThan(1.6 * along(fuji.t, 0, 1));
    const rt = parseState(JSON.parse(JSON.stringify(fuji.s))).state; expect(rt.features.fuji.scale).toBe(3); expect(rt.features.fuji.scaleY).toBe(1); expect(mapStateHash(rt)).toBe(mapStateHash(fuji.s));
    const over = parseState({ ...JSON.parse(JSON.stringify(defaultState())), features: { biwa: { pos: null, rot: 0, scale: 9, scaleY: 0.01 }, fuji: { pos: null, rot: 0 } } }).state;
    expect(over.features.biwa.scale).toBe(5); expect(over.features.biwa.scaleY).toBe(0.2);
    const oldS = defaultState(); oldS.features.biwa.scale = 1.5; expect(parseState(JSON.parse(JSON.stringify(oldS))).state.features.biwa.scaleY).toBeUndefined(); expect(mapStateHash(oldS)).toBe(mapStateHash(parseState(JSON.parse(JSON.stringify(oldS))).state));
  });
  it("an anisotropic Biwa or Fuji that would touch the coast is refused by the same map check as before", () => {
    const s = defaultState(); s.real = true; s.features.biwa.scale = 5; s.features.biwa.scaleY = 5; expect(validate(s).some((i) => i.severity === "error" && i.step === "features")).toBe(true);
    const t = defaultState(); t.real = true; t.features.biwa.scale = 1.2; t.features.biwa.scaleY = 1; expect(validate(t).some((i) => i.severity === "error" && i.step === "features")).toBe(false);
  });
});

describe("Stage 11: the map choice and the range 区間 tools are saved", () => {
  it("bg survives a save and load, and is not part of the map hash", () => {
    const s = defaultState(); s.bg = "terrain"; const back = parseState(JSON.parse(JSON.stringify(s))).state;
    expect(back.bg).toBe("terrain"); expect(mapStateHash(back)).toBe(mapStateHash(defaultState())); expect(parseState({ ...JSON.parse(JSON.stringify(s)), bg: "x" }).state.bg).toBeUndefined();
  });
  it("ridgeWorld helper builds the real terrain with a drawn range, whose barrier is part of the pathfinder", () => {
    const w = ridgeWorld({ ne: [[138.35, 34.95], [138.4, 35.4], [138.5, 35.9], [138.6, 36.4]] }, true, { ne: true }).w; expect(w.t.barrier.reduce((m, v) => (v > m ? v : m), 0)).toBeGreaterThan(0.9); void realWorld;
  });
});

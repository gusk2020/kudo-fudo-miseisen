import { describe, expect, it } from "vitest";
import { realToWorld } from "../../src/core/body";
import { lonLatToReal } from "../../src/core/data";
import { defaultState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import type { Vec } from "../../src/core/types";
import { homeCity, lakeHops, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { createSim } from "../../src/sim/engine";
import { isLakeFerry } from "../../src/sim/ferry";
import { checkIntegrity } from "../../src/sim/network";
import { buildWorld, type World } from "../../src/sim/world";
import { loadDem } from "./helpers";

const worldOf = (mut: (s: ReturnType<typeof defaultState>) => void = () => {}) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { w: buildWorld(t, s.seed), hash: t.hash }; };
const lakeCentre = (w: World): Vec => { let x = 0, y = 0, n = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 2) { const p = w.cellPos(k); x += p[0]; y += p[1]; n++; } return [x / n, y / n]; };
const line = (pts: Vec[], step = 4): Vec[] => { const out: Vec[] = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]); } return out; };
/** Tokyo -> (east shore) -> across the lake -> (west shore) -> Osaka, the way a player would draw it. */
const across = (w: World, dx = 30): Vec[] => { const c = lakeCentre(w), h = homeCity(w)!, d = subCity(w, "JP-27")!; return line([h.pos, [c[0] + dx, c[1]], [c[0] - dx, c[1]], d.pos]); };

describe("Stage 8: 国道1号 across Lake Biwa", () => {
  const base = worldOf();
  it("a line drawn across the lake stops at the shore, crosses by a lake ferry in 1950 (open water beyond the bridge span), and goes on from the far shore", () => {
    const p = previewNational(base.w, across(base.w), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true);
    expect(p.lakes?.length).toBe(1); expect(p.lakes![0].kind).toBe("ferry");
    const lk = p.segments.find((s) => s.lake)!; expect(base.w.t.land[lk.cells[0]]).toBe(1); expect(base.w.t.land[lk.cells[1]]).toBe(1);
    for (const s of p.segments) if (!s.lake && !s.ferry) for (const k of s.cells) expect(base.w.t.land[k], "a road cell on water").toBe(1);   // never a road over the lake
    const { sim } = { sim: createSim(base.w, "m", base.hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }) };
    expect(performNational(sim, base.w, p)).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
    const r = Object.values(sim.routes).find((x) => x.grade === "national" && x.number === 1)!, es = r.edges.map((x) => sim.edges[x.edgeId]);
    expect(es.some((e) => isLakeFerry(e) && (e.facilityName ?? "").includes("国道1号"))).toBe(true);
    for (let i = 1; i < r.edges.length; i++) { const a = sim.edges[r.edges[i - 1].edgeId], b = sim.edges[r.edges[i].edgeId], end = r.edges[i - 1].dir === 1 ? a.b : a.a, start = r.edges[i].dir === 1 ? b.a : b.b; expect(start, `break at ${i}`).toBe(end); }
  });
  it("a line drawn round the lake is routed round it (no crossing); with later technology a narrow lake gets a bridge instead of a ferry", () => {
    const c = lakeCentre(base.w), h = homeCity(base.w)!, d = subCity(base.w, "JP-27")!;
    const round = previewNational(base.w, line([h.pos, [c[0] + 30, c[1] - 60], [c[0] - 10, c[1] - 70], d.pos]), "JP-13", "JP-27"); expect(round.ok, round.reasons.join()).toBe(true); expect(round.lakes ?? []).toEqual([]);
    const small = worldOf((s) => { s.features.biwa.scale = 0.4; }), hops = lakeHops(small.w, across(small.w, 15), 2, 2100);
    if (hops.length) expect(hops[0].kind).toBe(hops[0].waterKm <= 40 ? "bridge" : "ferry");
    const hops1950 = lakeHops(base.w, across(base.w), 2, 1950); expect(hops1950.every((x) => x.kind === "ferry")).toBe(true);
  });
  it("the crossing follows the lake when it is moved and turned: the hop is on the new lake's shores", () => {
    const moved = worldOf((s) => { s.features.biwa.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(137.4, 35.5)); s.features.biwa.rot = 1.2; s.features.biwa.scale = 1.5; });
    const c = lakeCentre(moved.w), h = homeCity(moved.w)!, d = subCity(moved.w, "JP-27")!;
    const p = previewNational(moved.w, line([h.pos, [c[0] + 35, c[1]], [c[0] - 35, c[1]], d.pos]), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true);
    expect(p.lakes?.length).toBe(1); const lk = p.segments.find((s) => s.lake)!;
    for (const k of lk.cells) { const q = moved.w.cellPos(k); expect(Math.hypot(q[0] - c[0], q[1] - c[1])).toBeLessThan(80); }
    const old = lakeCentre(base.w); for (const k of lk.cells) { const q = moved.w.cellPos(k); expect(Math.hypot(q[0] - old[0], q[1] - old[1])).toBeGreaterThan(20); }
  });
});

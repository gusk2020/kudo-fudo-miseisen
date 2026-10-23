import { describe, expect, it } from "vitest";
import { homeCity, performNational, previewNational, subCity, snapKmFor } from "../../src/sim/ceremony";
import { modeOf } from "../../src/sim/types";
import { createSim } from "../../src/sim/engine";
import { realWorld } from "./simhelp";
import type { Vec } from "../../src/core/types";

const { w, hash } = realWorld(true, true, true);
const city = (n: string) => w.cities.find((c) => c.name === n)!;
const poly = (pts: Vec[], step = 8): Vec[] => { const out: Vec[] = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let q = 1; q <= n; q++) out.push([a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n]); } return out; };
const tokyo = homeCity(w, "JP-13")!, osaka = subCity(w, "JP-27")!, nagoya = city("名古屋市");
const off = (p: Vec, dx: number, dy: number): Vec => [p[0] + dx, p[1] + dy];
const run = (drawn: Vec[], opts = {}) => previewNational(w, drawn, "JP-13", "JP-27", opts);

describe("Stage 21: the drawn 国道1号", () => {
  const fwd = poly([tokyo.pos, nagoya.pos, osaka.pos]);
  it("drawn from the sub-capital to the capital it is the same road", () => {
    const a = run(fwd), b = run([...fwd].reverse());
    expect(a.ok, a.reasons.join()).toBe(true); expect(b.ok, b.reasons.join()).toBe(true);
    expect(b.reversed).toBe(true); expect(a.reversed).toBeUndefined(); expect(b.cells).toEqual(a.cells); expect(b.from).toBe(a.from);
  });
  it("an end a little off its city is joined by road over land; the allowance follows the zoom and is bounded", () => {
    expect(snapKmFor(0.3)).toBe(80); expect(snapKmFor(3)).toBe(30); expect(snapKmFor(0.05)).toBe(90);
    const start = off(tokyo.pos, 38, 0), d = poly([start, nagoya.pos, osaka.pos]);
    const r = run(d); expect(r.ok, r.reasons.join()).toBe(true);
    for (const s of r.segments) if (!s.ferry) for (const k of s.cells) expect(w.t.land[k]).toBe(1);   // never a line over water
    expect(r.cells[0]).toBe(tokyo.cell); expect(r.cells[r.cells.length - 1]).toBe(osaka.cell);
    const far = poly([off(tokyo.pos, 75, 0), nagoya.pos, osaka.pos]); expect(run(far).ok).toBe(false); expect(run(far, { snapKm: 90 }).ok).toBe(true);
  });
  it("a 県庁所在地 close to the line is routed through; one a little further gets an access road, once", () => {
    const wide = poly([tokyo.pos, off(nagoya.pos, 10, 6), osaka.pos]), r = run(wide);
    expect(r.ok, r.reasons.join()).toBe(true); expect(r.through).toContain("名古屋市"); expect(r.cells).toContain(nagoya.cell);
    const far = poly([tokyo.pos, off(nagoya.pos, 0, 40), osaka.pos]), q = run(far);
    expect(q.ok, q.reasons.join()).toBe(true); expect(q.through ?? []).not.toContain("名古屋市");
    expect(q.spurs?.length ?? 0).toBeGreaterThan(0); const ids = (q.spurs ?? []).map((s) => s.city); expect(new Set(ids).size).toBe(ids.length);
    for (const s of q.spurs ?? []) { expect(s.km).toBeLessThanOrEqual(30); for (const k of s.cells) expect(w.t.land[k]).toBe(1); }
  });
  it("a city across the water is not joined by a road", () => {
    // Kobe-side line passing Awaji: no spur may reach a city on another land mass
    const r = run(poly([tokyo.pos, nagoya.pos, osaka.pos]));
    for (const s of r.spurs ?? []) expect(w.lm[w.cityById.get(s.city)!.cell]).toBe(w.lm[osaka.cell]);
  });
  it("opening lays the access roads once and the city can be reached", () => {
    const sim = createSim(w, "m", hash, 3, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" });
    const r = run(poly([tokyo.pos, off(nagoya.pos, 0, 40), osaka.pos])), before = Object.keys(sim.edges).length;
    expect(performNational(sim, w, r)).toBe(true);
    const reach = (k: number) => Object.values(sim.edges).some((e) => modeOf(e) === "road" && e.state === "open" && e.cells.includes(k));
    expect(r.spurs?.length ?? 0).toBeGreaterThan(0);
    for (const sp of r.spurs ?? []) expect(reach(w.cityById.get(sp.city)!.cell)).toBe(true);
    expect(Object.keys(sim.edges).length).toBeGreaterThan(before);
  });
});

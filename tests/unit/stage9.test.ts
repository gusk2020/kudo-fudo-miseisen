import { describe, expect, it } from "vitest";
import { defaultState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import type { Vec } from "../../src/core/types";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { createSim } from "../../src/sim/engine";
import { checkIntegrity } from "../../src/sim/network";
import { buildWorld, type World } from "../../src/sim/world";
import { loadDem } from "./helpers";

const worldOf = (mut: (s: ReturnType<typeof defaultState>) => void = () => {}) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { w: buildWorld(t, s.seed), hash: t.hash, s }; };
export const line = (pts: Vec[], step = 4): Vec[] => { const out: Vec[] = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]); } return out; };
export const city = (w: World, n: string) => w.cities.find((c) => c.name === n)!;
/** Tokyo -> Osaka, but the player goes down through Shikoku (Takamatsu, Matsuyama) and comes back up through Hiroshima. */
export const viaShikoku = (w: World): Vec[] => line([homeCity(w)!.pos, city(w, "名古屋市").pos, city(w, "大阪市").pos, city(w, "徳島市").pos, city(w, "高松市").pos, city(w, "松山市").pos, city(w, "広島市").pos, city(w, "岡山市").pos, subCity(w, "JP-27")!.pos]);

describe("Stage 9: 国道1号 keeps the land masses the player drew", () => {
  const base = worldOf();
  it("a line drawn through Shikoku goes through Shikoku (two crossings, Shikoku cities on the road), and is laid that way", () => {
    const w = base.w, p = previewNational(w, viaShikoku(w), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true);
    const shik = w.lm[city(w, "高松市").cell], onShik = p.segments.filter((s) => !s.ferry && !s.lake && s.cells.some((k) => w.lm[k] === shik));
    expect(onShik.length).toBeGreaterThan(0); expect(p.ferries.length).toBeGreaterThanOrEqual(2);
    for (const n of ["高松市", "松山市"]) { const c = city(w, n).pos; expect(Math.min(...p.path.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))), n).toBeLessThan(12); }
    const sim = createSim(w, "m", base.hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }); expect(performNational(sim, w, p)).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
    const r = Object.values(sim.routes).find((x) => x.grade === "national" && x.number === 1)!;
    expect(r.edges.some((x) => sim.edges[x.edgeId].cells.some((k) => w.lm[k] === shik))).toBe(true);
    for (let i = 1; i < r.edges.length; i++) { const a = sim.edges[r.edges[i - 1].edgeId], b = sim.edges[r.edges[i].edgeId], end = r.edges[i - 1].dir === 1 ? a.b : a.a, start = r.edges[i].dir === 1 ? b.a : b.b; expect(start, `break at ${i}`).toBe(end); }
  });
  it("a line along Honshu stays on Honshu (no crossing invented)", () => {
    const w = base.w, p = previewNational(w, line([homeCity(w)!.pos, city(w, "名古屋市").pos, subCity(w, "JP-27")!.pos]), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true);
    expect(p.ferries.length).toBe(0);
  });
});

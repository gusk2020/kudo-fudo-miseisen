import { realToWorld } from "../../src/core/body";
import { lonLatToReal } from "../../src/core/data";
import { axisFrame } from "../../src/core/constraints";
import { defaultState } from "../../src/core/state";
import { suggestRidge } from "../../src/core/suggest";
import { generateTerrain } from "../../src/core/terrain";
import { derive } from "../../src/core/validate";
import { createSim, type SimOpts } from "../../src/sim/engine";
import { TOKYO, homeCity, performCeremony, performNational, previewCeremony, previewNational, subCity, tokyoCity } from "../../src/sim/ceremony";
import type { Vec } from "../../src/core/types";
import { buildWorld, type World } from "../../src/sim/world";
import { loadDem } from "./helpers";

let cache: { w: World; hash: string } | null = null;
export function testWorld() {
  if (cache) return cache;
  const s = defaultState(), d = derive(s), f = axisFrame(d.parts.honshu[0], [Math.SQRT1_2, Math.SQRT1_2]);
  s.ridges.sw = suggestRidge(d.parts.honshu[0], f, "sw"); s.ridges.ne = suggestRidge(d.parts.honshu[0], f, "ne");
  const t = generateTerrain(s, loadDem()); return (cache = { w: buildWorld(t, s.seed), hash: t.hash });
}
/** Sim with the ceremony performed (Tokyo -> `end`, plus a road inside Tokyo), on top of the 1950 starting network. */
export function startedSim(seed = 1, end = "名古屋市") {
  const { w, hash } = testWorld(), sim = createSim(w, "m", hash, seed), t = tokyoCity(w)!, e = w.cities.find((c) => c.name === end)!;
  const line = (a: Vec, b: Vec, n = 12): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
  const k = previewCeremony(w, "kokudo1", line(t.pos, e.pos));
  let far: Vec = t.pos, bd = 0; for (let c = 0; c < w.N; c++) if (w.t.land[c] === 1 && w.prefOf(c) === TOKYO) { const p = w.cellPos(c), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; far = p; } }
  const f = previewCeremony(w, "fudo1", line(t.pos, far, 6));
  if (!performCeremony(sim, w, k, f)) throw new Error("ceremony failed: " + k.reasons.join() + f.reasons.join());
  return { sim, w };
}

/** The real Japan (no deformation, no drawn ridges): what Stage 3 plays on. */
const realCache: Record<string, { w: World; hash: string }> = {};
export function realWorld(islands = false) {
  const key = islands ? "i" : "p"; if (realCache[key]) return realCache[key];
  const s = defaultState(); if (islands) s.islands = true; const t = generateTerrain(s, loadDem()); return (realCache[key] = { w: buildWorld(t, s.seed), hash: t.hash });
}
/** A Stage 3 game with the ceremony performed on top of the 1950 road + rail network. */
export function stage3Sim(era: "heisei" | "shubun" | "shoka" = "heisei", seed = 7, ceremony = true, firstEra?: number, techK?: number, islands = false, seats?: { capital?: string; sub?: string; palace?: string }, waterK?: number, extra?: Partial<SimOpts>) {
  const { w, hash } = realWorld(islands), pal = seats?.palace ? w.cities.find((c) => c.pref === seats.palace && c.kind === "capital") : null;
  const sim = createSim(w, "m", hash, seed, firstEra !== undefined ? { stage3: true, firstEra, techK, ...(waterK !== undefined ? { waterK } : {}), ...(seats?.capital ? { capital: seats.capital } : {}), subCapital: seats?.sub ?? "JP-27", ...(pal ? { palace: { pref: seats!.palace!, pos: pal.pos } } : {}), ...(extra ?? {}) } : { era, stage3: true, techK });
  if (ceremony) {
    const line = (a: Vec, b: Vec, n = 12): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
    if (sim.crossings) {   // the Issue #15 ceremony: one national road, capital -> sub-capital
      const home = homeCity(w, sim.capital)!, dest = subCity(w, sim.subCapital)!, p = previewNational(w, line(home.pos, dest.pos, 20), sim.capital, sim.subCapital);
      if (!performNational(sim, w, p)) throw new Error("national ceremony failed: " + p.reasons.join());
      return { sim, w };
    }
    const t = tokyoCity(w)!, e = w.cities.find((c) => c.name === "名古屋市")!;
    const k = previewCeremony(w, "kokudo1", line(t.pos, e.pos)); let far: Vec = t.pos, bd = 0;
    for (let c = 0; c < w.N; c++) if (w.t.land[c] === 1 && w.prefOf(c) === TOKYO) { const p = w.cellPos(c), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; far = p; } }
    const f = previewCeremony(w, "fudo1", line(t.pos, far, 6)); if (!performCeremony(sim, w, k, f)) throw new Error("ceremony failed: " + k.reasons.join() + f.reasons.join());
  }
  return { sim, w };
}
/** Stage 9: the real Japan with hand-drawn ranges (lon/lat points along each ridge line), for the mountain-barrier tests. */
const ridgeCache: Record<string, { w: World; hash: string }> = {};
export function ridgeWorld(ridges: { ne?: [number, number][]; sw?: [number, number][] }, islands = true, alps?: { ne?: true; sw?: true }, fuji?: { lonLat: [number, number]; scale?: number }) {
  const key = JSON.stringify(ridges) + islands + JSON.stringify(alps ?? null) + JSON.stringify(fuji ?? null); if (ridgeCache[key]) return ridgeCache[key];
  const s = defaultState(); if (islands) s.islands = true; if (alps) s.alpsRemoved = alps;
  if (fuji) { s.features.fuji.pos = realToWorld("honshu", s.bodies.honshu, lonLatToReal(fuji.lonLat[0], fuji.lonLat[1])); if (fuji.scale) s.features.fuji.scale = fuji.scale; }
  const to = ([lon, lat]: [number, number]): Vec => realToWorld("honshu", s.bodies.honshu, lonLatToReal(lon, lat));
  s.ridges = { ne: ridges.ne ? ridges.ne.map(to) : null, sw: ridges.sw ? ridges.sw.map(to) : null };
  const t = generateTerrain(s, loadDem()); return (ridgeCache[key] = { w: buildWorld(t, s.seed), hash: t.hash });
}
export function stage3SimOn(base: { w: World; hash: string }, firstEra = 0, seed = 7, extra?: Partial<SimOpts>) {
  const { w, hash } = base, sim = createSim(w, "m", hash, seed, { stage3: true, firstEra, techK: 2, subCapital: "JP-27", ...(extra ?? {}) });
  const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
  const home = homeCity(w, sim.capital)!, dest = subCity(w, sim.subCapital)!, p = previewNational(w, line(home.pos, dest.pos), sim.capital, sim.subCapital);
  if (!performNational(sim, w, p)) throw new Error("national ceremony failed: " + p.reasons.join());
  return { sim, w };
}

export const line = (pts: Vec[], step = 4): Vec[] => { const out: Vec[] = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]); } return out; };
export const city = (w: World, n: string) => w.cities.find((c) => c.name === n)!;
/** Tokyo -> Osaka, but the player goes down through Shikoku (Takamatsu, Matsuyama) and comes back up through Hiroshima. */
export const viaShikoku = (w: World): Vec[] => line([homeCity(w)!.pos, city(w, "名古屋市").pos, city(w, "大阪市").pos, city(w, "徳島市").pos, city(w, "高松市").pos, city(w, "松山市").pos, city(w, "広島市").pos, city(w, "岡山市").pos, subCity(w, "JP-27")!.pos]);


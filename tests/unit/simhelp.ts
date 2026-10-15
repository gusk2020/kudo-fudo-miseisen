import { axisFrame } from "../../src/core/constraints";
import { defaultState } from "../../src/core/state";
import { suggestRidge } from "../../src/core/suggest";
import { generateTerrain } from "../../src/core/terrain";
import { derive } from "../../src/core/validate";
import { createSim } from "../../src/sim/engine";
import { TOKYO, performCeremony, previewCeremony, tokyoCity } from "../../src/sim/ceremony";
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
export function stage3Sim(era: "heisei" | "shubun" | "shoka" = "heisei", seed = 7, ceremony = true, firstEra?: number, techK?: number, islands = false) {
  const { w, hash } = realWorld(islands), sim = createSim(w, "m", hash, seed, firstEra !== undefined ? { stage3: true, firstEra, techK } : { era, stage3: true, techK });
  if (ceremony) {
    const t = tokyoCity(w)!, e = w.cities.find((c) => c.name === "名古屋市")!;
    const line = (a: Vec, b: Vec, n = 12): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
    const k = previewCeremony(w, "kokudo1", line(t.pos, e.pos)); let far: Vec = t.pos, bd = 0;
    for (let c = 0; c < w.N; c++) if (w.t.land[c] === 1 && w.prefOf(c) === TOKYO) { const p = w.cellPos(c), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; far = p; } }
    const f = previewCeremony(w, "fudo1", line(t.pos, far, 6)); if (!performCeremony(sim, w, k, f)) throw new Error("ceremony failed: " + k.reasons.join() + f.reasons.join());
  }
  return { sim, w };
}

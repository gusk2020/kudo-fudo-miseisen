import { axisFrame } from "../../src/core/constraints";
import { defaultState } from "../../src/core/state";
import { suggestRidge } from "../../src/core/suggest";
import { generateTerrain } from "../../src/core/terrain";
import { derive } from "../../src/core/validate";
import { createSim, designate } from "../../src/sim/engine";
import { layPath } from "../../src/sim/network";
import { buildWorld, pathfind, type World } from "../../src/sim/world";
import { loadDem } from "./helpers";

let cache: { w: World; hash: string } | null = null;
export function testWorld() {
  if (cache) return cache;
  const s = defaultState(), d = derive(s), f = axisFrame(d.parts.honshu[0], [Math.SQRT1_2, Math.SQRT1_2]);
  s.ridges.sw = suggestRidge(d.parts.honshu[0], f, "sw"); s.ridges.ne = suggestRidge(d.parts.honshu[0], f, "ne");
  const t = generateTerrain(s, loadDem()); return (cache = { w: buildWorld(t, s.seed), hash: t.hash });
}
/** Sim with the two ceremony roads laid straight by least-cost path (Tokyo -> Nagoya, and one inside Tokyo). */
export function startedSim(seed = 1, end = "名古屋市") {
  const { w, hash } = testWorld(), sim = createSim(w, "m", hash, seed);
  const tokyo = w.cities.find((c) => c.name === "東京")!, nag = w.cities.find((c) => c.name === end)!;
  const p = pathfind(w, tokyo.cell, nag.cell)!; const r = layPath(sim, w, p, { open: true, surface: "gravel", quality: 55, built: 1, month: 0 });
  designate(sim, r.chain, "national", "JP", "test", "test"); sim.ceremonyDone = true; return { sim, w };
}

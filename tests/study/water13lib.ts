/** Stage 13: the game runner the water-tunnel and metro studies (and one unit test) share. */
import { realToLonLat } from "../../src/core/data";
import { isCrossingProject } from "../../src/sim/crossing";
import { createSim, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { modeOf } from "../../src/sim/types";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import type { Vec } from "../../src/core/types";
import { realWorld, ridgeWorld } from "../unit/simhelp";
import { defaultState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { buildWorld } from "../../src/sim/world";
import { loadDem } from "../unit/helpers";
const biwaCache: Record<string, ReturnType<typeof realWorld>> = {};
export function biwaWorld(scale: number, rot: number) { const key = `${scale}/${rot}`; if (biwaCache[key]) return biwaCache[key]; const s = defaultState(); s.islands = true; s.features.biwa.scale = scale; s.features.biwa.rot = rot; const t = generateTerrain(s, loadDem()); return (biwaCache[key] = { w: buildWorld(t, s.seed), hash: t.hash }); }

export function runWater(wk: number, seed: number, until: number, world: "plain" | "biwa5" = "plain", hook?: (sim: ReturnType<typeof createSim>, w: ReturnType<typeof realWorld>["w"], y: number) => void) {
  const base = world === "plain" ? realWorld(true) : biwaWorld(world === "biwa5" ? 5 : 3, world === "biwa5" ? 0 : 0.8), { w, hash } = base;
  const sim = createSim(w, "m", hash, seed, { stage3: true, firstEra: 0, techK: 2, waterK: wk, subCapital: "JP-27" });
  const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
  const p = previewNational(w, line(homeCity(w, sim.capital)!.pos, subCity(w, sim.subCapital)!.pos), sim.capital, sim.subCapital); if (!performNational(sim, w, p)) throw new Error("ceremony");
  sim.policy!.mode = "priority";
  const seen = new Map<string, any>(), ll = (k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(2));
  const track = () => { for (const pr of Object.values(sim.projects)) if (isCrossingProject(pr)) { const e = sim.edges[pr.edgeIds[0]]; let r = seen.get(pr.id); if (!r) { r = { id: pr.id, mode: modeOf(pr), name: e?.facilityName ?? "", fac: e?.facility, km: e?.lengthKm, ends: e ? [ll(e.cells[0]), ll(e.cells[e.cells.length - 1])] : [], cost: pr.costBu, concept: yearOf(sim), hist: [] }; seen.set(pr.id, r); } const last = r.hist[r.hist.length - 1]; if (!last || last[1] !== pr.status) r.hist.push([yearOf(sim), pr.status]); r.cost = pr.costBu; r.spent = pr.spentBu; if (e) { r.traffic = Math.round(e.through + e.local + 0.4 * e.freight); r.built = e.built; r.state = e.state; } } };
  const stance = "heisei"; const t0 = Date.now(); let ferries0 = Object.values(sim.edges).filter((e) => e.facility === "ferry").length;
  while (yearOf(sim) < until) { stepMonth(sim, w); if (sim.kaigen?.pending) { const i = sim.kaigen.pending.cands.findIndex((c) => c.stance === stance); settleKaigen(sim, i >= 0 ? i : 0, true); } if (sim.policy?.pending) autoResolve(sim, w); if (sim.month % 6 === 0) track(); if (hook && sim.month % 12 === 0) hook(sim, w, yearOf(sim)); }
  track();
  const ferries = Object.values(sim.edges).filter((e) => e.facility === "ferry").map((e) => ({ name: e.facilityName, mode: modeOf(e), km: e.lengthKm, state: e.state, traffic: Math.round(e.through + e.local + 0.4 * e.freight) }));
  return Object.defineProperties({ wk, seed, ferries0, projects: [...seen.values()], ferries, wallS: (Date.now() - t0) / 1000 }, { _sim: { value: sim }, _w: { value: w } }) as { wk: number; seed: number; ferries0: number; projects: any[]; ferries: any[]; wallS: number; _sim: typeof sim; _w: typeof w };
}

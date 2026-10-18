import { regionOfCells } from "./network";
import { updateRegionShares } from "./engine";
import type { SimState } from "./types";
import type { World } from "./world";

/** After the world exists: derive what an older save could not store (budget regions, shares). Idempotent. */
export function finishMigration(sim: SimState, w: World) {
  w.barrier = !!sim.stage3; w.land12 = !!sim.econ;
  for (const e of Object.values(sim.edges)) if (!e.region) e.region = regionOfCells(w, e.cells);
  for (const p of Object.values(sim.projects)) if (!p.region) p.region = p.edgeIds.length && sim.edges[p.edgeIds[0]] ? sim.edges[p.edgeIds[0]].region : "JP";
  if (!Object.keys(sim.regionShare).length) updateRegionShares(sim, w);
}

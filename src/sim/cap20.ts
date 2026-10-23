/** Stage 20: a city on a tiny island cannot hold more people than the island can (area x PEOPLE_PER_KM2). What it would hold above that stays where it came from: it is handed back, to the person, to the
 *  other cities of the same prefecture in proportion to their 1950 size, so no one is created or lost. */
import { basePop } from "./roles";
import type { SimState } from "./types";
import type { World } from "./world";

export function enforceCaps(sim: SimState, w: World): void {
  const capped = w.cities.filter((c) => c.capPop !== undefined); if (!capped.length) return;
  for (const c of capped) {
    const st = sim.cities[c.id]; if (!st || st.pop <= c.capPop!) continue; let excess = st.pop - c.capPop!;
    const to = w.cities.filter((d) => d !== c && d.pref === c.pref && (d.capPop === undefined || sim.cities[d.id].pop < d.capPop)); if (!to.length) continue;
    const wt = to.map((d) => basePop(sim, w, d)), sw = wt.reduce((a, b) => a + b, 0) || 1; let given = 0, big = 0;
    to.forEach((d, i) => { const g = Math.floor((excess * wt[i]) / sw); sim.cities[d.id].pop += g; given += g; if (wt[i] > wt[big]) big = i; });
    sim.cities[to[big].id].pop += excess - given; st.pop -= excess; excess = 0;
  }
}

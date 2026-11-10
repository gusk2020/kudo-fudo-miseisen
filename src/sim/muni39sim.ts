/**
 * Stage 39 (the simulation side): which municipalities may stand where, and what becomes of the ones the player's terrain drowned.
 *  - A municipality's office point is FIXED: terrain edits never move it. If a lake the player made covers it, the municipality is abolished when the game starts: it leaves every active process, its
 *    people go to the other habitable municipalities of its prefecture (nobody is created or lost), its place and history are kept, its roads and railways are left as they are, and it is never revived.
 *  - Whether a municipality may be shown as a 市 is decided by the ground at its office point AFTER the edit (muni39.ts: 1300 m, 1950 relaxations); how well it can grow reads the ORIGINAL ground.
 */
import { CITY_FROM, eligible, type MuniKind } from "../core/muni39";
import { ev } from "./engine";
import { modeOf, type SimState } from "./types";
import type { WCity, World } from "./world";

export const isAbolished = (sim: Pick<SimState, "abolished39">, id: string): boolean => !!sim.abolished39?.[id];
/** 0..1: how well a road or railway reaches this cell (the nearest built node, within ACCESS_KM). */
export const ACCESS_KM = 20;
export function accessOf(sim: SimState, w: World, cell: number): number {
  const p = w.cellPos(cell); let best = Infinity;
  for (const e of Object.values(sim.edges)) { if (e.built < 1 || e.state === "lost" || e.facility === "ferry" || (e.state !== "open" && e.state !== "dormant")) continue; void modeOf;
    for (const k of [e.cells[0], e.cells[e.cells.length - 1]]) { const q = w.cellPos(k), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best) best = d; } }
  return isFinite(best) ? Math.max(0, 1 - best / ACCESS_KM) : 0;
}
export const reclaimedCell = (sim: SimState, cell: number): boolean => !!sim.rec34?.log.some((l) => l.k === cell);
/** May this municipality (a 市 candidate, or a settlement of `kind`) stand at `cell` in `year`? Water and made land never get an exception. */
export function mayStand(sim: SimState, w: World, cell: number, kind: MuniKind, year: number, pop: number): boolean {
  const e = w.elevM(cell); if (e < 1200) return true;   // (cheap exit: nothing below the lowest limit is ever restricted)
  return eligible({ kind, elevM: e, year, access: accessOf(sim, w, cell), demand: Math.min(1, pop / CITY_FROM), noException: w.t.land[cell] !== 1 || reclaimedCell(sim, cell) });
}
export const cityMayShow = (sim: SimState, w: World, c: WCity, year: number): boolean => mayStand(sim, w, c.cell, "city", year, sim.cities[c.id]?.pop ?? 0);

/** At the start of a game: abolish the municipalities whose office points the player's lakes cover. Returns how many. */
export function abolishSubmerged(sim: SimState, w: World): number {
  let n = 0; const dead = (sim.abolished39 ??= {});
  for (const c of w.cities) {
    if (!c.submerged || c.kind === "capital" || dead[c.id]) continue;   // (a prefecture's capital city holds its prefecture: it is kept)
    const st = sim.cities[c.id]; if (!st) continue; const pop = st.pop;
    dead[c.id] = { year: sim.startYear, pop, cell: c.cell, why: "役所の位置が、地形変換で作られた湖の下になった" }; st.pop = 0; n++;
    const to = w.cities.filter((d) => d.id !== c.id && d.pref === c.pref && !d.submerged && !dead[d.id] && (sim.cities[d.id]?.pop ?? 0) > 0), pool = to.length ? to : w.cities.filter((d) => d.id !== c.id && !d.submerged && !dead[d.id] && (sim.cities[d.id]?.pop ?? 0) > 0);
    const tot = pool.reduce((a, d) => a + sim.cities[d.id].pop, 0); let given = 0;
    pool.forEach((d, i) => { const g = i === pool.length - 1 ? pop - given : Math.round((sim.cities[d.id].pop / tot) * pop); sim.cities[d.id].pop += g; given += g; });
    ev(sim, "muni39", `${c.name}を廃止(役所の位置が湖の下)`, `地形変換の確定で役所の位置が水没した。人口${Math.round(pop / 1000)}千人は同じ府県のほかの市町村へ移った。道路・鉄道はそのまま。復活はしない`, { city: c.id });
  }
  return n;
}

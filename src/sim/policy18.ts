/**
 * Stage 18: what 海路重視 (kairo) and 空路重視 (kuuro) mean for building, in a Stage 17 game (`sim.pot17`; older games keep their rules).
 *   - no new sea-bed or lake-bed tunnels, except the rare exception below (a tunnel stays possible when the public benefit is exceptional: the ferry it replaces carries twice its capacity,
 *     the water is at most EXC_MAX_KM wide and the last exception is EXC_GAP_YEARS or more ago). The technology (3x speed, 3x reach, half cost, half time) is untouched.
 *   - new railway lines and railway upgrades to high speed are suppressed (a third of their usual score; high-speed upgrades not planned at all); electrifying and doubling an existing line is half as likely.
 *   - the other of the two (air for 海路, sea for 空路) is held back too: new ports/airports and expansions get a quarter of their usual appetite; the favoured one gets half as much again.
 * Nothing is ever taken away: existing roads, railways, ferries, ports and airports keep running and are maintained as before (the shrink rules of hubs.ts use the unsuppressed appetite).
 */
import type { SimState } from "./types";

export type Stance18 = "sea" | "air" | null;
export function stance18(sim: SimState): Stance18 {
  if (!sim.pot17?.c18 || !sim.kaigen) return null; const e = sim.kaigen.eras[sim.kaigen.eras.length - 1]?.stance; return e === "kairo" ? "sea" : e === "kuuro" ? "air" : null;
}
export const EXC_LOAD = 2, EXC_MAX_KM = 25, EXC_GAP_YEARS = 25, EXC_TAG = "【例外】";
/** Appetite multipliers for ports and airports: [sea, air]. */
export function hubAppetite18(sim: SimState): [number, number] { const s = stance18(sim); return s === "sea" ? [1.5, 0.25] : s === "air" ? [0.25, 1.5] : [1, 1]; }
export const RAIL_NEW_FACTOR = 0.33, RAIL_UPGRADE_FACTOR = 0.5;
/** May a water tunnel be started under the policy (the exception)? `load` = ferry traffic over its capacity. */
export function tunnelException18(sim: SimState, load: number, spanKm: number, y: number): boolean {
  return load >= EXC_LOAD && spanKm <= EXC_MAX_KM && y - (sim.lastTunnelException18 ?? -1e9) >= EXC_GAP_YEARS;
}
/** The size a place must reach before the held-back kind of port / airport is built is multiplied by this: [sea, air]. */
export function hubThreshold18(sim: SimState): [number, number] { const s = stance18(sim); return s === "sea" ? [1, 2] : s === "air" ? [2, 1] : [1, 1]; }

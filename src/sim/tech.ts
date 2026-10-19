/**
 * Tunnel and bridge technology, one rule for roads and railways alike (Issue #13).
 *
 * The brief (provisional): relative to history, technology advances twice as fast, facility cost and building time are each halved, and the
 * tunnel length that can be dug and the odds of getting through hard rock are doubled -- but a probability never exceeds 1, and "twice as long"
 * and "half the cost" must not be stacked on each other.
 *
 * How that is modelled, once, with one number K (= 2, provisional; change `TECH_K`):
 *  - PROGRESS: capability is a historical-style curve of the calendar year. The game reads it at `techYear = 1950 + K*(year-1950)`, i.e. progress runs
 *    K times as fast. This is the ONLY place reach and rock-success get their factor: they are read off the faster clock, so they are about 2x the
 *    historical values through the middle decades and simply saturate (probability at 1, length at the curve's ceiling) rather than being multiplied again.
 *  - COST and TIME: the cost of a facility edge and the months a project with a facility needs are each multiplied by 1/K, once, and only for the
 *    facility part (the ordinary line is unchanged). Stacking is avoided by keeping the two groups on different quantities: capability (can it be built, how
 *    likely) comes from the clock; money and months come from 1/K.
 *  - It is the same function for roads and railways: nothing here looks at the mode.
 * The curves are model values in the spirit of the real record (the longest tunnels were ~8 km around 1950, ~54 km with the 青函 tunnel by 1988); they are not statistics.
 */
export const TECH_K = 2;
/** Stage 13: the speed of underwater tunnelling a new game starts with (see TechState.wk). */
export const WATER_K = 3;
/**
 * `wk`: the speed of UNDERWATER tunnelling (sea and lake beds), a rule of its own, separate from `k` (which keeps governing bridges and ordinary land tunnels). Stage 13: 3 means
 * technology advances three times as fast as the historical curve, the length that can be driven is read off that faster clock (never multiplied again), and cost and building time are each half; 1 is the
 * historical course (the A/B baseline). Absent in older games: they keep the single rule.
 */
export interface TechState { k: number; wk?: number }
type Key = [number, number][];
const at = (k: Key, y: number) => { if (y <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (y <= k[i][0]) { const [a, va] = k[i - 1], [b, vb] = k[i]; return va + ((vb - va) * (y - a)) / (b - a); } return k[k.length - 1][1]; };
/** Longest tunnel (km) that can be driven, by technology year. */
export const TUNNEL_KM: Key = [[1950, 8], [1960, 13], [1975, 22], [1990, 40], [2010, 55], [2050, 70], [2150, 85]];
/** Longest sea crossing (km of open water) a bridge can span, by technology year. Model values: the real record runs from a few hundred metres (1950) to the Akashi Kaikyo bridge's 4 km main span and 9 km Seto-Ohashi line (1998). */
export const BRIDGE_KM: Key = [[1950, 1.5], [1960, 3], [1975, 6], [1990, 12], [2010, 20], [2050, 30], [2150, 40]];
/** Chance a tunnel through hard rock goes ahead without trouble, by technology year (capped at 1). */
export const ROCK_P: Key = [[1950, 0.4], [1975, 0.6], [2000, 0.8], [2025, 0.92], [2060, 1]];
export const techYear = (k: number, year: number) => 1950 + k * (year - 1950);
export interface TechNow { yEff: number; tunnelKm: number; bridgeKm: number; rockP: number; costMult: number; timeMult: number }
export function techAt(k: number, year: number): TechNow {
  const yEff = techYear(k, year);
  return { yEff, tunnelKm: at(TUNNEL_KM, yEff), bridgeKm: at(BRIDGE_KM, yEff), rockP: Math.min(1, Math.max(0, at(ROCK_P, yEff))), costMult: 1 / k, timeMult: 1 / k };
}
/** A cell stretch is "hard rock" when it stays high: the rock-success roll applies to tunnels that run above this elevation. */
export const HARD_ROCK_M = 1200;
/** The cost multiplier to apply to a facility edge, given the game's tech state (1 when the game has none: older saves). */
export const facilityCostMult = (tech: TechState | undefined, year: number): number => (tech ? techAt(tech.k, year).costMult : 1);

/** How much tunnelling and bridging take off the cost of crossing rough ground in year `y` (0 at the start, about 0.6 at the technology ceiling). Same for roads and railways. */
export const EASE_MAX = 0.6;
export const crossingEase = (tech: TechState | undefined, year: number): number => (tech ? Math.min(EASE_MAX, EASE_MAX * (techAt(tech.k, year).tunnelKm - TUNNEL_KM[0][1]) / (TUNNEL_KM[TUNNEL_KM.length - 1][1] - TUNNEL_KM[0][1]) * 1.6) : 0);

/** Stage 13: what underwater tunnelling can do in `year` at speed `wk` (see TechState). Three separate rules, each applied once: (1) the technology clock runs wk times faster (`yEff`); (2) at any technology year the reach is wk times the ordinary tunnel reach of that year (the ordinary curve read at `yEff`, then x wk -- the faster clock and the longer reach are different conditions, so both apply); (3) cost and time are each 1/(1+(wk-1)/2) (0.5 at wk 3), applied once and not stacked on (1) or (2). wk 1 is the historical baseline. */
export interface WaterTechNow { yEff: number; reachKm: number; costMult: number; timeMult: number }
export function waterTechAt(wk: number, year: number): WaterTechNow {
  const yEff = techYear(wk, year), f = 1 / (1 + (wk - 1) / 2);
  return { yEff, reachKm: wk * at(TUNNEL_KM, yEff), costMult: f, timeMult: f };
}
/** True for the edges the water-tunnel rule governs: a tunnel that is a fixed link across water (named link:...). */
export const isWaterTunnel = (e: { facility?: string; facilityName?: string }) => e.facility === "tunnel" && (e.facilityName ?? "").startsWith("link:");

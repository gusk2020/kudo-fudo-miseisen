/**
 * Stage 27: the 150-year cycle that begins with each relocation event (2200, 2350, 2500, ...):
 *   0 - 50 years   復興 (rebuilding): a strong, lasting wave of construction -- roads, railways, airports and ports are all paid from the same purse, so all of them grow;
 *                  cities gather toward the places the new seats and policy favour (the people are MOVED, never created: the move is zero-sum, see potGrowthOf).
 *   50 - 100       平衡 (balance): new building and upkeep in step, growth slows, the network settles.
 *   100 - 150      衰退 (decline): the purse shrinks; new works stop, upkeep is rationed (busiest roads first), so thin lines rest, close and fall to ruin while the busy ones stay;
 *                  what is left is what the next relocation can reuse and reopen.
 * Nothing is scripted by line or place: the cycle only moves two numbers -- the national transport purse and the strength of the redistribution of people -- and the existing rules do the rest
 * (maintenance by traffic, dormancy and closure by years of no demand, ruin by weathering, revival when demand returns). Before the first relocation the game runs as it always did.
 * All of it is a table below, so the speeds can be tuned; `cycleOf` is pure (read from the game's own record of its events, nothing new is saved).
 */
import type { SimState } from "./types";

export const CYCLE_YEARS = 150, PHASE_YEARS = 50;
export type CyclePhase = "rebuild" | "balance" | "decline";
export const PHASE_LABEL: Record<CyclePhase, string> = { rebuild: "復興期", balance: "平衡期", decline: "衰退期" };
/** The purse as a multiple of the 1990 peak, by years since the event (linear between points). It starts low (where the long decline had left it), climbs fast, stays high through the rebuilding, eases through the balance, and falls through the decline. */
export const BUDGET_POINTS: [number, number][] = [[0, 0.08], [6, 0.6], [25, 1.5], [50, 1.2], [100, 0.6], [150, 0.1]];
/** How strongly people move toward the favoured places (1 = the ordinary strength). */
export const GROWTH_BY_PHASE: Record<CyclePhase, number> = { rebuild: 1.7, balance: 1, decline: 0.6 };
export interface CycleInfo { phase: CyclePhase; /** 0..1 through the phase */ t: number; /** years since the event */ since: number; /** the purse relative to the 1990 peak */ budget: number; /** strength of the redistribution of people */ growth: number }

export function budgetAt(since: number, points = BUDGET_POINTS): number {
  if (since <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (since <= points[i][0]) { const [x0, y0] = points[i - 1], [x1, y1] = points[i]; return y0 + ((y1 - y0) * (since - x0)) / (x1 - x0); }
  return points[points.length - 1][1];
}
/** The phase the game is in, or null before the first relocation event. */
export function cycleOf(sim: Pick<SimState, "startYear" | "month" | "e2200">): CycleInfo | null {
  const e = sim.e2200; if (!e) return null;
  const since = Math.max(0, Math.min(CYCLE_YEARS - 1e-9, sim.startYear + sim.month / 12 - e.year)), k = Math.min(2, Math.floor(since / PHASE_YEARS)), phase: CyclePhase = (["rebuild", "balance", "decline"] as const)[k];
  // the redistribution eases from one phase's strength to the next over the last five years of a phase, so nothing jumps at 50 or 100
  const order: CyclePhase[] = ["rebuild", "balance", "decline"], within = since - k * PHASE_YEARS, next = k < 2 ? GROWTH_BY_PHASE[order[k + 1]] : GROWTH_BY_PHASE.rebuild, ramp = Math.max(0, (within - (PHASE_YEARS - 5)) / 5), growth = GROWTH_BY_PHASE[phase] + (next - GROWTH_BY_PHASE[phase]) * ramp * (k < 2 ? 1 : 0);
  return { phase, t: within / PHASE_YEARS, since, budget: budgetAt(since), growth };
}

/** How much the cycle lifts or damps the appetite to build (the era's own dial is the base): a floor in the rebuilding and early balance, a damping in the decline.
 *  Without it the era tables, which fall to 0.15-0.3 by 2100, would leave a bigger purse with nothing to spend it on. */
export const BUILD_FLOOR_POINTS: [number, number][] = [[0, 0.45], [8, 1.0], [50, 1.0], [75, 0.45], [100, 0]];
export const BUILD_DAMP_POINTS: [number, number][] = [[0, 1], [100, 1], [125, 0.3], [150, 0.1]];
export const AIR_SEA_FLOOR_POINTS: [number, number][] = [[0, 0.3], [10, 0.9], [50, 0.9], [80, 0.4], [100, 0]];
export function cycleShape(e2200: SimState["e2200"], year: number) {
  if (!e2200) return null; const since = Math.max(0, Math.min(CYCLE_YEARS - 1e-9, year - e2200.year));
  return { build: budgetAt(since, BUILD_FLOOR_POINTS), damp: budgetAt(since, BUILD_DAMP_POINTS), airsea: budgetAt(since, AIR_SEA_FLOOR_POINTS) };
}

/**
 * Stage 28: the natural increase the rebuilding brings -- a baby boom after a reconstruction, the way 1950-75 was (about +1.6% a year in the real run-up); added to the nation's demographic rate,
 * so the people are BORN (and the common rescale that keeps the nation on its course carries them), never moved or conjured between cities. It rises over the first years, holds through the
 * rebuilding, and is gone by the middle of the balance phase; the decline and the time before the first relocation keep the ordinary course. All of it is this table.
 */
export const GROWTH_RATE_POINTS: [number, number][] = [[0, 0], [8, 0.02], [40, 0.02], [55, 0.009], [100, 0.009], [115, 0], [150, 0]];
export const cycleGrowthRate = (sim: Pick<SimState, "startYear" | "month" | "e2200">): number => { const c = cycleOf(sim); return c ? budgetAt(c.since, GROWTH_RATE_POINTS) : 0; };

/**
 * Stage 28: how hard the rebuilding drives the works, 0..1 (0 outside the rebuilding and at the end of the balance): it lifts the yearly planning limits (route searches, regions looked at,
 * works a region may run at once) in step with the purse, so a bigger purse is not left idle behind a limit written for the ordinary years. The cost is the measured price of the extra works.
 */
export const REBUILD_DRIVE_MAX = { pathfinds: 0.75, regions: 0.5 };
export function rebuildDrive(e2200: SimState["e2200"], year: number): number { const cs = cycleShape(e2200, year); return cs ? Math.max(0, Math.min(1, (cs.build * cs.damp - 0.5) * 2)) : 0; }

/** Stage 28: in the rebuilding a closed or ruined line is brought back on a smaller demand and after fewer years of it (the ordinary rule is REVIVE_DEMAND / REVIVE_YEARS in engine.ts). */
export const REBUILD_REVIVE = { demandCut: 0.5, yearsCut: 1 };
export const reviveRule = (e2200: SimState["e2200"], year: number, demand: number, years: number) => { const d = rebuildDrive(e2200, year); return { demand: demand * (1 - REBUILD_REVIVE.demandCut * d), years: Math.max(1, years - Math.round(REBUILD_REVIVE.yearsCut * d)) }; };

/** Stage 28: how much slower the resting / closing clocks run at full drive (0.8 = a fifth of the speed). */
export const REBUILD_CLOCK_SLOW = 0.8;

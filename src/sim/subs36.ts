/**
 * Stage 36 M3: one or two sub-capitals. With two, each carries 0.7x of every SUB-CAPITAL-DERIVED development modifier a single sub-capital has
 * (the uplift over the neutral value: `1 + 0.7 * (m - 1)` for a multiplier). The capital's and the palace's effects and the baseline growth of cities are never scaled.
 * "1.4x in total" is only the sum of the two shares, not a promised outcome. The count changes only at the start and at a relocation event.
 */
import type { SimState } from "./types";

export const SUB2_SHARE = 0.7;
/** The sub-capital prefectures of a game, first one first (one or two). */
export const subPrefsOf = (sim: Pick<SimState, "subCapital" | "subCapital2">, fallback?: string): string[] => { const a = sim.subCapital ?? fallback; return [a, sim.subCapital2].filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i); };
/** The share of a single sub-capital's modifier that each sub-capital carries: 1 with one, 0.7 with two. */
export const subShareOf = (sim: Pick<SimState, "subCapital2">): number => (sim.subCapital2 ? SUB2_SHARE : 1);
/** A multiplier `full` (as one sub-capital would have it) scaled to the share. */
export const shareMult = (full: number, share: number): number => 1 + share * (full - 1);

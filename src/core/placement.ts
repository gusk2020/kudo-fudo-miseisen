/**
 * Stage 32: where a seat (capital, sub-capital, imperial residence) may stand, and how a tap that is not on land is corrected.
 * Pure functions over the world grid (`cell` is the current smallest spatial unit: 5 km). Nothing here knows about the UI.
 */
import type { Vec } from "./types";

export interface PlaceGrid { nx: number; ny: number; cell: number; t: { land: Uint8Array }; cellPos(k: number): Vec; cellOf(p: Vec): number; prefOf(k: number): string | null }
/** A cell a seat may stand on: simulated land that belongs to a prefecture (lakes and sea never). */
export const isSeatCell = (g: PlaceGrid, k: number) => k >= 0 && g.t.land[k] === 1 && !!g.prefOf(k);

/**
 * The land cell nearest (straight line, between cell centres) to `p` among ALL of Japan's simulated land -- not limited to a prefecture or an island.
 * Rings of cells are searched outwards and the search stops as soon as no later ring can hold a nearer cell, so a tap close to a coast is cheap
 * and one far out at sea scans at most the grid once (344 x 447 cells). `km` is the distance from `p` to the cell's centre.
 */
export function nearestLandCell(g: PlaceGrid, p: Vec): { k: number; pos: Vec; km: number } | null {
  const c0 = g.cellOf(p); let i0: number, j0: number;
  if (c0 >= 0) { i0 = c0 % g.nx; j0 = (c0 / g.nx) | 0; }
  else { const q = g.cellPos(0), r0 = g.cell; i0 = Math.max(0, Math.min(g.nx - 1, Math.round((p[0] - q[0]) / r0))); j0 = Math.max(0, Math.min(g.ny - 1, Math.round((p[1] - q[1]) / r0))); }
  let best = -1, bd = Infinity; const maxR = Math.max(g.nx, g.ny);
  for (let r = 0; r <= maxR; r++) {
    if (best >= 0 && (r - 1) * g.cell > bd) break;   // (the ring's nearest possible cell is farther than what has been found)
    for (let dj = -r; dj <= r; dj++) {
      const j = j0 + dj; if (j < 0 || j >= g.ny) continue; const edge = Math.abs(dj) === r;
      for (let di = -r; di <= r; di += edge ? 1 : Math.max(1, 2 * r)) {
        const i = i0 + di; if (i < 0 || i >= g.nx) continue; const k = j * g.nx + i; if (!isSeatCell(g, k)) continue;
        const q = g.cellPos(k), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = k; }
      }
    }
  }
  return best < 0 ? null : { k: best, pos: g.cellPos(best), km: bd };
}

export type Dir = "up" | "down" | "left" | "right";
/** One fine-adjust step: one cell north / south / west / east of the cell `p` is in (world y grows northward). Null when that cell is not a seat cell (sea, lake, off the grid). */
export function stepSeat(g: PlaceGrid, p: Vec, dir: Dir): { k: number; pos: Vec } | null {
  const k0 = g.cellOf(p); if (k0 < 0) return null; const i = (k0 % g.nx) + (dir === "right" ? 1 : dir === "left" ? -1 : 0), j = ((k0 / g.nx) | 0) + (dir === "up" ? 1 : dir === "down" ? -1 : 0);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null; const k = j * g.nx + i; return isSeatCell(g, k) ? { k, pos: g.cellPos(k) } : null;
}
/** The one rule between seats: capital and sub-capital are in different prefectures. The imperial residence is free (it may share either's prefecture, even its point). */
export function seatConflict(which: "capital" | "sub" | "sub2" | "palace", pref: string, others: { capital: string; sub: string; sub2?: string }): boolean {
  if (which === "sub2") return pref === others.capital || pref === others.sub;   // Stage 36 M3: the second sub-capital is in a third prefecture
  return (which === "capital" && (pref === others.sub || pref === others.sub2)) || (which === "sub" && (pref === others.capital || pref === others.sub2));
}

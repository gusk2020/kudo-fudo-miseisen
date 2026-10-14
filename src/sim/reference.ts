/**
 * Reference alignments: where real railways and roads run (Natural Earth 1:10m, public domain), rasterised onto the 5 km grid.
 * They only steer path-finding (a cell on a real line is cheap), so the starting network follows the real corridors without copying
 * any single real line: the 1950-style network is a reconstruction, and the simulation is not a statement about any real line.
 */
import REF from "../data/reference-lines.json";
import type { World } from "./world";

export interface RefGrids {
  rail: Uint8Array;        // 0 none, 1 within a cell of a real line, 2 on a real line
  road: Uint8Array;
  railElectric: Uint8Array; // 1 where the reference marks the line electrified (used for a 1950-ish standard)
  railMulti: Uint8Array;    // 1 where the reference marks multiple tracks
}
const cache = new WeakMap<World, RefGrids>();
type Line = { pts: [number, number][]; electric?: number | null; tracks?: number | null };

function raster(w: World, lines: Line[], grid: Uint8Array, extra?: (l: Line, k: number) => void) {
  for (const l of lines) {
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const a = l.pts[i], b = l.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / (w.cell * 0.5)));
      for (let s = 0; s <= n; s++) {
        const k = w.cellOf([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
        if (k < 0 || w.t.land[k] !== 1) continue;
        grid[k] = 2; extra?.(l, k);
      }
    }
  }
  const on: number[] = []; for (let k = 0; k < grid.length; k++) if (grid[k] === 2) on.push(k);
  for (const k of on) { const i = k % w.nx, j = (k / w.nx) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue; const q = b * w.nx + a; if (grid[q] === 0 && w.t.land[q] === 1) grid[q] = 1; } }
}
export function referenceGrids(w: World): RefGrids {
  const hit = cache.get(w); if (hit) return hit;
  const g: RefGrids = { rail: new Uint8Array(w.N), road: new Uint8Array(w.N), railElectric: new Uint8Array(w.N), railMulti: new Uint8Array(w.N) };
  raster(w, REF.rail as unknown as Line[], g.rail, (l, k) => { if (l.electric) g.railElectric[k] = 1; if ((l.tracks ?? 1) > 1) g.railMulti[k] = 1; });
  raster(w, REF.road as unknown as Line[], g.road);
  cache.set(w, g); return g;
}
/** Path-finding bias: cells on a reference line cost a third, cells beside it 0.7. */
export const refBias = (grid: Uint8Array) => (k: number) => (grid[k] === 2 ? 0.33 : grid[k] === 1 ? 0.7 : 1);
/** Share of a path's cells that lie on or beside a reference line: 'is there really a corridor here'. */
export function refCoverage(grid: Uint8Array, path: number[]): number { let n = 0; for (const k of path) if (grid[k] >= 1) n++; return path.length ? n / path.length : 0; }

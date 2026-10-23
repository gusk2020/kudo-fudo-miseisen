/** Stage 20: the small and far islands, put on the world (never on the terrain: the terrain hash and every older save stay as they were; only a game made from Stage 20 on is built on this world, `sim.isl20`).
 *  The 5 km grid reaches neither Etorofu nor Yonaguni, so the grid is widened (same cell size, same origin lattice, so a cell keeps its position). Each island is an ellipse of its real length, width and bearing; a
 *  cell the island touches becomes land unless it already is land. Every island gets an island number of its own, so the roads treat it as a land mass a road cannot reach and the ferries join it. */
import { ISLETS, isletPos, type Islet } from "../core/islets";
import type { TerrainResult } from "../core/terrain";
import type { Vec } from "../core/types";

/** One island as the world holds it. `cells` are the grid cells it covers (empty = the island was already on the grid as land). */
export interface IsletCell { islet: Islet; pos: Vec; cells: number[]; cell: number; island: number; existing: boolean; areaKm2: number }
export const ISLET_ISLAND_BASE = 16;   // island numbers 1.. are the four big islands (+ spare); islets take BASE + index
export const ISLET_PAD_CELLS = 3;

export function withIslets(t: TerrainResult): TerrainResult {
  if (t.islets) return t;
  const { x0, y0, cell, nx, ny } = t.grid, pos = ISLETS.map(isletPos);
  let bx0 = x0, by0 = y0, bx1 = x0 + nx * cell, by1 = y0 + ny * cell;
  for (const p of pos) { bx0 = Math.min(bx0, p[0] - ISLET_PAD_CELLS * cell); by0 = Math.min(by0, p[1] - ISLET_PAD_CELLS * cell); bx1 = Math.max(bx1, p[0] + ISLET_PAD_CELLS * cell); by1 = Math.max(by1, p[1] + ISLET_PAD_CELLS * cell); }
  const sx = Math.round((x0 - (x0 + Math.floor((bx0 - x0) / cell) * cell)) / cell), sy = Math.round((y0 - (y0 + Math.floor((by0 - y0) / cell) * cell)) / cell);   // columns / rows added left and below
  const nx2 = nx + sx + Math.max(0, Math.ceil((bx1 - (x0 + nx * cell)) / cell)), ny2 = ny + sy + Math.max(0, Math.ceil((by1 - (y0 + ny * cell)) / cell)), X0 = x0 - sx * cell, Y0 = y0 - sy * cell, N2 = nx2 * ny2;
  const land = new Uint8Array(N2), island = new Uint8Array(N2), pref = new Uint8Array(N2), plains = new Uint8Array(N2), elev = new Float32Array(N2).fill(-200), ridge = new Float32Array(N2), barrier = new Float32Array(N2);
  for (let j = 0; j < ny; j++) { const a = j * nx, b = (j + sy) * nx2 + sx; land.set(t.land.subarray(a, a + nx), b); island.set(t.island.subarray(a, a + nx), b); pref.set(t.pref.subarray(a, a + nx), b); plains.set(t.plains.subarray(a, a + nx), b); elev.set(t.elev.subarray(a, a + nx), b); ridge.set(t.ridge.subarray(a, a + nx), b); barrier.set(t.barrier.subarray(a, a + nx), b); }
  const at = (p: Vec) => { const i = Math.floor((p[0] - X0) / cell), j = Math.floor((p[1] - Y0) / cell); return i < 0 || j < 0 || i >= nx2 || j >= ny2 ? -1 : j * nx2 + i; };
  const out: IsletCell[] = [];
  ISLETS.forEach((s, n) => {
    const p = pos[n], c0 = at(p), id = ISLET_ISLAND_BASE + n, pi = Math.max(0, t.prefOrder.indexOf(s.pref) + 1);
    // already on the grid as land (a big island the grid holds): nothing to add, the island is just named
    if (c0 >= 0 && land[c0] === 1) { out.push({ islet: s, pos: p, cells: [], cell: c0, island: island[c0], existing: true, areaKm2: s.area }); return; }
    const a = Math.max(s.len, 0.5) / 2, b = Math.max(s.wid, 0.5) / 2, th = (s.bear * Math.PI) / 180, ux = Math.sin(th), uy = Math.cos(th), reach = Math.max(a, b) / cell + 1;
    const ci = Math.floor((p[0] - X0) / cell), cj = Math.floor((p[1] - Y0) / cell), cells: { k: number; r: number }[] = [];
    for (let dj = -Math.ceil(reach); dj <= Math.ceil(reach); dj++) for (let di = -Math.ceil(reach); di <= Math.ceil(reach); di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx2 || j >= ny2) continue;
      const dx = X0 + (i + 0.5) * cell - p[0], dy = Y0 + (j + 0.5) * cell - p[1], u = dx * ux + dy * uy, v = -dx * uy + dy * ux, r = Math.hypot(u / a, v / b);
      if (r <= 1 || (di === 0 && dj === 0)) cells.push({ k: j * nx2 + i, r });
    }
    const mine: number[] = [];
    for (const { k, r } of cells) { if (land[k] !== 0 || island[k] !== 0) continue; land[k] = 1; island[k] = id; pref[k] = pi; elev[k] = Math.max(5, s.elev * (1 - 0.6 * Math.min(1, r))); plains[k] = s.elev < 80 ? 1 : 0; mine.push(k); }
    // the centre cell was taken by a neighbouring island or by the coast: the nearest free sea cell that touches this island's footprint, else it shares
    let cen = c0; if (mine.length && !mine.includes(c0)) { let bd = Infinity; for (const k of mine) { const d = Math.hypot(((k % nx2) + 0.5) * cell + X0 - p[0], (((k / nx2) | 0) + 0.5) * cell + Y0 - p[1]); if (d < bd) { bd = d; cen = k; } } }
    out.push({ islet: s, pos: p, cells: mine, cell: mine.length ? cen : c0, island: mine.length ? id : (c0 >= 0 ? island[c0] : id), existing: !mine.length, areaKm2: s.area });
  });
  return { ...t, grid: { x0: X0, y0: Y0, cell, nx: nx2, ny: ny2 }, land, island, pref, plains, elev, ridge, barrier, islets: out };
}

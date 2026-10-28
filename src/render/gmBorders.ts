/**
 * Stage 26: which lines of 地球地図日本's polygons are the COAST and which are the border between two prefectures.
 * The data (dataofjapan/land) is one polygon per prefecture with shared vertices, so a segment two polygons both carry is a prefecture border and a segment only one carries is a coastline.
 * Before this, every polygon was stroked whole as "coast": the real borders were drawn (twice) as coastline, while the game's own cell-assignment borders (terrain.ts, stair-steps of its grid) were drawn
 * as well in purple -- two different borders in two places. Now the real border is drawn once, as a border, and the grid's stair-steps stay only where the real data has no border at all (inside Hokkaido's three regions).
 * Pure: no pixi, no DOM.
 */
export interface GmSplit { coast: number[]; border: number[] }   // [lon*1000, lat*1000, lon*1000, lat*1000] per segment
export function splitGmj(polys: number[][]): GmSplit {
  const count = new Map<string, number>(), segs: [number, number, number, number, string][] = [];
  for (const p of polys) {
    const n = p.length >> 1; if (n < 2) continue; const closed = p[0] === p[2 * n - 2] && p[1] === p[2 * n - 1], m = closed ? n - 1 : n;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n, x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1]; if (x1 === x2 && y1 === y2) continue;
      const key = x1 < x2 || (x1 === x2 && y1 <= y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`; count.set(key, (count.get(key) ?? 0) + 1); segs.push([x1, y1, x2, y2, key]);
    }
  }
  const coast: number[] = [], border: number[] = [], seen = new Set<string>();
  for (const [x1, y1, x2, y2, key] of segs) { if ((count.get(key) ?? 1) >= 2) { if (seen.has(key)) continue; seen.add(key); border.push(x1, y1, x2, y2); } else coast.push(x1, y1, x2, y2); }
  return { coast, border };
}
/** The cell-assignment border segments (world km, x1 y1 x2 y2) that lie between two cells of the SAME group of prefectures `inside` (e.g. Hokkaido's three regions) -- the only borders the real data does not have. */
export function gridBordersWithin(grid: { x0: number; y0: number; cell: number; nx: number; ny: number }, land: ArrayLike<number>, pref: ArrayLike<number>, inside: (prefIndex: number) => boolean): number[] {
  const { x0, y0, cell, nx, ny } = grid, out: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!land[k]) continue;
    if (i + 1 < nx && land[k + 1] && pref[k] !== pref[k + 1] && inside(pref[k]) && inside(pref[k + 1])) out.push(x0 + (i + 1) * cell, y0 + j * cell, x0 + (i + 1) * cell, y0 + (j + 1) * cell);
    if (j + 1 < ny && land[k + nx] && pref[k] !== pref[k + nx] && inside(pref[k]) && inside(pref[k + nx])) out.push(x0 + i * cell, y0 + (j + 1) * cell, x0 + (i + 1) * cell, y0 + (j + 1) * cell);
  }
  return out;
}

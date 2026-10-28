/**
 * Stage 26: which lines of 地球地図日本's polygons are the COAST and which are the border between two prefectures.
 * The data (dataofjapan/land) is one polygon per prefecture with shared vertices, so a segment two polygons both carry is a prefecture border and a segment only one carries is a coastline.
 * Before this, every polygon was stroked whole as "coast": the real borders were drawn (twice) as coastline, while the game's own cell-assignment borders (terrain.ts, stair-steps of its grid) were drawn
 * as well in purple -- two different borders in two places. Now the real border is drawn once, as a border, and the grid's stair-steps stay only where the real data has no border at all (inside Hokkaido's three regions).
 * Pure: no pixi, no DOM.
 */
export interface GmSplit { coast: number[]; border: number[] }   // [lon*1000, lat*1000, lon*1000, lat*1000] per segment
const EPS = 3;   // how far (in 1/1000 degree, ~300 m) to step to either side of a segment to see what lies there
const CELL = 500;
function inside(p: number[], x: number, y: number): boolean {
  let c = false; const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
/**
 * Stage 27: coast or border, decided by what is on the OTHER side of each segment. (Stage 26 asked only whether two polygons carried the identical segment; but the data's polygons were simplified one by one, so most
 * borders -- Nara, Wakayama, Mie among them -- have two near-identical but not identical copies, were taken for "coast" twice, and showed as a double line.)
 * For each segment of polygon P: step a little to both sides; the side inside P is P's own, the other side is land (another polygon Q holds it) -> a border, or sea -> coast.
 * Both polygons carry their copy of a border, so only the one of the lower-numbered polygon is kept: one line.
 */
export function splitGmj(polys: number[][]): GmSplit {
  const boxes = polys.map((p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; } return [x0, y0, x1, y1]; });
  const grid = new Map<string, number[]>(); const key = (cx: number, cy: number) => `${cx},${cy}`;
  boxes.forEach((b, k) => { for (let cx = Math.floor((b[0] - EPS) / CELL); cx <= Math.floor((b[2] + EPS) / CELL); cx++) for (let cy = Math.floor((b[1] - EPS) / CELL); cy <= Math.floor((b[3] + EPS) / CELL); cy++) { const kk = key(cx, cy), l = grid.get(kk); if (l) l.push(k); else grid.set(kk, [k]); } });
  const holders = (x: number, y: number, skip: number): number => {   // the lowest-numbered polygon other than `skip` that holds the point (-1 = none)
    const l = grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))); if (!l) return -1; let best = -1;
    for (const k of l) { if (k === skip) continue; const b = boxes[k]; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; if ((best < 0 || k < best) && inside(polys[k], x, y)) best = k; }
    return best;
  };
  const coast: number[] = [], border: number[] = [];
  polys.forEach((p, k) => {
    const n = p.length >> 1; if (n < 2) return; const closed = p[0] === p[2 * n - 2] && p[1] === p[2 * n - 1], m = closed ? n - 1 : n;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n, x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); if (!len) continue;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, nx = (-dy / len) * EPS, ny = (dx / len) * EPS, a = inside(p, mx + nx, my + ny), b = inside(p, mx - nx, my - ny);
      let other = -1;
      if (a !== b) other = a ? holders(mx - nx, my - ny, k) : holders(mx + nx, my + ny, k);   // the side that is not this polygon's own
      if (other < 0) coast.push(x1, y1, x2, y2); else if (k < other) border.push(x1, y1, x2, y2);   // (the other polygon's copy of the same border is dropped)
    }
  });
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

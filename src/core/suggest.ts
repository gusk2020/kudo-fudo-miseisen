import { pointInPolygon, simplifyLine } from "./geom";
import type { AxisFrame } from "./constraints";
import type { Vec } from "./types";

/** A default ridge for one half of Honshu: follows the middle of the island's width along its long axis. */
export function suggestRidge(outline: Vec[], f: AxisFrame, half: "sw" | "ne"): Vec[] {
  const span = f.tMax - f.tMin, perp: Vec = [-f.dir[1], f.dir[0]], pts: Vec[] = [];
  const [a, b] = half === "sw" ? [0.07, 0.45] : [0.55, 0.93];
  for (let k = 0; k <= 12; k++) {
    const t = a + ((b - a) * k) / 12, along = f.tMin + t * span;
    const base: Vec = [f.c[0] + f.dir[0] * along, f.c[1] + f.dir[1] * along];
    let best: Vec | null = null, bestAbs = Infinity, runStart = -1e9;
    const at = (o: number): Vec => [base[0] + perp[0] * o, base[1] + perp[1] * o];
    for (let o = -500; o <= 500; o += 3) {
      const inside = pointInPolygon(at(o), outline);
      if (inside && runStart === -1e9) runStart = o;
      if ((!inside || o + 3 > 500) && runStart !== -1e9) {
        const mid = (runStart + (inside ? o : o - 3)) / 2;
        if (Math.abs(mid) < bestAbs) { bestAbs = Math.abs(mid); best = at(mid); }
        runStart = -1e9;
      }
    }
    if (best) pts.push(best);
  }
  for (let pass = 0; pass < 3; pass++) // light smoothing; a point only moves if it stays inside the island
    for (let i = 1; i < pts.length - 1; i++) { const m: Vec = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4]; if (pointInPolygon(m, outline)) pts[i] = m; }
  return simplifyLine(pts, 4);
}

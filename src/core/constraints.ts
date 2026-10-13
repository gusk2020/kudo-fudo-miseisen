/** Pure placement rules. No rendering, no DOM: input is world-space geometry, output is verdicts. */
import { centroid, containsWithClearance, dist, dot, polygonsOverlap, principalAxis, scaleAbout, sub } from "./geom";
import type { Vec } from "./types";

export const HOKKAIDO_MIN_T = 0.5;   // centre must lie in Honshu's NE half (t >= 0.5)
export const KYUSHU_MAX_T = 0.5;     // centre must lie in Honshu's SW half (t <= 0.5)
export const AREA_CHECK_FACTOR = 1.2; // judging shape = 1.2x AREA, i.e. linear factor sqrt(1.2)
export const LINEAR_CHECK_FACTOR = Math.sqrt(AREA_CHECK_FACTOR);
export const COAST_CLEARANCE_KM = 1;

export interface AxisFrame { c: Vec; dir: Vec; tMin: number; tMax: number }
/**
 * Honshu's local long axis, signed so it points to the island's own north-east end.
 * `neRef` is the real NE direction rotated by the island's current placement rotation.
 */
export function axisFrame(mainOutline: Vec[], neRef: Vec): AxisFrame {
  const pa = principalAxis(mainOutline);
  let dir = pa.dir;
  if (dot(dir, neRef) < 0) dir = [-dir[0], -dir[1]];
  let tMin = Infinity, tMax = -Infinity;
  for (const q of mainOutline) { const t = dot(sub(q, pa.c), dir); if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
  return { c: pa.c, dir, tMin, tMax };
}
export const tOf = (f: AxisFrame, p: Vec) => (dot(sub(p, f.c), f.dir) - f.tMin) / (f.tMax - f.tMin);

export const hokkaidoOk = (f: AxisFrame, hokkaidoMain: Vec[]) => tOf(f, centroid(hokkaidoMain)) >= HOKKAIDO_MIN_T;
export const kyushuOk = (f: AxisFrame, kyushuMain: Vec[]) => tOf(f, centroid(kyushuMain)) <= KYUSHU_MAX_T;

/** Parameter of p along the Kyushu->Hokkaido centre line (0 at Kyushu, 1 at Hokkaido). */
export function uOnKH(kc: Vec, hc: Vec, p: Vec): number {
  const d = sub(hc, kc), l2 = dot(d, d);
  return l2 === 0 ? NaN : dot(sub(p, kc), d) / l2;
}
export const inKHRange = (kc: Vec, hc: Vec, p: Vec) => { const u = uOnKH(kc, hc, p); return u >= 0 && u <= 1; };

export function featureInside(honshuMain: Vec[], shape: Vec[]): boolean {
  return containsWithClearance(honshuMain, scaleAbout(shape, centroid(shape), LINEAR_CHECK_FACTOR), COAST_CLEARANCE_KM);
}
export function featuresOverlap(a: Vec[], b: Vec[]): boolean {
  return polygonsOverlap(scaleAbout(a, centroid(a), LINEAR_CHECK_FACTOR), scaleAbout(b, centroid(b), LINEAR_CHECK_FACTOR));
}
export function islandsOverlap(a: Vec[][], b: Vec[][]): boolean {
  for (const p of a) for (const q of b) if (polygonsOverlap(p, q)) return true;
  return false;
}
export { dist };

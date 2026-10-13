import type { Vec } from "./types";

export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Vec) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const rot = (a: Vec, ang: number): Vec => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; };

export function polyArea(p: Vec[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export function centroid(p: Vec[]): Vec {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], w = a[0] * b[1] - b[0] * a[1];
    A += w; cx += (a[0] + b[0]) * w; cy += (a[1] + b[1]) * w;
  }
  if (Math.abs(A) < 1e-9) { const n = p.length || 1; return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]; }
  return [cx / (3 * A), cy / (3 * A)];
}
export function bbox(p: Vec[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  return [x0, y0, x1, y1];
}
export function pointInPolygon(pt: Vec, p: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function orient(a: Vec, b: Vec, c: Vec) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
/** Proper crossing of two segments (shared endpoints do not count). */
export function segCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0)) && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
/** Number of crossing edge pairs of a closed polygon with itself (non-adjacent edges). */
export function selfIntersections(p: Vec[], limit = 1): number {
  const n = p.length; let found = 0;
  const bx0 = new Float64Array(n), bx1 = new Float64Array(n), by0 = new Float64Array(n), by1 = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; bx0[i] = Math.min(a[0], b[0]); bx1[i] = Math.max(a[0], b[0]); by0[i] = Math.min(a[1], b[1]); by1[i] = Math.max(a[1], b[1]); }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (bx1[i] < bx0[j] || bx1[j] < bx0[i] || by1[i] < by0[j] || by1[j] < by0[i]) continue;
      if (segCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) { if (++found >= limit) return found; }
    }
  }
  return found;
}
export function polygonsCross(a: Vec[], b: Vec[]): boolean {
  const ba = bbox(a), bb = bbox(b);
  if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    if (Math.max(p[0], q[0]) < bb[0] || Math.min(p[0], q[0]) > bb[2] || Math.max(p[1], q[1]) < bb[1] || Math.min(p[1], q[1]) > bb[3]) continue;
    for (let j = 0; j < b.length; j++) if (segCross(p, q, b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}
/** Overlap = edges cross, or one polygon lies wholly inside the other. */
export function polygonsOverlap(a: Vec[], b: Vec[]): boolean {
  if (polygonsCross(a, b)) return true;
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}
export function pointSegDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}
export function pointPolyEdgeDist(p: Vec, poly: Vec[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}
/** Minimum distance between the boundaries of two polygons (vertex-to-edge both ways). */
export function boundaryClearance(a: Vec[], b: Vec[]): number {
  let m = Infinity;
  for (const p of a) m = Math.min(m, pointPolyEdgeDist(p, b));
  for (const p of b) m = Math.min(m, pointPolyEdgeDist(p, a));
  return m;
}
/** inner lies strictly inside outer with at least `clearance` km to the boundary. */
export function containsWithClearance(outer: Vec[], inner: Vec[], clearance: number): boolean {
  for (const p of inner) if (!pointInPolygon(p, outer)) return false;
  if (polygonsCross(outer, inner)) return false;
  return boundaryClearance(outer, inner) >= clearance;
}
export function scaleAbout(p: Vec[], c: Vec, k: number): Vec[] { return p.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k] as Vec); }
/** Principal axis (unit) and standard deviations along (major, minor) from vertex covariance. */
export function principalAxis(p: Vec[]): { c: Vec; dir: Vec; sMajor: number; sMinor: number } {
  const n = p.length; let mx = 0, my = 0;
  for (const q of p) { mx += q[0]; my += q[1]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of p) { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: [mx, my], dir: [Math.cos(ang), Math.sin(ang)], sMajor: Math.sqrt(Math.max(l1, 0)), sMinor: Math.sqrt(Math.max(l2, 0)) };
}
/** Insert points so no edge is longer than maxSeg (closed polygon). */
export function densify(p: Vec[], maxSeg: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], n = Math.max(1, Math.ceil(dist(a, b) / maxSeg));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
/** Douglas-Peucker for an open polyline. */
export function simplifyLine(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1]; let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = pointSegDist(pts[i], a, b); if (d > best) { best = d; bi = i; } }
  if (best <= tol) return [a, b];
  return [...simplifyLine(pts.slice(0, bi + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(bi), tol)];
}

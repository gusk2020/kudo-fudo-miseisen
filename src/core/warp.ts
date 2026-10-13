import type { Op, Vec } from "./types";

export const MAX_PULL_RATIO = 0.6;   // |d| <= 0.6 r keeps one pull from folding the map
export const MAX_BULGE = 0.6;

const falloff = (t: number) => (t >= 1 ? 0 : (1 - t * t) * (1 - t * t));

export function applyOp(op: Op, q: Vec): Vec {
  const dx = q[0] - op.c[0], dy = q[1] - op.c[1];
  const t = Math.hypot(dx, dy) / op.r;
  if (t >= 1) return q;
  const w = falloff(t);
  if (op.t === "pull") return [q[0] + op.d[0] * w, q[1] + op.d[1] * w];
  return [q[0] + dx * op.k * w, q[1] + dy * op.k * w];
}
export function warpPoint(ops: readonly Op[], q: Vec): Vec {
  let p = q;
  for (let i = 0; i < ops.length; i++) p = applyOp(ops[i], p);
  return p;
}
/** Clamp an op's strength so a single op cannot fold the surface by itself. */
export function clampOp(op: Op): Op {
  if (op.t === "pull") {
    const m = Math.hypot(op.d[0], op.d[1]), lim = op.r * MAX_PULL_RATIO;
    if (m > lim) return { ...op, d: [(op.d[0] * lim) / m, (op.d[1] * lim) / m] };
    return op;
  }
  return { ...op, k: Math.max(-MAX_BULGE, Math.min(MAX_BULGE, op.k)) };
}
/** Singular values of the warp's Jacobian at q (central differences). */
export function jacobianSV(ops: readonly Op[], q: Vec, h = 1): { det: number; smax: number; smin: number } {
  const px = warpPoint(ops, [q[0] + h, q[1]]), mx = warpPoint(ops, [q[0] - h, q[1]]);
  const py = warpPoint(ops, [q[0], q[1] + h]), my = warpPoint(ops, [q[0], q[1] - h]);
  const a = (px[0] - mx[0]) / (2 * h), c = (px[1] - mx[1]) / (2 * h), b = (py[0] - my[0]) / (2 * h), d = (py[1] - my[1]) / (2 * h);
  const det = a * d - b * c, f = a * a + b * b + c * c + d * d, disc = Math.sqrt(Math.max(0, f * f - 4 * det * det));
  return { det, smax: Math.sqrt((f + disc) / 2), smin: Math.sqrt(Math.max(0, (f - disc) / 2)) };
}
/** Numerical inverse of warpPoint (Newton), starting from the target itself. */
export function unwarpPoint(ops: readonly Op[], target: Vec, iters = 12): Vec {
  let x: Vec = [target[0], target[1]];
  for (let i = 0; i < iters; i++) {
    const f = warpPoint(ops, x), ex = f[0] - target[0], ey = f[1] - target[1];
    if (Math.hypot(ex, ey) < 1e-7) break;
    const h = 0.5;
    const px = warpPoint(ops, [x[0] + h, x[1]]), py = warpPoint(ops, [x[0], x[1] + h]);
    const a = (px[0] - f[0]) / h, c = (px[1] - f[1]) / h, b = (py[0] - f[0]) / h, d = (py[1] - f[1]) / h;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) break;
    x = [x[0] - (d * ex - b * ey) / det, x[1] - (-c * ex + a * ey) / det];
  }
  return x;
}

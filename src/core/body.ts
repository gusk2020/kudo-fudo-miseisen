import { add, rot, sub } from "./geom";
import { BODY_DEFS } from "./data";
import type { BodyState, IslandId, Op, Place, Vec } from "./types";
import { unwarpPoint, warpPoint } from "./warp";

export function localToWorld(bs: BodyState, q: Vec, extraOp?: Op): Vec {
  let w = warpPoint(bs.ops, q);
  if (extraOp) w = warpPoint([extraOp], w);
  const r = rot([w[0] * bs.place.scale, w[1] * bs.place.scale], bs.place.rot);
  return add(r, bs.place.pos);
}
/** Local frame *after* all ops (what a finger on the screen points at). */
export function worldToPostOps(place: Place, w: Vec): Vec {
  const r = rot(sub(w, place.pos), -place.rot);
  return [r[0] / place.scale, r[1] / place.scale];
}
export function worldToLocal(bs: BodyState, w: Vec): Vec { return unwarpPoint(bs.ops, worldToPostOps(bs.place, w)); }
export function realToWorld(id: IslandId, bs: BodyState, real: Vec): Vec { const o = BODY_DEFS[id].origin; return localToWorld(bs, [real[0] - o[0], real[1] - o[1]]); }
export function worldToReal(id: IslandId, bs: BodyState, w: Vec): Vec { const o = BODY_DEFS[id].origin, l = worldToLocal(bs, w); return [l[0] + o[0], l[1] + o[1]]; }
export function worldParts(id: IslandId, bs: BodyState, extraOp?: Op): Vec[][] {
  return BODY_DEFS[id].parts.map((p) => p.map((q) => localToWorld(bs, q, extraOp)));
}

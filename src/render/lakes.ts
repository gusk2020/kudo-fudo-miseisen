/**
 * Stage 29: the lakes of the real map -- Japan's main lakes and brackish lakes, with the islands in them -- drawn from their own outlines (src/data/lakes.json, from OpenStreetMap by tools/build_lakes.py).
 * Display only: nothing here reads or changes the game, the terrain or its hash. A lake is a filled outline in the lake colour with a thin darker shore; its islands are holes cut out of it, so the land shows
 * through them (water and land are told apart by the shape itself, never by a second guess). 琵琶湖 itself is the map's own editable feature, so it is not drawn here; only its islands are, and only while
 * that feature stands where it began.
 */
import { Graphics } from "pixi.js";
import LAKES from "../data/lakes.json";
import { lonLatToReal } from "../core/data";
import { WATER } from "./water";

export interface LakeRec { name: string; kind: "lake" | "brackish"; km2: number; outer: number[][]; holes: number[][][]; islands?: { name: string; km2: number }[] }
const RAW = (LAKES as unknown as { lakes: LakeRec[] }).lakes;
/** An island is kept only if its middle is inside its lake's outline (so land and water never contradict each other: an "island" outside the lake would cut a hole in dry land). */
const ringMid = (r: number[][]): [number, number] => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];
const inRing = (p: [number, number], ring: number[][]): boolean => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
export const LAKE_LIST: LakeRec[] = RAW.map((l) => ({ ...l, holes: l.holes.filter((h) => h.length >= 3 && inRing(ringMid(h), l.outer)) }));
export const RAW_HOLE_COUNT = RAW.reduce((t, l) => t + l.holes.filter((h) => h.length >= 3).length, 0);   // (an islet reduced to two points by the simplification is no island)
const pts = (ring: number[][]): number[] => ring.flatMap(([x, y]) => { const q = lonLatToReal(x / 1e4, y / 1e4); return [q[0], -q[1]]; });
export const BIWA_NAME = "琵琶湖";
/** Brackish lakes (a lagoon open to the sea, or one where sea water comes in): by name, so a lake named with a suffix (霞ヶ浦（西浦）) still counts. */
const BRACKISH_NAMES = ["霞ヶ浦", "北浦", "サロマ", "能取", "風蓮", "厚岸", "網走湖", "宍道湖", "中海", "浜名湖", "涸沼", "十三湖", "小川原", "八郎潟", "湖山池", "佐鳴湖", "北潟湖", "濤沸", "藻琴", "コムケ", "加茂湖", "河北潟", "水月湖", "三方五湖", "久々子"];
export const isBrackish = (l: { name: string; kind: string }) => l.kind === "brackish" || BRACKISH_NAMES.some((n) => l.name.includes(n));
/** The lakes drawn at the whole-country view and the ones that join as you zoom in. */
export const LAKE_BIG_KM2 = 25;

const centroid = (r: number[][]): [number, number] => { let x = 0, y = 0; for (const [lo, la] of r) { const q = lonLatToReal(lo / 1e4, la / 1e4); x += q[0]; y += q[1]; } return [x / r.length, y / r.length]; };
const inPoly = (p: [number, number], poly: readonly (readonly [number, number])[]): boolean => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };

/** Two Graphics, built once: the big lakes (always) and the small ones (from a middle zoom). Shore lines are one pixel wide at every zoom (`pixelLine`), so a small lake is never swallowed by its own outline. */
export function buildLakeGraphics(): { big: Graphics; small: Graphics } {
  const big = new Graphics(), small = new Graphics();
  for (const l of LAKE_LIST) {
    if (l.name === BIWA_NAME) continue;
    const g = l.km2 >= LAKE_BIG_KM2 ? big : small, col = isBrackish(l) ? WATER.brackish : WATER.lake;
    g.poly(pts(l.outer)).fill({ color: col }); for (const h of l.holes) g.poly(pts(h)).cut();
    g.poly(pts(l.outer)).stroke({ width: 1, color: WATER.shore, alpha: 0.7, pixelLine: true }); for (const h of l.holes) g.poly(pts(h)).stroke({ width: 1, color: WATER.shore, alpha: 0.6, pixelLine: true });
  }
  return { big, small };
}
/** The islands of 琵琶湖 as land, drawn over the map's own 琵琶湖 -- only those whose middle falls inside that outline (the map's lake is an approximation of the real one; an island outside it would stand on dry land) and that are big enough to see. */
export function buildBiwaIslands(land: number, biwaOutline: readonly (readonly [number, number])[]): Graphics {
  const g = new Graphics(), biwa = LAKE_LIST.find((l) => l.name === BIWA_NAME);
  if (biwa) for (const h of biwa.holes) { const c = centroid(h); if (!inPoly(c, biwaOutline)) continue; g.poly(pts(h)).fill({ color: land }).stroke({ width: 1, color: WATER.shore, alpha: 0.8, pixelLine: true }); }
  return g;
}

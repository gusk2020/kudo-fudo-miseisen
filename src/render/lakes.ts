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
export const LAKE_LIST = (LAKES as unknown as { lakes: LakeRec[] }).lakes;
const pts = (ring: number[][]): number[] => ring.flatMap(([x, y]) => { const q = lonLatToReal(x / 1e4, y / 1e4); return [q[0], -q[1]]; });
export const BIWA_NAME = "琵琶湖";
/** The lakes drawn at the whole-country view and the ones that join as you zoom in. */
export const LAKE_BIG_KM2 = 25;

/** Two Graphics, built once: the big lakes (always) and the small ones (from a middle zoom). `biwaIslands` are drawn as land on top of the map's own 琵琶湖. */
export function buildLakeGraphics(land: number): { big: Graphics; small: Graphics; biwaIslands: Graphics } {
  const big = new Graphics(), small = new Graphics(), biwaIslands = new Graphics();
  for (const l of LAKE_LIST) {
    if (l.name === BIWA_NAME) { for (const h of l.holes) biwaIslands.poly(pts(h)).fill({ color: land }).stroke({ width: 0.6, color: WATER.shore, alpha: 0.9 }); continue; }
    const g = l.km2 >= LAKE_BIG_KM2 ? big : small, col = l.kind === "brackish" ? WATER.brackish : WATER.lake;
    g.poly(pts(l.outer)).fill({ color: col }); for (const h of l.holes) g.poly(pts(h)).cut();
    g.poly(pts(l.outer)).stroke({ width: 0.5, color: WATER.shore, alpha: 0.85 }); for (const h of l.holes) g.poly(pts(h)).stroke({ width: 0.4, color: WATER.shore, alpha: 0.8 });
  }
  return { big, small, biwaIslands };
}

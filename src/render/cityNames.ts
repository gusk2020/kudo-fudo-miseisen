/**
 * Stage 19: where the names of the grown places go. Pure (screen pixels in, screen pixels out), so a test can ask it. Names are placed in the order given (seats of government first, then by size) beside the
 * circle, on the first of four sides (right, left, above, below) where the text overlaps nothing already placed: not another name, not any circle, not the base map's name of a prefectural capital. A name
 * with no free side is left out for now (the place keeps its circle); how many are placed at most depends on the zoom.
 */
export interface NameCircle { x: number; y: number; rad: number; name: string | null; seat: boolean }
export type Box = [number, number, number, number];   // left, top, right, bottom
export const FONT = 12, LINE = FONT + 4;
export const nameWidth = (s: string) => s.length * FONT + 4;
/** Most names shown at a zoom: none in the far view, then 7 / 18 / 45 as one looks closer (Stage 22: a little fewer than Stage 19's 10 / 24 / 60; the places themselves are all still simulated). */
export const maxNames = (zoom: number) => (zoom < 0.55 ? 0 : zoom < 1 ? 7 : zoom < 2 ? 18 : 45);
/** Stage 22: names of the 49 県庁所在地 on the base map: none far out, the 25 that matter most (the seats first, then by size) at a middle zoom, all from 0.85 -- always without overlaps. */
export const maxCapitalNames = (zoom: number) => (zoom < 0.55 ? 0 : zoom < 0.85 ? 25 : 49);
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
export function placeNames(circles: NameCircle[], fixed: Box[], zoom: number, capN = maxNames(zoom)): { i: number; x: number; y: number }[] {
  const out: { i: number; x: number; y: number }[] = [], cap = capN; if (!cap) return out;
  const boxes: Box[] = [...fixed, ...circles.map((d): Box => [d.x - d.rad, d.y - d.rad, d.x + d.rad, d.y + d.rad])], own = fixed.length;
  circles.forEach((d, i) => {
    if (!d.name || out.length >= cap) return; const wd = nameWidth(d.name), r = d.rad, tries: [number, number][] = [[d.x + r + 2, d.y - 7], [d.x - r - 2 - wd, d.y - 7], [d.x - wd / 2, d.y - r - LINE - 1], [d.x - wd / 2, d.y + r + 1]];
    for (const [x, y] of tries) { const b: Box = [x, y, x + wd, y + LINE]; if (boxes.some((o, k) => k !== own + i && hit(b, o))) continue; out.push({ i, x, y }); boxes.push(b); break; }
  });
  return out;
}

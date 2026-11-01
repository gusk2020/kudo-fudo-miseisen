import { describe, expect, it } from "vitest";
import { isSeatCell, nearestLandCell, seatConflict, stepSeat } from "../../src/core/placement";
import { lonLatToReal } from "../../src/core/data";
import { realWorld } from "./simhelp";

const W = realWorld(true, false, 2).w as any;
const world = W;   // (the real Japan with the added islands and the islets, as the game builds it)
const toWorld = (lon: number, lat: number) => lonLatToReal(lon, lat) as [number, number];   // (the real map: world = real km)
const brute = (p: [number, number]) => { let best = -1, bd = Infinity; for (let k = 0; k < world.nx * world.ny; k++) { if (!isSeatCell(world, k)) continue; const c = world.cellPos(k), d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = k; } } return { k: best, d: bd }; };

describe("Stage 32: placement", () => {
  it("the spatial unit is one grid cell (5 km): stored positions and fine steps are in it", () => { expect(world.cell).toBe(5); expect(world.nx * world.ny).toBeGreaterThan(100000); });
  it("a point on land is its own cell (distance 0); a sea point goes to the globally nearest land, equal to a brute-force scan over every cell", () => {
    const land = world.cities.find((c: any) => c.pref === "JP-13" && c.kind === "capital"); expect(land).toBeTruthy();
    const n0 = nearestLandCell(world, land.pos)!; expect(n0.km).toBeLessThan(world.cell); expect(isSeatCell(world, n0.k)).toBe(true);
    const seaPts: [number, number][] = [[150, 35], [135, 39.5], [131, 33.5], [139.7, 34.8], [142, 38], [128, 30], [133.5, 34.1], [150, 25], [123, 27], [140, 45.9]].map(([a, b]) => toWorld(a, b));
    for (const p of seaPts) { const g = nearestLandCell(world, p)!, b = brute(p); expect(g.k, `${p}`).toBe(b.k); expect(Math.abs(g.km - b.d)).toBeLessThan(1e-6); }
  });
  it("it is not limited to one prefecture or one island: a sea point between two prefectures goes to whichever land is nearer, the far prefecture included", () => {
    // a point in the open Sea of Japan off Hokkaido's west coast is nearest to Hokkaido, one off the Sanin coast to Honshu: the prefecture follows the land reached, never a chosen one
    const a = nearestLandCell(world, toWorld(139.2, 44.5))!, b = nearestLandCell(world, toWorld(133, 36.3))!;
    expect(world.prefOf(a.k)!.startsWith("HK")).toBe(true); expect(world.prefOf(b.k)!.startsWith("JP")).toBe(true); expect(world.prefOf(a.k)).not.toBe(world.prefOf(b.k));
  });
  it("a far point (the worst case) costs little: under 50 ms for the whole grid", () => {
    const t0 = performance.now(); for (const p of [toWorld(160, 20), toWorld(120, 20), toWorld(160, 50)]) expect(nearestLandCell(world, p)).not.toBeNull(); expect((performance.now() - t0) / 3).toBeLessThan(50);
  });
  it("fine steps move exactly one cell (5 km) and refuse the sea; stepping back returns to the same cell", () => {
    const c = world.cities.find((x: any) => x.pref === "JP-23" && x.kind === "capital").pos as [number, number], k0 = world.cellOf(c);
    const e = stepSeat(world, c, "right")!, back = stepSeat(world, e.pos, "left")!; expect(e.k).toBe(k0 + 1); expect(Math.hypot(e.pos[0] - world.cellPos(k0)[0], e.pos[1] - world.cellPos(k0)[1])).toBeCloseTo(5, 6); expect(back.k).toBe(k0);
    const u = stepSeat(world, c, "up")!, d = stepSeat(world, c, "down")!; expect(u.k).toBe(k0 + world.nx); expect(d.k).toBe(k0 - world.nx); expect(u.pos[1] - world.cellPos(k0)[1]).toBeCloseTo(5, 6);
    // walk east from a coast city until the sea: the step then refuses
    let p = c, n = 0; for (; n < 400; n++) { const s = stepSeat(world, p, "right"); if (!s) break; p = s.pos; } expect(n).toBeGreaterThan(0); expect(n).toBeLessThan(400); expect(stepSeat(world, p, "right")).toBeNull();
  });
  it("capital and sub-capital may not share a prefecture; the residence may share with either", () => {
    expect(seatConflict("capital", "JP-27", { capital: "JP-13", sub: "JP-27" })).toBe(true); expect(seatConflict("sub", "JP-13", { capital: "JP-13", sub: "JP-27" })).toBe(true);
    expect(seatConflict("sub", "JP-13", { capital: "JP-27", sub: "JP-27" })).toBe(false); expect(seatConflict("palace", "JP-13", { capital: "JP-13", sub: "JP-27" })).toBe(false); expect(seatConflict("palace", "JP-27", { capital: "JP-13", sub: "JP-27" })).toBe(false);
  });
});

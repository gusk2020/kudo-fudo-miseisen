import { describe, expect, it } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { PREF_IDS } from "../../src/core/seat";
import { LINE, maxNames, nameWidth, placeNames, type NameCircle } from "../../src/render/cityNames";
import { createSim } from "../../src/sim/engine";
import { coreness } from "../../src/sim/recon";
import { potentialDataOf, potentialOrder } from "../../src/sim/potential17";
import { realWorld } from "./simhelp";
import type { Vec } from "../../src/core/types";

const { w, hash } = realWorld(true, true), D = potentialDataOf(w.t);

describe("Stage 19: a seat put at a point of the map", () => {
  const base = { capital: "JP-13", sub: "JP-27", palace: "JP-13", mode: "concentrate" as const, seed: 7 };
  it("the order uses the seat's prefecture for ranks and the real point for the centre of the three seats", () => {
    const plain = potentialOrder(base, D), same = potentialOrder({ ...base, at: { capital: D.points["JP-13"], sub: D.points["JP-27"], palace: D.points["JP-13"] } }, D), far = potentialOrder({ ...base, at: { capital: [141.5, 43.5] } }, D);
    expect(same).toEqual(plain);   // the 県庁所在地 gives exactly the old order
    expect(far.slice(0, 3)).toEqual(plain.slice(0, 3)); expect(new Set(far).size).toBe(49); expect([...far].sort()).toEqual([...PREF_IDS].sort()); expect(far.slice(3, 6)).not.toEqual(plain.slice(3, 6));   // a far point moves the centre
    expect(potentialOrder({ ...base, at: { capital: [141.5, 43.5] } }, D)).toEqual(far);   // same inputs, same order
  });
  const mk = (o: object) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...o });
  it("a game keeps the points; the points count in the pull of the seats; an older game has none and is unchanged", () => {
    const cap = w.cities.find((c) => c.kind === "capital" && c.pref === "JP-13")!, far = w.cities.find((c) => c.kind === "capital" && c.pref === "JP-02")!;
    const home = mk({}), moved = mk({ capital: "JP-02", capitalPos: [far.pos[0] + 3, far.pos[1] - 3] as Vec }), plainMoved = mk({ capital: "JP-02" });
    expect(home.capitalPos).toBeUndefined(); expect(moved.capitalPos).toEqual([far.pos[0] + 3, far.pos[1] - 3]); expect(moved.pot17!.c19).toBe(true); void cap;
    const near = w.cities.find((c) => Math.hypot(c.pos[0] - (far.pos[0] + 3), c.pos[1] - (far.pos[1] - 3)) < 60 && c.id !== far.id);
    if (near) expect(coreness(moved, w, near.id)).toBeGreaterThanOrEqual(coreness(plainMoved, w, near.id) - 1e-9);
    expect(mk({ capital: "JP-02" }).pot17!.order).toEqual(plainMoved.pot17!.order);   // the same prefecture list choice: the same result as before
  });
  it("saving and loading keep the points; a broken point is dropped", () => {
    const sim = mk({ subCapital: "JP-28", subPos: [100, 100] as Vec }), back = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect(back.subPos).toEqual([100, 100]); expect(back.pot17!.c19).toBe(true);
    const bad = JSON.parse(JSON.stringify(sim)); bad.subPos = ["x", 1]; expect(sanitizeSim(bad).sim!.subPos).toBeUndefined(); bad.subPos = [1e9, 1]; expect(sanitizeSim(bad).sim!.subPos).toBeUndefined();
  });
});

describe("Stage 19: the names of grown cities do not overlap", () => {
  const box = (n: { x: number; y: number }, name: string): [number, number, number, number] => [n.x, n.y, n.x + nameWidth(name), n.y + LINE];
  const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const crowd: NameCircle[] = Array.from({ length: 80 }, (_, i) => ({ x: 400 + (i % 10) * 18, y: 300 + Math.floor(i / 10) * 14, rad: 6 + (i % 3) * 2, name: `衛星都市${i}`, seat: i === 0 }));
  it("a crowded patch: no two names overlap and none covers a circle; the seat is placed first; the count depends on the zoom", () => {
    for (const zoom of [0.6, 1.2, 2.5]) {
      const placed = placeNames(crowd, [], zoom); expect(placed.length).toBeLessThanOrEqual(maxNames(zoom)); const bs = placed.map((p) => box(p, crowd[p.i].name!));
      for (let a = 0; a < bs.length; a++) { for (let b = a + 1; b < bs.length; b++) expect(overlap(bs[a], bs[b])).toBe(false); for (const c of crowd) expect(overlap(bs[a], [c.x - c.rad, c.y - c.rad, c.x + c.rad, c.y + c.rad]) && c !== crowd[placed[a].i]).toBe(false); }
      expect(placed.some((p) => p.i === 0)).toBe(true);
    }
    expect(maxNames(0.3)).toBe(0); expect(placeNames(crowd, [], 0.3)).toEqual([]); expect(maxNames(0.7)).toBeLessThan(maxNames(1.5)); expect(maxNames(1.5)).toBeLessThan(maxNames(3));
  });
  it("a name keeps clear of a capital's name drawn by the base map, and an isolated place gets its name at once", () => {
    const one: NameCircle[] = [{ x: 100, y: 100, rad: 8, name: "川崎市", seat: false }], cap: [number, number, number, number] = [112, 93, 112 + nameWidth("横浜市"), 93 + LINE];
    const p = placeNames(one, [cap], 1)[0]; expect(p).toBeDefined(); expect(overlap(box(p, "川崎市"), cap)).toBe(false); expect(placeNames(one, [], 1)[0].x).toBe(110);
    expect(placeNames([{ x: 5, y: 5, rad: 4, name: null, seat: false }], [], 2)).toEqual([]);   // the 49 capitals are named by the base map, not here
  });
  it("speed: placing 60 names among 200 circles takes a few milliseconds", () => {
    const many: NameCircle[] = Array.from({ length: 200 }, (_, i) => ({ x: (i * 37) % 900, y: (i * 53) % 600, rad: 5, name: `市${i}`, seat: false })), t = performance.now(); for (let k = 0; k < 20; k++) placeNames(many, [], 3); expect((performance.now() - t) / 20).toBeLessThan(40);
  });
});

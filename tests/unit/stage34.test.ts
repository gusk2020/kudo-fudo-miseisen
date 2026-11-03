import { describe, expect, it } from "vitest";
import { applyG34, cellUnits, rateUnits, reclaimReport, stepReclaim, type G34Input, type Rec34, type TerrainLike } from "../../src/sim/reclaim34";
import { resetWorldCaches, type World } from "../../src/sim/world";
import type { SimState } from "../../src/sim/types";
import type { SeatMove } from "../../src/sim/seatmove20";
import { validateSimAgainstWorld } from "../../src/core/save2";

const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
/** A small sea with 5 km cells, islands given as [x0,y0,w,h,islandId]. */
function mini(nx: number, ny: number, isl: [number, number, number, number, number][]): TerrainLike {
  const N = nx * ny, t: TerrainLike = { land: new Uint8Array(N), island: new Uint8Array(N), pref: new Uint8Array(N), plains: new Uint8Array(N), elev: new Float32Array(N).fill(-200), grid: { x0: 0, y0: 0, cell: 5, nx, ny } };
  for (const [x0, y0, w, h, id] of isl) for (let j = y0; j < y0 + h; j++) for (let i = x0; i < x0 + w; i++) { const k = j * nx + i; t.land[k] = 1; t.island[k] = id; t.pref[k] = id; t.elev[k] = 30; }
  return t;
}
const comps = (t: { land: Uint8Array; island: Uint8Array }, nx: number, ny: number) => { const id = new Int32Array(nx * ny); let n = 0; for (let k0 = 0; k0 < nx * ny; k0++) if (t.land[k0] === 1 && !id[k0]) { id[k0] = ++n; const st = [k0]; while (st.length) { const c = st.pop()!; for (const [di, dj] of N8) { const x = (c % nx) + di, y = ((c / nx) | 0) + dj; if (x < 0 || y < 0 || x >= nx || y >= ny) continue; const q = y * nx + x; if (t.land[q] === 1 && !id[q] && t.island[q] === t.island[c]) { id[q] = n; st.push(q); } } } } return { id, n }; };
/** a fake World, just enough for stepReclaim: two seat cities (JP-13 capital, JP-27 sub). */
function fakeWorld(t: TerrainLike, cap: number, sub: number): World {
  const { nx, ny } = t.grid, { id } = comps(t, nx, ny), lm = Uint16Array.from(id);
  const city = (cell: number, pref: string) => ({ id: pref, name: pref, cell, pos: [0, 0], pref, island: t.island[cell], pop0: 1, popSource: "synthetic", coastal: true, plains: 1, kind: "capital" });
  return { t, nx, ny, cell: 5, N: nx * ny, cities: [city(cap, "JP-13"), city(sub, "JP-27")], lm, g34: true } as unknown as World;
}
const fakeSim = (): SimState => ({ capital: undefined, subCapital: undefined, rec34: { sites: [], log: [], done: [] } as Rec34 } as unknown as SimState);
const run = (sim: SimState, w: World, from: number, to: number) => { for (let y = from; y <= to; y++) stepReclaim(sim, w, y); };

describe("Stage 34: units and rates", () => {
  it("one 5 km cell is 25 km2 = 50 half-km2 units; 5 km2/yr = 10 units, 0.5 km2/yr = 1 unit", () => {
    expect(cellUnits(5)).toBe(50); expect(rateUnits(1)).toBe(10); expect(rateUnits(50)).toBe(10); expect(rateUnits(51)).toBe(1); expect(rateUnits(100)).toBe(1); expect(rateUnits(101)).toBe(0); expect(rateUnits(150)).toBe(0);
  });
});

describe("Stage 34: island enlargement", () => {
  const moves = (cell: number, nx: number, by: SeatMove["by"] = "capital"): SeatMove[] => [{ pref: "JP-13", by, pos: [(cell % nx) * 5 + 2.5, ((cell / nx) | 0) * 5 + 2.5] }];
  it("a one-cell island (25 km2) becomes two cells (50 km2) and stays separate from its neighbour, edge or diagonal", () => {
    const t = mini(30, 20, [[10, 10, 1, 1, 1], [12, 10, 1, 1, 2]]), k = 10 * 30 + 10, r = applyG34(t, { log: [], done: [] }, moves(k, 30));
    expect(r.grown).toHaveLength(1); expect(r.grown[0]).toMatchObject({ from: 25, to: 50, cells: 1 });
    const { id, n } = comps(r.t, 30, 20); expect(n).toBe(2); expect(id[k]).not.toBe(id[10 * 30 + 12]);
    for (let q = 0; q < id.length; q++) if (r.t.land[q] === 1 && id[q] === id[k]) for (const [di, dj] of N8) { const o = (((q / 30) | 0) + dj) * 30 + (q % 30) + di; if (r.t.land[o] === 1) expect(id[o]).toBe(id[k]); }
    expect(t.land.reduce((a, b) => a + b, 0)).toBe(2);   // the shared terrain arrays are never touched
  });
  it("an island of two cells (50 km2 >= 30) is left alone; all three seats enlarge", () => {
    const t = mini(30, 20, [[10, 10, 2, 1, 1]]); expect(applyG34(t, { log: [], done: [] }, moves(10 * 30 + 10, 30)).add.log).toHaveLength(0);
    const t2 = mini(30, 20, [[3, 3, 1, 1, 1], [10, 10, 1, 1, 2], [20, 5, 1, 1, 3]]), mv: SeatMove[] = [[3, 3, "capital"], [10, 10, "sub"], [20, 5, "palace"]].map(([x, y, by]) => ({ pref: "JP-" + x, by: by as SeatMove["by"], pos: [(x as number) * 5 + 2.5, (y as number) * 5 + 2.5] }));
    const r = applyG34(t2, { log: [], done: [] }, mv); expect(r.add.log).toHaveLength(3); expect(comps(r.t, 30, 20).n).toBe(3);
  });
  it("an island with no room (a ring of another mass two cells out) stays as it is rather than joining", () => {
    const ring: [number, number, number, number, number][] = [[8, 8, 5, 1, 2], [8, 12, 5, 1, 2], [8, 9, 1, 3, 2], [12, 9, 1, 3, 2]], t = mini(30, 20, [[10, 10, 1, 1, 1], ...ring]);
    const r = applyG34(t, { log: [], done: [] }, moves(10 * 30 + 10, 30)); expect(r.add.log).toHaveLength(0); expect(comps(r.t, 30, 20).n).toBe(2);
  });
  it("replaying the log reproduces the land exactly and decides nothing new (deterministic)", () => {
    const t = mini(30, 20, [[10, 10, 1, 1, 1], [20, 5, 1, 1, 2]]), mv = [...moves(10 * 30 + 10, 30), { pref: "JP-27", by: "sub" as const, pos: [20 * 5 + 2.5, 5 * 5 + 2.5] as [number, number] }];
    const a = applyG34(t, { log: [], done: [] }, mv), full: G34Input = a.add, b = applyG34(t, full, mv), c = applyG34(t, { log: [], done: [] }, mv);
    expect(b.add.log).toHaveLength(0); expect(Array.from(b.t.land)).toEqual(Array.from(a.t.land)); expect(Array.from(c.t.land)).toEqual(Array.from(a.t.land)); expect(c.add).toEqual(a.add);
  });
});

describe("Stage 34: reclamation schedule", () => {
  const big = () => mini(80, 60, [[38, 28, 4, 4, 1], [10, 5, 4, 4, 2]]);   // a 4x4 island (cap) and a far one (sub)
  const solo = () => { const t = mini(80, 60, [[38, 28, 4, 4, 1]]); const w = fakeWorld(t, 29 * 80 + 39, 29 * 80 + 39); w.cities[1].pref = "JP-27"; return { t, w, sim: fakeSim() }; };
  it("year 50/51/100/101 boundaries: 10 cells at 50, still 10 at 99, 11 at 100, 11 at 150; the budget is exact and never whole early", () => {
    const { w, sim } = solo(); w.cities.pop();
    run(sim, w, 1950, 1950); const s = sim.rec34!.sites[0]; expect(s.start).toBe(1950);
    run(sim, w, 1951, 1954); expect(s.filled).toBe(0); expect(s.accU).toBe(40);
    run(sim, w, 1955, 1955); expect(s.filled).toBe(1); expect(s.accU).toBe(0);
    run(sim, w, 1956, 2000); expect(s.filled).toBe(10); expect(s.accU).toBe(0);   // 50 years x 5 km2 = 250 km2 = 10 cells
    run(sim, w, 2001, 2001); expect(s.filled).toBe(10); expect(s.accU).toBe(1);    // year 51: +0.5 km2, no cell
    run(sim, w, 2002, 2049); expect(s.filled).toBe(10); expect(s.accU).toBe(49);   // year 99
    run(sim, w, 2050, 2050); expect(s.filled).toBe(11); expect(s.accU).toBe(0);    // year 100: 25 km2 -> the 11th cell
    run(sim, w, 2051, 2100); expect(s.filled).toBe(11); expect(s.accU).toBe(0);    // years 101-150: nothing
    expect(sim.rec34!.log.filter((e) => e.kind === "fill")).toHaveLength(11);
  });
  it("capital and sub-capital are independent: each gets its own 11 cells, no cell is claimed twice, and nobody spends the other's budget", () => {
    const t = big(), w = fakeWorld(t, 29 * 80 + 39, 6 * 80 + 11), sim = fakeSim(); run(sim, w, 1950, 2050);
    const [a, b] = sim.rec34!.sites; expect(a.filled).toBe(11); expect(b.filled).toBe(11); const ks = sim.rec34!.log.map((e) => e.k); expect(new Set(ks).size).toBe(22);
    expect(sim.rec34!.log.filter((e) => e.site === 0)).toHaveLength(11); expect(sim.rec34!.log.filter((e) => e.site === 1)).toHaveLength(11);
  });
  it("overlapping shores: two sites on one coast still add 22 distinct cells (an overlapped cell is paid for once, by whoever took it)", () => {
    const t = mini(80, 60, [[38, 28, 4, 4, 1]]), w = fakeWorld(t, 29 * 80 + 39, 30 * 80 + 40), sim = fakeSim(); run(sim, w, 1950, 2050);
    const ks = sim.rec34!.log.map((e) => e.k); expect(ks.length).toBe(22); expect(new Set(ks).size).toBe(22);
    expect(sim.rec34!.sites.map((s) => s.filled)).toEqual([11, 11]); expect(t.land.reduce((n, v) => n + v, 0)).toBe(16 + 22); expect(reclaimReport(sim)[0].filledKm2).toBe(275);
  });
  it("two nearby islands never join, however long the reclamation runs; land only touches its own mass", () => {
    const t = mini(60, 30, [[10, 10, 3, 3, 1], [14, 10, 3, 3, 2]]), w = fakeWorld(t, 11 * 60 + 11, 11 * 60 + 15), sim = fakeSim(); run(sim, w, 1950, 2200);
    const { n, id } = comps(t, 60, 30); expect(n).toBe(2); expect(id[11 * 60 + 11]).not.toBe(id[11 * 60 + 15]); for (let j = 0; j < 30; j++) expect(t.land[j * 60 + 13]).toBe(0);   // the one-cell channel stays sea
    expect(sim.rec34!.sites.map((s) => s.filled).every((f) => f === 11)).toBe(true);
  });
  it("with no legal shore the budget is kept (not spent, not forced) and the site reports it", () => {
    const ring: [number, number, number, number, number][] = [[28, 28, 5, 1, 2], [28, 32, 5, 1, 2], [28, 29, 1, 3, 2], [32, 29, 1, 3, 2]], t = mini(60, 60, [[30, 30, 1, 1, 1], ...ring]);
    const w = fakeWorld(t, 30 * 60 + 30, 30 * 60 + 30); w.cities.pop(); const sim = fakeSim(); run(sim, w, 1950, 2000); const s = sim.rec34!.sites[0];
    expect(s.filled).toBe(0); expect(s.accU).toBe(500); expect(s.blocked).toBeGreaterThan(0); expect(comps(t, 60, 60).n).toBe(2);
  });
  it("relocation: the old site stops (its land stays), the new one starts from zero on its own schedule", () => {
    const t = big(), w = fakeWorld(t, 29 * 80 + 39, 6 * 80 + 11), sim = fakeSim(); run(sim, w, 1950, 1980);
    const kept = sim.rec34!.log.length, oldCap = sim.rec34!.sites[0].filled; expect(oldCap).toBe(6);
    // the capital moves to the other island's city (the seat city of prefecture JP-26)
    w.cities.push({ ...w.cities[1], id: "k", name: "k", pref: "JP-26", cell: 7 * 80 + 12 } as never); sim.capital = "JP-26"; run(sim, w, 1981, 2031);
    const [c0, , c2] = sim.rec34!.sites; expect(c0.active).toBe(false); expect(c0.filled).toBe(6); expect(c2.role).toBe("capital"); expect(c2.start).toBe(1981); expect(c2.filled).toBe(10);   // 1981..2031 = 50 years -> 10 cells
    expect(sim.rec34!.log.length).toBeGreaterThan(kept); expect(sim.rec34!.log.slice(0, kept).every((e) => t.land[e.k] === 1)).toBe(true);
  });
  it("an inland seat accrues nothing", () => {
    const t = mini(40, 40, [[0, 0, 40, 40, 1]]), w = fakeWorld(t, 20 * 40 + 20, 21 * 40 + 21), sim = fakeSim(); run(sim, w, 1950, 2050); expect(sim.rec34!.log).toHaveLength(0); expect(sim.rec34!.sites.every((s) => !s.coastal && s.accU === 0)).toBe(true);
  });
  it("a world rebuilt from the log is identical to the one that grew (save/restore), and the save validation accepts it", () => {
    const t = big(), w = fakeWorld(t, 29 * 80 + 39, 6 * 80 + 11), sim = fakeSim(); run(sim, w, 1950, 2000);
    const saved = JSON.parse(JSON.stringify(sim)) as SimState, base = big(), r = applyG34(base, { log: saved.rec34!.log, done: saved.rec34!.done }, []);
    expect(Array.from(r.t.land)).toEqual(Array.from(t.land)); expect(Array.from(r.t.island)).toEqual(Array.from(t.island)); expect(Array.from(r.t.pref)).toEqual(Array.from(t.pref));
    // continuing from the restored state matches continuing the original
    const w2 = fakeWorld(r.t, 29 * 80 + 39, 6 * 80 + 11); run(saved, w2, 2001, 2060); run(sim, w, 2001, 2060); expect(Array.from(w2.t.land)).toEqual(Array.from(w.t.land)); expect(saved.rec34).toEqual(sim.rec34);
    const wv = { ...w2, N: w2.N, g34: true, townIds: undefined, moveSpec: undefined, islets: undefined } as unknown as World; const ss = { ...saved, terrainHash: "h", edges: {}, nodes: {}, towns16: undefined, moves20: undefined } as unknown as SimState;
    expect(validateSimAgainstWorld(ss, wv, "h")).toBeNull(); expect(validateSimAgainstWorld({ ...ss, rec34: undefined } as unknown as SimState, wv, "h")).toMatch(/Stage 34/);
    resetWorldCaches(w);
  });
});

// ---- the real map ----
import { realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { advance, createSim } from "../../src/sim/engine";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { loadDem } from "./helpers";

describe("Stage 34: on the real map", () => {
  const s = realState(), t = generateTerrain(s, loadDem()), ids = townsForSeats(t, ["JP-13", "JP-27"]);
  const mk = (moves: SeatMove[] = [], g: G34Input | false = { log: [], done: [] }) => buildWorld(t, s.seed, ids, 2, moves, g);
  const w0 = mk([]);
  const sizes = new Map<number, number>(); for (let k = 0; k < w0.N; k++) if (w0.lm[k]) sizes.set(w0.lm[k], (sizes.get(w0.lm[k]) ?? 0) + 1);
  const single = [...sizes].filter(([, n]) => n === 1).map(([id]) => w0.lm.indexOf(id));
  it("there are one-cell islands (< 30 km2) on the 5 km grid, and a seat put on one enlarges it to 50 km2 without touching any other mass", () => {
    expect(single.length).toBeGreaterThan(0); const k = single[0], p = w0.cellPos(k), w1 = mk([{ pref: "JP-47", by: "capital", pos: [p[0], p[1]] }]);
    expect(w1.g34grown![0]).toMatchObject({ from: 25, to: 50 }); const m = w1.lm[k], own = [] as number[]; for (let q = 0; q < w1.N; q++) if (w1.lm[q] === m) own.push(q); expect(own.length).toBe(2);
    for (const q of own) for (const [di, dj] of N8) { const o = (((q / w1.nx) | 0) + dj) * w1.nx + (q % w1.nx) + di; if (w1.t.land[o] === 1) expect(w1.lm[o]).toBe(m); }
    expect(w1.lmCount).toBe(w0.lmCount);   // not one mass more or fewer: nothing was merged or lost
  });
  it("the shared terrain arrays are never written; the world owns copies", () => {
    const before = t.land.reduce((a, b) => a + b, 0), g = mk([{ pref: "JP-47", by: "capital", pos: w0.cellPos(single[0]) }]); expect(g.t.land).not.toBe(t.land); expect(t.land.reduce((a, b) => a + b, 0)).toBe(before);
  });
  it("a new game on Tokyo / Osaka reclaims over 100 years: whole cells only, no mass merged, the log replays to the same world, and an ordinary game is untouched", () => {
    const w = mk(), sim = createSim(w, "m", t.hash, 5, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }); expect(sim.rec34).toBeTruthy();
    const lm0 = w.lmCount, land0 = w.t.land.reduce((a, b) => a + b, 0), t0 = Date.now(); advance(sim, w, 12 * 60); const ms = Date.now() - t0;
    const log = sim.rec34!.log.filter((e) => e.kind === "fill"); expect(log.length).toBeGreaterThan(0); expect(w.t.land.reduce((a, b) => a + b, 0)).toBe(land0 + log.length);
    const sites = sim.rec34!.sites.filter((x) => x.coastal); expect(sites.length).toBeGreaterThan(0); for (const x of sites) expect(x.filled).toBeLessThanOrEqual(Math.floor(((x.last - x.start) <= 50 ? (x.last - x.start) * 5 : 250 + ((x.last - x.start) - 50) * 0.5) / 25) + 0);
    const lmN = (() => { const id = new Int32Array(w.N); let n = 0; for (let k0 = 0; k0 < w.N; k0++) if (w.t.land[k0] === 1 && !id[k0]) { id[k0] = ++n; const st = [k0]; while (st.length) { const c = st.pop()!; for (const [di, dj] of N8) { const x = (c % w.nx) + di, y = ((c / w.nx) | 0) + dj; if (x < 0 || y < 0 || x >= w.nx || y >= w.ny) continue; const q = y * w.nx + x; if (w.t.land[q] === 1 && !id[q] && w.t.island[q] === w.t.island[c]) { id[q] = n; st.push(q); } } } } return n; })();
    expect(lmN).toBe(lm0);
    const w2 = mk([], { log: JSON.parse(JSON.stringify(sim.rec34!.log)), done: sim.rec34!.done }); expect(Array.from(w2.t.land)).toEqual(Array.from(w.t.land)); expect(Array.from(w2.lm)).toEqual(Array.from(w.lm));
    expect(validateSimAgainstWorld(JSON.parse(JSON.stringify(sim)), w2, t.hash)).toBeNull();
    const plain = mk([], false), s0 = createSim(plain, "m", t.hash, 5, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }); expect(s0.rec34).toBeUndefined(); expect(plain.g34).toBeUndefined();
    console.log("reclaim 60y:", log.length, "cells", log.length * 25, "km2,", ms, "ms");
  }, 120000);
});

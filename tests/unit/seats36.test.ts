import { describe, expect, it } from "vitest";
import { movesOfSettings } from "../../src/sim/seatmove20";
import { applyG34, type TerrainLike } from "../../src/sim/reclaim34";

describe("seat points put on the map (playtest feedback)", () => {
  const seats = { capital: "JP-23", sub: "JP-34", palace: "JP-23" };
  it("a palace point in the capital's prefecture is kept as its own (extra) move, never dropped", () => {
    const m = movesOfSettings(seats, { capitalPos: [0, 0], subPos: [100, 0], palacePos: [30, 5] });
    expect(m.map((x) => [x.by, x.pref, !!x.extra])).toEqual([["capital", "JP-23", false], ["sub", "JP-34", false], ["palace", "JP-23", true]]);
    expect(m[2].pos).toEqual([30, 5]);
  });
  it("three prefectures: no extra flag anywhere", () => {
    expect(movesOfSettings({ capital: "JP-23", sub: "JP-34", palace: "JP-04" }, { capitalPos: [0, 0], subPos: [1, 1], palacePos: [2, 2] }).some((x) => x.extra)).toBe(false);
  });
  it("an extra palace point on a one-cell islet still enlarges that islet immediately", () => {
    const nx = 30, ny = 20, N = nx * ny, t: TerrainLike = { land: new Uint8Array(N), island: new Uint8Array(N), pref: new Uint8Array(N), plains: new Uint8Array(N), elev: new Float32Array(N).fill(-200), grid: { x0: 0, y0: 0, cell: 5, nx, ny } };
    const k = 10 * nx + 10; t.land[k] = 1; t.island[k] = 1; t.elev[k] = 30;
    const r = applyG34(t, { log: [], done: [] }, movesOfSettings(seats, { capitalPos: [200, 200], palacePos: [10 * 5 + 2.5, 10 * 5 + 2.5] }).filter((x) => x.by === "palace"));
    expect(r.grown[0]).toMatchObject({ role: "palace", from: 25, to: 50 });
  });
});

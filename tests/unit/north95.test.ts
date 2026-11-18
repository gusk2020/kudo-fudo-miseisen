import { afterAll, beforeAll, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { stage3Sim } from "./simhelp";
/** Issue #95: the island-gateway port rule (hubs.ts) exists only in games made with `sim.north41` (new 1800 games); with the northern towns in the world, 樺太 gets its first port by 1960, and the same game without the flag gets none there. */
const prev = process.env.KFM_NORTH_TOWNS;
beforeAll(() => { process.env.KFM_NORTH_TOWNS = "1"; });
afterAll(() => { if (prev === undefined) delete process.env.KFM_NORTH_TOWNS; else process.env.KFM_NORTH_TOWNS = prev; });
const game = (flag: boolean) => { const g = stage3Sim("heisei", 1, true, 0, 2, true, { capital: "JP-13", sub: "JP-27" }, undefined, { start1800: true, towns: true } as never); if (!flag) delete g.sim.north41; g.sim.policy!.mode = "auto"; return g; };
const northPorts = (g: ReturnType<typeof game>) => Object.keys(g.sim.hubs?.ports ?? {}).filter((id) => id.startsWith("TN-") || id === "X-KARAFUTO");
it("new games get the flag; older ones do not", () => { expect(game(true).sim.north41).toBe(true); expect(game(false).sim.north41).toBeUndefined(); }, 600000);
it("樺太 gets its first port from the rule; the same game without the flag does not", () => {
  const a = game(true); advance(a.sim, a.w, 12 * (1960 - yearOf(a.sim))); const p = northPorts(a); expect(p.length, "a port on 樺太").toBeGreaterThanOrEqual(1);
  expect(a.sim.hubs!.ports[p[0]].hist.some((h) => h.t.includes("島の玄関港")), "opened by the island rule").toBe(true);
  const b = game(false); advance(b.sim, b.w, 12 * (1960 - yearOf(b.sim))); expect(northPorts(b).length, "no port without the flag").toBe(0);
}, 3000000);

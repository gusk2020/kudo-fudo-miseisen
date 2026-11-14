import { beforeAll, describe, expect, it, vi } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { syncOldCities } from "../../src/sim/oldcity40";
import { promoteOldCities, promotionCandidates } from "../../src/sim/oldpromote40";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/**
 * Audit of PR #71 (point 2): the earlier failure tests only reach `undo()` through paths where the road comes back EMPTY, so nothing had been changed
 * and "byte-identical" proves little. Here the road is really laid (edges, nodes, ids, rng all change) and only THEN the definition is refused,
 * which is the case the all-or-nothing snapshot exists for.
 */
const hook = vi.hoisted(() => ({ fail: false, edgesAtCall: -1, edgesBefore: -1 }));
vi.mock("../../src/sim/oldcity40", async (orig) => {
  const m = await orig<typeof import("../../src/sim/oldcity40")>();
  return { ...m, addOldCity: (sim: SimState, w: never, d: never) => { hook.edgesAtCall = Object.keys(sim.edges).length; return hook.fail ? "forced: definition refused" : m.addOldCity(sim, w, d); } };
});
const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g;
let S = "", Y = 0, chosen = "";
beforeAll(() => {
  sim.policy!.mode = "auto"; advance(sim, w, 12 * (1960 - yearOf(sim)));
  Y = sim.startYear + Math.ceil((yearOf(sim) - sim.startYear + 1) / 10) * 10;
  for (const v of Object.values(sim.settlements)) { if (v.gone || !v.origin || v.post) continue; const pop = v.pop; v.pop = 60000; if (promotionCandidates(sim, w, Y).some((c) => c.id === "O-" + v.origin!.code)) { chosen = v.id; break; } v.pop = pop; }
  S = JSON.stringify(sim);
}, 900000);
const fresh = () => { const s = JSON.parse(S) as SimState; syncOldCities(s, w); s.policy!.mode = "auto"; return s; };
const worldIds = () => w.cities.map((c) => c.id).join(",");
describe("Issue #67: refusing the definition AFTER a real road was laid restores everything", () => {
  it("has a candidate", () => { expect(chosen).not.toBe(""); });
  it("whole game byte-identical, world cities unchanged, and the road really was laid before the refusal", () => {
    const s = fresh(), before = JSON.stringify(s), ids = worldIds(); hook.fail = true; hook.edgesAtCall = -1; hook.edgesBefore = Object.keys(s.edges).length;
    let n: number; try { n = promoteOldCities(s, w, Y); } finally { hook.fail = false; }
    expect(hook.edgesAtCall, "a road had really been laid when the definition was refused").toBeGreaterThan(hook.edgesBefore);
    expect(n).toBe(0); { const A = JSON.parse(before), B = JSON.parse(JSON.stringify(s)); const d = Object.keys({ ...A, ...B }).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])); expect(d, "changed top-level keys").toEqual([]); } expect(JSON.stringify(s)).toBe(before); expect(worldIds()).toBe(ids);
  });
  it("the game then runs exactly like one that never tried", () => {
    const a = fresh(), b = fresh(); hook.fail = true; try { promoteOldCities(a, w, Y); } finally { hook.fail = false; }
    advance(a, w, 12 * 5); const sa = JSON.stringify([Object.keys(a.edges).length, a.rngState, a.next, Object.keys(a.cities).sort(), a.oldCities40?.map((d) => d.id)]); syncOldCities(b, w); advance(b, w, 12 * 5);
    expect(sa).toBe(JSON.stringify([Object.keys(b.edges).length, b.rngState, b.next, Object.keys(b.cities).sort(), b.oldCities40?.map((d) => d.id)]));
  }, 600000);
});

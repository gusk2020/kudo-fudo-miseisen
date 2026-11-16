import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { autoResolve, openWindow } from "../../src/sim/policy";
import { autoEraIdx, resolveSimple, simpleItems } from "../../src/sim/simple41";
import type { EraCand } from "../../src/sim/kaigen";
import { stage3Sim } from "./simhelp";

/** Stage 41 #4: the simple intervention mode maps three answers onto the policy items / dials that already exist; with nothing kept the game decides exactly as before. */
const game = () => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
const open = () => { const g = game(); advance(g.sim, g.w, 12 * 3); g.sim.policy!.pending = null; openWindow(g.sim, g.w, yearOf(g.sim)); return g; };
describe("Stage 41 #4: simple intervention mode", () => {
  it("transport road/rail map onto p-road/p-rail; sea/air onto the seaBias/airBias dials; the city answer onto 選択と集中/地方交通の広域連携", () => {
    const { sim } = open(); expect(sim.policy!.pending).not.toBeNull();
    expect(simpleItems(sim, { transport: "road", city: "concentrate" }).map((i) => i.id)).toEqual(["p-road", "o-select"]);
    expect(simpleItems(sim, { transport: "rail", city: "disperse" }).map((i) => i.id)).toEqual(["p-rail", "p-region"]);
    const sea = simpleItems(sim, { transport: "sea" })[0], air = simpleItems(sim, { transport: "air" })[0]; expect(Object.keys(sea.d)).toEqual(["seaBias"]); expect(Object.keys(air.d)).toEqual(["airBias"]);
    expect(simpleItems(sim, { transport: "bogus" as never, city: "x" as never })).toEqual([]);   // (a hand-edited save cannot throw)
  }, 600000);
  it("a manual answer adopts the mapped items as ten-year mods, spends no points, closes the window and records it", () => {
    const { sim } = open(), pts = sim.policy!.points, nm = sim.mods.length, y = sim.policy!.pending!.year;
    const rec = resolveSimple(sim, { transport: "sea", city: "disperse", coast: "japansea", keep: false })!; expect(rec.adopted.map((a) => a.id)).toEqual(expect.arrayContaining(["s-sea"]));
    expect(sim.policy!.pending).toBeNull(); expect(sim.policy!.points).toBe(pts); expect(sim.mods.length).toBe(nm + rec.adopted.length); const m = sim.mods.find((x) => x.id === `s-sea-${y}`)!; expect(m.until - m.from).toBe(10); expect(m.d.seaBias).toBeGreaterThan(0);
    expect(sim.policy!.history.at(-1)).toBe(rec); expect(resolveSimple(sim, { keep: false }), "no window open: nothing happens").toBeNull();
  }, 600000);
  it("kept answers decide the automatic windows; without keep (or with no answer) the automatic choice is exactly the old one", () => {
    const a = open(), b = open(), c = open(); a.sim.simple41 = { transport: "rail", keep: true }; b.sim.simple41 = { transport: "rail", keep: false };
    const ra = autoResolve(a.sim, a.w)!, rb = autoResolve(b.sim, b.w)!, rc = autoResolve(c.sim, c.w)!;
    expect(ra.adopted.map((x) => x.id)).toContain("p-rail"); expect(ra.auto).toBe(true);
    expect(JSON.stringify(rb)).toBe(JSON.stringify(rc));   // keep=false == never answered: the old automatic decision, bit for bit
  }, 600000);
  it("an automatic era change prefers the candidate matching the kept coast and city answer; without them it takes the first, as before", () => {
    const { sim } = open(); const c = (coast: "pacific" | "japansea", focus: "concentrate" | "disperse"): EraCand => ({ name: coast + focus, stance: "heisei", real: false, note: "", recon: { coast, focus } });
    const cands = [c("pacific", "concentrate"), c("japansea", "concentrate"), c("japansea", "disperse"), c("pacific", "disperse")];
    expect(autoEraIdx(sim, cands)).toBe(0); sim.simple41 = { coast: "japansea", keep: true }; expect(autoEraIdx(sim, cands)).toBe(1); sim.simple41 = { coast: "japansea", city: "disperse", keep: true }; expect(autoEraIdx(sim, cands)).toBe(2);
    sim.simple41 = { coast: "japansea", keep: false }; expect(autoEraIdx(sim, cands)).toBe(0);
  }, 600000);
});

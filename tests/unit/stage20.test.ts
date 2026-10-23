import { describe, expect, it } from "vitest";
import { ISLETS, isDisputed } from "../../src/core/islets";
import { realWorld } from "./simhelp";

describe("Stage 20 C: islets on the world", () => {
  const base = realWorld(true, true).w, W = realWorld(true, true, true).w;
  it("the terrain hash and the plain world are untouched", () => {
    expect(realWorld(true, true, true).hash).toBe(realWorld(true, true).hash);
    expect(base.islets).toBeUndefined(); expect(base.t.grid.nx).toBeLessThan(W.t.grid.nx);
  });
  it("old cells keep their position after the grid is widened", () => {
    let n = 0; for (let k = 0; k < base.N; k += 7) { const p = base.cellPos(k), q = W.cellOf(p); expect(q).toBeGreaterThanOrEqual(0); if (base.t.land[k] !== 0) { expect(W.t.land[q]).toBe(base.t.land[k]); expect(W.t.island[q]).toBe(base.t.island[k]); } n++; }
    expect(n).toBeGreaterThan(1000);
  });
  it("every islet is on the grid, once, with land under it", () => {
    expect(W.islets!.length).toBe(ISLETS.length);
    const seen = new Set<number>();
    for (const s of W.islets!) { expect(s.cell).toBeGreaterThanOrEqual(0); expect(W.t.land[s.cell]).toBe(1); if (!s.existing) { for (const k of s.cells) { expect(seen.has(k)).toBe(false); seen.add(k); expect(W.t.island[k]).toBe(s.island); } } }
  });
  it("the named groups are all there, and the disputed ones carry a statement", () => {
    const names = new Set(ISLETS.map((s) => s.name));
    for (const n of ["硫黄島", "父島", "母島", "八丈島", "魚釣島", "竹島", "択捉島", "国後島", "色丹島", "歯舞群島".length ? "水晶島" : ""]) expect(names.has(n), n).toBe(true);
    for (const g of ["尖閣諸島", "竹島", "北方四島", "歯舞群島"]) { const l = ISLETS.filter((s) => s.group === g); expect(l.length, g).toBeGreaterThan(0); for (const s of l) expect(isDisputed(s), s.name).toBe(true); }
  });
  it("each islet is its own land mass (a road cannot reach it)", () => {
    for (const s of W.islets!) if (!s.existing) { const m = W.lm[s.cells[0]]; expect(m).toBeGreaterThan(0); for (const k of s.cells) expect(W.lm[k]).toBe(m); }
  });
});

import { cityNameOf, nearestPlace } from "../../src/core/gazetteer";
import { isletPos } from "../../src/core/islets";
import { autoResolve } from "../../src/sim/policy";
import { createSim, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { validateSimAgainstWorld, makeSave, parseSave, mapStateHash } from "../../src/core/save2";
import { defaultState } from "../../src/core/state";
import type { Vec } from "../../src/core/types";
import type { SeatMove } from "../../src/sim/seatmove20";

const isl = (n: string) => ISLETS.find((s) => s.name === n)!;
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
function game(moves: SeatMove[], cap = "JP-13", sub = "JP-27", seed = 3) {
  const { w, hash } = realWorld(true, { capital: cap, sub }, true, moves), pos = (r: string) => moves.find((m) => m.by === r)?.pos;
  const sim = createSim(w, "m", hash, seed, { stage3: true, firstEra: 0, techK: 2, capital: cap, subCapital: sub, moves, ...(pos("capital") ? { capitalPos: pos("capital") } : {}), ...(pos("sub") ? { subPos: pos("sub") } : {}) });
  return { w, sim, hash };
}
describe("Stage 20 B: names", () => {
  it("nearest real place + 市, never 市市", () => {
    expect(cityNameOf("水戸市")).toBe("水戸市"); expect(cityNameOf("硫黄島")).toBe("硫黄島市");
    expect(nearestPlace(isletPos(isl("硫黄島")))!.name).toBe("硫黄島市");
    const n = nearestPlace(isletPos(isl("択捉島")))!; expect(n.km).toBe(0);
    for (const s of ISLETS) expect(nearestPlace(isletPos(s))!.name.endsWith("市市")).toBe(false);
  });
});
describe("Stage 20 B/D/E: a seat on a tiny island", () => {
  const mv = (n: string, pref: string, by: SeatMove["by"] = "capital"): SeatMove => ({ pref, pos: isletPos(isl(n)), by });
  it("the point becomes the one 県庁所在地; the old one stays an ordinary city with its people; nobody is created", () => {
    const base = game([]), g = game([mv("硫黄島", "JP-13")]);
    const caps = g.w.cities.filter((c) => c.kind === "capital" && c.pref === "JP-13"); expect(caps.length).toBe(1); expect(caps[0].name).toBe("硫黄島市");
    const old = g.w.cityById.get("C-JP-13")!; expect(old.kind).toBe("city"); expect(old.former).toBe(true);
    const tot = (x: ReturnType<typeof game>) => x.w.cities.reduce((a, c) => a + x.sim.cities[c.id].pop, 0);
    expect(Math.abs(tot(g) - tot(base)) / tot(base)).toBeLessThan(0.002);
    expect(g.sim.cities["C-JP-13"].pop).toBeGreaterThan(0.9 * base.sim.cities["C-JP-13"].pop);   // not stripped of residents
    expect(g.sim.cities[caps[0].id].pop).toBeLessThanOrEqual(caps[0].capPop!);
    expect(g.sim.moves20).toEqual([{ pref: "JP-13", pos: isletPos(isl("硫黄島")), by: "capital" }]);
    expect(base.sim.moves20).toBeUndefined();
  });
  it("the national road reaches the island (ferry chain) and the game runs on", () => {
    const g = game([mv("魚釣島", "JP-47")], "JP-47"), p = previewNational(g.w, line(homeCity(g.w, "JP-47")!.pos, subCity(g.w, "JP-27")!.pos), "JP-47", "JP-27");
    expect(p.ok, p.reasons.join()).toBe(true); expect(performNational(g.sim, g.w, p)).toBe(true);
    const c = homeCity(g.w, "JP-47")!; expect(c.name).toBe("魚釣島市"); expect(p.segments.flatMap((q) => q.cells)).toContain(c.cell);
    const t0 = g.sim.cities[c.id].pop; g.sim.policy!.mode = "priority"; while (yearOf(g.sim) < 1962) { stepMonth(g.sim, g.w); if (g.sim.kaigen?.pending) settleKaigen(g.sim, 0, true); if (g.sim.policy?.pending) autoResolve(g.sim, g.w); }
    expect(g.sim.cities[c.id].pop).toBeLessThanOrEqual(c.capPop!); expect(g.sim.cities[c.id].pop).toBeGreaterThanOrEqual(2000); void t0;
  }, 300000);
  it("an old game (no isl20) keeps its world; mismatches are refused", () => {
    const g = game([mv("竹島", "JP-32")], "JP-32"), plain = realWorld(true, true).w;
    expect(validateSimAgainstWorld(g.sim, g.w, g.hash)).toBeNull();
    expect(validateSimAgainstWorld(g.sim, plain, g.hash)).not.toBeNull();
    const s = defaultState(); s.finalized = true; s.capital = "JP-32"; s.capitalPos = isletPos(isl("竹島")); g.sim.mapHash = mapStateHash(s); const back = parseSave(JSON.parse(JSON.stringify(makeSave(s, g.sim))));
    expect(back.sim?.moves20).toEqual(g.sim.moves20); expect(back.sim?.isl20).toBe(true); void mapStateHash;
  });
});

import { describe, expect, it } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { PREF_IDS } from "../../src/core/seat";
import { isShown, LATENT_START, SHOW_ON } from "../../src/sim/city17";
import { createSim } from "../../src/sim/engine";
import { potentialData, potentialDataOf, potentialOrder, potentialWeights, POT_FLOOR } from "../../src/sim/potential17";
import { pickCityCircles } from "../../src/render/cityCircles";
import { realWorld } from "./simhelp";
import { run14 } from "../study/lib14";

describe("Stage 17 B: from rank to weight", () => {
  const d = potentialData(realWorld(true).w.t), order = potentialOrder({ capital: "JP-13", sub: "JP-27", palace: "JP-13", mode: "concentrate", seed: 7 }, d), W = potentialWeights(order);
  it("the 49 weights average exactly 1, fall with rank, stay above the floor, and differ little from the 20th rank down", () => {
    const v = order.map((p) => W[p]); expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(49, 9);
    for (let i = 1; i < 49; i++) expect(v[i]).toBeLessThan(v[i - 1]); expect(v[48]).toBeGreaterThan(0.25); expect(v[48]).toBeGreaterThan(POT_FLOOR * 0.6);
    expect(v[0] / v[48]).toBeGreaterThan(4); expect(v[19] / v[48]).toBeLessThan(1.25); expect(v[0] - v[9]).toBeGreaterThan(3 * (v[19] - v[48]));
  });
  it("the total is the same for 集中 and 分散 and for any seats; the same inputs give the same weights", () => {
    const a = potentialWeights(potentialOrder({ capital: "JP-17", sub: "JP-27", palace: "JP-26", mode: "disperse", seed: 3 }, d)), s = (o: Record<string, number>) => Object.values(o).reduce((x, y) => x + y, 0);
    expect(s(a)).toBeCloseTo(49, 9); expect(s(W)).toBeCloseTo(49, 9); expect(potentialWeights(order)).toEqual(W); expect(Object.keys(W).sort()).toEqual([...PREF_IDS].sort());
  });
});

describe("Stage 17 C/D/E: a game from the 49 capitals", () => {
  const { w, hash } = realWorld(true, true);
  const mk = (o: object = {}) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...o });
  const a = mk(), old = mk({ pot17: false });
  it("a new game carries the potentials; every capital is shown and nothing else; an older world-with-towns game has none", () => {
    expect(a.pot17).toBeDefined(); expect(a.pot17!.order.length).toBe(49); expect(new Set(a.pot17!.order).size).toBe(49); expect(old.pot17).toBeUndefined();
    const shown = w.cities.filter((c) => isShown(a, c.id)); expect(shown.length).toBe(49); expect(shown.every((c) => c.kind === "capital")).toBe(true);
    expect(w.cities.filter((c) => c.kind === "capital").length).toBe(49);
  });
  it("registering places moves nobody: each prefecture starts with the same people as before, the candidates holding only a share of their size", () => {
    const sum = (s: typeof a, pref: string) => w.cities.filter((c) => c.pref === pref).reduce((t, c) => t + s.cities[c.id].pop, 0);
    for (const p of PREF_IDS) expect(Math.abs(sum(a, p) - sum(old, p))).toBeLessThanOrEqual(w.cities.length);
    const cand = w.cities.find((c) => c.kind === "town")!; expect(a.cities[cand.id].pop).toBeLessThan(old.cities[cand.id].pop * (LATENT_START + 0.05) + 3000);
    expect(pickCityCircles(a, w, 1, null, false).every((c) => w.cityById.get(c.id)!.kind === "capital")).toBe(true);
  });
  it("sanitising keeps a good record and drops a broken one", () => {
    const back = sanitizeSim(JSON.parse(JSON.stringify(a))); expect(back.sim!.pot17!.order).toEqual(a.pot17!.order);
    const bad = JSON.parse(JSON.stringify(a)); bad.pot17.order = ["JP-13"]; expect(sanitizeSim(bad).sim!.pot17).toBeUndefined();
  });
});

describe("Stage 17: a game 1950-1991, 集中 and 分散", () => {
  const con = run14({ seed: 7, firstEra: 0, until: 1991 }), dis = run14({ seed: 7, firstEra: 2, until: 1991 }), off = run14({ seed: 7, firstEra: 0, until: 1991, pot17: false });
  const total = (r: typeof con) => r.w.cities.reduce((t, c) => t + r.sim.cities[c.id].pop, 0), pref = (r: typeof con, p: string) => r.w.cities.filter((c) => c.pref === p).reduce((t, c) => t + r.sim.cities[c.id].pop, 0);
  it("places grow into cities; the nation is the same as without them; the shown count never counts a place twice", () => {
    const born = Object.entries(con.sim.pot17!.shown).filter(([id, v]) => v > 0 && con.w.cityById.get(id)!.kind !== "capital"); expect(born.length).toBeGreaterThan(15);
    for (const [id, y] of born) { expect(y).toBeGreaterThan(1950); expect(con.sim.cities[id].pop).toBeGreaterThan(0); }
    expect(Math.abs(total(con) / total(off) - 1)).toBeLessThan(0.02);
  });
  it("the satellites of the capital's prefecture grow; the people of a place come from its capital (a place near the seats is not smaller than its far twin)", () => {
    const sat = con.w.cities.filter((c) => c.kind !== "capital" && c.pref && ["JP-13", "JP-14", "JP-11", "JP-12", "JP-27", "JP-28"].includes(c.pref) && isShown(con.sim, c.id));
    expect(sat.length).toBeGreaterThanOrEqual(6); expect(Math.max(...sat.map((c) => con.sim.cities[c.id].pop))).toBeGreaterThan(SHOW_ON * 3);
    const circles = pickCityCircles(con.sim, con.w, 1.2, null, false); expect(circles.length).toBeGreaterThan(40);
  });
  it("分散 changes where the people are: Tokyo's prefecture holds less and a regional prefecture more than under 集中, with the same nation", () => {
    expect(con.sim.pot17!.order.join()).not.toBe(dis.sim.pot17!.order.join()); expect(Math.abs(total(con) / total(dis) - 1)).toBeLessThan(0.03);
    expect(pref(dis, "JP-13")).toBeLessThan(pref(con, "JP-13") * 0.9);
  });
  it("a new era re-orders the prefectures (history kept) and the weights in force glide, they do not jump", () => {
    const p = con.sim.pot17!; expect(p.hist.length).toBeGreaterThanOrEqual(2); expect(p.hist[1].y).toBeGreaterThanOrEqual(1989); expect(p.hist[0].order.slice(0, 3)).toEqual(p.hist[1].order.slice(0, 3));
    const t = potentialWeights(p.order), moved = PREF_IDS.filter((q) => Math.abs((p.cur[q] ?? 1) - t[q]) > 1e-6); expect(moved.length).toBeGreaterThan(0);
    expect(PREF_IDS.reduce((s, q) => s + p.cur[q], 0)).toBeCloseTo(49, 6);
    expect(potentialDataOf(con.w.t)).toBeDefined();
  });
}, 900000);

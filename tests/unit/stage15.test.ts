import { describe, expect, it } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { homeCity, subCity } from "../../src/sim/ceremony";
import { censusPops, LISTED_CAP } from "../../src/sim/census50";
import { advance, createSim, updateRegionShares } from "../../src/sim/engine";
import { computeMetros } from "../../src/sim/metro";
import { reconCorridor, reconMeanCore, reconRegionLean, FAVOURED_LEAN } from "../../src/sim/recon";
import { basePop } from "../../src/sim/roles";
import { cityOrderBreaches, prefAdjacency } from "../../src/sim/seats14";
import { modeOf } from "../../src/sim/types";
import { runWater } from "../study/water13lib";
import { realWorld, stage3Sim } from "./simhelp";

const KANTO = ["JP-08", "JP-09", "JP-10", "JP-11", "JP-12", "JP-13", "JP-14"];
const share = (s: ReturnType<typeof stage3Sim>["sim"], w: ReturnType<typeof stage3Sim>["w"], f: (pref: string | null) => boolean) => { let a = 0, t = 0; for (const c of w.cities) { const p = s.cities[c.id].pop; t += p; if (f(c.pref)) a += p; } return a / t; };

describe("Stage 15: the cities start from the 1950 census, not from one factor on today's metropolises", () => {
  const { w, hash } = realWorld(true);
  const mk = (o: object) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...o });
  const a = mk({}), old = mk({ pop15: false });
  it("a new game carries the rule (pop15, roles.p15); a game made without it starts as before (Tokyo 40%+ of every city's people)", () => {
    expect(a.pop15).toBe(true); expect(a.roles!.p15).toBe(true); expect(old.pop15).toBeUndefined(); expect(old.roles!.p15).toBeUndefined();
    const tk = (s: typeof a) => s.cities[homeCity(w, s.capital)!.id].pop / w.cities.reduce((t, c) => t + s.cities[c.id].pop, 0);
    expect(tk(old)).toBeGreaterThan(0.38); expect(tk(a)).toBeLessThan(0.3); expect(tk(a)).toBeGreaterThan(0.12);
  });
  it("Kanto holds about a third of the city people at the start (the 1950 urban figure), not the half it did", () => {
    const k = (s: typeof a) => share(s as never, w, (p) => !!p && KANTO.includes(p));
    expect(k(old)).toBeGreaterThan(0.45); expect(k(a)).toBeGreaterThan(0.2); expect(k(a)).toBeLessThan(0.36);
  });
  it("no prefecture carries more than LISTED_CAP times what the map lists for its cities (a lone listed city never takes a whole prefecture's towns)", () => {
    const c = censusPops(w), by = new Map<string, [number, number]>();
    for (const x of w.cities) { const k = x.pref ?? "?", v = by.get(k) ?? [0, 0]; v[0] += c.get(x.id)!; v[1] += x.pop0; by.set(k, v); }
    for (const [k, [now, then]] of by) if (!k.startsWith("HK-")) expect(now, k).toBeLessThanOrEqual(LISTED_CAP * then + 5);
  });
  it("another capital takes the capital's mass under the census rule too, and the old capital's region shrinks to the new one's size", () => {
    const k = mk({ capital: "JP-17" }), tokyo = w.cities.find((c) => c.name === "東京")!, kana = homeCity(w, k.capital)!;
    expect(k.cities[kana.id].pop).toBeGreaterThan(a.cities[tokyo.id].pop * 0.8); expect(k.cities[tokyo.id].pop).toBeLessThan(a.cities[tokyo.id].pop * 0.3);
  });
  it("a capital placed elsewhere draws the region's people and its budget share: Aichi as capital holds 2.5 times the people it has when Tokyo is the capital", () => {
    const x = (cap: string) => { const g = stage3Sim("heisei", 7, false, 0, 2, true, { capital: cap, sub: "JP-27" }); updateRegionShares(g.sim, g.w); return { people: g.w.cities.filter((c) => c.pref === "JP-23").reduce((t, c) => t + g.sim.cities[c.id].pop, 0), share: g.sim.regionShare["JP-23"] }; };
    const t = x("JP-13"), n = x("JP-23"); expect(n.people).toBeGreaterThan(t.people * 2.5); expect(n.share).toBeGreaterThan(t.share);
  });
  it("the flag survives a load and is dropped when it is not `true`; the cities' total is conserved by the roles (a permutation of masses)", () => {
    const j = JSON.parse(JSON.stringify(a)); expect(sanitizeSim(j).sim?.pop15).toBe(true); j.pop15 = 3; expect(sanitizeSim(j).sim?.pop15).toBeUndefined();
    const tot = (s: typeof a, f: (c: (typeof w.cities)[0]) => number) => w.cities.reduce((t, c) => t + f(c), 0), base = tot(a, (c) => censusPops(w).get(c.id)!);
    expect(Math.abs(tot(a, (c) => basePop(a, w, c)) / base - 1)).toBeLessThan(0.01); expect(Math.abs(tot(mk({ capital: "JP-17" }), (c) => basePop(mk({ capital: "JP-17" }), w, c)) / base - 1)).toBeLessThan(0.01);
  });
  it("the 1950 railway reaches along the Sea-of-Japan coast between its sparse cities: Tohoku-Japan-Sea, Hokuriku and San'in together have clearly more track than the older start gave them", () => {
    const rail = (s: typeof a) => Object.values(s.edges).filter((e) => modeOf(e) === "rail" && e.facility !== "ferry" && e.built >= 1).reduce((t, e) => t + (/-(05|06|15|16|17|18|31|32)$/.test(w.prefOf(e.cells[Math.floor(e.cells.length / 2)]) ?? "") ? e.lengthKm : 0), 0);
    expect(rail(a)).toBeGreaterThan(rail(old) * 1.3);
  });
}, 300000);

describe("Stage 15: the policy is a priority, regions it favours work faster, and the satellites are bigger", () => {
  const g = stage3Sim("heisei", 7, false, 1, 2, true), o = stage3Sim("heisei", 7, false, 1, 2, true);
  it("a corridor between two cities of the favoured coast gets an added priority in a Stage 15 game, none in an older one", () => {
    const { w } = g, i = w.cities.findIndex((c) => c.name.startsWith("金沢")), j = w.cities.findIndex((c) => c.name.startsWith("富山"));
    const r = reconCorridor(g.sim, w, i, j, 1960, reconMeanCore(g.sim, w)); expect(r.add).toBeGreaterThan(0.3); expect(r.f).toBeGreaterThan(1.2);
    const old = { ...o.sim, pop15: undefined } as never; expect(reconCorridor(old, o.w, i, j, 1960, reconMeanCore(old, o.w)).add).toBe(0);
    expect(reconRegionLean(g.sim, w, "JP-17", reconMeanCore(g.sim, w))).toBeGreaterThanOrEqual(FAVOURED_LEAN);
  });
  it("prefectures that touch are known (Tokyo-Saitama, Ishikawa-Toyama) and the relation is symmetric", () => {
    const adj = prefAdjacency(g.w); expect(adj.get("JP-13")!.has("JP-11")).toBe(true); expect(adj.get("JP-17")!.has("JP-16")).toBe(true); for (const [a, s] of adj) for (const b of s) expect(adj.get(b)!.has(a)).toBe(true);
  });
  it("the seat's metropolis has towns in several prefectures next to its own and the order still holds (40 years)", () => {
    const x = stage3Sim("heisei", 7, true, 0, 2, true); x.sim.policy!.mode = "auto"; advance(x.sim, x.w, 12 * 50);
    expect(cityOrderBreaches(x.sim, x.w)).toBe(0); const home = homeCity(x.w, x.sim.capital)!, m = x.sim.metro!.list.find((q) => q.members.includes(home.id))!;
    const big = m.members.filter((id) => id !== home.id && x.sim.cities[id].pop >= 300000); expect(big.length).toBeGreaterThanOrEqual(4);
    expect(new Set(big.map((id) => x.w.prefOf(x.w.cityById.get(id)!.cell))).size).toBeGreaterThanOrEqual(3);
    const sub = subCity(x.w, x.sim.subCapital)!, ms = x.sim.metro!.list.find((q) => q.members.includes(sub.id))!; expect(ms.members.filter((id) => id !== sub.id && x.sim.cities[id].pop >= 300000).length).toBeGreaterThanOrEqual(3);
  });
  it("a city with nobody in it does not break the metropolis count (the centre of a satellite is a city already placed)", () => {
    const x = stage3Sim("heisei", 7, false, 0, 2, true), n = x.w.cities.length, an = { T: new Float64Array(n * n).fill(0.4), TT: new Float64Array(n * n).fill(0.4) };
    for (const c of x.w.cities.slice(0, 5)) x.sim.cities[c.id].pop = 0; expect(() => computeMetros(x.sim, x.w, an, 1960)).not.toThrow();
  });
}, 600000);

describe("Stage 15: the island links get places of their own (Kyushu-Shikoku opens with the other straits)", () => {
  it("at the water-tunnel speed the Oita-Ehime tunnel is planned and open by 1970 (it was 1975 before), with traffic, in three seeds", () => {
    for (const seed of [7, 11, 23]) {
      const r = runWater(3, seed, 1970), sim = r._sim, t = Object.values(sim.edges).find((e) => e.facility === "tunnel" && (e.facilityName ?? "").includes("大分〜愛媛") && e.built >= 1 && e.state === "open");
      expect(t, `seed ${seed}`).toBeTruthy(); expect(t!.through + t!.local).toBeGreaterThan(0);
    }
  }, 900000);
}, 1200000);

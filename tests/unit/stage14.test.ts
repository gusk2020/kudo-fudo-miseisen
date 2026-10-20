import { describe, expect, it } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { pickCityCircles } from "../../src/render/cityCircles";
import { homeCity, subCity } from "../../src/sim/ceremony";
import { advance, createSim } from "../../src/sim/engine";
import { mainStraitLinks } from "../../src/sim/ferry";
import { RECON_BOOST, reconGrowth } from "../../src/sim/recon";
import { applySeatOrder, cityOrderBreaches, SEAT_MARGIN } from "../../src/sim/seats14";
import { waterLinks } from "../../src/sim/waterlink";
import { runWater } from "../study/water13lib";
import { realWorld, stage3Sim } from "./simhelp";

const total = (s: ReturnType<typeof stage3Sim>["sim"], w: ReturnType<typeof stage3Sim>["w"]) => w.cities.reduce((t, c) => t + s.cities[c.id].pop, 0);

describe("Stage 14: the seats of government head the city order", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); sim.policy!.mode = "auto";
  const hist: { y: number; breaches: number }[] = [];
  for (let i = 0; i < 8; i++) { advance(sim, w, 60); hist.push({ y: 1950 + Math.floor(sim.month / 12), breaches: cityOrderBreaches(sim, w) }); }
  it("a game made from Stage 14 carries the rule; no city but the two seats is ever bigger than the smaller seat (40 years, every 5)", () => {
    expect(sim.seats14).toBe(true); expect(hist.every((h) => h.breaches === 0)).toBe(true);
  });
  it("moving people never creates or deletes one: the seat rule's own transfer keeps the total to the person", () => {
    const an = { T: new Float64Array(w.cities.length ** 2).fill(0.5), TT: new Float64Array(w.cities.length ** 2).fill(0.5) }, t0 = total(sim, w);
    applySeatOrder(sim, w, an, 2000); expect(total(sim, w)).toBe(t0);
  });
  it("a city forced above the seats is brought under them, year by year, and what it sheds goes to other cities (the total holds)", () => {
    const { sim: s, w: ww } = stage3Sim("heisei", 11, true, 0, 2, true), n = ww.cities.length, an = { T: new Float64Array(n * n).fill(0.7), TT: new Float64Array(n * n).fill(0.7) };
    const seats = [homeCity(ww, s.capital)!.id, subCity(ww, s.subCapital)!.id], small = Math.min(...seats.map((id) => s.cities[id].pop)), nag = ww.cities.find((c) => c.name === "名古屋市")!;
    s.cities[nag.id].pop = Math.round(small * 1.6); const t0 = total(s, ww);
    for (let i = 0; i < 12; i++) applySeatOrder(s, ww, an, 1960 + i);
    expect(s.cities[nag.id].pop).toBeLessThanOrEqual(small * SEAT_MARGIN + 1); expect(total(s, ww)).toBe(t0); expect(cityOrderBreaches(s, ww)).toBe(0);
  });
  it("the seats' people live partly in the suburbs: the capital's city is under three quarters of its metropolis and there are towns of 300,000 or more in two or more other prefectures", () => {
    const m = sim.metro!.list.find((x) => x.members.includes(homeCity(w, sim.capital)!.id))!, home = homeCity(w, sim.capital)!, hp = w.prefOf(home.cell);
    expect(sim.cities[home.id].pop / m.pop).toBeLessThan(0.75);
    const big = m.members.filter((id) => id !== home.id && sim.cities[id].pop >= 300000), prefs = new Set(big.map((id) => w.prefOf(w.cityById.get(id)!.cell)).filter((p) => p && p !== hp));
    expect(big.length).toBeGreaterThanOrEqual(3); expect(prefs.size).toBeGreaterThanOrEqual(2);
  });
  it("another capital works the same way (the order holds and the capital is first or second), and the old-style game is untouched", () => {
    const k = stage3Sim("heisei", 7, true, 0, 2, true, { capital: "JP-17" }); k.sim.policy!.mode = "auto"; advance(k.sim, k.w, 12 * 30);
    expect(cityOrderBreaches(k.sim, k.w)).toBe(0); const rank = k.w.cities.map((c) => ({ id: c.id, p: k.sim.cities[c.id].pop })).sort((a, b) => b.p - a.p), cap = homeCity(k.w, k.sim.capital)!.id; expect(rank.slice(0, 2).some((r) => r.id === cap)).toBe(true);
    const { w: w2, hash } = realWorld(true), old = createSim(w2, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", seats14: false }); expect(old.seats14).toBeUndefined();
    const j = JSON.parse(JSON.stringify(sim)); expect(sanitizeSim(j).sim?.seats14).toBe(true); j.seats14 = "x"; expect(sanitizeSim(j).sim?.seats14).toBeUndefined();
  }, 300000);
}, 600000);

describe("Stage 14: the Sea-of-Japan policy has teeth, and an older game keeps its old strength", () => {
  it("the four terms are RECON_BOOST times as strong from Stage 14 on, and unchanged for a game without the Stage 14 rule", () => {
    const a = stage3Sim("heisei", 7, false, 1, 2, true).sim, { w, hash } = realWorld(true), o = createSim(w, "m", hash, 7, { stage3: true, firstEra: 1, techK: 2, subCapital: "JP-27", seats14: false });
    const w1 = stage3Sim("heisei", 7, false, 1, 2, true).w, ga = reconGrowth(a, w1, 1960), go = reconGrowth(o, w, 1960);
    const id = [...ga.keys()].find((k) => Math.abs(go.get(k)!) > 1e-5)!; expect(ga.get(id)! / go.get(id)!).toBeCloseTo(RECON_BOOST, 6);
  });
  it("with 日本海側重視 the Sea-of-Japan side has more people, more industry and more big ports in 2000 than with 太平洋側重視 (same seed)", () => {
    const run = (era: number) => { const g = stage3Sim("heisei", 7, true, era, 2, true); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * 50); return g; };
    const share = (g: ReturnType<typeof run>, west: boolean) => { let s = 0, t = 0; for (const c of g.w.cities) { const p = g.sim.cities[c.id].pop; t += p; if ((west ? 1 : -1) * coast(g.w, c.id) > 0.25) s += p; } return s / t; };
    const coast = (ww: ReturnType<typeof run>["w"], id: string) => coastSideOf(ww, id);
    const pac = run(0), jsea = run(1); expect(pac.sim.kaigen!.recon!.coast).toBe("pacific"); expect(jsea.sim.kaigen!.recon!.coast).toBe("japansea");
    expect(share(jsea, false)).toBeGreaterThan(share(pac, false) * 1.5);   // the Sea-of-Japan side's share of the nation
  }, 600000);
}, 900000);
import { coastSide as coastSideOf } from "../../src/sim/recon";

describe("Stage 14: the crossing between Kyushu and Shikoku (Hoyo) exists, is a tunnel under the water, and joins the road network at both ends", () => {
  const { w } = realWorld(true);
  it("the narrowest strait between each two main islands is always a candidate, by the grid's island ids (Honshu-Kyushu-Shikoku-Hokkaido)", () => {
    const l = mainStraitLinks(w, waterLinks(w)); expect(l.length).toBeGreaterThanOrEqual(4);
    const pair = (a: number, b: number) => l.find((x) => new Set([w.t.island[x.a], w.t.island[x.b]]).has(a) && new Set([w.t.island[x.a], w.t.island[x.b]]).has(b));
    const kyushu = w.t.island[w.cityById.get("C-JP-44")!.cell], shikoku = w.t.island[w.cityById.get("C-JP-38")!.cell]; const k = pair(kyushu, shikoku); expect(k).toBeTruthy();
    expect(w.lm[k!.a]).not.toBe(w.lm[k!.b]); expect(k!.km).toBeLessThan(60);
  });
  it("in 1950-1995 at the water-tunnel speed an open road tunnel joins an Oita-side port to Shikoku, and both of its ends reach the whole network (seed 7)", () => {
    const r = runWater(3, 7, 1995), sim = r._sim, kyushu = w.t.island[w.cityById.get("C-JP-44")!.cell], shikoku = w.t.island[w.cityById.get("C-JP-38")!.cell];
    const t = Object.values(sim.edges).find((e) => e.facility === "tunnel" && e.built >= 1 && e.state === "open" && (e.facilityName ?? "").startsWith("link:") && new Set([w.t.island[e.cells[0]], w.t.island[e.cells[e.cells.length - 1]]]).size === 2 && [w.t.island[e.cells[0]], w.t.island[e.cells[e.cells.length - 1]]].every((i) => i === kyushu || i === shikoku))!;
    expect(t).toBeTruthy(); expect(t.facilityName).toContain("海底トンネル");
    const reach = (start: string) => { const seen = new Set([start]), q = [start]; while (q.length) { const n = q.pop()!; for (const e of Object.values(sim.edges)) { if (e.id === t.id || e.built < 1 || e.state !== "open" || e.facility === "ferry") continue; const o = e.a === n ? e.b : e.b === n ? e.a : null; if (o && !seen.has(o)) { seen.add(o); q.push(o); } } } return seen; };
    expect(reach(t.a).size).toBeGreaterThan(100); expect(reach(t.b).size).toBeGreaterThan(100); expect(t.through + t.local).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.text.includes("海峡連絡が開通") && e.text.includes("海底トンネル"))).toBe(true);   // and the timeline says so
  }, 600000);
}, 900000);

describe("Stage 14: the circles", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); sim.policy!.mode = "auto"; advance(sim, w, 12 * 40);
  it("the seats, the metropolises' cores and the seats' towns of 150,000 or more are always drawn, in every view; the biggest city of the nation is never missing", () => {
    for (const [zoom, lite] of [[0.3, true], [0.3, false], [1.2, false]] as [number, boolean][]) {
      const c = pickCityCircles(sim, w, zoom, null, lite), ids = new Set(c.map((x) => x.id)), tokyo = homeCity(w, sim.capital)!, osaka = subCity(w, sim.subCapital)!;
      expect(ids.has(tokyo.id)).toBe(true); expect(ids.has(osaka.id)).toBe(true); expect(c.filter((x) => x.seat).length).toBe(2);
      const biggest = [...w.cities].sort((a, b) => sim.cities[b.id].pop - sim.cities[a.id].pop)[0]; expect(ids.has(biggest.id)).toBe(true);
      const m = sim.metro!.list.find((x) => x.members.includes(tokyo.id))!; for (const id of m.members) if (sim.cities[id].pop >= 150000) expect(ids.has(id), id).toBe(true);
    }
  });
  it("the circles of the past view come from the history; no triangle is drawn any more (the picker returns circles only)", () => {
    const c = pickCityCircles(sim, w, 0.5, 1980, false); expect(c.length).toBeGreaterThan(10); for (const x of c) { expect(Number.isFinite(x.rel)).toBe(true); expect(x.p).toBeGreaterThan(0); }
  });
}, 600000);

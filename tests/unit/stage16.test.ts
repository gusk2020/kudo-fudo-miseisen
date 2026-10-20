import { describe, expect, it } from "vitest";
import { sanitizeSim, validateSimAgainstWorld } from "../../src/core/save2";
import { mainStraitLinks, namedStrait } from "../../src/sim/ferry";
import { waterLinks } from "../../src/sim/waterlink";
import { createSim } from "../../src/sim/engine";
import { cityOrderBreaches } from "../../src/sim/seats14";
import { modeOf } from "../../src/sim/types";
import { SUBGRID_LAND, TOWN_MAX, townsForSeats, withSubgridLand } from "../../src/sim/world";
import { SATELLITE_MIN } from "../../src/render/cityCircles";
import { realToLonLat, TOWNS } from "../../src/core/data";
import { run14 } from "../study/lib14";
import { realWorld, stage3Sim } from "./simhelp";

describe("Stage 16: real provincial towns round the two seats, in the world and not in the terrain", () => {
  const base = realWorld(true), tw = realWorld(true, true);
  it("the town data is real: unique ids and names, a population each, every town a place in Japan", () => {
    expect(TOWNS.length).toBeGreaterThan(250); expect(new Set(TOWNS.map((t) => t.id)).size).toBe(TOWNS.length); expect(new Set(TOWNS.map((t) => t.name)).size).toBe(TOWNS.length);
    for (const t of TOWNS) { expect(t.pop).toBeGreaterThan(0); const [lon, lat] = realToLonLat(t.pos); expect(lon).toBeGreaterThan(122); expect(lon).toBeLessThan(146.5); expect(lat).toBeGreaterThan(24); expect(lat).toBeLessThan(45.6); }
  });
  it("a towns world keeps the cities first and in their old order, and adds towns after them (at most TOWN_MAX); the base world has none", () => {
    expect(base.w.hasTowns).toBeUndefined(); expect(base.w.cities.some((c) => c.kind === "town")).toBe(false);
    expect(tw.w.hasTowns).toBe(true); const n = base.w.cities.length; expect(tw.w.cities.length).toBeGreaterThan(n + 10); expect(tw.w.cities.length).toBeLessThanOrEqual(n + TOWN_MAX);
    for (let i = 0; i < n; i++) expect(tw.w.cities[i].id).toBe(base.w.cities[i].id);
    expect(tw.w.cities.slice(n).every((c) => c.kind === "town")).toBe(true); expect(tw.w.townIds!.length).toBe(tw.w.cities.length - n);
    expect(tw.hash).toBe(base.hash);   // (the terrain hash is the same: an older save's terrain check is untouched)
  });
  it("the towns are those of the seats' prefectures and the prefectures next to them; another pair of seats takes another set", () => {
    const a = tw.w.townIds!, b = realWorld(true, { capital: "JP-17", sub: "JP-27" }).w.townIds!;
    expect(a.join()).not.toBe(b.join());
    const prefsA = new Set(tw.w.cities.filter((c) => c.kind === "town").map((c) => c.pref)); expect(prefsA.has("JP-13") || prefsA.has("JP-11") || prefsA.has("JP-12") || prefsA.has("JP-14")).toBe(true);
    const prefsB = new Set(realWorld(true, { capital: "JP-17", sub: "JP-27" }).w.cities.filter((c) => c.kind === "town").map((c) => c.pref)); expect(prefsB.has("JP-17") || prefsB.has("JP-16") || prefsB.has("JP-18")).toBe(true);
    expect(townsForSeats(tw.w.t, ["JP-13", "JP-27"]).join()).toBe(a.join());   // (the same seats always give the same towns)
  });
  it("Saganoseki and Sadamisaki: in the towns world the peninsula is one piece of Shikoku and the Kyushu-Shikoku strait the game sees is the 14 km Hoyo one, not the 47 km one", () => {
    expect(SUBGRID_LAND.length).toBeGreaterThan(0);
    const kyuShi = (w: typeof base.w) => mainStraitLinks(w, waterLinks(w)).filter((l) => new Set([w.t.island[l.a], w.t.island[l.b]]).size === 2 && [w.t.island[l.a], w.t.island[l.b]].sort().join() === "3,4");
    const old = kyuShi(base.w), now = kyuShi(tw.w);
    expect(old.length).toBe(1); expect(old[0].km).toBeGreaterThan(40);
    expect(now.length).toBe(1); expect(now[0].km).toBeLessThan(25);
    const ns = namedStrait(tw.w, { a: { cell: now[0].a }, b: { cell: now[0].b } }); expect(ns).not.toBeNull(); expect(ns!.name).toBe("豊予海峡"); expect([ns!.a, ns!.b].sort()).toEqual(["佐田岬", "佐賀関"].sort());
    expect(namedStrait(base.w, { a: { cell: old[0].a }, b: { cell: old[0].b } })).toBeNull();
    expect(withSubgridLand(base.w.t).hash).toBe(base.w.t.hash);
  });
  it("a save without towns cannot attach to a towns world and the other way round; towns16 survives a save and load", () => {
    const sim = createSim(tw.w, "m", tw.hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" });
    expect(sim.towns16).toEqual(tw.w.townIds); expect(validateSimAgainstWorld(sim, tw.w, tw.hash)).toBeNull(); expect(validateSimAgainstWorld(sim, base.w, base.hash)).not.toBeNull();
    const old = createSim(base.w, "m", base.hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" });
    expect(old.towns16).toBeUndefined(); expect(validateSimAgainstWorld(old, base.w, base.hash)).toBeNull(); expect(validateSimAgainstWorld(old, tw.w, tw.hash)).not.toBeNull();
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(back.sim!.towns16).toEqual(sim.towns16);
  });
  it("the seats' towns hold real people from the census start and the city order guard still holds; the circle threshold lets a small town show", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { towns: true });
    const towns = w.cities.filter((c) => c.kind === "town"); expect(towns.length).toBeGreaterThan(10);
    for (const c of towns) expect(sim.cities[c.id].pop).toBeGreaterThan(0);
    expect(cityOrderBreaches(sim, w)).toBe(0); expect(SATELLITE_MIN).toBeLessThan(150000);
  });
});

describe("Stage 16: a game on the towns world (1950-1975)", () => {
  const r = run14({ seed: 7, until: 1975 });
  it("the Hoyo tunnel is built across the real strait (Saganoseki-Sadamisaki), named so, open, with the ferry that stood there closed and a road on the Shikoku side", () => {
    const { sim, w } = r, isl = (k: number) => w.t.island[k];
    const tun = Object.values(sim.edges).find((e) => e.facility === "tunnel" && (e.facilityName ?? "").includes("豊予海峡"));
    expect(tun).toBeDefined(); expect(tun!.state).toBe("open"); expect(modeOf(tun!)).toBe("road"); expect(tun!.facilityName).toContain("佐賀関〜佐田岬");
    const [a, b] = [tun!.cells[0], tun!.cells[tun!.cells.length - 1]]; expect([isl(a), isl(b)].sort()).toEqual([3, 4]);
    const [lonA, latA] = realToLonLat(w.cellPos(a)), [lonB, latB] = realToLonLat(w.cellPos(b)); const [kl, kb] = lonA < lonB ? [[lonA, latA], [lonB, latB]] : [[lonB, latB], [lonA, latA]];
    expect(Math.abs(kl[0] - 131.88)).toBeLessThan(0.1); expect(Math.abs(kl[1] - 33.24)).toBeLessThan(0.1); expect(Math.abs(kb[0] - 132.01)).toBeLessThan(0.1); expect(Math.abs(kb[1] - 33.34)).toBeLessThan(0.1);
    const ferry = Object.values(sim.edges).find((e) => e.facility === "ferry" && (e.facilityName ?? "").includes("豊予海峡")); expect(ferry).toBeDefined(); expect(ferry!.state).not.toBe("open");
    const touching = Object.values(sim.edges).filter((e) => e !== tun && e.facility !== "ferry" && modeOf(e) === "road" && e.state === "open" && (e.a === tun!.a || e.b === tun!.a || e.a === tun!.b || e.b === tun!.b)); expect(touching.some((e) => e.a === tun!.a || e.b === tun!.a)).toBe(true); expect(touching.some((e) => e.a === tun!.b || e.b === tun!.b)).toBe(true);
    const ev = sim.events.find((x) => x.kind === "open" && x.cause.includes("豊予") || (x.kind === "crossing" && x.text.includes("佐賀関"))); expect(ev).toBeDefined();
  });
  it("the provincial towns do not all move together: some grow, some fall behind (traffic and terrain decide), and the nation is not counted twice", () => {
    const { sim, w } = r, towns = w.cities.filter((c) => c.kind === "town"), ratios = towns.map((c) => sim.cities[c.id].pop / Math.max(1, c.pop0));
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeGreaterThan(1.3);
    const sum = w.cities.reduce((t, c) => t + sim.cities[c.id].pop, 0); expect(sum).toBeLessThan(80e6); expect(sum).toBeGreaterThan(20e6);
  });
});

describe("Stage 16: the 日本海側 policy builds trunk lines you can see on the map (high-speed rail and expressways ahead of the jam)", () => {
  const hsr = (s: ReturnType<typeof run14>, pref: (p: string) => boolean) => { let km = 0; for (const e of Object.values(s.sim.edges)) { if (modeOf(e) !== "rail" || e.standard !== "highgrade" || e.state !== "open" || e.facility === "ferry") continue; const p = s.w.prefOf(e.cells[e.cells.length >> 1]); if (p && pref(p)) km += e.lengthKm; } return km; };
  const JS = (p: string) => ["JP-05", "JP-06", "JP-15", "JP-16", "JP-17", "JP-18", "JP-31", "JP-32"].includes(p), PAC = (p: string) => ["JP-08", "JP-09", "JP-10", "JP-11", "JP-12", "JP-13", "JP-14", "JP-21", "JP-22", "JP-23", "JP-24", "JP-25", "JP-26", "JP-27", "JP-28", "JP-33", "JP-34"].includes(p);
  const pac = run14({ seed: 7, firstEra: 0, until: 1975 }), js = run14({ seed: 7, firstEra: 1, until: 1975 });
  it("with 日本海側重視 the Sea-of-Japan prefectures have far more high-speed line than under 太平洋側重視, and the Pacific belt less", () => {
    expect(hsr(js, JS)).toBeGreaterThan(hsr(pac, JS) + 150); expect(hsr(pac, PAC)).toBeGreaterThan(hsr(js, PAC));
  });
  it("the policy trunk jobs name the policy as their reason", () => {
    expect(Object.values(js.sim.projects).some((p) => modeOf(p) === "rail" && p.reason.includes("復興方針") && p.reason.includes("幹線鉄道"))).toBe(true);
  });
});

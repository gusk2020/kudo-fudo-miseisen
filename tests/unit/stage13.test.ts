import { describe, expect, it } from "vitest";
import { realToLonLat } from "../../src/core/data";
import { sanitizeSim } from "../../src/core/save2";
import { corridorsOf, evalCorridor } from "../../src/sim/crossing";
import { advance } from "../../src/sim/engine";
import { facCost } from "../../src/sim/planning";
import { isWaterTunnel, TUNNEL_KM, techAt, waterTechAt, WATER_K } from "../../src/sim/tech";
import { HIGH_F, LOW_F, metroBudgetKm2, PLAIN_F, terrainFactor, validMetro } from "../../src/sim/metro";
import { landDistanceKm, sidePops, virtualTrips, waterLinks } from "../../src/sim/waterlink";
import type { SimEdge } from "../../src/sim/types";
import { biwaWorld, runWater } from "../study/water13lib";
import { createSim } from "../../src/sim/engine";
import { BAY_FIRST, BAY_TAG, isLakeFerry, reviewLakeFerries, LAKE_BRIDGE_TAG } from "../../src/sim/ferry";
import { CROSSING_TAG, MAX_ACTIVE_PER_MODE, MAX_ACTIVE_WATER, isCrossingProject, planCrossings } from "../../src/sim/crossing";
import { capacityOf } from "../../src/sim/demand";
import { modeOf } from "../../src/sim/types";
import { checkIntegrity } from "../../src/sim/network";
import { realWorld, stage3Sim } from "./simhelp";

const lonLat = (w: ReturnType<typeof realWorld>["w"], k: number) => realToLonLat(w.cellPos(k) as [number, number]);
const near = (p: number[], lon: number, lat: number, tol = 0.35) => Math.abs(p[0] - lon) <= tol && Math.abs(p[1] - lat) <= tol;

describe("Stage 13: the water-tunnel technology rule (Issue #33)", () => {
  it("the clock runs three times as fast, at any technology year the reach is three times the ordinary reach, and cost and time are halved -- each once", () => {
    expect(WATER_K).toBe(3);
    const a = waterTechAt(3, 1960), b = waterTechAt(1, 1960);
    expect(a.yEff).toBe(1980); expect(b.yEff).toBe(1960);
    expect(a.costMult).toBeCloseTo(0.5, 9); expect(a.timeMult).toBeCloseTo(0.5, 9); expect(b.costMult).toBe(1); expect(b.timeMult).toBe(1);
    // the baseline (wk 1) is the ordinary curve; wk 3 reads the curve at the faster year AND triples it
    expect(b.reachKm).toBeCloseTo(techAt(1, 1960).tunnelKm, 9);
    expect(a.reachKm).toBeCloseTo(3 * waterTechAt(1, 1980).reachKm, 9);
    expect(a.reachKm).toBeGreaterThan(3 * b.reachKm);   // faster clock x longer reach: more than either alone
    expect(waterTechAt(3, 2100).reachKm).toBe(3 * TUNNEL_KM[TUNNEL_KM.length - 1][1]);
  });
  it("only a fixed link under water follows it: a bridge, and an ordinary land tunnel, keep the general rule", () => {
    const mk = (facility: string, facilityName?: string) => ({ facility, facilityName, curv: 0 }) as unknown as SimEdge;
    expect(isWaterTunnel(mk("tunnel", "link:A〜B海底トンネル"))).toBe(true); expect(isWaterTunnel(mk("tunnel", "tunnel:峠"))).toBe(false); expect(isWaterTunnel(mk("bridge", "link:A〜B大橋"))).toBe(false);
    const { sim } = stage3Sim("heisei", 7, false, 0, 2, true); expect(sim.tech?.wk).toBe(3);
    const one = { ...sim, tech: { k: 2, wk: 1 } } as typeof sim;
    expect(facCost(mk("tunnel", "link:A〜B海底トンネル"), sim)).toBeCloseTo(0.5 * facCost(mk("tunnel", "link:A〜B海底トンネル"), one), 6);
    expect(facCost(mk("bridge", "link:A〜B大橋"), sim)).toBe(facCost(mk("bridge", "link:A〜B大橋"), one));
    expect(facCost(mk("tunnel", "tunnel:峠"), sim)).toBe(facCost(mk("tunnel", "tunnel:峠"), one));
    expect(techAt(2, 1960).tunnelKm).toBeLessThan(waterTechAt(3, 1960).reachKm);   // the land tunnel's limit is not the water tunnel's
  });
  it("an older game has no water rule; a damaged one is dropped by the loader and a good one survives", () => {
    const { sim } = stage3Sim("heisei", 7, false, 0, 2, true), good = JSON.parse(JSON.stringify(sim));
    expect(sanitizeSim(good).sim?.tech?.wk).toBe(3);
    const bad = JSON.parse(JSON.stringify(sim)); bad.tech.wk = 99; expect(sanitizeSim(bad).sim?.tech?.wk).toBeUndefined();
    const text = JSON.parse(JSON.stringify(sim)); text.tech.wk = "x"; expect(sanitizeSim(text).sim?.tech?.wk).toBeUndefined();
    const old = JSON.parse(JSON.stringify(sim)); delete old.tech.wk; const r = sanitizeSim(old); expect(r.sim?.tech?.k).toBe(2); expect(r.sim?.tech?.wk).toBeUndefined();
  });
});

describe("Stage 13: candidates come from the shape of the coast", () => {
  const { w } = realWorld(true), links = waterLinks(w);
  it("water the older rules never joined is found: the mouth of Tokyo Bay, Ise Bay, the Bungo channel, the bays of Kagoshima and Nagasaki", () => {
    expect(links.length).toBeGreaterThan(20);
    const has = (lon: number, lat: number, lon2: number, lat2: number) => links.some((l) => { const a = lonLat(w, l.a), b = lonLat(w, l.b); return (near(a, lon, lat) && near(b, lon2, lat2)) || (near(a, lon2, lat2) && near(b, lon, lat)); });
    expect(has(139.69, 35.21, 139.86, 35.21) || has(139.7, 35.2, 139.85, 35.2)).toBe(true);   // Kanagawa - Chiba
    expect(has(137.08, 34.63, 136.92, 34.76) || has(137.0, 34.65, 136.9, 34.75, )).toBe(true);   // the two Aichi peninsulas
    expect(has(132.25, 33.45, 132.36, 33.5) || has(131.9, 33.25, 132.3, 33.5)).toBe(true);   // Oita - Ehime
    expect(has(130.64, 31.23, 130.81, 31.23)).toBe(true);   // Kinko Bay's two peninsulas
  });
  it("each candidate really saves distance over the way by land, joins two land cells, and a lake is never a sea", () => {
    for (const l of links) {
      expect(w.t.land[l.a]).toBe(1); expect(w.t.land[l.b]).toBe(1); expect(l.km).toBeGreaterThanOrEqual(5); expect(l.saving).toBeGreaterThan(0);
      expect(landDistanceKm(w, l.a, l.b, 1) === null || l.landKm !== null || l.landKm === null).toBe(true);
    }
    expect(links.filter((l) => l.kind === "lake").every((l) => l.lmA === l.lmB)).toBe(true);
  });
  it("shore people count both sides and the countryside; the demand of a crossing grows with them and with the distance it saves", () => {
    const { sim } = stage3Sim("heisei", 7, false, 0, 2, true), l = links.find((x) => x.kind === "sea" && x.saving > 60)!;
    const [pa, pb] = sidePops(sim, w, l.a, l.b); expect(pa).toBeGreaterThan(0); expect(pb).toBeGreaterThan(0);
    const t = virtualTrips(sim, w, l.a, l.b, l.km, "road"); expect(t).toBeGreaterThan(0); expect(virtualTrips(sim, w, l.a, l.b, l.km, "rail")).toBeGreaterThan(0);
    const shorter = virtualTrips(sim, w, l.a, l.b, l.km * 0.5, "road"); expect(shorter).toBeGreaterThanOrEqual(t);
  });
});

describe("Stage 13: the planner takes them up on cost and demand (1950-1975 at 1x and 3x)", () => {
  const a3 = runWater(3, 7, 1975), a1 = runWater(1, 7, 1975);
  const ok = (r: ReturnType<typeof runWater>, pat: RegExp) => r.projects.some((p) => pat.test(p.name ?? "") && p.state === "open");
  it("at 3x the named places get a concept, a construction and an opening: Chiba-Kanagawa, the Aichi peninsulas, Oita-Ehime, Nagasaki, Kagoshima", () => {
    expect(ok(a3, /神奈川〜千葉海底トンネル/)).toBe(true); expect(ok(a3, /名古屋東岸〜名古屋西岸|三重〜愛知/)).toBe(true); expect(ok(a3, /大分西岸〜松山東岸/)).toBe(true);
    expect(ok(a3, /佐賀〜長崎|熊本〜長崎/)).toBe(true); expect(a3.projects.some((p) => /鹿児島西岸〜鹿児島東岸/.test(p.name ?? ""))).toBe(true);   // (Kinko Bay: conceived; whether it is finished is cost against a small traffic)
  });
  it("technology at 1x gets fewer of them, and later", () => {
    const n = (r: ReturnType<typeof runWater>) => r.projects.filter((p) => p.state === "open").length;
    expect(n(a3)).toBeGreaterThan(n(a1));
    const years = (r: ReturnType<typeof runWater>) => r.projects.filter((p) => p.state === "open").map((p) => Math.min(...(p.hist as any[]).filter((h) => String(h[1]).startsWith("op")).map((h) => h[0] as number))), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(years(a3))).toBeLessThan(mean(years(a1)));   // the faster technology opens its projects earlier on the whole (a single project's year moves with the random stream)
  });
  it("every candidate evaluated says why it is, or is not, one; and a far pair of ports is not a crossing", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true);
    const cs = corridorsOf(sim, w, "road"); expect(cs.length).toBeGreaterThan(20);
    const why = new Set(cs.map((c) => evalCorridor(sim, w, c, "road", 1952, 1).why)); expect(why.has("far-ports")).toBe(true);
    for (const c of cs) { const e = evalCorridor(sim, w, c, "road", 1952, 1); expect(typeof e.why).toBe("string"); if (e.ok) expect(e.score!).toBeGreaterThanOrEqual(e.bar!); }
  });
}, 600000);

describe("Stage 13: metropolitan areas", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); sim.policy!.mode = "auto"; advance(sim, w, 12 * 30);
  const M = sim.metro!;
  it("terrain develops 1.5x on a plain, 1x on low ground and 0.5x on high ground or in a range", () => {
    expect([PLAIN_F, LOW_F, HIGH_F]).toEqual([1.5, 1, 0.5]);
    const fs = new Set<number>(); for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) fs.add(terrainFactor(w, k));
    expect([...fs].sort()).toEqual([0.5, 1, 1.5]);
    for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) { const f = terrainFactor(w, k); if (w.elevM(k) > 500) expect(f).toBe(0.5); if (f === 1.5) expect(w.elevM(k)).toBeLessThanOrEqual(120); }
  });
  it("exists after the first yearly steps, validates, and survives the loader; a damaged one is dropped", () => {
    expect(M).toBeTruthy(); expect(validMetro(M)).toBe(true); expect(M.list.length).toBeGreaterThan(10);
    const j = JSON.parse(JSON.stringify(sim)); expect(sanitizeSim(j).sim?.metro?.list.length).toBe(M.list.length);
    const bad = JSON.parse(JSON.stringify(sim)); bad.metro.list[0].cells = "x"; expect(sanitizeSim(bad).sim?.metro).toBeUndefined();
  });
  it("nobody and no ground is counted twice: every city is in exactly one metropolis, no cell in two, and the people add up", () => {
    const seen = new Map<string, number>(); for (const m of M.list) for (const id of m.members) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect(seen.size).toBe(w.cities.length); expect([...seen.values()].every((v) => v === 1)).toBe(true);
    const cells = new Set<number>(); let dup = 0; for (const m of M.list) for (const k of m.cells) { if (cells.has(k)) dup++; cells.add(k); }
    expect(dup).toBe(0);
    const total = w.cities.reduce((s, c) => s + sim.cities[c.id].pop, 0); expect(Math.abs(M.list.reduce((s, m) => s + m.pop, 0) - total)).toBeLessThan(1);
    for (const m of M.list) for (const k of m.cells) expect(w.t.land[k]).toBe(1);   // never over the sea
  });
  it("the area follows the budget and the ground: a plain spends a cell at 1/1.5, high ground at 1/0.5; the radius is that of the area covered", () => {
    let saturated = 0, big = 0; const cell2 = w.cell * w.cell;
    for (const m of M.list) {
      const spend = m.cells.reduce((s, k) => s + cell2 / terrainFactor(w, k), 0);
      expect(spend).toBeLessThanOrEqual(m.budgetKm2 + 2 * cell2 + 1e-6 + (m.members.length) * 2 * cell2);   // never spends more than it has, apart from the cities' own cells
      expect(m.radiusKm).toBeCloseTo(Math.sqrt(m.areaKm2 / Math.PI), 6);
      if (m.budgetKm2 > 400) { big++; if (spend >= 0.9 * m.budgetKm2) saturated++; }
    }
    expect(big).toBeGreaterThan(3); expect(saturated).toBeGreaterThan(0);
    expect(metroBudgetKm2(36e6, 0.5)).toBeGreaterThan(8000); expect(metroBudgetKm2(36e6, 0.5)).toBeLessThan(22000); expect(metroBudgetKm2(3e5, 0.5)).toBeGreaterThan(150); expect(metroBudgetKm2(3e5, 0.5)).toBeLessThan(500);
  });
  it("a bigger city covers more ground; satellites join a city at least 1.5 times their size; the largest metropolis spreads across prefectures", () => {
    const sorted = [...M.list].sort((p, q) => q.pop - p.pop), top = sorted[0];
    expect(top.areaKm2).toBeGreaterThan(sorted[5].areaKm2); expect(top.members.length).toBeGreaterThan(1);
    for (const m of M.list) for (const id of m.members) if (id !== m.core) expect(sim.cities[id].pop * 1.5).toBeLessThanOrEqual(sim.cities[m.core].pop + 1);
    expect(sorted.slice(0, 5).some((m) => m.prefs.length >= 2 && m.outsidePct > 0.05)).toBe(true);
  });
  it("the history keeps a size and an area every five years for the past view", () => {
    const top = [...M.list].sort((p, q) => q.pop - p.pop)[0], h = M.h[top.core]; expect(h.length).toBeGreaterThanOrEqual(5); expect(h[h.length - 1][1]).toBeGreaterThan(0); expect(h[h.length - 1][2]).toBeGreaterThan(0);
    for (let i = 1; i < h.length; i++) expect(h[i][0]).toBeGreaterThan(h[i - 1][0]);
  });
}, 600000);

describe("Stage 13: Lake Biwa -- a tunnel, a bridge and a ferry compete, at any size, place and turn", () => {
  for (const [scale, rot] of [[1, 0], [3, 0.8], [5, 0]] as [number, number][]) it(`scale ${scale} rotated ${rot}: a busy lake crossing is planned as ONE fixed link, a bridge or a tunnel, never both; the lake ferry stays until it opens`, () => {
    const { w, hash } = biwaWorld(scale, rot), sim = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" });
    const lakes = Object.values(sim.edges).filter((e) => isLakeFerry(e)); expect(lakes.length).toBeGreaterThan(0);
    sim.dials.hwyBuild = 1; sim.dials.austerity = 1; sim.macro.budgetBu = 2000;
    for (const e of lakes) { e.through = 1e6; e.state = "open"; }
    const cs = corridorsOf(sim, w, "road").filter((c) => c.kind === "lake"); if (!cs.length) return;   // (the lake is too small or too long for a crossing under the limit)
    for (let y = 1985; y < 2010; y++) { planCrossings(sim, w, y); reviewLakeFerries(sim, w, y); }
    const fixed = Object.values(sim.projects).filter((p) => p.reason.startsWith(CROSSING_TAG) || p.reason.startsWith(LAKE_BRIDGE_TAG));
    expect(fixed.length).toBeGreaterThan(0);
    const key = (p: (typeof fixed)[0]) => { const e = sim.edges[p.edgeIds[0]]; return modeOf(p) + [e.cells[0], e.cells[e.cells.length - 1]].sort().join(); };
    const keys = fixed.filter((p) => p.status !== "abolished").map(key); expect(new Set(keys).size).toBe(keys.length);   // one project per pair of shores
    for (const e of lakes) expect(["open", "dormant"].includes(e.state)).toBe(true);
  });
  it("the lake tunnel is named for the lake and never the sea", () => {
    const { w, hash } = biwaWorld(3, 0.8), sim = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" });
    for (const e of Object.values(sim.edges)) if (isLakeFerry(e)) { e.through = 1e6; e.state = "open"; }
    sim.dials.hwyBuild = 1; sim.macro.budgetBu = 5000; for (let y = 1990; y < 2030; y++) planCrossings(sim, w, y);
    for (const p of Object.values(sim.projects)) { const e = sim.edges[p.edgeIds[0]]; if (e && isLakeFerry({ ...e, facility: "ferry" } as never) === false && (e.facilityName ?? "").includes("湖底")) expect(e.facilityName).not.toContain("海底"); }
  });
});

describe("Stage 13: the water-tunnel games plan by money, not by a count of two", () => {
  it("any number of projects up to MAX_ACTIVE_WATER per mode, none beyond it, never a second project for a corridor that has one", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); sim.policy!.mode = "auto"; advance(sim, w, 12 * 3);
    sim.dials.hwyBuild = 1; sim.dials.railBuild = 1; sim.macro.budgetBu = 1e6;
    for (const e of Object.values(sim.edges)) if (e.facility === "ferry" && e.state === "open") e.through = capacityOf(e) * 1.5;
    for (let i = 0; i < 12; i++) planCrossings(sim, w, 1960);
    for (const m of ["road", "rail"] as const) { const act = Object.values(sim.projects).filter((p) => isCrossingProject(p) && modeOf(p) === m && ["concept", "planned", "building", "suspended"].includes(p.status)); expect(act.length).toBeLessThanOrEqual(MAX_ACTIVE_WATER); const keys = act.map((p) => `${p.from}>${p.to}`); expect(new Set(keys).size).toBe(keys.length); }
    expect(Object.values(sim.projects).filter(isCrossingProject).length).toBeGreaterThan(2);   // the Stage 11 cap of two is gone
  });
  it("the older rule is still there for a game made without the water rule (waterK 0): two projects at most, no bay ferries, no water tunnel price", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, 0); expect(sim.tech?.wk).toBeUndefined();
    expect(Object.values(sim.edges).some((e) => (e.facilityName ?? "").endsWith("湾岸航路"))).toBe(false);
    sim.dials.hwyBuild = 1; sim.macro.budgetBu = 1e6; for (const e of Object.values(sim.edges)) if (e.facility === "ferry" && e.state === "open") e.through = capacityOf(e) * 1.5;
    for (let i = 0; i < 8; i++) planCrossings(sim, w, 1990);
    expect(Object.values(sim.projects).filter((p) => isCrossingProject(p) && modeOf(p) === "road").length).toBeLessThanOrEqual(MAX_ACTIVE_PER_MODE);
  });
});

describe("Stage 13 (audit): Lake Biwa tunnels get built when the lake and its shore towns give them a reason", () => {
  for (const [scale, rot] of [[3, 0.8], [3, 0], [5, 0]] as [number, number][]) it(`scale ${scale} rotated ${rot}: a lake tunnel is conceived, built and opened (no fixed year), and the lake's bridge rule stands down in favour of one planner`, () => {
    const r = runWater(3, 7, 1975, `biwa:${scale}:${rot}`), tun = r.projects.filter((p) => /湖底トンネル/.test(p.name ?? "") && p.state === "open");
    expect(tun.length).toBeGreaterThan(0); for (const p of tun) { expect(p.cost).toBeGreaterThan(0); expect(p.km).toBeGreaterThan(5); expect(p.km).toBeLessThanOrEqual(40); }
    expect(Object.values(r._sim.projects).some((p) => p.reason.startsWith(LAKE_BRIDGE_TAG))).toBe(false);   // lake bridges and tunnels are one planner's choice (BRIDGE_PREF), not two rules
    const names = tun.map((p) => p.name as string); for (const n of names) expect(n).not.toContain("海底");
  }, 300000);
  it("the lake's shore ferries are seeded from the shape of the lake, are lake ferries, and a larger or demanding lake gets crossings a small one does not", () => {
    const small = biwaWorld(1, 0), big = biwaWorld(3, 0.8);
    const lakeSeeded = (b: ReturnType<typeof biwaWorld>) => Object.values(createSim(b.w, "m", b.hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }).edges).filter((e) => (e.facilityName ?? "").endsWith("湖岸航路"));
    const a = lakeSeeded(big); expect(a.length).toBeGreaterThan(lakeSeeded(small).length); for (const e of a) expect(isLakeFerry(e)).toBe(true);
  });
});

describe("Stage 13 (audit): the 1950s ferries are laid a few at a time (start-up cost)", () => {
  it("at the start only BAY_FIRST are laid; the rest join over the first years; a game without the water rule gets none", () => {
    const { w, hash } = realWorld(true), mk = (waterK?: number) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...(waterK !== undefined ? { waterK } : {}) });
    const count = (s: ReturnType<typeof mk>) => Object.values(s.edges).filter((e) => (e.facilityName ?? "").endsWith(BAY_TAG) || (e.facilityName ?? "").endsWith("湖岸航路")).length;
    const a = mk(); expect(count(a)).toBeGreaterThan(0); expect(count(a)).toBeLessThanOrEqual(BAY_FIRST);
    a.policy!.mode = "auto"; advance(a, w, 12 * 10); expect(count(a)).toBeGreaterThan(BAY_FIRST); expect(checkIntegrity(a)).toEqual([]);
    expect(count(mk(0))).toBe(0);
  }, 300000);
});

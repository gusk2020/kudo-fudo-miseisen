import { describe, expect, it } from "vitest";
import { analyze } from "../../src/sim/demand";
import { advance, settleKaigen, simHash, stepMonth, yearOf } from "../../src/sim/engine";
import { AIR_SPACING_KM, HUB_CAP, PORT_CAP, PORT_SPACING_KM, RUNWAY_CAP, ensureHubs, hubBoost, hubsAt, reviewHubs, type HubTotals } from "../../src/sim/hubs";
import { autoResolve } from "../../src/sim/policy";
import { modeOf, type SimState } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { stage3Sim } from "./simhelp";

const memo = new Map<string, { sim: SimState; w: World }>();
/** 1950 -> y1 with the first era's stance kept at every era change (0 均衡, 3 空路, 4 海路). */
const run = (first: number, y1: number) => {
  const key = `${first}:${y1}`; if (memo.has(key)) return memo.get(key)!;
  const { sim, w } = stage3Sim("heisei", 7, true, first, 2, true); sim.policy!.mode = "priority"; const stance = ["heisei", "shubun", "shoka", "kuuro", "kairo"][first];
  while (yearOf(sim) < y1) { stepMonth(sim, w); if (sim.kaigen?.pending) { const i = sim.kaigen.pending.cands.findIndex((c) => c.stance === stance); settleKaigen(sim, Math.max(0, i), true); } if (sim.policy?.pending) autoResolve(sim, w); }
  memo.set(key, { sim, w }); return { sim, w };
};
const dist = (w: World, a: string, b: string) => { const p = w.cityById.get(a)!.pos, q = w.cityById.get(b)!.pos; return Math.hypot(p[0] - q[0], p[1] - q[1]); };
const totals = (port: [string, number][] = [], air: [string, number, number][] = [], pairs: [string, number][] = []): HubTotals => ({ port: new Map(port.map(([id, c]) => [id, { cargo: c, pax: 0, dom: 0 }])), air: new Map(air.map(([id, i, d]) => [id, { intl: i, cargo: 0, dom: d }])), pairs: new Map(pairs), unmet: 0 });

describe("Stage 8: ports and airports are facilities with a size", () => {
  it("1950 starts with ports of three tiers, kept apart, and no airport yet; a hub is an order of magnitude bigger than a regional airport", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true), P = Object.values(sim.hubs!.ports);
    expect(P.length).toBeGreaterThan(10); expect(new Set(P.map((p) => p.tier))).toEqual(new Set([1, 2, 3])); expect(Object.keys(sim.hubs!.airports)).toEqual([]);
    for (const p of P) for (const q of P) if (p !== q) expect(dist(w, p.city, q.city)).toBeGreaterThanOrEqual(PORT_SPACING_KM);
    for (const p of P) expect(w.cityById.get(p.city)!.coastal).toBe(true);
    expect(HUB_CAP).toBeGreaterThanOrEqual(2 * RUNWAY_CAP[RUNWAY_CAP.length - 1][1]); expect(PORT_CAP[4]).toBeGreaterThan(30 * PORT_CAP[1]);
  });
  it("by 1985 the balanced world has an international hub with foreign routes, regional airports with domestic routes, foreign sea lanes, and the history to show it", () => {
    const { sim, w } = run(0, 1985), h = sim.hubs!, A = Object.values(h.airports).filter((a) => a.until === undefined), hubs = A.filter((a) => a.kind === "hub"), reg = A.filter((a) => a.kind === "regional");
    expect(hubs.length).toBeGreaterThanOrEqual(1); expect(reg.length).toBeGreaterThan(5);
    expect(Math.min(...hubs.map((a) => a.cap))).toBeGreaterThan(Math.max(...reg.map((a) => a.cap))); expect(Math.max(...hubs.map((a) => a.pax))).toBeGreaterThan(3 * Math.max(...reg.map((a) => a.pax)));
    const open = h.routes.filter((r) => r.state === "open");
    expect(open.some((r) => r.mode === "air" && r.intl && hubs.some((a) => a.city === r.a))).toBe(true); expect(open.filter((r) => r.mode === "air" && !r.intl).length).toBeGreaterThan(5);
    expect(open.filter((r) => r.mode === "sea" && r.intl).length).toBeGreaterThan(5); for (const r of open.filter((r) => r.mode === "sea")) expect(h.ports[r.a].tier).toBeGreaterThanOrEqual(2);
    for (const a of A) for (const b of A) if (a !== b && a.since > 1950) { const d = dist(w, a.city, b.city); if (d < AIR_SPACING_KM) expect(Math.max(sim.cities[a.city].pop, sim.cities[b.city].pop)).toBeGreaterThan(1e6); }
    for (const k of ["port", "air", "lane"]) expect(sim.events.some((e) => e.kind === k), k).toBe(true);
    for (const a of hubs) { expect(a.access.length).toBeGreaterThan(0); for (const id of a.access) expect(sim.edges[id]).toBeTruthy(); }
    expect(Object.values(h.ports).some((p) => p.hist.length > 1)).toBe(true);
    const past = hubsAt(sim, 1960); expect(past.airports.length).toBeLessThan(A.length); expect(past.airports.every((a) => a.since <= 1960)).toBe(true);
  }, 300000);
  it("foreign trade and travellers ride the roads and railways: the network carries more freight with the ports than without them", () => {
    const { sim, w } = run(0, 1985), es = Object.values(sim.edges), keep = es.map((e) => [e.through, e.local, e.freight]);
    const frKm = () => es.reduce((s, e) => s + (e.state === "open" && e.facility !== "ferry" ? e.freight * e.lengthKm : 0), 0);
    const an = analyze(sim, w), withHubs = frKm(); expect(an.hub).toBeTruthy(); expect([...an.hub!.port.values()].reduce((s, x) => s + x.cargo, 0)).toBeGreaterThan(0);
    const hubs = sim.hubs; delete sim.hubs; analyze(sim, w); const without = frKm(); sim.hubs = hubs;
    expect(withHubs).toBeGreaterThan(without * 1.05);
    const railFr = es.filter((e) => modeOf(e) === "rail").reduce((s, e) => s + e.freight, 0); expect(railFr).toBeGreaterThan(0);
    es.forEach((e, i) => { [e.through, e.local, e.freight] = keep[i]; });
  }, 300000);
});

describe("Stage 8: the world line shows in the ports and airports", () => {
  it("a sea-minded world builds bigger ports and moves more coastal freight by sea; an air-minded one opens airports sooner and flies more", () => {
    const K = run(4, 1985), A = run(3, 1985);
    const portCap = (s: SimState) => Object.values(s.hubs!.ports).filter((p) => p.until === undefined).reduce((t, p) => t + PORT_CAP[p.tier], 0);
    const airCap = (s: SimState) => Object.values(s.hubs!.airports).filter((a) => a.until === undefined).reduce((t, a) => t + a.cap, 0);
    const last = (s: SimState) => s.stats[s.stats.length - 1];
    expect(portCap(K.sim)).toBeGreaterThan(portCap(A.sim)); expect(last(K.sim).seaShare!).toBeGreaterThan(last(A.sim).seaShare!);
    expect(airCap(A.sim)).toBeGreaterThan(airCap(K.sim)); expect(last(A.sim).airShare!).toBeGreaterThan(last(K.sim).airShare!);
    const first = (s: SimState) => Math.min(...Object.values(s.hubs!.airports).map((a) => a.since)); expect(first(A.sim)).toBeLessThanOrEqual(first(K.sim));
  }, 600000);
});

describe("Stage 8: facilities grow, shrink and close by their use; routes open, rest and end", () => {
  it("a port running full is expanded after two years (works take time); one left nearly empty for ten years is cut back", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true); sim.dials.seaBias = 1; sim.macro.budgetBu = 1000;
    const p = Object.values(sim.hubs!.ports).find((x) => x.tier === 2)!, cap = PORT_CAP[2];
    reviewHubs(sim, w, totals([[p.city, cap]]), 1970); expect(p.build).toBeUndefined(); reviewHubs(sim, w, totals([[p.city, cap]]), 1971); expect(p.build?.to).toBe(3);
    const done = p.build!.done; for (let y = 1972; y < done; y++) reviewHubs(sim, w, totals([[p.city, cap]]), y); expect(p.tier).toBe(2);
    reviewHubs(sim, w, totals([[p.city, cap]]), done); expect(p.tier).toBe(3); expect(sim.events.some((e) => e.text.includes("拡張が完成"))).toBe(true);
    sim.dials.seaBias = 0; for (let y = done + 1; y <= done + 10; y++) reviewHubs(sim, w, totals([[p.city, 1]]), y); expect(p.tier).toBe(2); expect(p.hist.some((x) => x.t.includes("縮小"))).toBe(true);
  });
  it("a route below half its threshold rests after three years and ends after six more; a recovering one reopens", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true), h = sim.hubs!, p = Object.values(h.ports).find((x) => x.tier === 3)!;
    reviewHubs(sim, w, totals([[p.city, 20000]]), 1970); const r = h.routes.find((x) => x.mode === "sea" && x.a === p.city && x.state === "open")!; expect(r).toBeTruthy();
    for (let y = 1971; y <= 1973; y++) reviewHubs(sim, w, totals([[p.city, 0]]), y); expect(r.state).toBe("suspended");
    reviewHubs(sim, w, totals([[p.city, 20000]]), 1974); expect(r.state).toBe("open");
    for (let y = 1975; y <= 1977; y++) reviewHubs(sim, w, totals([[p.city, 0]]), y); expect(r.state).toBe("suspended");
    for (let y = 1978; y <= 1983; y++) reviewHubs(sim, w, totals([[p.city, 0]]), y); expect(r.state).toBe("closed"); expect(r.until).toBe(1983);
    expect(hubsAt(sim, 1972).routes.some((x) => x.id === r.id)).toBe(true); expect(hubsAt(sim, 1990).routes.some((x) => x.id === r.id)).toBe(false);
  });
  it("what a port or airport adds to its city is bounded", () => {
    const { sim } = run(0, 1985); for (const id of Object.keys(sim.cities)) { const b = hubBoost(sim, id); expect(b.industry).toBeLessThanOrEqual(0.12); expect(b.growth).toBeLessThanOrEqual(0.0012); expect(b.growth).toBeGreaterThanOrEqual(0); }
  }, 300000);
});

describe("Stage 8: saves", () => {
  it("a game with ports and airports survives a JSON round trip and keeps running identically; an older save gets them at the next year; a broken block is rebuilt", async () => {
    const { sanitizeSim } = await import("../../src/core/save2");
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); advance(sim, w, 12 * 12); expect(Object.keys(sim.hubs!.airports).length).toBeGreaterThan(0);
    const copy = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect(simHash(copy)).toBe(simHash(sim)); advance(sim, w, 24); advance(copy, w, 24); expect(simHash(copy)).toBe(simHash(sim));
    const old = JSON.parse(JSON.stringify(sim)); delete old.hubs; const o = sanitizeSim(old).sim!; expect(o.hubs).toBeUndefined(); advance(o, w, 12);
    expect(o.hubs).toBeTruthy(); for (const c of Object.keys(sim.cities)) if (sim.cities[c].airport !== undefined) expect(o.hubs!.airports[c], c).toBeTruthy();
    const bad = JSON.parse(JSON.stringify(sim)); bad.hubs.ports = "x"; expect(sanitizeSim(bad).sim!.hubs).toBeUndefined();
    void ensureHubs;
  }, 300000);
});

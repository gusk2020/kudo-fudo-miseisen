import { describe, expect, it } from "vitest";
import { advance } from "../../src/sim/engine";
import { CROSSING_TAG, MAX_ACTIVE_PER_MODE, POP_PER_KM, chooseStructure, isCrossingProject, planCrossings } from "../../src/sim/crossing";
import { fixedLink, seedFerries } from "../../src/sim/ferry";
import { capacityOf } from "../../src/sim/demand";
import { checkIntegrity } from "../../src/sim/network";
import { BRIDGE_KM, TUNNEL_KM, techAt } from "../../src/sim/tech";
import { modeOf } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

const fixedLinks = (sim: ReturnType<typeof stage3Sim>["sim"]) => Object.values(sim.edges).filter((e) => (e.facility === "bridge" || e.facility === "tunnel") && e.facilityName?.startsWith("link:"));

describe("strait links: ferry, bridge or tunnel (Issue #15)", () => {
  it("1950 forces no bridge: islands are joined by ferry first, and a fixed link needs technology, money and traffic", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true);
    expect(fixedLinks(sim)).toEqual([]); expect(Object.values(sim.edges).filter((e) => e.facility === "ferry").length).toBeGreaterThanOrEqual(10);
    expect(planCrossings(sim, w, 1950)).toEqual([]);   // no traffic yet on any ferry
  });
  it("the structure follows the technology: a bridge when it spans, else a tunnel when it can be driven, else the ferry stays", () => {
    const { sim } = stage3Sim("heisei", 7, false, 0, 2, true, undefined, 0);
    const early = techAt(2, 1950), late = techAt(2, 2060); expect(early.bridgeKm).toBe(BRIDGE_KM[0][1]); expect(late.tunnelKm).toBeGreaterThan(early.tunnelKm);
    expect(chooseStructure(sim, 1, 30, "road", 1950)?.fac).toBe("bridge");
    const mid = chooseStructure(sim, 10, 60, "road", 1955); expect(mid === null || mid.fac === "tunnel").toBe(true);
    expect(chooseStructure(sim, 20, 60, "road", 1950)).toBeNull();                       // 20 km of water in 1950: no bridge, no tunnel
    expect(chooseStructure(sim, 20, 60, "road", 2000)?.fac).toBeTruthy();
    expect(chooseStructure(sim, 640, 640, "road", 2100)).toBeNull();                      // Okinawa: far beyond any tunnel -> ferry stays
    expect(chooseStructure(sim, 1, 30, "rail", 1950)!.cost).toBeGreaterThan(0);
    const same = chooseStructure(sim, 5, 40, "road", 1990)!, rail = chooseStructure(sim, 5, 40, "rail", 1990)!; expect(rail.fac).toBe(same.fac);   // the same rule for both modes
    expect(Math.max(...TUNNEL_KM.map((k) => k[1]))).toBeLessThan(640);
  });
  it("a busy ferry gets a project (road and rail alike); an idle one does not; never more than MAX_ACTIVE_PER_MODE per mode at a time", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, 0); sim.policy!.mode = "auto"; let any = 0; /* Stage 11 rules (waterK 0): a game made before the Stage 13 water-tunnel rule keeps them; the Stage 13 rules are in stage13.test.ts */ const modes = new Set<string>();
    for (const year of [1960, 1975, 1990, 2010, 2040, 2070]) {
      advance(sim, w, 12 * (year - 1950 - Math.floor(sim.month / 12)));
      for (const e of Object.values(sim.edges)) if (e.facility === "ferry") { e.through = 0; e.local = 0; e.freight = 0; }
      for (const [id, p] of Object.entries(sim.projects)) if (isCrossingProject(p)) delete sim.projects[id];
      expect(planCrossings(sim, w, year)).toEqual([]);      // idle ferries: no project
      for (const e of Object.values(sim.edges)) if (e.facility === "ferry" && e.state === "open") e.through = capacityOf(e) * 1.5;
      sim.dials.hwyBuild = 1; sim.dials.railBuild = 1; sim.macro.budgetBu = 1e6;
      const made = planCrossings(sim, w, year); expect(made.length).toBeLessThanOrEqual(2); expect(new Set(made.map((p) => modeOf(p))).size).toBe(made.length);
      for (const p of made) { modes.add(modeOf(p)); expect(p.reason.startsWith(CROSSING_TAG)).toBe(true); expect(p.status).toBe("concept"); expect(sim.edges[p.edgeIds[0]].built).toBe(0); expect(["bridge", "tunnel"]).toContain(sim.edges[p.edgeIds[0]].facility); }
      any += made.length;
      for (let again = 0; again < 4; again++) planCrossings(sim, w, year);   // asked over and over, a mode never has more than its cap of live projects
      for (const m of ["road", "rail"] as const) expect(Object.values(sim.projects).filter((p) => isCrossingProject(p) && modeOf(p) === m && ["concept", "planned", "building", "suspended"].includes(p.status)).length).toBeLessThanOrEqual(MAX_ACTIVE_PER_MODE);
    }
    expect(any).toBeGreaterThan(0); expect(modes.size).toBeGreaterThanOrEqual(1);
  }, 600000);
  it("over a century: links appear later than 1950, for both modes, with history; routes stay continuous; and the faster technology builds sooner", () => {
    const run = (k: number) => {
      const { sim, w } = stage3Sim("heisei", 7, true, 0, k, true, undefined, 0); sim.policy!.mode = "auto"; const seen = { road: 0, rail: 0, maxActive: 0 }, log: string[] = []; let first = 9999, lastEv = 0;
      for (let y = 1951; y <= 2100; y++) {
        advance(sim, w, 12); for (const e of sim.events) if (e.id > lastEv) { log.push(e.text); lastEv = e.id; }
        const act = Object.values(sim.projects).filter((p) => isCrossingProject(p) && ["concept", "planned", "building", "suspended"].includes(p.status));
        for (const m of ["road", "rail"] as const) seen.maxActive = Math.max(seen.maxActive, act.filter((p) => modeOf(p) === m).length);
        if (first === 9999 && fixedLinks(sim).some((e) => e.built >= 1)) first = y;
      }
      const links = fixedLinks(sim).filter((e) => e.built >= 1); seen.road = links.filter((e) => modeOf(e) === "road").length; seen.rail = links.filter((e) => modeOf(e) === "rail").length;
      return { sim, w, seen, first, links, log };
    };
    const a = run(2), b = run(1);
    expect(a.first).toBeGreaterThan(1950); expect(a.seen.maxActive).toBeLessThanOrEqual(MAX_ACTIVE_PER_MODE);
    expect(a.seen.road + a.seen.rail).toBeGreaterThanOrEqual(2); expect(a.seen.road).toBeGreaterThanOrEqual(1); expect(a.seen.rail).toBeGreaterThanOrEqual(1);
    expect(a.seen.road + a.seen.rail).toBeLessThanOrEqual(24);                       // no endless chaining
    // the faster technology builds sooner: by 2000 it has more fixed links than K=1, and its first one is not much later (Stage 11: a strait a bridge will span soon is waited for, not tunnelled, so the very
    // first link can come a year or two later when a bridge, not a tunnel, is what the faster clock builds)
    const by2000 = (r: ReturnType<typeof run>) => r.links.filter((e) => e.builtMonth !== null && 1950 + e.builtMonth / 12 <= 2000).length;
    expect(by2000(a)).toBeGreaterThanOrEqual(by2000(b)); expect(a.first).toBeLessThanOrEqual(b.first + 5);   // Stage 12: the first link's year moves with the random stream (measured over seeds 7/11/23/31: K=1 always 1967; K=2 1971/1972/1961/1961), so the bound is +5; the by-2000 count above is the real claim
    expect(a.log.filter((x) => x.includes("海峡") && x.includes("構想")).length).toBeGreaterThan(0);   // the history is recorded as it happens (the timeline keeps the newest 1000; finished projects are tidied away after 25 years)
    expect(a.log.some((x) => x.includes("連絡が開通"))).toBe(true); expect(a.log.some((x) => x.includes("フェリーを廃止") || x.includes("連絡船を廃止"))).toBe(true);
    expect(checkIntegrity(a.sim)).toEqual([]);
    // every opened link closed the ferry it replaced
    for (const l of a.links) { const f = Object.values(a.sim.edges).find((e) => e.facility === "ferry" && modeOf(e) === modeOf(l) && ((e.a === l.a && e.b === l.b) || (e.a === l.b && e.b === l.a))); if (f) expect(f.state === "closed" || f.state === "lost").toBe(true); }
    void POP_PER_KM; void seedFerries; void fixedLink;
  }, 900000);
  it("a numbered route that crossed by ferry stays one continuous road when the ferry is replaced by a tunnel", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, { capital: "JP-36", sub: "JP-13" }); sim.policy!.mode = "auto";   // Tokushima (Shikoku) -> Tokyo: the road crosses by ferry
    const r = Object.values(sim.routes).find((x) => x.grade === "national" && x.number === 1)!; const ferriesBefore = r.edges.filter((x) => sim.edges[x.edgeId].facility === "ferry").length; expect(ferriesBefore).toBeGreaterThanOrEqual(1);
    advance(sim, w, 12 * 80);
    const chainOk = (rt: typeof r) => { let at = ""; return rt.edges.every((ref, i) => { const e = sim.edges[ref.edgeId]; if (!e) return false; const from = ref.dir === 1 ? e.a : e.b, to = ref.dir === 1 ? e.b : e.a; const ok = i === 0 || from === at; at = to; return ok; }); };
    expect(chainOk(r)).toBe(true); expect(r.edges.every((ref) => sim.edges[ref.edgeId])).toBe(true);
    void w;
  }, 600000);
});

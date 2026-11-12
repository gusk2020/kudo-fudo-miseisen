import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { analyze } from "../../src/sim/demand";
import { checkIntegrity } from "../../src/sim/network";
import { gateOpen, stanceExposure, techStageFor, EARLY_SERVICE_YEARS, EARLY_EXPERIMENT_YEARS, mayScheduleServiceFor } from "../../src/sim/rules1800";
import { ALL_MILESTONES, reached, techNow } from "../../src/sim/history1800";
import { GAZETTEER_2000, nearestOld, oldPlaces, stemOf } from "../../src/core/gazetteer2000";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

const km = (s: SimState) => Object.values(s.edges).filter((e) => e.built >= 1 && e.state === "open").reduce((a, e) => a + e.lengthKm, 0);
const o1800 = { start1800: true } as never;
describe("Stage 40 (1): an 1800 start does not begin with the 1950-style national road network", () => {
  const a = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, o1800), b = stage3Sim("heisei", 7, true, 0, 2, true);
  it("the 1950 start is exactly what it was (805 sections, 152 routes), and the 1800 start has far fewer sections, less road and fewer routes", () => {
    expect(Object.values(b.sim.edges).filter((e) => e.built >= 1 && e.state === "open").length).toBe(807);   /* (Fix #61: 805 + the two land lines of the 1942 関門 railway, which no longer runs city centre to city centre) */ expect(Object.keys(b.sim.routes).length).toBe(152);
    const ea = Object.values(a.sim.edges).filter((e) => e.built >= 1 && e.state === "open");
    expect(ea.length).toBeLessThan(805 * 0.4); expect(km(a.sim)).toBeLessThan(km(b.sim) * 0.6); expect(Object.keys(a.sim.routes).length).toBeLessThan(15);
  });
  it("the principal highways and their post towns are there (not every old track): six named 街道, post towns, a few cart tracks", () => {
    const kaido = Object.values(a.sim.routes).filter((r) => r.kaido); expect(kaido.length).toBeGreaterThanOrEqual(6); expect(new Set(kaido.map((r) => r.kaido))).toContain("東海道");
    expect(Object.values(a.sim.settlements).filter((s) => s.post).length).toBeGreaterThanOrEqual(8); expect(checkIntegrity(a.sim)).toEqual([]);
  });
  it("walking / pack-horse access is not a drawn road: an ordinary village has no road node, a post town has one", () => {
    const nodeCells = new Set(Object.values(a.sim.nodes).map((n) => n.cell)), vs = Object.values(a.sim.settlements);
    expect(vs.filter((s) => !s.post && nodeCells.has(s.cell)).length).toBeLessThan(vs.length * 0.1); expect(vs.filter((s) => s.post).every((s) => nodeCells.has(s.cell))).toBe(true);
  });
  it("the cities and villages are not wiped out and the network grows: after 30 years most cities are on one network, and no settlement is gone", () => {
    const s = a.sim; s.policy!.mode = "auto"; const pop0 = Object.values(s.cities).reduce((x, c) => x + c.pop, 0); advance(s, a.w, 12 * 30);
    const r = [...analyze(s, a.w).reach.values()]; expect(r.filter(Boolean).length / r.length).toBeGreaterThan(0.6); expect(Object.values(s.settlements).filter((v) => v.gone).length).toBe(0);
    expect(Object.values(s.cities).reduce((x, c) => x + c.pop, 0)).toBeGreaterThan(pop0); expect(checkIntegrity(s)).toEqual([]);
  }, 600000);
});
describe("Stage 40 (2): the era stance moves the technology gates, never the whole timeline", () => {
  const sim = (eras: { start: number; stance: string }[]) => ({ startYear: 1800, kaigen: { eras } });
  const first = (s: ReturnType<typeof sim>, id: "rail" | "car" | "plane" | "airship" | "expressway", base: number, early: number) => { for (let y = 1800; y <= 2000; y++) if (gateOpen(s, id, base, early, y)) return y; return Infinity; };
  it("a balanced era moves nothing; a matching stance moves the gate earlier, by at most 10 years (experiment) and 20 years (service), never before 1800", () => {
    const bal = sim([{ start: 1800, stance: "heisei" }]), rail = sim([{ start: 1800, stance: "shoka" }]);
    expect(first(bal, "rail", 1810, EARLY_EXPERIMENT_YEARS)).toBe(1810); expect(first(bal, "rail", 1830, EARLY_SERVICE_YEARS)).toBe(1830);
    const e = first(rail, "rail", 1810, EARLY_EXPERIMENT_YEARS), s = first(rail, "rail", 1830, EARLY_SERVICE_YEARS);
    expect(e).toBeGreaterThanOrEqual(1800); expect(e).toBeLessThan(1810); expect(e).toBeGreaterThanOrEqual(1810 - EARLY_EXPERIMENT_YEARS); expect(s).toBeGreaterThanOrEqual(1830 - EARLY_SERVICE_YEARS); expect(s).toBeLessThan(1830); expect(s).toBeGreaterThan(e);
    expect(first(rail, "car", 1890, EARLY_EXPERIMENT_YEARS)).toBe(1890); expect(first(rail, "plane", 1920, EARLY_SERVICE_YEARS)).toBe(1920);   // (another stance's technology is not moved)
    expect(first(sim([{ start: 1800, stance: "shubun" }]), "expressway", 1930, EARLY_SERVICE_YEARS)).toBeLessThan(1930); expect(first(sim([{ start: 1800, stance: "kairo" }]), "rail", 1830, EARLY_SERVICE_YEARS)).toBe(1830);   // (sea has no gate to move)
  });
  it("a later era change changes what comes after, and nothing that already came is taken back (monotone through every change)", () => {
    const s = sim([{ start: 1800, stance: "heisei" }, { start: 1870, stance: "shubun" }]), open = (y: number) => gateOpen(s, "car", 1890, EARLY_EXPERIMENT_YEARS, y);
    expect(first(s, "car", 1890, EARLY_EXPERIMENT_YEARS)).toBeLessThan(1890); expect(first(s, "car", 1890, EARLY_EXPERIMENT_YEARS)).toBeGreaterThan(1870);
    let was = false; for (let y = 1800; y <= 2050; y++) { const o = open(y); if (was) expect(o, String(y)).toBe(true); was = o; }
    const s2 = sim([{ start: 1800, stance: "shubun" }, { start: 1850, stance: "heisei" }, { start: 1880, stance: "shoka" }]); let w2 = false; for (let y = 1800; y <= 2050; y++) { const o = techStageFor(s2, "car", y) !== "none"; if (w2) expect(o).toBe(true); w2 = o; }
    expect(stanceExposure(s, "car", 1900)).toBe(30);
  });
  it("the timeline rows and the atlas say the year it really became usable (the same test as the simulation's)", () => {
    const rail = sim([{ start: 1800, stance: "shoka" }]), svc = ALL_MILESTONES.find((m) => m.id === "rail-svc")!, y = first(rail, "rail", 1830, EARLY_SERVICE_YEARS);
    expect(reached(rail, svc, y - 1)).toBe(false); expect(reached(rail, svc, y)).toBe(true); expect(mayScheduleServiceFor(rail, "rail", y)).toBe(true); expect(mayScheduleServiceFor(rail, "rail", y - 1)).toBe(false);
    expect(techNow("鉄道", y, rail).phase).toBe("service"); expect(techNow("鉄道", 1829, sim([{ start: 1800, stance: "heisei" }])).phase).not.toBe("service");
    const fic = ALL_MILESTONES.find((m) => m.id === "restoration")!; expect(reached(rail, fic, 1824)).toBe(false); expect(reached(rail, fic, 1825)).toBe(true);   // (the fictional history is not shifted)
  });
  it("in a real game the first era's stance does it: the railway era is earlier than the balanced one, and the timeline says so", () => {
    const g = (fe: number) => stage3Sim("heisei", 7, true, fe, 2, true, undefined, undefined, o1800), stances = [0, 1, 2].map((fe) => g(fe).sim.kaigen?.eras[0]?.stance);
    expect(new Set(stances).size).toBeGreaterThanOrEqual(2);   // (the three first eras carry different stances)
    const bal = [0, 1, 2].find((fe) => g(fe).sim.kaigen?.eras[0]?.stance === "heisei"), rail = [0, 1, 2].find((fe) => g(fe).sim.kaigen?.eras[0]?.stance === "shoka");
    if (bal === undefined || rail === undefined) return; const A = g(rail), B = g(bal); for (const x of [A, B]) { x.sim.policy!.mode = "auto"; advance(x.sim, x.w, 12 * 35); }
    const yr = (s: SimState) => { const e = s.events.find((v) => v.kind === "tech" && v.refs?.milestone === "rail-svc"); return e ? s.startYear + Math.floor(e.month / 12) : 9999; };
    expect(yr(A.sim)).toBeLessThan(yr(B.sim)); expect(yr(B.sim)).toBe(1830); expect(yr(A.sim)).toBeGreaterThanOrEqual(1810);
    const back = JSON.parse(JSON.stringify(A.sim)) as SimState; expect(techNow("鉄道", yr(A.sim), back).since).toBe(yr(A.sim)); expect(techNow("鉄道", yr(A.sim), back).phase).toBe("service"); expect(yearOf(back)).toBe(1835);
  }, 900000);
});
describe("Stage 40 (3): the 2000-10-01 municipalities are the pool of names", () => {
  it("the committed gazetteer is the real N03 v2.2 (2000-10-01): about 3,370 entries, the right kinds, inside Japan, with source and licence recorded", () => {
    expect(GAZETTEER_2000.count).toBeGreaterThan(3300); expect(GAZETTEER_2000.count).toBeLessThan(3450); expect(GAZETTEER_2000.source).toContain("N03"); expect(GAZETTEER_2000.license).toContain("PDL1.0"); expect(GAZETTEER_2000.url).toContain("nlftp.mlit.go.jp");
    const p = oldPlaces(), c = (k: string) => p.filter((x) => x.kind === k).length; expect(c("city")).toBeGreaterThan(640); expect(c("city")).toBeLessThan(690); expect(c("town")).toBeGreaterThan(1950); expect(c("town")).toBeLessThan(2030); expect(c("village")).toBeGreaterThan(540); expect(c("village")).toBeLessThan(600);
    expect(p.some((x) => x.name === "今市市")).toBe(true); expect(p.some((x) => x.name === "田老町")).toBe(true); expect(p.some((x) => x.name.endsWith("区"))).toBe(false);   // (merged away since 2000, and wards left out)
    expect(new Set(p.map((x) => x.code)).size).toBe(p.length); expect(new Set(p.map((x) => x.pref)).size).toBe(47);
    for (const x of p) { expect(x.pos.every((v) => Number.isFinite(v))).toBe(true); expect(Math.abs(x.pos[0]) < 3500 && Math.abs(x.pos[1]) < 3500).toBe(true); }
  });
  it("stems, and same-name resolution: a name in use is skipped, the nearest of the rest wins, the answer is the same every time", () => {
    expect(stemOf("田老町")).toBe("田老"); expect(stemOf("大町")).toBe("大町"); const p = oldPlaces().find((x) => x.name === "大和町")!;
    const a = nearestOld(p.pos, new Set()), b = nearestOld(p.pos, new Set([a!.stem])); expect(a).not.toBeNull(); expect(b!.stem).not.toBe(a!.stem); expect(nearestOld(p.pos, new Set())).toEqual(a);
    const used = new Set<string>(); for (let i = 0; i < 50; i++) { const q = nearestOld(p.pos, used)!; expect(used.has(q.stem)).toBe(false); used.add(q.stem); }
  });
  const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, o1800), h = stage3Sim("heisei", 7, true, 0, 2, true);
  it("an 1800 game's villages and post towns carry old municipality names with their source, each name once, none equal to a city's", () => {
    const vs = Object.values(g.sim.settlements); expect(vs.every((v) => !!v.origin)).toBe(true); const names = vs.map((v) => v.name); expect(new Set(names).size).toBe(names.length);
    const cities = new Set(g.w.cities.flatMap((c) => [c.name, c.name.replace(/市$/, "")])); for (const v of vs) { expect(cities.has(v.name.replace(/[町村宿]$/, "")), v.name).toBe(false); expect(v.origin!.code).toMatch(/^\d{5}$/); }
    for (const v of vs.filter((x) => x.post)) expect(v.name.endsWith("宿")).toBe(true); expect(vs.filter((v) => v.post).length).toBeGreaterThanOrEqual(8);
  });
  it("a 1950 game keeps its generated names (older games are not renamed)", () => { for (const v of Object.values(h.sim.settlements)) { expect(v.origin).toBeUndefined(); expect(v.name).toMatch(/近郊/); } });
  it("the names survive a save, and the same game gives the same names", () => { const back = JSON.parse(JSON.stringify(g.sim)) as SimState; expect(Object.values(back.settlements).map((v) => v.name)).toEqual(Object.values(g.sim.settlements).map((v) => v.name)); const g2 = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, o1800); expect(Object.values(g2.sim.settlements).map((v) => v.name)).toEqual(Object.values(g.sim.settlements).map((v) => v.name)); });
});

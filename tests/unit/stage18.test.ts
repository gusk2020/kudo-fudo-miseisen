import { describe, expect, it } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { PREF_IDS } from "../../src/core/seat";
import { CAND_1945, CAND_1989, CAND_2019, ERA_GROUP_LABEL, ERA_GROUPS, STANCE_LABEL, eraGroup } from "../../src/sim/kaigen";
import { PREF_COAST, coastBoost, coastCounts, coastSideOf, potentialDataOf, potentialOrder, potentialWeights, reassignPotential } from "../../src/sim/potential17";
import { EXC_GAP_YEARS, stance18, tunnelException18 } from "../../src/sim/policy18";
import { modeOf } from "../../src/sim/types";
import { createSim } from "../../src/sim/engine";
import { run14 } from "../study/lib14";
import { realWorld } from "./simhelp";

const { w, hash } = realWorld(true, true), D = potentialDataOf(w.t), side = (p: string) => coastSideOf(p);
const name = (p: string) => w.t.prefOrder.includes(p) ? p : p;

describe("Stage 19: era groups by transport stance (道路系 / 鉄道系 / 海路系 / 空路系 / 均衡系)", () => {
  it("each stance is its own group", () => {
    expect(eraGroup("shubun")).toBe("road"); expect(eraGroup("shoka")).toBe("rail"); expect(eraGroup("kairo")).toBe("sea"); expect(eraGroup("kuuro")).toBe("air"); expect(eraGroup("heisei")).toBe("balanced");
    expect(ERA_GROUPS.map((g) => ERA_GROUP_LABEL[g])).toEqual(["道路重視", "鉄道・公共交通重視", "海路重視", "空路重視", "均衡"]);
  });
  it("every candidate of every era list is in a group; the lists keep their names and stances", () => {
    for (const l of [CAND_1945, CAND_1989, CAND_2019]) for (const c of l) expect(ERA_GROUPS).toContain(eraGroup(c.stance));
    expect(CAND_1945.length).toBe(14); expect(new Set(CAND_1945.map((c) => eraGroup(c.stance))).size).toBe(5); expect(CAND_1989.map((c) => c.name).slice(0, 3)).toEqual(["平成", "修文", "正化"]);
    expect(CAND_1989.map((c) => eraGroup(c.stance))).toEqual(["balanced", "road", "rail"]); expect(STANCE_LABEL.kairo).toBe("海路重視"); expect(STANCE_LABEL.kuuro).toBe("空路重視");
  });
});

describe("Stage 19: which sea a prefecture faces (the real coast, as a table; not the grid)", () => {
  it("all 49 prefectures are classified; the cases that went wrong with the grid are right", () => {
    expect(Object.keys(PREF_COAST).sort()).toEqual([...PREF_IDS].sort());
    expect(PREF_COAST["JP-29"]).toBe("inland"); expect(PREF_COAST["JP-06"]).toBe("japansea"); expect(PREF_COAST["JP-13"]).toBe("pacific"); expect(PREF_COAST["JP-27"]).toBe("pacific");
    for (const p of ["JP-33", "JP-34", "JP-37", "JP-38"]) expect(PREF_COAST[p], p).toBe("pacific");   // the Seto Inland Sea side counts as the Pacific side
    for (const p of ["JP-02", "JP-28", "JP-35", "JP-40", "JP-41", "JP-42", "HK-SAP", "HK-HAK"]) expect(PREF_COAST[p], p).toBe("both");
    for (const p of ["JP-09", "JP-10", "JP-11", "JP-19", "JP-20", "JP-21", "JP-25", "JP-29"]) expect(PREF_COAST[p], p).toBe("inland");
    for (const p of ["JP-05", "JP-06", "JP-15", "JP-16", "JP-17", "JP-18", "JP-26", "JP-31", "JP-32"]) expect(PREF_COAST[p], p).toBe("japansea");
    expect(side("JP-02")).toBeNull(); expect(side("JP-29")).toBeNull(); expect(side("JP-06")).toBe("japansea");
  });
  it("cross-check with the terrain grid: where the grid shows a coast clearly, it agrees with the table (the exceptions are the grid's own artefacts)", () => {
    const C = coastCounts(w.t), artefact = new Set(["JP-29", "JP-20", "JP-21", "JP-25", "JP-13", "JP-27"]);   // Nara, Nagano, Gifu, Shiga touch the sea a little in the generated regions; Tokyo, Osaka have short coasts
    for (const p of PREF_IDS) { const c = C[p]; if (!c || artefact.has(p)) continue; const t = PREF_COAST[p]; if (t === "japansea") expect(c.japansea, p).toBeGreaterThanOrEqual(c.pacific); if (t === "pacific") expect(c.pacific, p).toBeGreaterThanOrEqual(c.japansea); }
    expect(coastCounts(w.t)).toEqual(C);
  });
});

describe("Stage 18: the coast correction of the potential order", () => {
  const seatsets: [string, string, string][] = [["JP-13", "JP-27", "JP-13"], ["JP-17", "JP-27", "JP-26"], ["HK-SAP", "JP-40", "JP-13"], ["JP-40", "JP-13", "JP-13"]];
  it("a permutation of the 49; the fixed part is untouched; only the random part moves; every favoured-coast prefecture there rises two places (or to the head of the part)", () => {
    for (const [capital, sub, palace] of seatsets) for (const mode of ["concentrate", "disperse"] as const) for (const seed of [1, 7, 23]) for (const coast of ["japansea", "pacific"] as const) {
      const base = potentialOrder({ capital, sub, palace, mode, seed }, D), got = potentialOrder({ capital, sub, palace, mode, seed, coast }, D), from = mode === "concentrate" ? 16 : 10;
      expect(got.length).toBe(49); expect(new Set(got).size).toBe(49); expect([...got].sort()).toEqual([...PREF_IDS].sort());
      expect(got.slice(0, from)).toEqual(base.slice(0, from));
      const fav = base.slice(from).filter((p) => side(p) === coast), tail = base.slice(from);
      for (const p of fav) { const was = tail.indexOf(p), now = got.slice(from).indexOf(p); expect(now).toBeLessThanOrEqual(was); expect(now).toBeGreaterThanOrEqual(Math.max(0, was - 2)); }
      expect(got.slice(from).filter((p) => side(p) !== coast)).toEqual(tail.filter((p) => side(p) !== coast));   // the others keep their order among themselves
      expect(potentialOrder({ capital, sub, palace, mode, seed, coast }, D)).toEqual(got);   // same seed, same result
    }
  });
  it("the range differs: 一極集中 starts at rank 17, 地方分散 at rank 11; at the head of the range the rise stops", () => {
    const ids = ["JP-13", "JP-15", "JP-16", "JP-12", "JP-17"];   // Tokyo, Niigata, Toyama, Chiba, Ishikawa (the last three on the Sea of Japan)
    expect(coastBoost(ids, 0, "japansea")).toEqual(["JP-15", "JP-16", "JP-17", "JP-13", "JP-12"]);   // Niigata rises to the head, Toyama behind it, Ishikawa two places
    expect(coastBoost(ids, 1, "japansea")).toEqual(["JP-13", "JP-15", "JP-16", "JP-17", "JP-12"]);   // the head of the range is index 1: Niigata and Toyama are there already
    expect(coastBoost(ids, 2, "japansea")).toEqual(["JP-13", "JP-15", "JP-16", "JP-17", "JP-12"]);
    expect(coastBoost(ids, 0, "pacific")).toEqual(["JP-13", "JP-12", "JP-15", "JP-16", "JP-17"]);   // Tokyo is at the head already; Chiba rises to just behind it
  });
  it("a worked example: Tokyo/Osaka/Tokyo, 一極集中, seed 7", () => {
    const o = { capital: "JP-13", sub: "JP-27", palace: "JP-13", mode: "concentrate" as const, seed: 7 }, base = potentialOrder(o, D), js = potentialOrder({ ...o, coast: "japansea" }, D), pac = potentialOrder({ ...o, coast: "pacific" }, D);
    const moved = (b: string[], a: string[]) => b.map((p, i) => [p, i + 1, a.indexOf(p) + 1] as [string, number, number]).filter((x) => x[1] !== x[2]);
    expect(moved(base, js).length).toBeGreaterThan(0); expect(moved(base, pac).length).toBeGreaterThan(0); expect(js).not.toEqual(pac);
    for (const [p, from, to] of moved(base, js)) if (side(p) === "japansea") expect(to).toBeLessThan(from);
  });
  it("the weights from the final order still sum to 49", () => { const o = potentialOrder({ capital: "JP-13", sub: "JP-27", palace: "JP-13", mode: "disperse", seed: 3, coast: "japansea" }, D), W = potentialWeights(o); expect(Object.values(W).reduce((a, b) => a + b, 0)).toBeCloseTo(49, 9); });
});

describe("Stage 18: a game 1950-1991 (a new era at 1989)", () => {
  const g = run14({ seed: 7, firstEra: 1, until: 1991 });   // era 1 = 日本海側重視 + 一極集中
  it("the order carries the correction, the fixed ranks are those of the plain order, and an older Stage 17 record is not corrected", () => {
    const p = g.sim.pot17!; expect(p.c18).toBe(true); expect(p.hist[0].why).toContain("日本海側"); expect(p.order.length).toBe(49); expect(new Set(p.order).size).toBe(49);
    const plain = potentialOrder({ capital: "JP-13", sub: "JP-27", palace: "JP-13", mode: "concentrate", seed: 7 }, D); expect(p.hist[0].order.slice(0, 16)).toEqual(plain.slice(0, 16));
    const old = createSim(w, "m", hash, 7, { stage3: true, firstEra: 1, techK: 2, subCapital: "JP-27", coast18: false }); expect(old.pot17!.c18).toBeUndefined(); expect(old.pot17!.order).toEqual(plain);
  });
  it("a new era re-orders with the same rules; saving and loading keeps the record and the same inputs give the same order", () => {
    const p = g.sim.pot17!; expect(p.hist.length).toBeGreaterThanOrEqual(2); const back = sanitizeSim(JSON.parse(JSON.stringify(g.sim))).sim!.pot17!; expect(back.order).toEqual(p.order); expect(back.c18).toBe(true);
    const copy = { ...back, hist: [], order: [] as string[] }; reassignPotential(copy as never, g.w.t, { capital: "JP-13", sub: "JP-27", palace: "JP-13" }, "concentrate", g.sim.seed, g.sim.kaigen!.eras.length, 1989, "x", "japansea"); expect(copy.order).toEqual(p.order);
    expect(PREF_IDS.reduce((s, q) => s + p.cur[q], 0)).toBeCloseTo(49, 6);   // the weights in force still sum to 49 and glide (Stage 17)
  });
  it("labels: the base map names the capitals only; the places that grew into cities are in the shown list", () => {
    const shown = g.w.cities.filter((c) => (g.sim.pot17!.shown[c.id] ?? 0) > 0), caps = shown.filter((c) => c.kind === "capital"); expect(caps.length).toBe(49); expect(shown.length).toBeGreaterThan(49);
    const kanto = g.w.cities.filter((c) => c.kind !== "capital" && c.pref && ["JP-11", "JP-12", "JP-14", "JP-13"].includes(c.pref)); expect(kanto.length).toBeGreaterThan(3);
    for (const c of kanto) { const s = g.sim.pot17!.shown[c.id]; expect(s === undefined || Math.abs(s) > 1950).toBe(true); }   // none was shown from the first day
  });
}, 900000);

describe("Stage 18: 海路重視 and 空路重視 (a game to 1989)", () => {
  const stat = (r: ReturnType<typeof run14>) => {
    const E = Object.values(r.sim.edges), wt = E.filter((e) => e.facility === "tunnel" && e.state === "open" && /海底|湖底/.test(e.facilityName ?? "")), rail = E.filter((e) => modeOf(e) === "rail" && e.state === "open" && e.facility !== "ferry"), h = r.sim.hubs!;
    return { tunnels: wt.length, exc: Object.values(r.sim.projects).filter((p) => p.reason.includes("【例外】")).length, hsr: rail.filter((e) => e.standard === "highgrade").reduce((t, e) => t + e.lengthKm, 0), railKm: rail.reduce((t, e) => t + e.lengthKm, 0), cargo: Object.values(h.ports).filter((p) => p.until === undefined).reduce((t, p) => t + p.cargo, 0), tier: Object.values(h.ports).filter((p) => p.until === undefined).reduce((t, p) => t + p.tier, 0), pax: Object.values(h.airports).filter((a) => a.until === undefined).reduce((t, a) => t + a.pax, 0), air: h.routes.filter((x) => x.mode === "air" && x.state === "open").length, ferries: E.filter((e) => e.facility === "ferry" && e.state === "open").length };
  };
  const early: Record<string, number> = {}, mk = (era: number) => run14({ seed: 7, firstEra: era, until: 1989, hook: (sim, _w, y) => { if (y === 1955 && !early[era]) early[era] = Object.values(sim.edges).filter((e) => modeOf(e) === "rail" && e.state === "open" && e.facility !== "ferry").reduce((t, e) => t + e.lengthKm, 0); } });
  const bal = mk(0), air = mk(3), sea = mk(4), B = stat(bal), A = stat(air), S = stat(sea);
  it("the stance is read from the latest era; a new game has the Stage 18 rules, older ones do not", () => { expect(stance18(air.sim)).toBe("air"); expect(stance18(sea.sim)).toBe("sea"); expect(stance18(bal.sim)).toBeNull(); });
  it("under either policy water tunnels are almost never built (the exception is rare); the balanced world builds many", () => {
    expect(B.tunnels).toBeGreaterThan(12); expect(A.tunnels).toBeLessThanOrEqual(4); expect(S.tunnels).toBeLessThanOrEqual(4); expect(A.exc).toBeLessThanOrEqual(1); expect(S.exc).toBeLessThanOrEqual(1);
    expect(tunnelException18(sea.sim, 1.5, 10, 2000)).toBe(false); expect(tunnelException18(sea.sim, 3, 40, 2000)).toBe(false); expect(tunnelException18({ lastTunnelException18: 1990 } as never, 3, 10, 1990 + EXC_GAP_YEARS - 1)).toBe(false); expect(tunnelException18({} as never, 3, 10, 1970)).toBe(true);
  });
  it("railway: new lines and high-speed upgrades are held back, the existing network is kept", () => {
    expect(S.hsr).toBeLessThan(B.hsr * 0.4); expect(A.hsr).toBeLessThan(B.hsr * 0.4); for (const [k, r] of [["air", A], ["sea", S]] as const) { expect(r.railKm, k).toBeGreaterThan(B.railKm * 0.85); expect(r.railKm, k).toBeGreaterThanOrEqual(early[k === "air" ? 3 : 4] * 0.98); }
  });
  it("海路重視 moves more by sea (port cargo and size, ferries), 空路重視 more by air; the held-back kind is not removed", () => {
    expect(S.cargo).toBeGreaterThan(B.cargo * 1.15); expect(S.tier).toBeGreaterThan(B.tier); expect(S.ferries).toBeGreaterThanOrEqual(B.ferries); expect(A.pax).toBeGreaterThan(B.pax * 1.15); expect(A.air).toBeGreaterThan(B.air);
    expect(S.air).toBeGreaterThan(0); expect(A.cargo).toBeGreaterThan(0); expect(S.pax).toBeGreaterThan(0);
  });
}, 1200000);

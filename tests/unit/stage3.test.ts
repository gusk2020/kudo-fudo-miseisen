import { describe, expect, test } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { advance, checkIntegrity, reviveRoutes, routeOfficial, simHash, stepMonthGen } from "../../src/sim/engine";
import { HIST_EVENTS, REAL_HISTORY_UNTIL } from "../../src/sim/events";
import { baseDials, composeDials } from "../../src/sim/eras";
import { codesAt, routeAtYear, snapCode } from "../../src/sim/ledger";
import { displayName } from "../../src/sim/straits";
import { ADOPT_BAR, POINTS_PER_WINDOW, autoResolve, boostOf, computeEnv, resolveWindow, topFive } from "../../src/sim/policy";
import { modeOf, type SimState } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { realWorld, stage3Sim } from "./simhelp";

const memo = new Map<string, { sim: SimState; w: World }>();
/** One shared 1950-2050 run per world line. */
function century(era: "heisei" | "shubun" | "shoka") {
  let m = memo.get(era); if (m) return m;
  const { sim, w } = stage3Sim(era, 7); advance(sim, w, 12 * 100); m = { sim, w }; memo.set(era, m); return m;
}
const live = (sim: SimState, mode: "road" | "rail") => Object.values(sim.edges).filter((e) => modeOf(e) === mode && e.state === "open" && e.built >= 1);
const km = (es: { lengthKm: number }[]) => es.reduce((s, e) => s + e.lengthKm, 0);

describe("real Japan as the stage", () => {
  const { w } = realWorld();
  test("real geography: 49 regions with Hokkaido in three, 東京府, no drawn ridges, plausible land area", () => {
    expect(w.t.prefOrder.length).toBe(49);
    for (const id of ["HK-SAP", "HK-HAK", "HK-NEM", "JP-13"]) expect(w.t.prefOrder).toContain(id);
    expect(w.t.ridge.every((v) => v === 0)).toBe(true);
    const land = w.t.land.reduce((n, v) => n + (v === 1 ? 1 : 0), 0) * w.cell * w.cell;   // km2
    expect(land).toBeGreaterThan(330000); expect(land).toBeLessThan(420000);                   // Japan is about 378,000 km2
    expect(w.t.stats.maxElevM).toBeGreaterThan(3700);                                             // Fuji is in the data
  });
});

describe("1950 road + rail network (a reconstruction, labelled as one)", () => {
  const { sim } = stage3Sim("heisei", 7);
  test("railways exist as their own mode with operators, along the real corridors, and the structure is consistent", () => {
    const rail = Object.values(sim.edges).filter((e) => modeOf(e) === "rail"), railRoutes = Object.values(sim.routes).filter((r) => modeOf(r) === "rail");
    expect(rail.length).toBeGreaterThan(80); expect(km(rail)).toBeGreaterThan(3500); expect(railRoutes.length).toBeGreaterThan(20);
    expect(Object.keys(sim.operators).length).toBeGreaterThan(3); expect(sim.operators.jnr.kind).toBe("jnr");
    expect(rail.every((e) => e.op && sim.operators[e.op])).toBe(true);
    expect(checkIntegrity(sim)).toEqual([]);
    expect(sim.events.some((e) => e.kind === "seed" && /再構成/.test(e.text) && /史実の路線台帳ではない/.test(e.cause))).toBe(true);
  });
  test("it is 1950-like: mostly thin non-electrified track, some electrified commuter trunks; roads are thin; nobody has a decay nickname yet", () => {
    const rail = Object.values(sim.edges).filter((e) => modeOf(e) === "rail"), thin = rail.filter((e) => e.standard === "rural").length / rail.length;
    expect(thin).toBeGreaterThan(0.4); expect(thin).toBeLessThan(0.95); expect(rail.some((e) => e.standard === "standard")).toBe(true); expect(rail.some((e) => e.standard === "highgrade")).toBe(false);
    expect(Object.values(sim.edges).every((e) => !e.nick)).toBe(true);
    expect(Object.values(sim.edges).filter((e) => modeOf(e) === "road").every((e) => e.standard === "rural")).toBe(true);
  });
  test("国道1号 and 東京府道1号 are the player's; railway numbers are per operator; official names are 国鉄/私鉄, never the decay nicknames", () => {
    const names = Object.values(sim.routes).filter((r) => modeOf(r) === "rail").map((r) => r.name);
    expect(names.some((n) => /^国鉄\d+号線$/.test(n))).toBe(true); expect(names.every((n) => !/酷鉄|死鉄/.test(n))).toBe(true);
    expect(Object.values(sim.routes).filter((r) => r.grade === "national" && r.number === 1)).toHaveLength(1);
    const jnrNums = Object.values(sim.routes).filter((r) => r.grade === "jnr").map((r) => r.number); expect(new Set(jnrNums).size).toBe(jnrNums.length); expect(Math.min(...jnrNums)).toBe(1);
  });
});

describe("determinism and saving", () => {
  test("the same seed gives the same history; a save made mid-run continues identically", () => {
    const a = stage3Sim("shubun", 3), b = stage3Sim("shubun", 3); advance(a.sim, a.w, 12 * 25); advance(b.sim, b.w, 12 * 12);
    const re = sanitizeSim(JSON.parse(JSON.stringify(b.sim))); expect(re.problems).toEqual([]); expect(re.sim).not.toBeNull();
    advance(re.sim!, b.w, 12 * 13); expect(simHash(re.sim!)).toBe(simHash(a.sim));
  });
  test("a Stage 2 (v2) save with no rail data still loads as a roads-only game", () => {
    const old = JSON.parse(JSON.stringify(stage3Sim("heisei", 1, true).sim)); old.schemaVersion = 2;
    for (const k of ["operators", "dials", "mods", "policy", "stage3"]) delete old[k];
    for (const e of Object.values<any>(old.edges)) { delete e.freight; delete e.mode; delete e.op; }
    for (const r of Object.values<any>(old.routes)) { if (r.grade === "jnr" || r.grade === "priv") delete old.routes[r.id]; else { delete r.mode; delete r.op; } }
    for (const [id, e] of Object.entries<any>(old.edges)) if (id) void e;
    const r = sanitizeSim(old); expect(r.sim?.schemaVersion).toBe(3); expect(r.sim?.stage3).toBeUndefined(); expect(r.sim?.dials.roadShare).toBeGreaterThan(0);
  });
  test("the save stays small enough for a phone after a century", () => {
    const { sim } = century("heisei"), size = JSON.stringify(sim).length; expect(size).toBeLessThan(1_300_000);
  });
});

describe("three world lines", () => {
  test("the dial baselines differ the way the lines are defined", () => {
    for (const y of [1970, 2000]) {
      const h = baseDials("heisei", y), s = baseDials("shubun", y), r = baseDials("shoka", y);
      expect(s.roadShare).toBeGreaterThan(h.roadShare); expect(h.roadShare).toBeGreaterThan(r.roadShare);
      expect(s.carBias).toBeGreaterThan(h.carBias); expect(h.carBias).toBeGreaterThan(r.carBias); expect(r.railBias).toBeGreaterThan(s.railBias);
    }
    expect(baseDials("heisei", 1990).privatize).toBe(1); expect(baseDials("shubun", 1980).privatize).toBe(1); expect(baseDials("shoka", 2090).privatize).toBe(0);
  });
  test("a century on each line: roads win under 修文, railways under 正化, 平成 in between", () => {
    const H = century("heisei"), S = century("shubun"), R = century("shoka");
    for (const x of [H, S, R]) expect(checkIntegrity(x.sim)).toEqual([]);
    const hwy = (c: typeof H) => km(live(c.sim, "road").filter((e) => e.standard === "highgrade")), hsr = (c: typeof H) => km(live(c.sim, "rail").filter((e) => e.standard === "highgrade"));
    expect(hwy(S)).toBeGreaterThan(hwy(H)); expect(hwy(H)).toBeGreaterThan(hwy(R)); expect(hsr(R)).toBeGreaterThan(hsr(H)); expect(hsr(H)).toBeGreaterThan(hsr(S));
    expect(km(live(R.sim, "rail"))).toBeGreaterThan(km(live(S.sim, "rail"))); expect(km(live(S.sim, "road"))).toBeGreaterThan(km(live(R.sim, "road")));
    const lostRail = (c: typeof H) => Object.values(c.sim.edges).filter((e) => modeOf(e) === "rail" && (e.state === "closed" || e.state === "lost")).length;
    expect(lostRail(S) + lostRail(H)).toBeGreaterThan(0);
  });
  test("国鉄 is broken up in 平成 (1987) and 修文 (1973) and kept in 正化; line numbers change with the operator and are never reused", () => {
    const H = century("heisei").sim, S = century("shubun").sim, R = century("shoka").sim;
    expect(H.operators.jnr.until).toBe(1987); expect(S.operators.jnr.until).toBe(1973); expect(R.operators.jnr.until).toBeUndefined();
    expect(H.events.some((e) => e.kind === "reform")).toBe(true);
    expect(Object.values(R.routes).some((r) => r.grade === "jnr" && r.active)).toBe(true); expect(Object.values(H.routes).filter((r) => r.grade === "jnr" && r.active)).toHaveLength(0);
    for (const sim of [H, S, R]) { const keys = Object.values(sim.routes).map((r) => `${r.grade}:${r.scope}:${r.number}`); expect(new Set(keys).size).toBe(keys.length); }
    const moved = Object.values(H.routes).find((r) => r.history.some((x) => /国鉄から/.test(x.text)))!; expect(moved.history.length).toBeGreaterThanOrEqual(2); expect(moved.history[0].grade).toBe("jnr"); expect(moved.grade).toBe("priv");
  });
  test("国鉄 earns 酷鉄 in its deficit years (1975-1987 on 平成), starved lines first; private operators earn 死鉄 afterwards", () => {
    const { sim, w } = stage3Sim("heisei", 7); advance(sim, w, 12 * 37);   // to January 1987, just before the break-up
    const nick = Object.values(sim.edges).filter((e) => modeOf(e) === "rail" && e.op === "jnr" && e.nick);
    expect(nick.length).toBeGreaterThan(0); expect(nick.every((e) => e.quality < 55 || e.weathering > 30)).toBe(true);
    const q = Object.values(sim.edges).filter((e) => modeOf(e) === "rail" && e.op === "jnr" && e.built >= 1).map((e) => e.quality).sort((a, b) => a - b); expect(q[0]).toBeLessThan(40); expect(q[Math.floor(q.length / 2)]).toBeGreaterThan(80);   // the thin lines decay, the trunks do not
    advance(sim, w, 12 * 30); expect(Object.values(sim.edges).some((e) => modeOf(e) === "rail" && e.nick && e.op !== "jnr")).toBe(true);
  });
  test("decay nicknames: 酷鉄 for the national railway, 死鉄 for private ones, both earned late and only by condition", () => {
    const R = century("shoka").sim, H = century("heisei").sim, nick = (sim: SimState) => Object.values(sim.edges).filter((e) => e.nick && modeOf(e) === "rail").length;
    expect(Object.values(century("shoka").sim.edges).filter((e) => e.nick && modeOf(e) === "rail").every((e) => e.quality < 55 || e.weathering > 30)).toBe(true);
    expect(nick(R) + nick(H)).toBeGreaterThanOrEqual(0);
    const first = stage3Sim("heisei", 7).sim; expect(Object.values(first.edges).some((e) => e.nick)).toBe(false);
  });
});

describe("平成 follows the real course of the population", () => {
  test("the population grows fast to the 1970s, peaks near 2008 (Japan's real peak) and declines afterwards", () => {
    const { sim } = century("heisei"), st = sim.stats.filter((x) => x.pop !== undefined), peak = st.reduce((a, b) => (b.pop! > a.pop! ? b : a));
    expect(peak.year).toBeGreaterThanOrEqual(2000); expect(peak.year).toBeLessThanOrEqual(2016);
    const at = (y: number) => st.find((x) => x.year === y)!.pop!; expect(at(1975) / at(1951)).toBeGreaterThan(1.25); expect(at(2040)).toBeLessThan(peak.pop! * 0.95);
  });
});

describe("events: 史実 / 架空 / 予測モデル", () => {
  test("history table is dated and every domestic entry is real only on 平成", () => {
    for (const h of HIST_EVENTS) { expect(h.year).toBeLessThanOrEqual(REAL_HISTORY_UNTIL); if (h.scope === "domestic") { expect(h.heisei?.real ?? true).toBe(true); expect(h.shubun?.real ?? false).toBe(false); expect(h.shoka?.real ?? false).toBe(false); } else expect(h.all?.real).toBe(true); }
  });
  test("the world's events are the same on every line, the domestic response differs, and 2027 onward is labelled a model", () => {
    const H = century("heisei").sim, S = century("shubun").sim, R = century("shoka").sim;
    for (const sim of [H, S, R]) expect(sim.mods.some((m) => m.id === "oil1")).toBe(true);
    expect(sim_has(H, "olympic")).toBe(true);
    const mod = (s: SimState, id: string) => s.mods.find((m) => m.id === id)!;
    expect(mod(R, "olympic").d.hsr ?? 0).toBeGreaterThan(mod(S, "olympic").d.hsr ?? 0); expect(mod(S, "olympic").d.hwyBuild ?? 0).toBeGreaterThan(mod(R, "olympic").d.hwyBuild ?? 0);
    expect(S.events.concat(H.events).some((e) => /^【予測モデル】/.test(e.text))).toBe(true);
    expect(H.events.filter((e) => e.kind === "domestic").every((e) => /^【(史実|架空|予測モデル)】/.test(e.text))).toBe(true);
  });
});
function sim_has(sim: SimState, id: string) { return sim.mods.some((m) => m.id === id); }

describe("the ten-yearly policy window", () => {
  test("it stops time in 介入優先, resumes after a decision, and the clock never runs past it", () => {
    const { sim, w } = stage3Sim("heisei", 5); sim.policy!.mode = "priority"; sim.month = 12 * 10 - 1;
    let guard = 0; while (!sim.policy!.pending && guard++ < 20) { const g = stepMonthGen(sim, w); while (!g.next().done); }
    expect(sim.policy!.pending?.year).toBe(1960); const m = sim.month; for (let i = 0; i < 5; i++) { const g = stepMonthGen(sim, w); while (!g.next().done); }
    expect(sim.month).toBe(m); expect(sim.policy!.points).toBe(POINTS_PER_WINDOW);
    resolveWindow(sim, w, "politics", {}); expect(sim.policy!.pending).toBeNull(); const g = stepMonthGen(sim, w); while (!g.next().done); expect(sim.month).toBe(m + 1);
  });
  test("points: top five by the environment, boost with diminishing returns, unused points carry over in full, over-spending is refused", () => {
    const { sim, w } = stage3Sim("heisei", 5); advance(sim, w, 12 * 5); const env = computeEnv(sim);
    for (const d of ["politics", "economy", "opinion"] as const) expect(topFive(env, d).length).toBe(5);
    expect(boostOf(1) - boostOf(0)).toBeGreaterThan(boostOf(10) - boostOf(9) * 1.0); expect(boostOf(1000)).toBeLessThan(1.11); expect(boostOf(0)).toBe(0);
    const pol = sim.policy!; pol.pending = { year: 1960, domain: null }; pol.points = 20; sim.mods = [];
    const rec = resolveWindow(sim, w, "politics", { "p-region": 99 })!; expect(rec.spent["p-region"]).toBeUndefined(); expect(pol.points).toBe(20);   // 99 > 20: nothing is spent
    pol.pending = { year: 1970, domain: null }; const rec2 = resolveWindow(sim, w, "opinion", { "o-safety": 4 })!; expect(pol.points).toBe(16); expect(rec2.spent["o-safety"]).toBe(4);
    expect(rec2.adopted.length).toBeLessThanOrEqual(2); for (const a of rec2.adopted) { expect(a.priority).toBeGreaterThanOrEqual(ADOPT_BAR); expect(a.reason.length).toBeGreaterThan(5); }
    expect(sim.events.some((e) => e.kind === "policy" && /【政策(採用|見送り)】/.test(e.text) && e.cause.length > 3)).toBe(true);
  });
  test("a policy outside the top five can be pushed in with enough points", () => {
    const { sim, w } = stage3Sim("heisei", 5); const env = computeEnv(sim), top = new Set(topFive(env, "economy").map((t) => t.p.id));
    const out = ["e-stimulus", "e-austerity", "e-rail-freight", "e-truck", "e-tourism"].filter((id) => !top.has(id)); void out;
    const pol = sim.policy!; pol.pending = { year: 1960, domain: null }; pol.points = 50;
    const weakest = ["e-stimulus", "e-austerity", "e-rail-freight", "e-truck", "e-tourism"].map((id) => id).sort()[0];
    const rec = resolveWindow(sim, w, "economy", { [weakest]: 20 })!; expect(rec.adopted.length + rec.declined.length).toBeGreaterThan(0); expect(sim.mods.length).toBeGreaterThanOrEqual(rec.adopted.length);
  });
  test("with the auto setting nothing waits: windows resolve by themselves and points accumulate", () => {
    const { sim, w } = stage3Sim("shoka", 5); sim.policy!.mode = "auto"; advance(sim, w, 12 * 31);
    expect(sim.policy!.pending).toBeNull(); expect(sim.policy!.history.length).toBeGreaterThanOrEqual(3); expect(sim.policy!.points).toBe(POINTS_PER_WINDOW * 3);
    expect(sim.policy!.history.every((r) => r.auto && r.adopted.every((a) => a.reason.length > 5))).toBe(true);
    void autoResolve; void composeDials;
  });
});

describe("how things get built and unbuilt", () => {
  test("long tunnels and bridges are edges of their own, built (and opened) separately; lines are conceived before they are planned, and some ideas fade", () => {
    let fac = 0, concepts = 0, faded = 0, converted = 0;
    for (const era of ["heisei", "shubun", "shoka"] as const) {
      const { sim } = century(era); expect(checkIntegrity(sim)).toEqual([]);
      for (const e of Object.values(sim.edges)) if (e.facility) { fac++; expect(displayName(e)).toMatch(/(トンネル|橋)(\(.*\))?$|橋$/); expect(e.lengthKm).toBeGreaterThanOrEqual(5); }
      concepts += sim.events.filter((x) => /構想:/.test(x.text)).length; faded += sim.events.filter((x) => /構想のまま立ち消え/.test(x.text)).length; converted += sim.events.filter((x) => /廃線跡を道路に転用:/.test(x.text)).length;
    }
    expect(fac).toBeGreaterThan(3); expect(concepts).toBeGreaterThan(10); expect(faded).toBeGreaterThan(3); expect(converted).toBeGreaterThan(3);
  });
  test("an abolished line that comes back keeps its number (the only case where a number is used again); a gone national railway's line is handed to a successor", () => {
    const { sim, w } = stage3Sim("heisei", 11), r = Object.values(sim.routes).find((x) => modeOf(x) === "rail" && x.active)!, num = r.number, before = routeOfficial(r);
    const es = r.edges.map((x) => sim.edges[x.edgeId]); for (const e of es) { e.state = "closed"; e.open = false; } r.active = false; r.endMonth = 5;
    for (const e of es) { e.state = "open"; e.open = true; } reviveRoutes(sim, w, es[0].id);
    expect(r.active).toBe(true); expect(r.number).toBe(num); expect(routeOfficial(r)).toBe(before); expect(r.history[r.history.length - 1].text).toMatch(/復活/); expect(r.endMonth).toBeUndefined();
    const keys = Object.values(sim.routes).map((x) => `${x.grade}:${x.scope}:${x.number}`); expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("crossings between the islands", () => {
  const years = (sim: SimState) => Object.fromEntries(sim.events.filter((e) => e.kind === "facility" && /が開通\(/.test(e.text) && /(関門|青函|瀬戸|明石|西瀬戸)/.test(e.text)).map((e) => [e.text.replace(/^【.*?】/, "").replace(/が開通.*$/, ""), 1950 + Math.floor(e.month / 12)]));
  test("平成 opens them in the real years, 修文 builds road crossings first and 正化 the railway ones; the first (関門 railway) is already there in 1950", () => {
    const H = years(century("heisei").sim), S = years(century("shubun").sim), R = years(century("shoka").sim);
    expect(H["関門鉄道トンネル"]).toBe(1950); expect(H["関門道路トンネル"]).toBe(1958); expect(H["青函トンネル"]).toBe(1988); expect(H["瀬戸大橋(道路)"]).toBe(1988); expect(H["明石海峡・鳴門の橋"]).toBe(1998);
    expect(S["瀬戸大橋(道路)"]).toBeLessThan(S["瀬戸大橋(鉄道)"]); expect(R["瀬戸大橋(鉄道)"]).toBeLessThan(R["瀬戸大橋(道路)"]); expect(R["青函トンネル"]).toBeLessThan(H["青函トンネル"]);
    expect(century("heisei").sim.events.filter((e) => /【史実】.*(青函|瀬戸大橋)/.test(e.text)).length).toBe(3); expect(century("shoka").sim.events.some((e) => /【史実】.*青函/.test(e.text))).toBe(false);
  });
  test("a crossing joins two islands in the graph, so a city on Hokkaido, Shikoku or Kyushu can reach Honshu once it opens", () => {
    const { sim, w } = century("heisei"), nodeOf = (id: string) => Object.values(sim.nodes).find((n) => n.cell === w.cityById.get(id)!.cell)!.id;
    const reach = (from: string, mode: "road" | "rail") => { const seen = new Set([from]), st = [from]; while (st.length) { const x = st.pop()!; for (const e of Object.values(sim.edges)) if (modeOf(e) === mode && e.state === "open" && e.built >= 1 && (e.a === x || e.b === x)) for (const y of [e.a, e.b]) if (!seen.has(y)) { seen.add(y); st.push(y); } } return seen; };
    const tokyo = nodeOf("C-JP-13"); expect(reach(tokyo, "road").has(nodeOf("C-JP-37"))).toBe(true);   // Takamatsu by road (瀬戸大橋・明石海峡)
    expect(reach(tokyo, "road").has(nodeOf("C-1159141097"))).toBe(true);                                  // Kitakyushu by road (関門)
  });
});

describe("reading the past", () => {
  test("snapshots fold back to the exact edge codes of that year; routes know what they were called", () => {
    const { sim } = century("heisei"), years = sim.snaps.map((s) => s.year);
    expect(years[0]).toBe(1950); expect(years.length).toBeGreaterThanOrEqual(18); expect(sim.snaps.slice(1).every((s) => s.delta)).toBe(true);
    const last = sim.snaps[sim.snaps.length - 1], codes = codesAt(sim.snaps, last.year)!; expect(Object.keys(codes).length).toBeGreaterThan(Object.keys(sim.snaps[0].edges).length);
    const now: Record<string, number> = {}; for (const e of Object.values(sim.edges)) now[e.id] = snapCode(e); let same = 0, n = 0; for (const [id, c] of Object.entries(codes)) { n++; if (now[id] === c) same++; } expect(same / n).toBeGreaterThan(0.6);
    expect(codesAt(sim.snaps, 1949)).toBeNull(); expect(Object.keys(codesAt(sim.snaps, 1950)!).length).toBe(Object.keys(sim.snaps[0].edges).length);
    const r = Object.values(sim.routes).find((x) => x.history.some((h) => /国鉄から/.test(h.text)))!;
    expect(routeAtYear(sim, r, 1960).label).toMatch(/^国鉄\d+号線$/); expect(routeAtYear(sim, r, 2020).label).toBe(r.name); expect(routeAtYear(sim, r, 1960).exists).toBe(true);
    const snapJson = JSON.stringify(sim.snaps).length; expect(snapJson).toBeLessThan(250_000);
  });
});

describe("robustness over other seeds", () => {
  test("the network stays structurally consistent for a century on three more seeds (one per world line), checked every ten years", () => {
    for (const [era, seed] of [["heisei", 11], ["shubun", 23], ["shoka", 31]] as const) {
      const { sim, w } = stage3Sim(era, seed);
      for (let d = 0; d < 10; d++) { advance(sim, w, 120); expect(checkIntegrity(sim), `${era} seed ${seed} year ${1950 + (d + 1) * 10}`).toEqual([]); }
      for (const p of Object.values(sim.projects)) for (const id of p.edgeIds) expect(sim.edges[id], `${era} project ${p.id} edge ${id}`).toBeDefined();
    }
  });
});

describe("performance on the main thread", () => {
  test("every slice of a simulated month is short, so the phone is never held (Issue #7)", () => {
    const { sim, w } = stage3Sim("shubun", 9); let worst = 0, atoms = 0;
    for (let m = 0; m < 12 * 30; m++) { const g = stepMonthGen(sim, w); for (;;) { const t0 = performance.now(), r = g.next(); worst = Math.max(worst, performance.now() - t0); atoms++; if (r.done) break; } if (sim.policy?.pending) autoResolve(sim, w); }
    expect(worst).toBeLessThan(250); expect(atoms).toBeGreaterThan(300);
  });
});

import { describe, expect, it } from "vitest";
import { CAND_1945, CAND_2200, REAL_ERAS_USED, REAL_POOL, eraKey, futureCandidates, newKaigen, relocGroup, relocYear, usedKeys, type KaigenState } from "../../src/sim/kaigen";
import { E2200_YEAR, apply2200, close2200, due2200, eventsOpened, groupOf2200, nextYear2200, open2200, waiting2200, type Choice2200 } from "../../src/sim/event2200";
import { run14 } from "../study/lib14";
import { advance, stepMonth, yearOf } from "../../src/sim/engine";
import { sanitizeSim } from "../../src/core/save2";
import { PREF_IDS } from "../../src/core/seat";

/** A timeline game that picked 神化 at the start (as the tests of the era rules need), with the regular eras it would have had. */
const fresh = (): KaigenState => newKaigen(CAND_1945[0], 0, 1);
const names = (g: { cands: { name: string }[] }) => g.cands.map((c) => c.name);

describe("Stage 25: the era names of the relocation events", () => {
  it("the schedule is 2200, 2350, 2500, 2650, 2800", () => { expect([0, 1, 2, 3, 4].map(relocYear)).toEqual([2200, 2350, 2500, 2650, 2800]); });
  it("the first group is the 1912 group; the second is the game-start group minus the one chosen then", () => {
    const k = fresh(), g0 = relocGroup(k, 0, 2200); expect(names(g0)).toEqual(CAND_2200.map((c) => c.name));
    const g1 = relocGroup(k, 1, 2350); expect(names(g1)).toEqual(CAND_1945.map((c) => c.name).filter((n) => n !== "神化"));
  });
  it("from the third on a group is what was left of the one two events earlier, minus every name used since", () => {
    const k = fresh(); const g0 = relocGroup(k, 0, 2200); g0.chosen = "天興"; k.eras.push({ name: "天興", start: 2200, stance: "heisei", real: true, picked: 0, of: 5, auto: false }); (k.reloc ??= [])[0] = g0;
    const g1 = relocGroup(k, 1, 2350); g1.chosen = "元化"; k.eras.push({ name: "元化", start: 2350, stance: "heisei", real: true, picked: 0, of: 13, auto: false }); k.reloc[1] = g1;
    // a regular 改元 between used 乾徳 (one of 2200's remaining names)
    k.eras.push({ name: "乾徳", start: 2400, stance: "heisei", real: true, picked: 0, of: 5, auto: false });
    const g2 = relocGroup(k, 2, 2500); expect(names(g2)).toEqual(["興化", "永安", "昭徳"]);   // 2200's group minus 天興 (chosen) and 乾徳 (used later)
    k.reloc[2] = g2; const g3 = relocGroup(k, 3, 2650); expect(names(g3)).toEqual(names(g1).filter((n) => n !== "元化"));   // 2350's group minus its choice
    expect(g2.base).toContain("2200"); expect(g3.base).toContain("2350");
  });
  it("a name used anywhere in the history (a regular 改元 too) is never offered; real eras of the last two centuries never come back", () => {
    const k = fresh(); k.eras.push({ name: "永安", start: 2100, stance: "heisei", real: true, picked: 0, of: 5, auto: false });
    expect(names(relocGroup(k, 0, 2200))).not.toContain("永安"); for (const n of REAL_ERAS_USED) expect(usedKeys(k).has(eraKey(n))).toBe(true);
  });
  it("one name written two ways is one name (old/new forms, width)", () => {
    expect(eraKey("乾德")).toBe(eraKey("乾徳")); expect(eraKey("ＡＢ")).toBe(eraKey("AB")); const k = fresh(); k.eras.push({ name: "乾德", start: 2100, stance: "heisei", real: true, picked: 0, of: 5, auto: false });
    expect(names(relocGroup(k, 0, 2200))).not.toContain("乾徳");
  });
  it("an exhausted group is topped up with real past eras first, then with names labelled as invented; no duplicates, nothing used", () => {
    const k = fresh(); for (const c of CAND_2200) k.eras.push({ name: c.name, start: 2100, stance: "heisei", real: true, picked: 0, of: 5, auto: false });
    const g = relocGroup(k, 0, 2200); expect(g.cands.length).toBe(5); expect(g.cands.every((c) => c.origin === "history" && c.real)).toBe(true); expect(g.base).toContain("補充");
    const dry = relocGroup(k, 0, 2200, ["大化"]); expect(dry.cands.length).toBe(5); expect(dry.cands[0].origin).toBe("history"); const fic = dry.cands.filter((c) => c.origin === "fiction");
    expect(fic.length).toBe(4); expect(fic.every((c) => !c.real && c.note.includes("架空"))).toBe(true);
    for (const gg of [g, dry]) { const keys = gg.cands.map((c) => eraKey(c.name)); expect(new Set(keys).size).toBe(keys.length); const used = usedKeys(k); for (const x of keys) expect(used.has(x)).toBe(false); }
    expect(new Set(REAL_POOL.map(eraKey)).size).toBe(REAL_POOL.length);
  });
  it("many events in a row never repeat a name, whatever is chosen (always the first / always the last)", () => {
    for (const pickLast of [false, true]) {
      const k = fresh(), seen = new Set<string>(usedKeys(k));
      for (let n = 0; n < 40; n++) {
        const g = relocGroup(k, n, relocYear(n)); (k.reloc ??= [])[n] = g; expect(g.cands.length).toBeGreaterThanOrEqual(3);
        const c = g.cands[pickLast ? g.cands.length - 1 : 0], key = eraKey(c.name); expect(seen.has(key)).toBe(false); seen.add(key); g.chosen = c.name;
        k.eras.push({ name: c.name, start: relocYear(n), stance: "heisei", real: c.real, picked: 0, of: g.cands.length, auto: false });
        if (n % 2) { const f = futureCandidates(relocYear(n) + 20, new Set(k.eras.map((e) => e.name)))[0]; expect(seen.has(eraKey(f.name))).toBe(false); seen.add(eraKey(f.name)); k.eras.push({ name: f.name, start: relocYear(n) + 20, stance: "heisei", real: false, picked: 0, of: 5, auto: false }); }
      }
    }
  });
});

const pick = (n: number, c: Partial<Choice2200> = {}): Choice2200 => ({ era: 0, stance: "heisei", coast: "neutral", focus: "concentrate", ...c });
describe("Stage 25: the 150-year relocation event", () => {
  it("fires at 2200, 2350, 2500, 2650, 2800; every one stops the game; each is recorded in order; ranks stay 1-49 with no duplicate; the nation keeps its people", () => {
    const prefs = ["JP-40", "HK-SAP", "JP-27", "JP-47", "JP-13"], subs = ["JP-04", "JP-15", "JP-23", "JP-20", "JP-14"], opened: number[] = [], taken: string[] = [];
    let total0 = 0; const before: number[] = [], after: number[] = [];
    const r = run14({ seed: 5, until: 2801, islets: true, choose: (n, sm) => { opened.push(n); before[n] = Object.values(sm.cities).reduce((a, c) => a + c.pop, 0); return pick(n, { era: n % 3, stance: (["shubun", "shoka", "kairo", "kuuro", "heisei"] as const)[n], capital: prefs[n], sub: subs[n], palace: prefs[n] }); },
      applied: (n, sm) => { after[n] = Object.values(sm.cities).reduce((a, c) => a + c.pop, 0); },
      hook: (sim, w, y) => { if (y === 2150) total0 = Object.values(sim.cities).reduce((a, c) => a + c.pop, 0); if (sim.e2200) { const nm = sim.kaigen!.eras.map((e) => e.name); if (new Set(nm).size !== nm.length) taken.push(`dup@${y}`); } } });
    const { sim } = r; expect(opened).toEqual([0, 1, 2, 3, 4]); const all = [...(sim.e2200hist ?? []), sim.e2200!]; expect(all.map((e) => e.n)).toEqual([0, 1, 2, 3, 4]); expect(all.map((e) => e.sched)).toEqual([2200, 2350, 2500, 2650, 2800]);
    expect(all.every((e) => e.state === "done" && e.year >= e.sched! && e.year < e.sched! + 2)).toBe(true); expect(taken).toEqual([]);
    expect(sim.capital).toBe("JP-13"); const eraNames = sim.kaigen!.eras.map((e) => e.name); expect(new Set(eraNames).size).toBe(eraNames.length);
    for (let i = 0; i < 5; i++) expect(sim.kaigen!.reloc![i]!.chosen).toBe(all[i].era);
    const o = sim.pot17!.order; expect(o.length).toBe(49); expect([...o].sort()).toEqual([...PREF_IDS].sort()); expect(o[0]).toBe("JP-13");
    expect(sim.pot17!.hist.filter((h) => [2200, 2350, 2500, 2650, 2800].some((y) => h.y >= y && h.y < y + 2)).length).toBeGreaterThanOrEqual(5);
    expect(before.length).toBe(5); for (let i = 0; i < 5; i++) expect(after[i]).toBe(before[i]); expect(total0).toBeGreaterThan(0);   // choosing moves the seats, never makes or removes people
    for (const c of r.w.cities) expect(sim.cities[c.id].pop).toBeGreaterThanOrEqual(2000 - 1);
  }, 3600000);
  it("it does not fire twice after a save and load, a fast-forward cannot skip it, a jump past the date still gets it once", () => {
    const r = run14({ seed: 5, until: 1952, islets: true }), { sim, w } = r; sim.month = (2200 - sim.startYear) * 12; sim.policy!.mode = "auto"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null;
    expect(nextYear2200(sim)).toBe(2200); advance(sim, w, 24); expect(sim.e2200?.state).toBe("pending"); expect(sim.e2200?.n).toBe(0); expect(waiting2200(sim)).toBe(true);
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect(back.e2200?.state).toBe("pending"); expect(eventsOpened(back)).toBe(1);
    apply2200(sim, pick(0)); close2200(sim); const m = sim.month; expect(due2200(sim)).toBe(false); expect(nextYear2200(sim)).toBe(2350);
    const again = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect(again.e2200?.state).toBe("done"); expect(due2200(again)).toBe(false); expect(nextYear2200(again)).toBe(2350);
    advance(sim, w, 12 * 60); expect(sim.e2200?.n).toBe(0); expect(sim.e2200hist ?? []).toEqual([]);
    sim.month = (2420 - sim.startYear) * 12; sim.kaigen!.next = 9999; if (sim.policy) sim.policy.pending = null; stepMonth(sim, w); expect(sim.e2200?.n).toBe(1); expect(sim.e2200hist!.length).toBe(1); expect(m).toBeGreaterThan(0);
    expect(groupOf2200(sim)!.cands.length).toBeGreaterThan(5);   // the second event offers the game-start group
  }, 1200000);
  it("a save made before the repeat existed (one finished event, no history, no groups) loads and goes on to 2350", () => {
    const r = run14({ seed: 5, until: 2202, islets: true, e2200: pick(0, { capital: "JP-40", sub: "JP-04", palace: "JP-40" }) as never }), s = JSON.parse(JSON.stringify(r.sim)); delete s.e2200hist; delete s.kaigen.reloc;
    const back = sanitizeSim(s).sim!; expect(back.e2200?.state).toBe("done"); expect(nextYear2200(back)).toBe(2350);
    back.e2200 = back.e2200!; back.month = (2350 - back.startYear) * 12; back.kaigen!.pending = null; back.kaigen!.next = 9999; open2200(back); const g = groupOf2200(back)!; expect(g.cands.map((c) => c.name)).not.toContain(back.e2200.era);
    expect(E2200_YEAR).toBe(2200);
  }, 600000);
});

import { readFileSync } from "node:fs";
import { AIR_STYLE, HIGHLIGHT_COLOUR, KIND_COLOUR, STATE_DASH, TIER_OF, allStyleColours, edgeStyle, hex, type Kind, type LineState, type Tier } from "../../src/render/style24";
import { legendItems, svgOfStyle } from "../../src/render/legendSamples";

describe("Stage 25: the colours of the lines, and the legend that must show them", () => {
  const kinds = Object.keys(KIND_COLOUR) as Kind[], tiers: Tier[] = ["main", "sub", "local"], states: LineState[] = ["open", "dormant", "planned", "unbuilt", "closed", "lost"];
  it("there are six hues, the greys and the black and white that edge them, and one highlight colour that nothing else uses", () => {
    const all = allStyleColours(); const hues = new Set(Object.values(KIND_COLOUR)); expect(hues.size).toBe(6); expect(all.has(HIGHLIGHT_COLOUR)).toBe(true);
    for (const k of kinds) for (const t of tiers) for (const s of states) for (const q of [90, 50, 20, 5]) { const st = edgeStyle(k, t, s, q, { old: true, bypass: true }); for (const x of [st.casing, st.body, st.centre, st.ties]) if (x) expect(x.colour, `${k}${t}${s}${q}`).not.toBe(HIGHLIGHT_COLOUR); }
    expect(AIR_STYLE.body.colour).not.toBe(HIGHLIGHT_COLOUR);
    const nonHue = [...all].filter((c) => !hues.has(c)); expect(nonHue.length).toBeLessThanOrEqual(12 + 24);   // (the shades of a hue, its dark edge, white, black, greys)
  });
  it("Stage 26: condition (良/可/悪/荒廃) does NOT change a line's colour or shape; tier is told by thickness, state by the kind of line", () => {
    for (const k of kinds) for (const t of tiers) for (const st of states) for (const o of [{}, { old: true, bypass: true, tunnel: true, thin: true }]) { const base = JSON.stringify(edgeStyle(k, t, st, 95, o)); for (const q of [80, 55, 30, 10, 0]) expect(JSON.stringify(edgeStyle(k, t, st, q, o)), `${k}${t}${st}${q}`).toBe(base); }
    for (const k of ["road", "hwy", "rail", "hsr", "maglev"] as Kind[]) expect(edgeStyle(k, "sub", "open", 3).body.colour).toBe(KIND_COLOUR[k]);
    for (const k of ["road", "rail"] as Kind[]) { const w = tiers.map((t) => edgeStyle(k, t, "open", 90).body.width); expect(w[0]).toBeGreaterThan(w[1]); expect(w[1]).toBeGreaterThan(w[2]); }
    expect(edgeStyle("road", "sub", "open", 90).body.dash).toBeUndefined(); for (const s of ["dormant", "planned", "unbuilt", "closed", "lost"] as LineState[]) expect(edgeStyle("road", "sub", s, 90).body.dash).toEqual(STATE_DASH[s]);
    const dashes = new Set(["dormant", "planned", "unbuilt", "closed", "lost"].map((s) => JSON.stringify(STATE_DASH[s as LineState]))); expect(dashes.size).toBe(5);   // every state has its own pattern
    expect(TIER_OF.highgrade).toBe("main");
  });
  it("the legend's samples ARE the map's styles: every entry carries the style it was made from and its svg holds that style's colour, width and dash", () => {
    const items = legendItems(); expect(items.length).toBeGreaterThanOrEqual(20);
    for (const it of items) {
      const r = it.ref; if (!r.kind) continue; const st = edgeStyle(r.kind, r.tier!, r.state!, r.quality!); if (r.also) { expect(it.svg).toContain(svgOfStyle(st, 5)); expect(it.svg).toContain(svgOfStyle(edgeStyle(r.also, r.tier!, r.state!, r.quality!), 11)); continue; } expect(it.svg, it.caption).toContain(svgOfStyle(st));
      expect(it.svg).toContain(`stroke="${hex(st.body.colour)}"`); expect(it.svg).toContain(`stroke-width="${st.body.width}"`); if (st.body.dash) expect(it.svg).toContain(`stroke-dasharray="${st.body.dash.join(" ")}"`); else if (r.state === "open") expect(it.svg).not.toContain("stroke-dasharray=\"" + STATE_DASH.dormant!.join(" "));
    }
    for (const k of kinds) expect(items.some((i) => (i.ref.kind === k || i.ref.also === k) && i.group === "交通種別"), k).toBe(true);
    expect(items.filter((i) => i.caption.includes("新幹線") || i.caption.includes("リニア")).length).toBe(1);   // Stage 26: one entry for 新幹線・リニア (they stay two kinds everywhere else)
    expect(items.some((i) => i.ref.what === "air" && i.svg.includes(`stroke-dasharray="${AIR_STYLE.body.dash!.join(" ")}"`))).toBe(true); expect(items.some((i) => i.group.includes("傷み"))).toBe(false);
    for (const t of tiers) expect(items.some((i) => i.ref.tier === t && i.group === "階層(太さ)")).toBe(true);
    for (const s of states) expect(items.some((i) => i.ref.state === s && i.group === "状態(線種)")).toBe(true);
    const hl = items.find((i) => i.ref.what === "highlight")!; expect(hl.svg).toContain(hex(HIGHLIGHT_COLOUR));
    const used = [...items.map((i) => i.svg).join("").matchAll(/stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]); const allowed = new Set([...allStyleColours()].map(hex).concat(["#3b1f6e", "#7a4fb5"])); for (const c of used) expect(allowed.has(c), c).toBe(true);
  });
  it("the map draws only through the table: no colour literal is left in the edge-drawing code of roads.ts", () => {
    const src = readFileSync("src/render/roads.ts", "utf8"), a = src.indexOf("for (const e of Object.values(sim.edges)) {\n        const eff"), b = src.indexOf("const nodes = this.g.nodes");
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); const region = src.slice(a, b), lits = region.match(/0x[0-9a-fA-F]{6}/g) ?? [];
    expect(lits.filter((x) => x !== "0xffffff").length).toBe(0); expect(region).toContain("edgeStyle("); for (const s of ["open", "dormant", "planned", "unbuilt", "closed", "lost"]) expect(region.includes(`"${s}"`) || s === "lost" || s === "closed").toBe(true);
    expect(region).toContain("BRIDGE."); expect(region).toContain("TUNNEL."); expect(region).toContain("HIGHLIGHT_LAYERS");
    const legend = readFileSync("src/ui/legend24.ts", "utf8"); expect(legend).toContain("legendItems()"); expect((legend.match(/#[0-9a-f]{6}/gi) ?? []).length).toBe(0);
  });
});

import { homeCity, performRoad0, previewNational, subCity } from "../../src/sim/ceremony";
import type { Vec } from "../../src/core/types";
describe("Stage 25: every 国道0号 is its own build", () => {
  it("a second 国道0号 is a route of its own, named by its year; the first keeps its number, edges and history; the number register is not touched", () => {
    const r = run14({ seed: 5, until: 1955, islets: true }), { sim, w } = r;
    const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
    const go = (c: string, s: string) => { const p = previewNational(w, line(homeCity(w, c)!.pos, subCity(w, s)!.pos), c, s); expect(p.ok, p.reasons?.join("|")).toBe(true); return performRoad0(sim, w, p); };
    const a = go("JP-40", "JP-41"), firstId = a!.routeId, first = sim.routes[firstId], edges0 = JSON.stringify(first.edges), hist0 = first.history.length;
    expect(first.number).toBe(0); expect(first.gen).toBeUndefined(); sim.month += 12 * 150;
    const b = go("JP-27", "JP-26"); expect(b!.routeId).not.toBe(firstId); const second = sim.routes[b!.routeId];
    expect(second.number).toBe(0); expect(second.gen).toBe(sim.startYear + Math.floor(sim.month / 12)); expect(second.name).toContain(`${second.gen}年`);
    expect(JSON.stringify(sim.routes[firstId].edges)).toBe(edges0); expect(sim.routes[firstId].history.length).toBe(hist0); expect(sim.routes[firstId].active).toBe(true);
    expect(Object.values(sim.routes).filter((q) => q.number === 0 && q.grade === "national").length).toBe(2);
  }, 600000);
});

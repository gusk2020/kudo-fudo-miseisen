import { describe, expect, it } from "vitest";
import { due2200, nextYear2200 } from "../../src/sim/event2200";
import { RELOC_FIRST, RELOC_FIRST_LEGACY, relocYear } from "../../src/sim/kaigen";
import { createSim } from "../../src/sim/engine";
import { realWorld } from "./simhelp";
import { sanitizeSim } from "../../src/core/save2";

const ev = (year: number, n: number) => ({ year, n, state: "done" } as any);
describe("Stage 28: 遷都は1950年起点の150年周期(2100, 2250, 2400, 2550)", () => {
  it("新しいゲームの予定年は 2100/2250/2400/2550", () => {
    expect([0, 1, 2, 3].map((n) => relocYear(n, RELOC_FIRST))).toEqual([2100, 2250, 2400, 2550]);
    const sim: any = { relocFirst: 2100 };
    expect(nextYear2200(sim)).toBe(2100);
    sim.e2200 = ev(2100, 0); expect(nextYear2200(sim)).toBe(2250);
    sim.e2200hist = [ev(2100, 0)]; sim.e2200 = ev(2250, 1); expect(nextYear2200(sim)).toBe(2400);
    sim.e2200hist.push(sim.e2200); sim.e2200 = ev(2400, 2); expect(nextYear2200(sim)).toBe(2550);
  });
  it("旧セーブ(relocFirst なし)は 2200/2350 のまま。2100 のイベントを後から出さない", () => {
    expect([0, 1, 2].map((n) => relocYear(n, RELOC_FIRST_LEGACY))).toEqual([2200, 2350, 2500]);
    const old: any = { stage3: true, kaigen: {}, startYear: 1950, month: (2150 - 1950) * 12 };   // an older game that is at 2150 and has not had an event yet
    expect(nextYear2200(old)).toBe(2200); expect(due2200(old)).toBe(false);
    old.e2200 = ev(2200, 0); old.month = (2300 - 1950) * 12; expect(nextYear2200(old)).toBe(2350); expect(due2200(old)).toBe(false);   // the event it had in 2200 is kept, the next is 2350
    const fresh: any = { stage3: true, kaigen: {}, relocFirst: 2100, startYear: 1950, month: (2100 - 1950) * 12 };
    expect(due2200(fresh)).toBe(true); fresh.e2200 = ev(2100, 0); expect(due2200(fresh)).toBe(false);   // an event that is open or done is not opened again
  });
  it("保存の検査は relocFirst を残し、壊れた値は捨てる(捨てると旧スケジュール)", () => {
    const { w, hash } = realWorld(true), sim = createSim(w, "m", hash, 3, { stage3: true, firstEra: 0, techK: 2, relocFirst: 2100 });
    expect(sim.relocFirst).toBe(2100); const json = JSON.parse(JSON.stringify(sim));
    expect(sanitizeSim(json).sim?.relocFirst).toBe(2100);
    for (const bad of [2100.5, "2100", 5, null]) { const r = sanitizeSim({ ...json, relocFirst: bad }); expect(r.sim, String(bad)).toBeTruthy(); expect(r.sim!.relocFirst).toBeUndefined(); }
    expect(createSim(w, "m", hash, 3, { stage3: true, firstEra: 0, techK: 2 }).relocFirst).toBeUndefined();   // (a game made without the option is the older kind)
  });
});

import { AIR_STYLE, KIND_COLOUR, edgeStyle, hex, TUNNEL, type Kind, type LineState, type Tier } from "../../src/render/style24";
import { legendItems } from "../../src/render/legendSamples";
describe("Stage 28: 通常地図の線は連続線だけ(点線・破線なし)", () => {
  it("どの種別・段階・状態の線にも dash がなく、凡例の見本にも stroke-dasharray がない", () => {
    const kinds = Object.keys(KIND_COLOUR) as Kind[];
    for (const k of kinds) for (const t of ["main", "sub", "local"] as Tier[]) for (const st of ["open", "dormant", "planned", "unbuilt", "closed", "lost"] as LineState[]) for (const o of [{}, { thin: true, tunnel: true }]) {
      const e = edgeStyle(k, t, st, 60, o); for (const s of [e.casing, e.body, e.centre, e.ties]) expect(s?.dash, `${k} ${t} ${st}`).toBeUndefined();
    }
    for (const s of [AIR_STYLE.casing, AIR_STYLE.body, TUNNEL.edge]) expect(s?.dash).toBeUndefined();
    for (const it of legendItems()) { expect(it.svg).not.toContain("dasharray"); expect(it.caption).not.toMatch(/点線|破線|鎖線|ドット/); }
  });
  it("計画・未成と廃線・廃道は、道路と鉄道を見分けられ、供用中とも区別できる", () => {
    for (const st of ["planned", "closed"] as LineState[]) { const r = edgeStyle("road", "sub", st, 90), l = edgeStyle("rail", "sub", st, 90); expect(JSON.stringify(r)).not.toBe(JSON.stringify(l)); expect(hex((r.casing ?? r.body).colour)).not.toBe(hex((l.casing ?? l.body).colour)); }
    for (const k of ["road", "rail", "sea"] as Kind[]) expect(new Set(["open", "planned", "closed"].map((st) => JSON.stringify(edgeStyle(k, "sub", st as LineState, 90)))).size).toBe(3);
  });
});

import { GROWTH_RATE_POINTS, budgetAt, cycleGrowthRate, rebuildDrive, reviveRule } from "../../src/sim/cycle27";
describe("Stage 28: 復興の強化(表と連続性)", () => {
  const ev = { year: 2100 } as any;
  it("自然増は復興期だけ強く、平衡期で止まり、衰退期と遷都前は0。境界で飛ばない", () => {
    const at = (y: number) => cycleGrowthRate({ startYear: y, month: 0, e2200: ev });
    expect(cycleGrowthRate({ startYear: 2050, month: 0, e2200: undefined } as any)).toBe(0);
    expect(at(2100)).toBe(0); expect(at(2125)).toBeGreaterThan(0.015); expect(at(2175)).toBeLessThan(0.012); expect(at(2230)).toBe(0); expect(at(2149)).toBeGreaterThan(0.005);
    let prev = at(2100); for (let y = 2100.25; y < 2250; y += 0.25) { const v = at(y); expect(Math.abs(v - prev)).toBeLessThan(0.0035); prev = v; }
    expect(GROWTH_RATE_POINTS[GROWTH_RATE_POINTS.length - 1][1]).toBe(0);
    expect(budgetAt(100, GROWTH_RATE_POINTS)).toBeCloseTo(0.009, 6);
  });
  it("復興の駆動力は 0〜1 で、復興期に最大、平衡期の途中までに消え、衰退期は0。なだらか", () => {
    expect(rebuildDrive(undefined, 2125)).toBe(0); expect(rebuildDrive(ev, 2130)).toBe(1); expect(rebuildDrive(ev, 2149)).toBe(1); expect(rebuildDrive(ev, 2180)).toBe(0); expect(rebuildDrive(ev, 2240)).toBe(0);
    let prev = rebuildDrive(ev, 2100); for (let y = 2100.1; y < 2250; y += 0.1) { const v = rebuildDrive(ev, y); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); expect(Math.abs(v - prev)).toBeLessThan(0.12); prev = v; }
  });
  it("復旧の基準は復興期だけ緩み、それ以外は従来のまま", () => {
    expect(reviveRule(undefined, 2125, 30, 3)).toEqual({ demand: 30, years: 3 }); expect(reviveRule(ev, 2230, 30, 3)).toEqual({ demand: 30, years: 3 });
    const r = reviveRule(ev, 2130, 30, 3); expect(r.demand).toBeLessThan(30); expect(r.years).toBeLessThan(3); expect(r.years).toBeGreaterThanOrEqual(1);
  });
});

import { run14 } from "../study/lib14";
describe("Stage 28: 2100年の遷都のあとの復興(実際にゲームを進める)", () => {
  it("遷都は2100年に1度だけ。復興期に人口が自然増で増え(都市間の移動では増えない)、平衡期の入口で安定する", () => {
    const pop: Record<number, number> = {}; let opened = 0, lastN = -1;
    const { sim } = run14({ seed: 5, until: 2162, islets: true, relocFirst: 2100, hook: (s, _w, y) => { if (y >= 2098 && y <= 2162 && y % 2 === 0 && pop[y] === undefined) pop[y] = Object.values(s.cities).reduce((t, c) => t + c.pop, 0); if (s.e2200 && (s.e2200.n ?? 0) !== lastN) { lastN = s.e2200.n ?? 0; opened++; } } });
    expect(opened).toBe(1); expect(sim.e2200!.year).toBe(2100); expect(sim.e2200!.n).toBe(0); expect(sim.relocFirst).toBe(2100);
    expect(pop[2150]).toBeGreaterThan(pop[2100] * 1.3);   // the rebuilding: a baby boom, ~+2% a year net of the ordinary decline
    expect(Math.abs(pop[2162] / pop[2150] - 1)).toBeLessThan(0.03);   // the balance phase: it holds
    for (let y = 2100; y < 2162; y += 2) expect(Math.abs(pop[y + 2] / pop[y] - 1), String(y)).toBeLessThan(0.05);   // no jump between two samples, at the phase edge or anywhere
  }, 600000);
});

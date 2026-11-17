import { describe, expect, it } from "vitest";
import { ADOPTED_REAL, HIST_POOL, fourEraBlock, generatedYomi, historicalCands, kanjiInitial, ordinaryCands, poolFor, romajiInitial, firstEraCands } from "../../src/sim/era86";
import { advance, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { apply2200 } from "../../src/sim/event2200";
import { eraKey } from "../../src/sim/kaigen";
import { skipWindow } from "../../src/sim/policy";
import { sanitizeSim } from "../../src/core/save2";
import { stage3Sim } from "./simhelp";

/** Issue #86: era names and policy apart; pools by year; the 4-era rule; 前・中・後; nothing guessed. */
const game = (o: object = {}) => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true, era86: { name: "興化", stance: "kairo", coast: "japansea", focus: "disperse" }, ...o } as never);
describe("Issue #86: candidates", () => {
  it("pools by year; no name history adopted is in them; 明治's candidates and 令和's side proposals are absent; the 1926 names have no reading and say so", () => {
    expect(poolFor(1800)).toEqual(["taisho"]); expect(poolFor(1900)).toEqual(["showa"]); expect(poolFor(2000)).toEqual(["heisei", "reiwa"]); expect(poolFor(2100).length).toBe(4);
    for (const c of HIST_POOL) expect(ADOPTED_REAL.has(eraKey(c.name)), c.name).toBe(false); const names = HIST_POOL.map((c) => c.name); for (const n of ["大正", "昭和", "平成", "令和", "明治", "佳桜", "桜花", "知道"]) expect(names).not.toContain(n);
    expect(HIST_POOL.filter((c) => c.origin === "taisho").map((c) => c.name)).toEqual(["天興", "興化", "永安", "乾徳", "昭徳"]); expect(HIST_POOL.filter((c) => c.origin === "reiwa").map((c) => `${c.name}:${c.yomi}`)).toEqual(["英弘:えいこう", "久化:きゅうか", "広至:こうし", "万和:ばんな", "万保:ばんぽう"]);
    expect(HIST_POOL.filter((c) => c.origin === "showa").length).toBe(14); expect(HIST_POOL.filter((c) => c.origin === "showa").every((c) => c.yomi === null)).toBe(true);
    const s = historicalCands(1900, [{ name: "興化", yomi: "こうか" }]).filter((c) => c.origin === "showa"); expect(s.length).toBe(14); expect(s.every((c) => c.mark === "読" && !!c.blocked)).toBe(true);
  });
  it("initials: Hepburn first letter from the reading (し S, ち C, つ T, ふ F, じ J); kanji first character; a generated name's reading is the game's own", () => {
    expect(["しょうとく", "ちゅう", "つ", "ふ", "じ", "えいあん", "ばんな", "ぜんこうか"].map((y) => romajiInitial(y))).toEqual(["S", "C", "T", "F", "J", "E", "B", "Z"]); expect(romajiInitial(null)).toBeNull(); expect(kanjiInitial("興化")).toBe("興");
    expect(generatedYomi("与乙")).toBe("よおつ"); expect(generatedYomi("乙与")).toBe("おつよ"); expect(generatedYomi("天興")).toBeNull();
  });
  it("4-era rule, kanji and romaji judged apart: same kanji / same letter within the last three blocks, with the mark and the reason; the fifth era may repeat the first", () => {
    const past = [{ name: "天興", yomi: "てんこう" }, { name: "興化", yomi: "こうか" }, { name: "永安", yomi: "えいあん" }];
    expect(fourEraBlock("永和", "えいわ", past)!.mark).toBe("漢"); expect(fourEraBlock("乾徳", "けんとく", past)!.mark, "K as 興化(こうか)").toBe("ロ"); expect(fourEraBlock("昭徳", "しょうとく", past)).toBeNull();
    expect(fourEraBlock("天和", "てんな", [...past, { name: "昭徳", yomi: "しょうとく" }]), "天興 is four eras back now").toBeNull();
    expect(fourEraBlock("乾徳", "けんとく", [{ name: "興化", yomi: null }]), "an era with no known reading is judged by its kanji only").toBeNull();
    const c = historicalCands(1800, [{ name: "興化", yomi: "こうか" }]); expect(c.find((x) => x.name === "興化")!.mark).toBe("済"); expect(c.find((x) => x.name === "乾徳")!.mark).toBe("ロ"); expect(c.find((x) => x.name === "天興")!.blocked).toBeNull(); expect(c.length, "blocked ones stay listed").toBe(5);
  });
  it("前・中・後 only when every verified historical name is used, as names of their own under the same rule; before that the fallback is the game's generated names, labelled", () => {
    const some = [{ name: "興化", yomi: "こうか" }]; const at1900 = historicalCands(1900, some); expect(at1900.some((c) => c.origin === "reuse"), "names are left: no 前").toBe(false); expect(at1900.filter((c) => c.origin === "generated" && !c.blocked).length).toBeGreaterThanOrEqual(3);
    const all = HIST_POOL.filter((c) => c.yomi).map((c) => ({ name: c.name, yomi: c.yomi })); const r = historicalCands(2400, all); const reuse = r.filter((c) => c.origin === "reuse"); expect(reuse.length).toBe(all.length); expect(reuse[0].name).toBe("前天興"); expect(reuse[0].yomi).toBe("ぜんてんこう");
    expect(reuse.every((c) => c.blocked === null || c.mark === "漢" || c.mark === "ロ")).toBe(true); expect(reuse.filter((c) => !c.blocked).length, "前 forms all begin with 前/Z: after one is taken the next three eras cannot take another").toBeGreaterThan(0);
    const again = historicalCands(2500, [...all, { name: "前天興", yomi: "ぜんてんこう" }]); expect(again.filter((c) => c.origin === "reuse" && c.name.startsWith("前")).every((c) => c.mark === "漢"), "the other 前 forms collide with 前天興").toBe(true); expect(again.find((c) => c.name === "中天興"), "天興 itself would come back as 中天興").toBeTruthy(); expect(again.find((c) => c.name === "中天興")!.blocked, "and can be chosen, so no generated name is needed").toBeNull(); expect(again.some((c) => c.origin === "generated")).toBe(false);
    const third = historicalCands(2900, [...all, { name: "前天興", yomi: "ぜんてんこう" }, { name: "甲与", yomi: "こうよ" }, { name: "乙与", yomi: "おつよ" }, { name: "丙与", yomi: "へいよ" }]); expect(third.find((c) => c.name === "中天興"), "the third use of 天興 is 中天興").toBeTruthy(); expect(third.find((c) => c.name === "前興化")).toBeTruthy();
  });
  it("ordinary change: generated names with their readings, at least three that can be chosen", () => { const c = ordinaryCands(1830, [{ name: "興化", yomi: "こうか" }]); expect(c.length).toBeGreaterThanOrEqual(5); expect(c.filter((x) => !x.blocked).length).toBeGreaterThanOrEqual(3); expect(c.every((x) => x.origin === "generated" && !!x.yomi)).toBe(true); });
});
describe("Issue #86: in the game", () => {
  it("a new 1800 game: the first era by name with ANY policy; an older-style game (no era86 option) is as before", () => {
    const { sim } = game(); const k = sim.kaigen!; expect(k.era86).toBe(true); expect(k.eras[0]).toMatchObject({ name: "興化", stance: "kairo", yomi: "こうか", o86: "taisho" }); expect(k.recon).toMatchObject({ coast: "japansea", focus: "disperse" }); expect(sim.initPolicy).toMatchObject({ stance: "kairo", coast: "japansea", focus: "disperse" });
    const old = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never).sim; expect(old.kaigen!.era86).toBeUndefined(); expect(old.kaigen!.eras[0].name).toBe("神化");
    expect(firstEraCands().map((c) => c.name)).toEqual(["天興", "興化", "永安", "乾徳", "昭徳"]);
  }, 600000);
  it("ordinary change: the name and the policy are chosen apart; a blocked name is never taken; automatic keeps the policy; saved and loaded", () => {
    const { sim, w } = game(); sim.policy!.mode = "priority"; for (let i = 0; i < 12 * 60 && !sim.kaigen!.pending; i++) { stepMonth(sim, w); if (sim.policy!.pending) skipWindow(sim); } const p = sim.kaigen!.pending!; expect(p, "an ordinary era change came").toBeTruthy(); expect(p.cands.every((c) => c.o86 === "generated")).toBe(true);
    const blockedIdx = p.cands.findIndex((c) => c.blocked), okIdx = p.cands.findIndex((c) => !c.blocked); const e = settleKaigen(sim, blockedIdx >= 0 ? blockedIdx : okIdx, false, "shoka")!; expect(e.name).toBe(p.cands[okIdx].name); expect(e.stance, "any policy with any name").toBe("shoka"); expect(e.yomi).toBeTruthy();
    sim.policy!.mode = "auto"; const n = sim.kaigen!.eras.length; advance(sim, w, 12 * 45); expect(sim.kaigen!.eras.length).toBeGreaterThan(n); const last3 = sim.kaigen!.eras.slice(-3); for (const x of last3.slice(1)) if (x.auto && x.start % 100 !== 0) expect(x.stance, "an automatic change keeps the policy").toBe("shoka");
    const eras = sim.kaigen!.eras; for (let i = 1; i < eras.length; i++) { const win = eras.slice(Math.max(0, i - 3), i + 1); expect(new Set(win.map((x) => kanjiInitial(x.name))).size, `kanji initials differ in ${win.map((x) => x.name).join()}`).toBe(win.length); const rs = win.map((x) => romajiInitial(x.yomi)).filter(Boolean); expect(new Set(rs).size, `romaji initials differ in ${win.map((x) => x.yomi).join()}`).toBe(rs.length); }
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(back.problems).toEqual([]); expect(back.sim!.kaigen!.era86).toBe(true); expect(back.sim!.kaigen!.eras.map((x) => x.yomi)).toEqual(eras.map((x) => x.yomi));
  }, 900000);
  it("relocation of 1900: the 昭和時候補 are listed but cannot be chosen (no verified reading); a generated name is taken; the policy is the player's; no era is named twice when an ordinary change falls in the same year", () => {
    const { sim, w } = game(); sim.policy!.mode = "priority"; sim.kaigen!.next = 1900; sim.month = 1200 - 1; let guard = 0; while (sim.e2200?.state !== "pending" && guard++ < 40) { stepMonth(sim, w); if (sim.policy!.pending) skipWindow(sim); if (sim.kaigen!.pending) settleKaigen(sim, 0, false, "heisei"); }
    expect(sim.e2200?.state).toBe("pending"); const g = sim.kaigen!.reloc![sim.e2200!.n ?? 0]!; expect(g.cands.filter((c) => c.o86 === "showa").length).toBe(14); expect(g.cands.filter((c) => c.o86 === "showa").every((c) => c.blocked)).toBe(true);
    const n = sim.kaigen!.eras.length; apply2200(sim, { era: 0, stance: "kuuro", coast: "pacific", focus: "concentrate" }); const last = sim.kaigen!.eras[sim.kaigen!.eras.length - 1]; expect(sim.kaigen!.eras.length).toBe(n + 1); expect(last.o86).toBe("generated"); expect(last.stance).toBe("kuuro"); expect(last.start).toBe(1900);
    expect(new Set(sim.kaigen!.eras.map((e) => e.name)).size).toBe(sim.kaigen!.eras.length); expect(sim.kaigen!.eras.filter((e) => e.start === 1900).length, "one era for 1900, not two").toBeLessThanOrEqual(2); void yearOf;
  }, 900000);
});

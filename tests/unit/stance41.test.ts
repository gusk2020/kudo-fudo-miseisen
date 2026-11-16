import { describe, expect, it } from "vitest";
import { currentPolicy, initialPolicy, policyText } from "../../src/sim/stance41";
import { settleKaigen, advance } from "../../src/sim/engine";
import { stage3Sim } from "./simhelp";

/** Stage 41: the policy line of the top bar: the policy the game started with, the one in force now, each as stance・city・region. */
describe("Stage 41: initial and current policy", () => {
  it("at the start they are the same three words; the initial one is recorded with the game; after an era change the current one follows the new era and the initial one stays", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 2, 2, true, undefined, undefined, { start1800: true } as never);   // firstEra 2 = 鉄道重視
    const ini0 = initialPolicy(sim)!, cur0 = currentPolicy(sim)!; expect(sim.initPolicy, "recorded when the game is made").toBeTruthy(); expect(policyText(ini0)).toBe(policyText(cur0)); expect(ini0.stance).toBe("鉄道重視"); expect(ini0.city).toMatch(/^(集中|分散)$/); expect(ini0.region).toMatch(/^(日本海側|太平洋側|中立)$/);
    sim.policy!.mode = "priority"; advance(sim, w, 12 * 30); if (!sim.kaigen!.pending) advance(sim, w, 12 * 20);   // (the clock stops at the first era change)
    if (sim.kaigen!.pending) { const other = sim.kaigen!.pending.cands.findIndex((c) => c.stance !== sim.kaigen!.eras[0].stance); settleKaigen(sim, other >= 0 ? other : 0, false); }
    const cur1 = currentPolicy(sim)!, ini1 = initialPolicy(sim)!; expect(policyText(ini1), "the initial policy does not move").toBe(policyText(ini0)); expect(cur1.stance).toBe(sim.kaigen!.eras.at(-1)!.stance === "heisei" ? "均衡" : cur1.stance);
    if (sim.kaigen!.eras.at(-1)!.stance !== sim.kaigen!.eras[0].stance) expect(policyText(cur1)).not.toBe(policyText(ini1));
  }, 900000);
  it("a game saved before the initial policy was recorded shows its first era's stance and a dash for the rest, never a guess; no era list = nothing", () => {
    const { sim } = stage3Sim("heisei", 7, true, 1, 2, true); const old = { ...sim, initPolicy: undefined }; const ini = initialPolicy(old)!; expect(ini.stance).toBe("道路重視"); expect(ini.city).toBe("—"); expect(ini.region).toBe("—");
    expect(currentPolicy({ kaigen: undefined })).toBeNull(); expect(initialPolicy({ kaigen: undefined, initPolicy: undefined })).toBeNull();
    // a game of the single-era kind (no era list): its one stance is both the initial and the current policy
    const single = { kaigen: undefined, initPolicy: undefined, era: "kobun" } as const; expect(policyText(currentPolicy(single)!)).toBe(policyText(initialPolicy(single)!)); expect(currentPolicy(single)!.stance).toBe("旧版"); expect(currentPolicy({ kaigen: undefined, era: "nope" })).toBeNull();
  }, 600000);
});

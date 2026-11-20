import { describe, expect, it } from "vitest";
import { stance18 } from "../../src/sim/policy18";
import { corridorCount, corridorFull, isMountainCell } from "../../src/sim/corridor43";
import { pathfind } from "../../src/sim/world";
import { newEdgeDefaults } from "../../src/sim/network";
import { TRANSPORT_LABEL, COAST_LABEL2, simpleItems, autoStance, autoEraIdx } from "../../src/sim/simple41";
import { nightColour } from "../../src/sim/night41";
import { airTier, seaTier, AIR_TRUNK_VOL, SEA_TRUNK_THROUGH } from "../../src/render/style24";
import type { SimEdge } from "../../src/sim/types";
import { realWorld, stage3SimOn } from "./simhelp";

const game = (stance = "kuuro", focus = "disperse") => { const base = realWorld(true, { capital: "JP-13", sub: "JP-27" }, 3); const g = stage3SimOn(base as never, 0, 7, { start1800: true, subCapital: "JP-27", era86: { name: "天興", stance, coast: "neutral", focus } } as never); g.sim.policy!.mode = "auto"; return g; };
describe("Stage 43", () => {
  it("A: the stance of the era reaches the 1800-start games made now (s43); an older game (no flag) keeps none, as before", () => {
    const g = game("kuuro"); expect(g.sim.s43).toBe(true); expect(stance18(g.sim)).toBe("air");
    expect(stance18(game("kairo").sim)).toBe("sea"); expect(stance18(game("shubun").sim)).toBeNull();
    delete (g.sim as { s43?: true }).s43; expect(stance18(g.sim), "a game made before Stage 43").toBeNull();
  }, 600000);
  it("A2: a mountain corridor that already carries three roads takes no fourth; an expressway may be the one more where none is; plains and older games are never checked", () => {
    const { sim, w } = game(); const c = (n: string) => w.cities.find((x) => x.name === n)!;
    const path = pathfind(w, c("前橋市").cell, c("新潟市").cell)!; expect(path.length).toBeGreaterThan(10); expect(path.filter((k) => isMountainCell(w, k)).length, "the 群馬〜新潟 way runs through mountains").toBeGreaterThan(3);
    const add = (dx: number, hg = false) => { const id = `x43-${dx}`, cells = path.map((k) => k + dx); sim.edges[id] = { ...newEdgeDefaults(), id, a: "n?", b: "n?", cells, lengthKm: cells.length * w.cell, surface: "paved", quality: 80, built: 1, open: true, state: "open", standard: hg ? "highgrade" : "standard", maxGradePct: 4, builtMonth: 0, region: "JP-10" } as SimEdge; sim.next.edge++; };
    console.log("S43 corridor before", JSON.stringify(corridorCount(sim, w, path)));
    for (const dx of [-3, 3, 6]) add(dx);
    const after = corridorCount(sim, w, path); console.log("S43 corridor after", JSON.stringify(after)); expect(after.median, "three roads cross the corridor").toBeGreaterThanOrEqual(3);
    expect(corridorFull(sim, w, path, "standard"), "a fourth ordinary road is refused").toBe(true);
    expect(corridorFull(sim, w, path, "highgrade"), "an expressway where the corridor has none is allowed").toBe(after.highgrade);
    delete (sim as { s43?: true }).s43; expect(corridorFull(sim, w, path, "standard"), "an older game is never checked").toBe(false);
  }, 600000);
  it("E3: 均衡 and 中立 are answers of the simple intervention (no transport item; the kept answers steer the next era)", () => {
    const { sim } = game("heisei", "concentrate"); expect(TRANSPORT_LABEL.balanced).toBe("均衡"); expect(COAST_LABEL2.neutral).toBe("中立");
    expect(simpleItems(sim, { transport: "balanced" }).length).toBe(0);
    sim.simple41 = { transport: "balanced", coast: "neutral", keep: true }; expect(autoStance(sim)).toBe("heisei");
    const cands = [{ name: "a", stance: "heisei", real: true, note: "", recon: { coast: "pacific", focus: "concentrate" } }, { name: "b", stance: "heisei", real: true, note: "", recon: { coast: "neutral", focus: "concentrate" } }] as never;
    expect(autoEraIdx(sim, cands), "the neutral candidate").toBe(1);
  }, 600000);
  it("B4: night lights are one daylight white at every brightness (no orange, no yellow)", () => {
    for (const x of [0.05, 0.3, 0.6, 1]) { const [r, g, b] = nightColour(x); expect(r - b, `x=${x}`).toBeLessThanOrEqual(12); expect(r - g).toBeLessThanOrEqual(6); }
    expect(nightColour(1)[0]).toBeGreaterThan(nightColour(0.1)[0]);
  });
  it("B1: trunk / local tiers of flights and sea routes", () => {
    expect(airTier({ vol: AIR_TRUNK_VOL })).toBe("trunk"); expect(airTier({ vol: AIR_TRUNK_VOL - 1 })).toBe("local"); expect(airTier({ vol: 5000, local: true }), "opened as a local route").toBe("local");
    expect(seaTier({ through: SEA_TRUNK_THROUGH })).toBe("trunk"); expect(seaTier({ through: 10 })).toBe("local");
  });
});

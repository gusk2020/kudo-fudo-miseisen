import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { edgeSpeed, FERRY_SPEED } from "../../src/sim/demand";
import { ALL_MILESTONES, reached, techNow } from "../../src/sim/history1800";
import { EARLY_SERVICE_YEARS, SHIP_SPEED_FACTOR, shipGrade } from "../../src/sim/rules1800";
import type { SimEdge, SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #66 B: sail ferries and ports are in service from 1800 and never gated; steam (1830) and steel steamers (1880) are upgrades that 海路重視 brings forward (at most 20 years, by exposure, monotone) and that make ferries faster. */
const sim = (eras: { start: number; stance: string }[]) => ({ startYear: 1800, kaigen: { eras } });
const first = (s: ReturnType<typeof sim>, g: 1 | 2) => { for (let y = 1800; y <= 2000; y++) if (shipGrade(s, y) >= g) return y; return Infinity; };
describe("Issue #66 B: ship grades", () => {
  it("1800 is sail for every stance; a balanced world gets steam in 1830 and steel in 1880; 海路重視 brings both forward by at most 20 years and never before the start", () => {
    for (const st of ["heisei", "shoka", "shubun", "kuuro", "kairo"]) expect(shipGrade(sim([{ start: 1800, stance: st }]), 1800), st).toBe(0);
    const bal = sim([{ start: 1800, stance: "heisei" }]), sea = sim([{ start: 1800, stance: "kairo" }]);
    expect(first(bal, 1)).toBe(1830); expect(first(bal, 2)).toBe(1880);
    const a = first(sea, 1), b = first(sea, 2); expect(a).toBeGreaterThanOrEqual(1830 - EARLY_SERVICE_YEARS); expect(a).toBeLessThan(1830); expect(b).toBeGreaterThanOrEqual(1880 - EARLY_SERVICE_YEARS); expect(b).toBeLessThan(1880); expect(b).toBeGreaterThan(a);
    expect(first(sim([{ start: 1800, stance: "shoka" }]), 1)).toBe(1830);   // (another stance's stance does not move the ships)
  });
  it("a later era change speeds up what comes after and never takes a grade back (monotone through every change)", () => {
    const s = sim([{ start: 1800, stance: "heisei" }, { start: 1840, stance: "kairo" }, { start: 1860, stance: "heisei" }]); let g = 0; for (let y = 1800; y <= 2050; y++) { const v = shipGrade(s, y); expect(v, String(y)).toBeGreaterThanOrEqual(g); g = v; }
    expect(first(s, 2)).toBeLessThan(1880); expect(first(s, 2)).toBeGreaterThan(1840);
  });
  it("the grade really changes a ferry's speed (and nothing else's): sail 1x, steam 1.35x, steel 1.8x", () => {
    const f = { facility: "ferry", mode: "road", standard: "rural", surface: "paved", quality: 80, maxGradePct: 1, lengthKm: 30, cells: [1, 2] } as unknown as SimEdge, r = { ...f, facility: undefined } as unknown as SimEdge;
    expect(edgeSpeed(f)).toBe(FERRY_SPEED); for (const g of [1, 2]) expect(edgeSpeed({ ...f, shipGrade: g } as SimEdge)).toBeCloseTo(FERRY_SPEED * SHIP_SPEED_FACTOR[g], 6); expect(edgeSpeed({ ...r, shipGrade: 2 } as SimEdge)).toBe(edgeSpeed(r));
  });
  it("the timeline and atlas say when the steamers really came (the same test as the simulation)", () => {
    const sea = sim([{ start: 1800, stance: "kairo" }]), m = ALL_MILESTONES.find((x) => x.id === "ship-steam")!, y = first(sea, 1);
    expect(reached(sea, m, y - 1)).toBe(false); expect(reached(sea, m, y)).toBe(true); expect(techNow("船舶", y, sea).phase).toBe("service"); expect(techNow("船舶", 1810, sim([{ start: 1800, stance: "heisei" }])).phase).toBe("none");
  });
  it("in a game: a 海路重視 first era runs its ferries faster than a balanced one from the 1820s; a 1950 game never sets a grade; the grade survives a save", () => {
    const mk = (stance: string | null) => { const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, stance ? ({ start1800: true } as never) : undefined); if (stance) g.sim.kaigen!.eras[0].stance = stance as never; g.sim.policy!.mode = "auto"; return g; };
    const ferries = (s: SimState) => Object.values(s.edges).filter((e) => e.facility === "ferry");
    const a = mk("kairo"), b = mk("heisei"); advance(a.sim, a.w, 12 * (1826 - yearOf(a.sim))); advance(b.sim, b.w, 12 * (1826 - yearOf(b.sim)));
    expect(ferries(a.sim).length).toBeGreaterThan(5); expect(ferries(a.sim).every((e) => (e.shipGrade ?? 0) >= 1)).toBe(true); expect(ferries(b.sim).every((e) => (e.shipGrade ?? 0) === 0)).toBe(true);
    const ev = a.sim.events.find((e) => e.kind === "tech" && e.refs?.milestone === "ship-steam"); expect(ev).toBeTruthy(); expect(a.sim.startYear + Math.floor(ev!.month / 12)).toBeLessThan(1830);
    const back = JSON.parse(JSON.stringify(a.sim)) as SimState; expect(ferries(back).map((e) => e.shipGrade)).toEqual(ferries(a.sim).map((e) => e.shipGrade));
    const h = stage3Sim("heisei", 7, true, 0, 2, true); h.sim.policy!.mode = "auto"; advance(h.sim, h.w, 12 * 15); expect(ferries(h.sim).every((e) => e.shipGrade === undefined)).toBe(true);
  }, 600000);
});

import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { ALL_MILESTONES, FICTION_1800, TECHS_1800, TECH_MILESTONES, techNow } from "../../src/sim/history1800";
import { mayScheduleService } from "../../src/sim/rules1800";
import { stage3Sim } from "./simhelp";

describe("Stage 36: timeline and atlas of an 1800 game", () => {
  it("the technology table: experiment / service / spread / decline are distinguished, and an experiment is never a service", () => {
    expect(techNow("鉄道", 1800).phase).toBe("none"); expect(techNow("鉄道", 1810).phase).toBe("experiment"); expect(techNow("鉄道", 1830).phase).toBe("service"); expect(techNow("鉄道", 1850).phase).toBe("spread");
    expect(techNow("飛行船", 1860).phase).toBe("experiment"); expect(techNow("飛行船", 1900).phase).toBe("experiment"); expect(techNow("飛行船", 1940).phase).toBe("decline");
    expect(techNow("自動車", 1890).phase).toBe("experiment"); expect(techNow("自動車", 1910).phase).toBe("spread"); expect(techNow("飛行機", 1910).phase).toBe("experiment"); expect(techNow("飛行機", 1920).phase).toBe("service");
    for (const m of TECH_MILESTONES) if (m.phase === "experiment") { const id = m.tech === "鉄道" ? "rail" : m.tech === "飛行船" ? "airship" : m.tech === "自動車" ? "car" : "plane"; if (id !== "car") expect(mayScheduleService(id as never, m.year), m.id).toBe(false); }
    expect(mayScheduleService("airship", 1950)).toBe(false);   // an airship never gets a scheduled route, even before it declines
    expect(TECHS_1800.every((t) => techNow(t, 1960).phase !== "none")).toBe(true);
  });
  it("the fictional-history rows are marked 【架空】 (or 【史実】) and sit before the 1830 railway", () => {
    for (const m of FICTION_1800) { expect(m.text, m.id).toMatch(/^【(架空|史実)】/); expect(m.year, m.id).toBeLessThanOrEqual(1830); }
    expect(FICTION_1800.map((m) => m.id)).toEqual(expect.arrayContaining(["foreign-pressure", "restoration", "engineers"]));
  });
  it("a game records the rows in its timeline as it runs, once each, and never an airship route", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true, undefined, undefined, { start1800: true }); sim.policy!.mode = "priority";
    expect(sim.events.some((e) => e.kind === "tech" && /架空/.test(e.text))).toBe(true);   // the start year's own rows
    advance(sim, w, 12 * 70); expect(yearOf(sim)).toBe(1870);
    const ts = sim.events.filter((e) => e.kind === "tech"), want = ALL_MILESTONES.filter((m) => m.year <= 1870);
    expect(ts.length).toBe(want.length); expect(new Set(ts.map((e) => e.refs.milestone)).size).toBe(ts.length);
    expect(ts.find((e) => e.refs.milestone === "airship-exp")?.text).toContain("試験・実験"); expect(ts.find((e) => e.refs.milestone === "rail-svc")?.text).toContain("実用");
    expect((sim.hubs?.routes ?? []).filter((r) => r.mode === "air").length).toBe(0);
  }, 900000);
});

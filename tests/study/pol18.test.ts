import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { modeOf } from "../../src/sim/types";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("pol18", () => { it("x", () => {
  const out: string[] = [];
  for (const [era, name] of [[0, "balanced"], [3, "air"], [4, "sea"]] as [number, string][]) {
    const r = run14({ seed: +(process.env.SEED ?? 7), firstEra: era, until: +(process.env.UNTIL ?? 2000) }), { sim } = r;
    const E = Object.values(sim.edges), wt = E.filter((e) => e.facility === "tunnel" && e.state === "open" && /海底|湖底/.test(e.facilityName ?? ""));
    const rail = E.filter((e) => modeOf(e) === "rail" && e.state === "open" && e.facility !== "ferry"), roads = E.filter((e) => modeOf(e) === "road" && e.state === "open" && e.facility !== "ferry");
    const h = sim.hubs!, ports = Object.values(h.ports).filter((p) => p.until === undefined), airs = Object.values(h.airports).filter((a) => a.until === undefined);
    const early = wt.filter((e) => 1950 + Math.floor((e.builtMonth ?? 0) / 12) < 1989).length; const exc = Object.values(sim.projects).filter((p) => p.reason.includes("【例外】")).length;
    const ferries = E.filter((e) => e.facility === "ferry" && e.state === "open").length;
    out.push(`${name} era=${era} stance=${sim.kaigen!.eras[0].stance} tunnels=${wt.length} before1989=${early} (exceptions ${exc}) railKm=${Math.round(rail.reduce((t, e) => t + e.lengthKm, 0))} hsrKm=${Math.round(rail.filter((e) => e.standard === "highgrade").reduce((t, e) => t + e.lengthKm, 0))} roadKm=${Math.round(roads.reduce((t, e) => t + e.lengthKm, 0))} ferries=${ferries} ports=${ports.length} tierSum=${ports.reduce((t, p) => t + p.tier, 0)} cargo=${ports.reduce((t, p) => t + p.cargo, 0)} airports=${airs.length} airPax=${airs.reduce((t, a) => t + a.pax, 0)} routesAir=${h.routes.filter((x) => x.mode === "air" && x.state === "open").length} c18=${!!sim.pot17?.c18}`);
  }
  writeFileSync(`/tmp/claude-0/pol18-${process.env.TAG ?? "x"}.txt`, out.join("\n"));
}, 3000000); });

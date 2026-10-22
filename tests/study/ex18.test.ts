import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { prefName } from "../../src/core/seat";
import { potentialDataOf, potentialOrder } from "../../src/sim/potential17";
import { realWorld } from "../unit/simhelp";
describe.skipIf(!process.env.STUDY)("ex18", () => { it("x", () => {
  const D = potentialDataOf(realWorld(true, true).w.t), out: string[] = [];
  for (const mode of ["concentrate", "disperse"] as const) for (const coast of ["japansea", "pacific"] as const) {
    const o = { capital: "JP-13", sub: "JP-27", palace: "JP-13", mode, seed: 7 }, a = potentialOrder(o, D), b = potentialOrder({ ...o, coast }, D);
    out.push(`${mode} ${coast}: moved ` + a.map((p, i) => [p, i + 1, b.indexOf(p) + 1] as const).filter((x) => x[1] !== x[2]).map(([p, f, t]) => `${prefName(p)}${f}→${t}`).join(" "));
  }
  writeFileSync("/tmp/claude-0/ex18.txt", out.join("\n"));
}); });

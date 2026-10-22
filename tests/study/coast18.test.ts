import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { potentialDataOf } from "../../src/sim/potential17";
import { realWorld } from "../unit/simhelp";
describe.skipIf(!process.env.STUDY)("coast18", () => { it("x", () => { const { w } = realWorld(true, true), c = potentialDataOf(w.t).coast!; writeFileSync("/tmp/claude-0/coast18.txt", w.t.prefOrder.map((p) => `${p} js=${c[p]?.japansea ?? 0} pac=${c[p]?.pacific ?? 0}`).join("\n")); }); });

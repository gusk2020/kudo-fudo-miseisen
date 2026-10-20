/** STUDY=1 SEED WK UNTIL: every crossing project (strait links between the four main islands and others): name, mode, km, ends, history. */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { runWater } from "./water13lib";
describe.skipIf(!process.env.STUDY)("cross15", () => { it("x", () => {
  const r = runWater(+(process.env.WK ?? 3), +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 2100));
  writeFileSync(`/tmp/claude-0/cross15-${process.env.TAG ?? "x"}.json`, JSON.stringify({ projects: r.projects, ferries: r.ferries }, null, 1));
}, 900000); });

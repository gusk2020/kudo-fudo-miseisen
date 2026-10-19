/** Stage 13: water-tunnel study. STUDY=1 SCEN=wk3 SEED=7 WK=3 OUT=dir npx vitest run tests/study/water13.test.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { runWater } from "./water13lib";

describe.skipIf(!process.env.STUDY)("water13", () => { it(process.env.SCEN ?? "w", () => {
  const r = runWater(+(process.env.WK ?? 3), +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 2100), (process.env.WORLD as any) ?? "plain"); const out = process.env.OUT ?? "/tmp/claude-0/w13"; mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${process.env.SCEN ?? "w"}-${r.wk}-${r.seed}.json`, JSON.stringify(r, null, 1));
}, 3_600_000); });

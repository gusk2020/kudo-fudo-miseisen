import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { run14 } from "./lib14";
import { simHash } from "../../src/sim/engine";
it.skipIf(!process.env.STUDY28)("hash", () => {
  const out: Record<string, string> = {};
  for (const seed of [3, 11]) { const { sim } = run14({ seed, until: Number(process.env.UNTIL ?? 2120), islets: true, relocFirst: 2100 }); out[seed] = simHash(sim) + " " + JSON.stringify([Object.keys(sim.edges).length, Object.keys(sim.settlements).length, sim.events.length, sim.rngState]); }
  writeFileSync(process.env.OUT ?? "/tmp/hash28.json", JSON.stringify(out, null, 1));
}, 3000000);

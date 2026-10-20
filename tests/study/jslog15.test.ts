import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("jslog", () => { it("x", () => {
  const log: any[] = []; (globalThis as any).__JSLOG = log;
  run14({ seed: 7, firstEra: +(process.env.ERA ?? 1), until: 1990 });
  const byY: Record<string, any> = {};
  for (const l of log) { const k = `${l.y}`; const o = (byY[k] ??= { regions: 0, nNew: 0, tries: 0, ok: 0, okNew: 0, rooms: 0 }); if (l.ev === 'cands') { o.regions++; o.nNew += l.nNew; o.rooms += l.room; } else { o.tries++; if (l.ok) { o.ok++; if (l.kind === 'new' || l.kind === 'access') o.okNew++; } } }
  writeFileSync("/tmp/claude-0/jslog.json", JSON.stringify({ byY, sample: log.filter((l) => l.y === 1962 || l.y === 1975).slice(0, 60) }, null, 1));
}, 900000); });

import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("city17", () => { it("x", () => {
  const out: string[] = [];
  const r = run14({ seed: +(process.env.SEED ?? 7), firstEra: +(process.env.ERA ?? 0), capital: process.env.CAP || undefined, sub: process.env.SUB || undefined, until: +(process.env.UNTIL ?? 2020), pot17: process.env.P17 === "0" ? false : undefined, hook: (sim, w, y) => {
    if (y % 20 && y !== 1951) return; const sh = sim.pot17?.shown ?? {}; const shown = w.cities.filter((c) => (sh[c.id] ?? 0) > 0);
    if (y === 2000) { const pt: Record<string, number> = {}; for (const c of w.cities) if (c.pref) pt[c.pref] = (pt[c.pref] ?? 0) + sim.cities[c.id].pop; out.push("PREF2000 " + ["JP-13", "JP-14", "JP-23", "JP-27", "JP-34", "JP-40", "JP-17"].map((q) => q + "=" + Math.round(pt[q] / 1000)).join(" ")); }
    out.push(`${y} shown=${shown.length} nation=${Math.round(w.cities.reduce((t, c) => t + sim.cities[c.id].pop, 0) / 1000)}k top: ` + [...w.cities].sort((a, b) => sim.cities[b.id].pop - sim.cities[a.id].pop).slice(0, 12).map((c) => `${c.name}${(!sim.pot17 || (sh[c.id] ?? 0) > 0) ? "" : "*"}${Math.round(sim.cities[c.id].pop / 1000)}`).join(" "));
  } });
  const sh = r.sim.pot17?.shown ?? {}; out.push("born: " + Object.entries(sh).filter(([, v]) => v !== 1950).map(([id, v]) => `${r.w.cityById.get(id)?.name}:${v}`).join(" "));
  writeFileSync(`/tmp/claude-0/city17-${process.env.TAG ?? "x"}.txt`, out.join("\n"));
}, 3000000); });

/** Stage 28 study: where the time goes in the years after a relocation (CPU profile of the monthly step, per phase). Run: STUDY=1 STUDY28=1 npx vitest run tests/study/perf28.test.ts */
import { it } from "vitest";
import { Session } from "node:inspector";
import { writeFileSync } from "node:fs";
import { run14 } from "./lib14";
import { settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { apply2200, close2200 } from "../../src/sim/event2200";

const FROM = Number(process.env.FROM ?? 2100), TO = Number(process.env.TO ?? 2150), FIRST = Number(process.env.FIRST ?? 2100), SEED = Number(process.env.SEED ?? 3);
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user/109baf63-fe83-5bb5-8529-ffea0ae6bce3/scratchpad/perf28.json";
it.skipIf(!process.env.STUDY28)("perf profile", async () => {
  const { sim, w } = run14({ seed: SEED, until: FROM, islets: true, ...(FIRST ? { relocFirst: FIRST } : {}) });
  const ses = new Session(); ses.connect(); const post = (m: string, p?: object) => new Promise<any>((res, rej) => ses.post(m, p ?? {}, (e, r) => (e ? rej(e) : res(r))));
  await post("Profiler.enable"); await post("Profiler.setSamplingInterval", { interval: 500 }); await post("Profiler.start");
  const years: Record<number, number> = {}; let t0 = performance.now(), ly = yearOf(sim);
  while (yearOf(sim) < TO) {
    stepMonth(sim, w); if (sim.kaigen?.pending) settleKaigen(sim, Math.max(0, sim.kaigen.pending.cands.findIndex((c: any) => c.stance === "heisei")), true); if (sim.policy?.pending) autoResolve(sim, w);
    if (sim.e2200?.state === "pending") apply2200(sim, null, true); if ((sim.e2200?.state as string) === "road0") close2200(sim);
    if (yearOf(sim) !== ly) { years[ly] = performance.now() - t0; t0 = performance.now(); ly = yearOf(sim); }
  }
  const { profile } = await post("Profiler.stop");
  const self = new Map<string, number>(), byId = new Map<number, any>(); for (const n of profile.nodes) byId.set(n.id, n);
  const dt: number[] = profile.timeDeltas; profile.samples.forEach((id: number, i: number) => { const n = byId.get(id), k = `${n.callFrame.functionName || "(anon)"} ${String(n.callFrame.url).split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
  const total = [...self.values()].reduce((a, b) => a + b, 0), top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => ({ fn: k, ms: Math.round(v / 1000), pct: Math.round((v / total) * 1000) / 10 }));
  // inclusive time per function (a function's own time and everything it called), summed over every place it appears
  const tick = new Map<number, number>(); profile.samples.forEach((id: number, i: number) => tick.set(id, (tick.get(id) ?? 0) + (dt[i] ?? 0)));
  const incl = new Map<string, number>(), memo = new Map<number, number>(); const total1 = (id: number): number => { const hit = memo.get(id); if (hit !== undefined) return hit; const n = byId.get(id); let v = tick.get(id) ?? 0; for (const c of n.children ?? []) v += total1(c); memo.set(id, v); return v; };
  const walk = (id: number, seen: Set<string>) => { const n = byId.get(id), f = `${n.callFrame.functionName || "(anon)"} ${String(n.callFrame.url).split("/").slice(-2).join("/")}`, first = !seen.has(f); if (first) { incl.set(f, (incl.get(f) ?? 0) + total1(id)); seen.add(f); } for (const c of n.children ?? []) walk(c, seen); if (first) seen.delete(f); };
  walk(profile.nodes[0].id, new Set());
  const topIncl = [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, v]) => ({ fn: k, ms: Math.round(v / 1000), pct: Math.round((v / total) * 1000) / 10 }));
  const lines = new Map<string, number>(); for (const n of profile.nodes) for (const t of n.positionTicks ?? []) { const k = `${n.callFrame.functionName || "(anon)"}:${t.line}`; lines.set(k, (lines.get(k) ?? 0) + t.ticks); }
  const topLines = [...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  writeFileSync(OUT, JSON.stringify({ years, totalMs: Math.round(total / 1000), top, topIncl, topLines }, null, 1));
}, 3000000);

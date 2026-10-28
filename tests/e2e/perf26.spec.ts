/** Stage 26 measurement harness (not part of CI): the same x20 window at several eras. Run: PERF=1 CPU=6 ERAS=1960,2050,2150,2250 npx playwright test tests/e2e/perf26.spec.ts */
import { test } from "@playwright/test";
import fs from "node:fs";

test.skip(!process.env.PERF, "measurement only");
const CPU = Number(process.env.CPU ?? 6), ERAS = (process.env.ERAS ?? "1960,2050,2150,2250").split(",").map(Number), WINDOW_MS = Number(process.env.WINDOW ?? 40000), TAG = process.env.TAG ?? "run";
test("perf26: x20 at several eras", async ({ page }) => {
  test.setTimeout(7200000);
  await page.addInitScript(() => { (window as any).__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__long.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {} });
  const cdp = await page.context().newCDPSession(page); await cdp.send("Performance.enable");
  await page.goto("/"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 300000 });
  const cityPos = (n: string) => page.evaluate((x) => (window as any).__kfm.world.cities.find((c: any) => c.name === x).pos, n) as Promise<[number, number]>;
  const scr = (p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
  await page.click("#setup-tab-era"); await page.click("#era-opt-0"); await page.click("#rw-close"); await page.click("#setup-close");
  const tokyo = await cityPos("東京"), osk = await cityPos("大阪市"); await page.click("#tool-cer-kokudo1");
  { const a = await scr(tokyo), b = await scr(osk); await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up(); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 600000 });
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.policy.mode = "auto"; const P: Record<string, number[]> = (window as any).__prof = {}; const wrap = (o: any, k: string, name: string) => { const f = o[k]; if (typeof f !== "function") return; P[name] = []; o[k] = function (...args: any[]) { const t = performance.now(); const r = f.apply(this, args); P[name].push(performance.now() - t); return r; }; };
    wrap(a, "renderRoads", "render"); wrap(a.runner, "pump", "pump"); wrap(a, "status", "status"); wrap(a, "persist", "persist"); wrap(a.r, "rebuild", "rebuild"); wrap(a, "tickClock", "tick"); });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const out: any[] = []; let year = 1950;
  for (const target of ERAS) {
    if (target > year) {
      await page.click("#speed-0");
      for (let y = year; y < target;) {   // fast-forward in 25-year steps, deciding the 2200+ events by "keep"
        const step = Math.min(25, target - y); await page.evaluate((n) => (window as any).__kfm.ffYears(n), step); y += step;
        await page.evaluate(() => { const a = (window as any).__kfm; for (let g = 0; g < 4; g++) { const e = a.sim.e2200; if (e?.state === "pending") a.decideE2200(true); else if (e?.state === "road0") a.openRoad0(true); else break; } });
      }
      year = target;
    }
    await page.evaluate(() => { const a = (window as any).__kfm; for (const k of Object.keys((window as any).__prof)) (window as any).__prof[k].length = 0; (window as any).__long.length = 0; a.sim.speed = 20; a.runner.settle(); });
    await cdp.send("HeapProfiler.collectGarbage"); const m0 = await page.evaluate(() => (window as any).__kfm.sim.month);
    await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 20; a.buildUI(); }); await page.click("#speed-20").catch(() => {});
    await page.waitForTimeout(WINDOW_MS);
    const r = await page.evaluate(() => { const a = (window as any).__kfm, P = (window as any).__prof as Record<string, number[]>, st = (v: number[]) => ({ n: v.length, mean: +(v.reduce((s, x) => s + x, 0) / (v.length || 1)).toFixed(1), max: Math.round(Math.max(0, ...v)), total: Math.round(v.reduce((s, x) => s + x, 0)) });
      const long = (window as any).__long as number[]; const t0 = performance.now(), j = JSON.stringify({ map: a.s, sim: a.sim }); const sv = Math.round(performance.now() - t0);
      return { month: a.sim.month, prof: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, st(v)])), longTasks: { n: long.length, total: long.reduce((s, x) => s + x, 0) }, edges: Object.keys(a.sim.edges).length, routes: Object.keys(a.sim.routes).length, events: a.sim.events.length, saveBytes: j.length, saveMs: sv }; });
    await cdp.send("HeapProfiler.collectGarbage"); const heap = await page.evaluate(() => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6));
    out.push({ era: target, monthsIn40s: r.month - m0, heapMB: heap, ...r }); console.log("ERA", JSON.stringify(out[out.length - 1]));
    await page.click("#speed-0").catch(() => {}); await page.evaluate(() => { (window as any).__kfm.sim.speed = 0; });
  }
  fs.mkdirSync("test-results", { recursive: true }); fs.writeFileSync(`test-results/perf26-${TAG}-cpu${CPU}.json`, JSON.stringify(out, null, 1));
});

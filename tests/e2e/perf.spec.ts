/** Measurement harness for Issue #7 (not part of CI): CPU-throttled Chromium approximates a phone. Run: PERF=1 CPU=6 npx playwright test tests/perf */
import { test } from "@playwright/test";
import fs from "node:fs";

test.skip(!process.env.PERF, "measurement only");
const CPU = Number(process.env.CPU ?? 6);
test("perf: boot -> ceremony -> x20 -> save -> tap", async ({ page }) => {
  test.setTimeout(600000);
  await page.addInitScript(() => {
    (window as any).__long = [] as { t: number; d: number; stage: string }[]; (window as any).__stage = "boot";
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__long.push({ t: Math.round(e.startTime), d: Math.round(e.duration), stage: (window as any).__stage }); }).observe({ type: "longtask", buffered: true }); } catch {}
  });
  const cdp = await page.context().newCDPSession(page); await cdp.send("Performance.enable"); await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const stage = (s: string) => page.evaluate((x) => ((window as any).__stage = x), s);
  const metrics = async (tag: string) => { const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x: any) => [x.name, x.value])); const heap = await page.evaluate(() => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6)); return { tag, heapMB: heap, jsHeapUsedMB: Math.round(m.JSHeapUsedSize / 1e6), nodes: m.Nodes, listeners: m.JSEventListeners, layoutMs: Math.round(m.LayoutDuration * 1000), scriptMs: Math.round(m.ScriptDuration * 1000) }; };
  const out: any = { cpuThrottle: CPU, stages: [] as any[], metrics: [] as any[] };
  const t0 = Date.now(); await page.goto("/?legacy=1"); await page.waitForFunction(() => (window as any).__kfm, null, { timeout: 120000 }); out.stages.push({ name: "boot", ms: Date.now() - t0 }); out.metrics.push(await metrics("boot"));
  await stage("terrain"); let t = Date.now();
  await page.evaluate(() => { const a = (window as any).__kfm; a.go(3); a.suggestRanges(); a.go(5); }); await page.waitForFunction(() => (window as any).__kfm.terrain, null, { timeout: 180000 }); out.stages.push({ name: "terrain", ms: Date.now() - t }); out.metrics.push(await metrics("terrain"));
  await page.evaluate(() => (window as any).__kfm.finalize()); await page.click("#btn-next");
  const cityPos = (n: string) => page.evaluate((x) => (window as any).__kfm.world.cities.find((c: any) => c.name === x).pos, n) as Promise<[number, number]>;
  const scr = (p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
  const draw = async (a: [number, number], b: [number, number]) => { const s = await scr(a), e = await scr(b); await page.mouse.move(s[0], s[1]); await page.mouse.down(); await page.mouse.move(e[0], e[1], { steps: 10 }); await page.mouse.up(); };
  const tokyo = await cityPos("東京"), nag = await cityPos("名古屋市");
  await page.click("#tool-cer-kokudo1"); await draw(tokyo, nag); await page.click("#tool-cer-fudo1");
  const far = await page.evaluate(() => { const w = (window as any).__kfm.world, tk = w.cities.find((c: any) => c.name === "東京"); let best: any = null, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-13") { const p = w.cellPos(k), d = Math.hypot(p[0] - tk.pos[0], p[1] - tk.pos[1]); if (d > bd) { bd = d; best = p; } } return best; });
  await draw(tokyo, far);
  await stage("ceremony"); t = Date.now(); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 120000 }); out.stages.push({ name: "ceremony(createSim)", ms: Date.now() - t }); out.metrics.push(await metrics("ceremony"));
  await stage("x20-60s"); await page.click("#speed-20"); t = Date.now(); const m0 = await page.evaluate(() => (window as any).__kfm.sim.month);
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(10000); out.metrics.push(await metrics(`x20+${(i + 1) * 10}s`)); }
  const m1 = await page.evaluate(() => (window as any).__kfm.sim.month); out.stages.push({ name: "x20 60s", ms: Date.now() - t, monthsAdvanced: m1 - m0 });
  await stage("ffYears40"); t = Date.now(); await page.click("#speed-0"); await page.evaluate(() => (window as any).__kfm.ffYears(40)); out.stages.push({ name: "ffYears(40)", ms: Date.now() - t }); out.metrics.push(await metrics("ff40"));
  await stage("save"); const sz = await page.evaluate(() => { const a = (window as any).__kfm; const t0 = performance.now(); const j = JSON.stringify({ map: a.s, sim: a.sim }); return { bytes: j.length, ms: Math.round(performance.now() - t0), edges: Object.keys(a.sim.edges).length, events: a.sim.events.length, snaps: a.sim.snaps.length }; }); out.save = sz;
  await stage("tap"); t = Date.now(); await page.click("#tool-why"); const spot = await page.evaluate(() => { const a = (window as any).__kfm, s = a.sim, w = a.world; const e = Object.values<any>(s.edges)[5]; return w.cellPos(e.cells[Math.floor(e.cells.length / 2)]); }); const sp = await scr(spot); await page.mouse.click(sp[0], sp[1]); out.stages.push({ name: "road tap", ms: Date.now() - t }); out.metrics.push(await metrics("tap"));
  out.longtasks = await page.evaluate(() => (window as any).__long); const by: Record<string, { n: number; max: number; total: number }> = {}; for (const l of out.longtasks) { const b = (by[l.stage] ??= { n: 0, max: 0, total: 0 }); b.n++; b.max = Math.max(b.max, l.d); b.total += l.d; } out.longByStage = by;
  fs.mkdirSync("test-results", { recursive: true }); fs.writeFileSync(`test-results/perf-cpu${CPU}.json`, JSON.stringify(out, null, 1)); console.log("PERF", JSON.stringify({ stages: out.stages, longByStage: out.longByStage, save: out.save, heap: out.metrics.map((m: any) => `${m.tag}:${m.jsHeapUsedMB}MB`) }));
});

/** Measurement harness for Stage 3 (not part of CI). CPU-throttled Chromium approximates a phone. Run: PERF=1 CPU=6 npx playwright test tests/e2e/perf3.spec.ts */
import { test } from "@playwright/test";
import fs from "node:fs";

test.skip(!process.env.PERF, "measurement only");
const CPU = Number(process.env.CPU ?? 6);
test("perf3: boot -> era -> ceremony -> x20 -> zoom/pan -> atlas -> save", async ({ page }) => {
  test.setTimeout(900000);
  await page.addInitScript(() => {
    (window as any).__long = []; (window as any).__stage = "boot";
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__long.push({ d: Math.round(e.duration), stage: (window as any).__stage }); }).observe({ type: "longtask", buffered: true }); } catch {}
  });
  const cdp = await page.context().newCDPSession(page); await cdp.send("Performance.enable"); await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const stage = (s: string) => page.evaluate((x) => ((window as any).__stage = x), s);
  const heap = async (tag: string) => { await cdp.send("HeapProfiler.collectGarbage"); return { tag, heapMB: await page.evaluate(() => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6)) }; };
  const out: any = { cpu: CPU, stages: [], heap: [] };
  let t = Date.now(); await page.goto("/"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 300000 }); out.stages.push({ name: "boot+terrain", ms: Date.now() - t }); out.heap.push(await heap("boot"));
  const cityPos = (n: string) => page.evaluate((x) => (window as any).__kfm.world.cities.find((c: any) => c.name === x).pos, n) as Promise<[number, number]>;
  const scr = (p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
  const draw = async (a: [number, number], b: [number, number]) => { const s = await scr(a), e = await scr(b); await page.mouse.move(s[0], s[1]); await page.mouse.down(); await page.mouse.move(e[0], e[1], { steps: 10 }); await page.mouse.up(); };
  await page.click("#setup-tab-era"); await page.click("#era-opt-0"); await page.click("#setup-close"); const tokyo = await cityPos("東京"), osk = await cityPos("大阪市");
  await page.click("#tool-cer-kokudo1"); await draw(tokyo, osk);
  await stage("ceremony"); t = Date.now(); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 300000 }); out.stages.push({ name: "ceremony(1950 network)", ms: Date.now() - t }); out.heap.push(await heap("ceremony"));
  await page.evaluate(() => { (window as any).__kfm.sim.policy.mode = "auto"; });
  await page.evaluate(() => {
    const a = (window as any).__kfm, P: Record<string, number[]> = (window as any).__prof = { render: [], pump: [], status: [], persist: [], rebuild: [] };
    const wrap = (o: any, k: string, name: string) => { const f = o[k]; o[k] = function (...args: any[]) { const t = performance.now(); const r = f.apply(this, args); P[name].push(performance.now() - t); return r; }; };
    wrap(a, "renderRoads", "render"); wrap(a.runner, "pump", "pump"); wrap(a, "status", "status"); wrap(a, "persist", "persist"); wrap(a.r, "rebuild", "rebuild");
  });
  await stage("x20-90s"); await page.click("#speed-20"); t = Date.now(); const m0 = await page.evaluate(() => (window as any).__kfm.sim.month);
  for (let i = 0; i < 9; i++) { await page.waitForTimeout(10000); out.heap.push(await heap(`x20+${(i + 1) * 10}s`)); }
  out.stages.push({ name: "x20 90s", ms: Date.now() - t, monthsAdvanced: (await page.evaluate(() => (window as any).__kfm.sim.month)) - m0 });
  await page.click("#speed-0"); await stage("pan-zoom");
  for (let i = 0; i < 6; i++) { await page.evaluate((k) => { const a = (window as any).__kfm; a.r.setView({ cx: 100 + k * 40, cy: -150 + k * 20, zoom: [0.3, 0.9, 1.6, 0.6, 2.2, 0.35][k] }); }, i); await page.waitForTimeout(1500); }
  out.heap.push(await heap("panzoom"));
  await stage("atlas"); for (const y of [1960, 1980, 2000, 1950]) { await page.evaluate((yy) => (window as any).__kfm.setViewYear(yy), y); await page.waitForTimeout(800); } await page.evaluate(() => (window as any).__kfm.setViewYear(null));
  out.heap.push(await heap("atlas"));
  await stage("sheets"); for (const s of ["timeline", "ledger", "atlas", "policy", "layers"]) { await page.evaluate((x) => (window as any).__kfm.openSheet(x), s); await page.waitForTimeout(500); }
  await stage("ff40"); t = Date.now(); await page.evaluate(() => (window as any).__kfm.ffYears(40)); out.stages.push({ name: "ffYears(40) sync", ms: Date.now() - t }); out.heap.push(await heap("ff40"));
  out.save = await page.evaluate(() => { const a = (window as any).__kfm; const t0 = performance.now(); const j = JSON.stringify({ map: a.s, sim: a.sim }); return { bytes: j.length, ms: Math.round(performance.now() - t0), year: 1950 + Math.floor(a.sim.month / 12), events: a.sim.events.length }; });
  const long = await page.evaluate(() => (window as any).__long) as { d: number; stage: string }[]; const by: Record<string, { n: number; max: number; total: number }> = {};
  for (const l of long) { const b = (by[l.stage] ??= { n: 0, max: 0, total: 0 }); b.n++; b.max = Math.max(b.max, l.d); b.total += l.d; }
  out.prof = await page.evaluate(() => Object.fromEntries(Object.entries((window as any).__prof as Record<string, number[]>).map(([k, v]) => [k, { n: v.length, max: Math.round(Math.max(0, ...v)), mean: Math.round(v.reduce((s, x) => s + x, 0) / (v.length || 1)), over100: v.filter((x) => x > 100).length }])));
  out.longBy = by; fs.mkdirSync("test-results", { recursive: true }); fs.writeFileSync(`test-results/perf3-cpu${CPU}.json`, JSON.stringify(out, null, 1));
  console.log("PERF3", JSON.stringify({ prof: out.prof, stages: out.stages, longBy: out.longBy, save: out.save, heap: out.heap.map((h: any) => `${h.tag}:${h.heapMB}`).join(" ") }));
});

/** Start: a plain on Hokkaido far from every city is the capital (set up by touch on the map), 函館 the sub-capital; then 10 / 30 years of play. */
import { expect, test, type Page } from "@playwright/test";
test.use({ hasTouch: true });
async function tap(page: Page, sel: string) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const b = (await el.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
const screenOf = (page: Page, p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
test("Stage 38 (C): a capital put on a plain with no city grows a metropolis, satellite towns and roads of its own, with no railway before its time, and the terrain is untouched", async ({ page }) => {
  test.setTimeout(900000); await page.setViewportSize({ width: 412, height: 915 }); page.on("dialog", (d) => void d.accept());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  const kfm = (f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
  const spot: any = await kfm("a => { const w = a.world; let best = -1, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.t.island[k] === 2 && w.t.plains[k] === 1) { const p = w.cellPos(k); let d = 1e9; for (const c of w.cities) d = Math.min(d, Math.hypot(c.pos[0] - p[0], c.pos[1] - p[1])); if (d > bd) { bd = d; best = k; } } return { pos: w.cellPos(best), pref: w.prefOf(best), bd }; }");
  await page.evaluate(() => (window as any).__kfm.wizGo(2));
  await tap(page, "#setup-tab-capital"); await tap(page, "#pref-map");
  await page.evaluate((q) => (window as any).__kfm.r.setView({ cx: q[0], cy: q[1], zoom: 2 }, true), spot.pos);
  const [sx, sy] = await screenOf(page, spot.pos); await page.touchscreen.tap(sx, sy); await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 10000 });
  await tap(page, "#seat-confirm"); console.log("C38 seats", JSON.stringify(await kfm("a => ({ cap: a.s.capital, pos: a.s.capitalPos, sub: a.s.subCapital })")));
  const hak = (await kfm("a => a.world.cities.find((c) => c.name === '函館市').pos")) as [number, number];
  await tap(page, "#setup-tab-sub"); await tap(page, "#pref-map"); await page.evaluate((q) => (window as any).__kfm.r.setView({ cx: q[0], cy: q[1], zoom: 2 }, true), hak);
  { const [x, y] = await screenOf(page, hak); await page.touchscreen.tap(x, y); await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 10000 }); await tap(page, "#seat-confirm"); }
  console.log("C38 seats", JSON.stringify(await kfm("a => ({ cap: a.s.capital, sub: a.s.subCapital })")));
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const cap = await kfm("a => { const c = a.world.cities.find((x) => x.kind === 'capital' && x.pref === a.s.capital); return c.pos; }") as [number, number];
  await page.evaluate((q) => (window as any).__kfm.r.setView({ cx: (q[0] + q[2]) / 2, cy: (q[1] + q[3]) / 2, zoom: 1.2 }, true), [cap[0], cap[1], hak[0], hak[1]]);
  const A = await screenOf(page, cap), B = await screenOf(page, hak); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm("a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  const probe = "a => { const c = a.world.cities.find((x) => x.kind === 'capital' && x.pref === a.s.capital), M = a.sim.metro?.list.find((m) => m.core === c.id || m.members.includes(c.id)); return { id: c.id, pop: a.sim.cities[c.id].pop, metroKm2: M?.areaKm2 ?? 0, metroPop: M?.pop ?? 0, sats: Object.values(a.sim.settlements).filter((v) => v.city === c.id && !v.gone && (/近郊/.test(v.name) || !!v.origin)).length, rail: Object.values(a.sim.edges).filter((e) => e.mode === 'rail' && e.built >= 1).length, land: a.world.t.land.reduce((x, y) => x + y, 0), year: 1800 + Math.floor(a.sim.month / 12), pos: c.pos }; }";
  const p0: any = await kfm(probe);
  await kfm("a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(10); return 1; }"); const p10: any = await kfm(probe);
  await kfm("a => { a.ffYears(20); return 1; }"); const p30: any = await kfm(probe);
  console.log("C38", JSON.stringify({ p0, p10, p30 }));
  expect(p30.pop).toBeGreaterThan(p0.pop * 1.2);                 // the city grew on its own site
  expect(p30.sats).toBeGreaterThanOrEqual(3);                    // with satellite towns round it
  expect(p30.metroKm2).toBeGreaterThan(p10.metroKm2 * 0.9); expect(p30.metroKm2).toBeGreaterThan(50);   // and a metropolitan area that is drawn
  expect(p30.rail).toBe(0);                                       // 1800s: no railway
  expect(p30.land).toBeLessThanOrEqual(p0.land + 80);             // nothing was done to the land (only a small island under a seat may grow)
  await page.evaluate((q) => { const a = (window as any).__kfm; a.setBg?.("roadmap"); a.r.setView({ cx: q[0], cy: q[1], zoom: 2.2 }, true); a.render(); }, p30.pos); await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/shots/c38-final.png", clip: { x: 0, y: 200, width: 412, height: 450 } });
});

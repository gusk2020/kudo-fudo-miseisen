/** The phone failure: a slot saved in 2010 (20 reclaimed cells) loaded after the page was reopened on an older state (no cells) came back as a map without its roads (道路が地形の外にあります). */
import { expect, test } from "@playwright/test";
test("Stage 38 (A): a manual save made LATER than the game on screen loads whole (the world is built from the loaded game's own land log)", async ({ page }) => {
  test.setTimeout(900000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const kfm = (f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
  const pos = (n: string) => kfm(`a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p: any) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A: any = await scr(await pos("東京")), B: any = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm("a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  const st = () => kfm("a => ({ y: 1800 + Math.floor(a.sim.month / 12), log: a.sim.rec34?.log.length, sites: a.sim.rec34?.sites.length, land: a.world.t.land.reduce((x, y) => x + y, 0) })");
  await kfm("a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(150); return 1; }"); await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); console.log("A38 auto saved at", JSON.stringify(await st()));
  await kfm("a => { a.ffYears(60); return 1; }");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = null; a.openSheet("menu"); }); await page.waitForSelector("#slot-1 .slot-save"); await page.click("#slot-1 .slot-save"); await page.waitForTimeout(2500); console.log("A38 slot saved at", JSON.stringify(await st()));
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 120000 }); await page.waitForTimeout(2000); console.log("A38 after reload", JSON.stringify(await st()));
  const before: any = await kfm("a => ({ routes: Object.keys(a.sim.routes).length })");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = null; a.openSheet("menu"); }); await page.waitForSelector("#slot-1 .slot-load"); await page.click("#slot-1 .slot-load"); await page.waitForTimeout(8000);
  const after: any = await kfm("a => ({ sim: !!a.sim, y: a.sim ? 1800 + Math.floor(a.sim.month / 12) : null, routes: a.sim ? Object.keys(a.sim.routes).length : 0, step: a.s.step, locked: a.saveLocked, toast: document.querySelector('#toast, .toast')?.textContent })");
  expect(after.sim).toBe(true); expect(after.y).toBe(2010); expect(after.locked).toBe(false); expect(after.toast ?? "").not.toMatch(/退避|読み込めませんでした/); expect(after.routes).toBeGreaterThan(before.routes); expect(errs).toEqual([]);
});

/** Issue #88-4: the decade mode (10年⏩) on a Pixel 7-size screen (Chromium emulation with software GL: the speed measured here says nothing about a real Pixel 7a). */
import { expect, test, type Page } from "@playwright/test";
test.use({ actionTimeout: 20000 });
const kfm = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
test("Issue #88-4: 10年⏩ runs the same months faster, stops where the player must decide, goes on after the choice, and is switched off by any other speed", async ({ page }) => {
  test.setTimeout(900000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const pos = (n: string) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`) as Promise<[number, number]>, scr = (p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
  await kfm(page, "a => a.wizGo(3)"); await page.click("#tool-cer-kokudo1"); { const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up(); }
  await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  const year = () => kfm(page, "a => a.sim.startYear + Math.floor(a.sim.month / 12)") as Promise<number>;
  // priority mode: the decade mode stops at the first policy window (1810) and waits
  await kfm(page, "a => { a.sim.policy.mode = 'priority'; return 1; }"); await page.click("#speed-turbo"); expect(await page.getAttribute("#speed-turbo", "aria-pressed")).toBe("true"); expect(await page.getAttribute("#speed-20", "aria-pressed"), "only one speed is shown as chosen").not.toBe("true");
  await page.waitForFunction(() => (window as any).__kfm.sim.policy.pending, null, { timeout: 240000 }); expect(await year()).toBe(1810); const m = await kfm(page, "a => a.sim.month"); await page.waitForTimeout(1200); expect(await kfm(page, "a => a.sim.month"), "time stands still at the window").toBe(m);
  await page.waitForSelector("#pol-window"); await page.click("#pol-none"); await page.waitForFunction((m0) => (window as any).__kfm.sim.month > (m0 as number) + 6, m, { timeout: 120000 }); expect(await kfm(page, "a => a.turbo"), "it goes on by itself after the choice").toBe(true);
  // automatic: measure, and nothing is skipped (every policy window of the decades passed is on record)
  await kfm(page, "a => { a.sim.policy.mode = 'auto'; a.sim.policy.pending = null; a.openSheet(null); return 1; }"); const y0 = await year(), t0 = Date.now(); await page.waitForFunction((y) => { const s = (window as any).__kfm.sim; return s.startYear + Math.floor(s.month / 12) >= (y as number) + 40; }, y0, { timeout: 600000 }); const secs = (Date.now() - t0) / 1000, y1 = await year();
  console.log(`T88 decade mode: ${y1 - y0} years in ${secs.toFixed(1)} s = ${((y1 - y0) / secs).toFixed(1)} years/s (software GL; x20 is 0.33 years/s)`); expect((y1 - y0) / secs, "faster than x20 (1 year per 3 s)").toBeGreaterThan(0.6);
  const wins = (await kfm(page, "a => a.sim.policy.history.map((h) => h.year)")) as number[]; for (let y = Math.ceil((y0 + 1) / 10) * 10; y <= y1 - 1; y += 10) expect(wins, `the policy window of ${y} was held`).toContain(y);
  expect(await kfm(page, "a => a.sim.kaigen.eras.length"), "era changes happened on the way").toBeGreaterThan(1);
  await page.click("#speed-0"); expect(await kfm(page, "a => [a.turbo, a.sim.speed]")).toEqual([false, 0]); const mm = await kfm(page, "a => { a.runner.settle(); return a.sim.month; }"); await page.waitForTimeout(800); expect(await kfm(page, "a => a.sim.month")).toBe(mm); expect(errs).toEqual([]);
});

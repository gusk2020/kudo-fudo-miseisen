/** Stage 37 (A3/A4): the technology filter of the timeline and the technology block of the atlas -- also after years of play and after a reload. */
import { expect, test } from "@playwright/test";
test("技術・架空史 filter and the atlas 技術 block, on a Pixel 7a-size screen, after play and after reload", async ({ page }) => {
  test.setTimeout(300000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const kfm = (f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
  const pos = (n: string) => kfm(`a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p: any) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A: any = await scr(await pos("東京")), B: any = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm("a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  const check = async (minRows: number, label: string) => {
    await page.click("#dock-timeline"); await page.waitForSelector("#tl-tech"); await page.click("#tl-tech"); await page.waitForTimeout(300);
    expect(await page.getAttribute("#tl-tech", "aria-pressed"), label).toBe("true"); const rows = await page.locator("#sheet .issue").count(); expect(rows, label).toBeGreaterThanOrEqual(minRows);
    expect(await page.locator("#sheet .issue", { hasText: "架空" }).count(), label).toBeGreaterThan(0); await page.click("#tl-all"); expect(await page.locator("#sheet .issue").count(), label).toBeGreaterThan(rows - 1); await page.click("#sheet-close");
    await page.click("#dock-atlas"); await page.waitForSelector("#atlas-tech"); expect(await page.textContent("#atlas-tech"), label).toContain("技術"); expect(await page.textContent("#atlas-tech-鉄道"), label).toBeTruthy(); await page.click("#sheet-close");
  };
  await check(2, "at the start");
  await kfm("a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(60); return 1; }"); await check(6, "after 60 years");
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 120000 }); await page.waitForTimeout(1500);
  await check(6, "after a reload"); expect(errs).toEqual([]);
});

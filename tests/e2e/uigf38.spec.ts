/** Stage 38 (F, G): 「なぜ?」 moved from the basic display into the 台帳; the three operation buttons of the save panel moved from its bottom to its top. Pixel 7a-size screen, by touch-sized taps. */
import { expect, test } from "@playwright/test";
test.use({ hasTouch: true });
test("なぜ? is in the 台帳 (not the basic display) and the save panel's three buttons are at its top", async ({ page }) => {
  test.setTimeout(300000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.dismiss());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const kfm = (f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
  const pos = (n: string) => kfm(`a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p: any) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A: any = await scr(await pos("東京")), B: any = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm("a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  await kfm("a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(12); return 1; }");
  // F: not in the basic display ...
  expect(await page.locator("#tool-why").count()).toBe(0);
  // ... but in the 台帳, once
  await page.click("#dock-ledger"); await page.waitForSelector("#tool-why"); expect(await page.locator("#tool-why").count()).toBe(1); expect(await page.locator("#sheet #why-row #tool-why").count()).toBe(1);
  const box = (await page.locator("#tool-why").boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(30); expect(box.y + box.height).toBeLessThan(915);
  await page.click("#tool-why"); await page.waitForSelector("#why-hint"); expect(await page.getAttribute("#why-hint #why-stop", "aria-pressed") ?? "x").toBeTruthy();   // the sheet is put away, the state is shown
  expect(await kfm("a => a.sheet")).toBeNull();
  const spot = await page.evaluate(() => { const a = (window as any).__kfm, s = a.sim, w = a.world; const e = Object.values<any>(s.edges).filter((x) => x.hist.length >= 2 && x.state !== "lost").sort((p: any, q: any) => q.hist.length - p.hist.length)[0]; const k = e.cells[Math.floor(e.cells.length / 2)]; return { id: e.id, pos: w.cellPos(k) }; });
  const sp: any = await scr(spot.pos); await page.touchscreen.tap(sp[0], sp[1]);
  await page.waitForSelector("#why-designation", { timeout: 10000 }); expect(await page.textContent("#sheet")).toContain("行政指定");
  await page.click("#sheet-close"); await page.click("#why-stop"); expect(await page.locator("#why-hint").count()).toBe(0);
  // G: the save panel
  await page.click("#dock-menu"); await page.waitForSelector("#slot-1");
  const order = await page.evaluate(() => { const ids = ["export", "restart-roads", "reset", "slot-1", "slot-5"], y = (id: string) => document.getElementById(id)!.getBoundingClientRect().top, o: Record<string, number> = {}; for (const id of ids) o[id] = y(id); return { o, ops: [...document.querySelectorAll("#menu-ops button, #menu-ops label")].map((b) => (b.id || "") + ":" + (b.textContent ?? "").trim()), count: ["export", "restart-roads", "reset"].map((id) => document.querySelectorAll("#" + id).length) }; });
  expect(order.count).toEqual([1, 1, 1]); expect(order.o.export).toBeLessThan(order.o["slot-1"]); expect(order.o["restart-roads"]).toBeLessThan(order.o["slot-1"]); expect(order.o.reset).toBeLessThan(order.o["slot-1"]);
  expect(order.o.export).toBeLessThan(order.o["restart-roads"]); expect(order.o["restart-roads"]).toBeLessThan(order.o.reset);   // the order of the three is what it was
  expect(order.ops.join("|")).toContain("JSONエクスポート"); expect(order.ops.join("|")).toContain("道路だけやり直す"); expect(order.ops.join("|")).toContain("最初からやり直す");
  // the slots still save and load
  await page.click("#slot-1 .slot-save"); await page.waitForTimeout(1500); await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = null; a.openSheet("menu"); }); await page.waitForSelector("#slot-1 .slot-load:not([disabled])");
  expect(errs).toEqual([]);
});

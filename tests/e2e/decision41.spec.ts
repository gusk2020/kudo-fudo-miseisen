/**
 * Stage 41: 判断直前のセーブ in the real app (Chromium emulation of a Pixel 7-size screen, NOT a Pixel 7a). A new 1800 game in 常に自動: an era change and policy windows are decided by the game itself and each leaves a save point
 * with the decision still open. One is loaded from the 自動セーブポイント list with the real button: the game waits at the decision (the automatic mode held back), and once it is made the automatic mode comes back.
 */
import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 20000 });
const kfm = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
async function newGame(page: Page) {
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const pos = (n: string) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p: any) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A: any = await scr(await pos("東京")), B: any = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
}
test("Issue Stage 41: decision save points are written by a game that decides by itself, and loading one brings the decision back", async ({ page }) => {
  test.setTimeout(900000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  await newGame(page); await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(25); return 1; }"); await page.waitForTimeout(3000);
  const y = (await kfm(page, "a => 1800 + Math.floor(a.sim.month / 12)")) as number; console.log("D41 year after the fast-forward", y);
  await kfm(page, "a => { a.sheet = null; a.openSheet('menu'); return 1; }"); await page.waitForSelector("#cp-title"); await page.waitForTimeout(500);
  const rows: string[] = await page.$$eval(".cp-row .slot-text", (els) => els.map((e) => e.textContent ?? "")); console.log("D41 save points listed:\n" + rows.join("\n"));
  const dec = rows.filter((t) => t.includes("判断直前")); expect(dec.length, "decision save points are listed").toBeGreaterThan(0); expect(dec.length, "only the newest few are kept").toBeLessThanOrEqual(3);
  const ids: string[] = await page.$$eval(".cp-row", (els) => els.filter((e) => (e.textContent ?? "").includes("判断直前")).map((e) => e.id)); const target = ids[ids.length - 1];   // the oldest kept one
  await page.click(`#${target} .cp-load`); await page.waitForFunction(() => { const a = (window as any).__kfm; return !!a.sim && a.sim.resumeMode === "auto"; }, null, { timeout: 60000 });
  const st: any = await kfm(page, "a => ({ mode: a.sim.policy.mode, resume: a.sim.resumeMode, pol: !!a.sim.policy.pending, kai: !!a.sim.kaigen && !!a.sim.kaigen.pending, reloc: a.relocOpen(), year: 1800 + Math.floor(a.sim.month / 12) })"); console.log("D41 after loading", JSON.stringify(st));
  expect(st.mode, "the automatic mode is held back while the decision is open").toBe("priority"); expect(st.pol || st.kai || st.reloc, "a decision is open").toBe(true);
  const m0 = (await kfm(page, "a => a.sim.month")) as number; await page.waitForTimeout(2500); expect((await kfm(page, "a => a.sim.month")) as number, "the clock does not run past the open decision").toBe(m0);
  // make the decision (the player's own choice through the app's own function), then the automatic mode returns
  await kfm(page, "a => { if (a.sim.kaigen && a.sim.kaigen.pending) a.chooseKaigen(0); else if (a.sim.policy.pending) a.sim.policy.pending = null; return 1; }");
  await kfm(page, "a => { a.sim.speed = 1; return 1; }"); await page.waitForFunction(() => { const a = (window as any).__kfm; return a.sim.resumeMode === undefined && a.sim.policy.mode === 'auto'; }, null, { timeout: 60000 });
  expect(errs, "no page errors").toEqual([]);
});

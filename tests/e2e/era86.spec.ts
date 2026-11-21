/** Issue #86 on a Pixel 7-size screen (Chromium emulation, not the phone): the first era's name and the policy are chosen apart; at an ordinary era change a forbidden name stays listed but cannot be chosen, and any policy goes with any name. */
import { expect, test, type Page } from "@playwright/test";
test.use({ actionTimeout: 20000 });
const kfm = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
test("Issue #86: name and policy apart at the start and at an era change", async ({ page }) => {
  test.setTimeout(600000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await kfm(page, "a => a.wizGo(1)"); await page.waitForSelector("#e86-name"); expect(await page.locator("#e86-name button").count()).toBe(5); expect(await page.textContent("#e86-name")).toContain("大正時候補");
  { const b = (await page.locator("#setup-panel").boundingBox())!; expect(b.x + b.width, "the panel fits the screen").toBeLessThanOrEqual(413); }
  await page.click("#e86-name-2"); await page.click("#e86-stance-kuuro"); await page.click("#e86-focus-disperse"); await page.click("#e86-coast-japansea"); expect(await page.textContent("#era-now")).toContain("永安"); expect(await page.textContent("#era-now")).toContain("空路重視");
  const pos = (n: string) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`) as Promise<[number, number]>, scr = (p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
  await kfm(page, "a => a.wizGo(3)"); await page.click("#tool-cer-kokudo1"); { const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up(); }
  await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  expect(await kfm(page, "a => [a.sim.kaigen.era86, a.sim.kaigen.eras[0].name, a.sim.kaigen.eras[0].stance, a.sim.kaigen.eras[0].yomi, a.sim.kaigen.recon.coast, a.sim.kaigen.recon.focus]")).toEqual([true, "永安", "kuuro", "えいあん", "japansea", "disperse"]);
  expect(await page.textContent("#status")).toContain("方針(初期/現在) 空路/空路");   // (Stage 43: the policy line, short words)
  // an ordinary era change, by hand: make the next one come now, with a name whose first kanji repeats (it must be listed and disabled)
  await kfm(page, "a => { const s = a.sim; a.runner.settle(); s.policy.mode = 'priority'; s.policy.pending = null; s.kaigen.next = 1803; s.month = 35; s.speed = 20; return 1; }"); await page.waitForFunction(() => (window as any).__kfm.sim.kaigen.pending, null, { timeout: 60000 }); await page.waitForSelector("#kaigen-go");
  const cands: any[] = (await kfm(page, "a => a.sim.kaigen.pending.cands")) as any[]; console.log("E86 candidates:", cands.map((c) => `${c.name}(${c.yomi})${c.blocked ? "✕" + c.mark : ""}`).join(" ")); expect(cands.filter((c) => !c.blocked).length).toBeGreaterThanOrEqual(3);
  const blocked = cands.findIndex((c) => c.blocked); if (blocked >= 0) { expect(await page.isDisabled("#kaigen-" + blocked), "a forbidden name is listed but cannot be chosen").toBe(true); expect(await page.textContent("#kaigen-" + blocked)).toContain("選べません"); }
  const ok = cands.map((c, i) => i).filter((i) => !cands[i].blocked)[1]; await page.click("#kaigen-" + ok); await page.click("#kaigen-stance-shoka"); await page.click("#kaigen-go"); await page.waitForTimeout(300);
  expect(await kfm(page, "a => { const e = a.sim.kaigen.eras.at(-1); return [a.sim.kaigen.pending, e.name, e.stance, !!e.yomi]; }")).toEqual([null, cands[ok].name, "shoka", true]);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 120000 }); expect(await kfm(page, "a => a.sim.kaigen.eras.map((e) => e.name + ':' + e.stance)")).toEqual(["永安:kuuro", cands[ok].name + ":shoka"]); expect(errs).toEqual([]);
});

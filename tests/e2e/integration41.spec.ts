/**
 * Stage 41 integration (Chromium emulation of a Pixel 7-size screen, NOT a real Pixel 7a): ONE 1800-start game goes through everything this stage added, in the order a player meets it --
 * night view dark at the start, the simple intervention at a policy window, a relocation at 1900 that builds 国道0号, a long automatic run to 2000+, the night view lit, a second relocation that builds A号 (the next symbol),
 * then a reload: the game (special routes, simple answers, policy line) is all there and still runs.
 */
import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 20000 });
const kfm = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const pos = (page: Page, n: string) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`) as Promise<[number, number]>, scr = (page: Page, p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
async function drawLine(page: Page, from: string, to: string) { const a = await pos(page, from), b = await pos(page, to); await page.evaluate(([p, q]) => (window as any).__kfm.r.setView({ cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2, zoom: 0.9 }), [a, b] as const); await page.waitForTimeout(400); const A = await scr(page, a), B = await scr(page, b); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 16 }); await page.mouse.up(); }
async function newGame(page: Page) {
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1"); await drawLine(page, "東京", "大阪市");
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
}
const warm = (page: Page) => page.evaluate(() => { const a = (window as any).__kfm; a.r.fit(a.s); a.updateNight?.(); a.r.app.renderer.render(a.r.app.stage); const c = document.querySelector("#stage canvas") as HTMLCanvasElement, t = document.createElement("canvas"); t.width = 160; t.height = 240; const g = t.getContext("2d")!; g.drawImage(c, 0, 0, 160, 240); const d = g.getImageData(0, 0, 160, 240).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i] > d[i + 2] + 40) n++; return n; });
/** the relocation wizard up to the road stage, keeping the seats */
async function toRoadStage(page: Page, year: number) {
  await kfm(page, `a => { const s = a.sim; a.runner.settle(); s.policy.pending = null; s.kaigen.pending = null; s.kaigen.next = ${year} + 40; s.policy.mode = 'priority'; s.month = (${year} - s.startYear) * 12; s.speed = 20; return 1; }`);
  await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "pending", null, { timeout: 120000 }); await page.waitForSelector("#e22-box");
  await page.click("#e22-era-1"); await page.click("#e22-next"); await page.click("#e22-decide"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "road0", null, { timeout: 60000 }); await page.waitForSelector("#sp-row");
}
test("Stage 41 integration: 1800 start -> dark night -> simple intervention -> 国道0号 (1900) -> lit night (2000) -> A号 (2000) -> reload", async ({ page }) => {
  test.setTimeout(1500000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  await newGame(page); expect(await kfm(page, "a => [a.sim.startYear, a.sim.special41, a.sim.relocFirst]")).toEqual([1800, true, 1900]);
  // night at 1800: dark, no lights
  await kfm(page, "a => { a.sim.speed = 0; a.runner.settle(); a.setNight(true); return 1; }"); await page.waitForTimeout(400); const w1800 = await warm(page); console.log("I41 warm px at 1800:", w1800); expect(w1800, "1800 is dark").toBeLessThan(3); await kfm(page, "a => { a.setNight(false); return 1; }");
  // the first policy window (1810), by the simple mode, kept for the automatic modes
  await kfm(page, "a => { const s = a.sim; s.policy.mode = 'priority'; s.month = 10 * 12 - 1; s.speed = 20; a.acc = 0; return 1; }"); await page.waitForFunction(() => (window as any).__kfm.sim.policy.pending, null, { timeout: 90000 }); await page.waitForSelector("#pol-window");
  await page.click("#pol-simple"); await page.click("#sx-transport-road"); await page.click("#sx-city-concentrate"); await page.check("#sx-keep"); await page.click("#sx-go"); await page.waitForTimeout(300);
  expect(await kfm(page, "a => [a.sim.policy.pending, a.sim.simple41.transport, a.sim.simple41.keep]")).toEqual([null, "road", true]); await kfm(page, "a => { a.openSheet(null); return 1; }");
  // automatic to 1899 (the kept answers decide the windows on the way), then the relocation of 1900 by hand: 国道0号
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'autoReloc'; a.ffYears(88); a.runner.settle(); return 1; }"); const y1 = (await kfm(page, "a => 1800 + Math.floor(a.sim.month / 12)")) as number; console.log("I41 year before the first relocation:", y1); expect(y1).toBeLessThan(1900);
  expect(await kfm(page, "a => a.sim.policy.history.some((h) => h.auto && h.adopted.some((x) => x.id === 'p-road'))"), "an automatic window used the kept simple answer").toBe(true);
  await toRoadStage(page, 1900); expect(await page.textContent("#sp-new")).toContain("国道0号"); await page.click("#tool-cer-kokudo0").catch(() => {}); await drawLine(page, "東京", "大阪市"); await page.waitForSelector("#cer-status-kokudo0"); const s0 = (await page.textContent("#cer-status-kokudo0"))!; console.log("I41 0号:", s0); expect(s0).toContain("✓");
  await page.click("#rw-review"); await page.click("#rw-confirm"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "done", null, { timeout: 60000 });
  expect(await kfm(page, "a => Object.values(a.sim.routes).filter((r) => r.grade === 'national' && r.scope === 'JP' && r.number === 0).map((r) => [r.special ?? null, r.gen ?? null])")).toEqual([[null, null]]);
  // automatic to 1999: the night is lit
  await kfm(page, "a => { const s = a.sim; s.speed = 0; s.policy.pending = null; s.policy.mode = 'autoReloc'; a.openSheet(null); a.ffYears(99 - (Math.floor(s.month / 12) - 100)); a.runner.settle(); return 1; }"); const y2 = (await kfm(page, "a => 1800 + Math.floor(a.sim.month / 12)")) as number; console.log("I41 year before the second relocation:", y2); expect(y2).toBeGreaterThan(1990); expect(y2).toBeLessThan(2000);
  await kfm(page, "a => { a.setNight(true); return 1; }"); await page.waitForTimeout(500); const w2000 = await warm(page); console.log("I41 warm px near 2000:", w2000); expect(w2000, "by 2000 the country is lit").toBeGreaterThan(40); await kfm(page, "a => { a.setNight(false); return 1; }");
  // the relocation of 2000: the next symbol is A号
  await toRoadStage(page, 2000); expect(await page.textContent("#sp-new")).toContain("A号"); expect(await page.locator("#sp-ext-1").count(), "国道0号 can be extended instead").toBe(1);
  await page.click("#tool-cer-kokudo0").catch(() => {}); await drawLine(page, "東京", "大阪市"); await page.waitForSelector("#cer-status-kokudo0"); const sA = (await page.textContent("#cer-status-kokudo0"))!; console.log("I41 A号:", sA); expect(sA).toContain("✓"); expect(sA).toContain("A号");
  await page.click("#rw-review"); await page.click("#rw-confirm"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "done", null, { timeout: 60000 });
  const sp = (await kfm(page, "a => Object.values(a.sim.routes).filter((r) => r.special).map((r) => [r.special, r.gen, r.active])")) as unknown[]; expect(sp).toEqual([["A", 2000, true]]);
  expect(await page.textContent("#status")).toContain("現在の方針");
  // save and reload: everything is there, and time still runs
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 120000 });
  expect(await kfm(page, "a => [a.sim.special41, a.sim.simple41.keep, Object.values(a.sim.routes).filter((r) => r.special).map((r) => r.special).join(), a.saveLocked ?? false]")).toEqual([true, true, "A", false]);
  console.log("I41 after reload:", JSON.stringify(await kfm(page, "a => ({ pol: a.sim.policy.pending, kai: !!a.sim.kaigen.pending, e22: a.sim.e2200?.state, safe: a.safeMode, speed: a.sim.speed, cer: a.sim.ceremonyDone, step: a.s.step })")));
  // (a policy window waiting for the player after the reload is answered with the simple mode's own button -- the same as a player would)
  if (await kfm(page, "a => !!a.sim.policy.pending")) { await page.waitForSelector("#pol-window"); if (await page.locator("#sx-go").count() === 0) await page.click("#pol-simple"); await page.click("#sx-go"); await page.waitForTimeout(300); expect(await kfm(page, "a => a.sim.policy.pending")).toBeNull(); }
  const m = (await kfm(page, "a => { a.openSheet(null); a.sim.policy.mode = 'auto'; a.sim.speed = 20; return a.sim.month; }")) as number; await page.waitForFunction((m0) => (window as any).__kfm.sim.month > (m0 as number) + 2, m, { timeout: 120000 });
  expect(errs).toEqual([]);
});

/** Stage 36 M3: two sub-capitals by touch on a Pixel 7-sized screen (emulator, not the phone). */
import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 20000 });
const app = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
async function tap(page: Page, sel: string) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const b = (await el.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }

test("setup: 副首都を2か所にし、2つ目を地図で選び、1か所に戻せる。1か所のときは従来どおり", async ({ page }) => {
  test.setTimeout(240000); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); await page.evaluate(() => (window as any).__kfm.wizGo(2));
  // one sub-capital: no second tab
  await tap(page, "#setup-tab-sub"); expect(await page.isVisible("#sub-count-1")).toBe(true); expect(await page.locator("#setup-tab-sub2").count()).toBe(0);
  await tap(page, "#sub-count-2"); expect(await app(page, "a => a.s.subCapital2")).toBeTruthy(); expect(await page.locator("#setup-tab-sub2").count()).toBe(1);
  // the second sub-capital on the map: Fukuoka
  const fk = await page.evaluate(() => (window as any).__kfm.world.cities.find((c: any) => c.name === "福岡市").pos) as [number, number];
  await tap(page, "#setup-tab-sub2"); await tap(page, "#pref-map"); await page.evaluate((q) => (window as any).__kfm.r.setView({ cx: q[0], cy: q[1], zoom: 2 }, true), fk);
  const [sx, sy] = await page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), fk) as [number, number]; await page.touchscreen.tap(sx, sy);
  await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 10000 }); await tap(page, "#seat-confirm");
  expect(await app(page, "a => [a.s.subCapital2, !!a.s.subPos2]")).toEqual(["JP-40", true]);
  // back to one
  await tap(page, "#setup-tab-sub"); await tap(page, "#sub-count-1"); expect(await app(page, "a => a.s.subCapital2 ?? null")).toBeNull(); expect(await page.locator("#setup-tab-sub2").count()).toBe(0);
  expect(errs).toEqual([]);
});

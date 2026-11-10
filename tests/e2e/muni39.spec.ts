/** Stage 39 (B/C/E): after a range is worn flat in the app, the world holds towns founded on it (named from the highest peak, at fixed cells), no existing city moves, and the page stays healthy on a Pixel 7a-size screen. */
import { expect, test } from "@playwright/test";
test("山脈を平らにすると、最高峰の名を持つ町が加わり、既存の市は動かない", async ({ page }) => {
  test.setTimeout(300000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro&start=1950"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForTimeout(300);
  const before = await page.evaluate(() => (window as any).__kfm.world.cities.map((c: any) => [c.id, c.cell, Boolean(c.zone)]));
  expect(before.some((c: any[]) => c[2])).toBe(false);
  await page.evaluate(() => (window as any).__kfm.setRangeFactor("hida", 0)); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  await page.waitForFunction(() => (window as any).__kfm.world?.cities.some((c: any) => c.zone), null, { timeout: 90000 });
  const after = await page.evaluate(() => (window as any).__kfm.world.cities.map((c: any) => [c.id, c.cell, c.name, c.zone?.range ?? null, c.kind]));
  const zone = after.filter((c: any[]) => c[3]); expect(zone.length).toBeGreaterThan(0);
  for (const z of zone) { expect(z[3]).toBe("hida"); expect(z[2]).toMatch(/奥穂高/); expect(z[4]).toBe("city"); }
  expect(new Set(zone.map((z: any[]) => z[2])).size).toBe(zone.length);
  const was = new Map(before.map((c: any[]) => [c[0], c[1]])); let kept = 0; for (const c of after) { if (c[3]) continue; if (was.has(c[0])) { kept++; expect(c[1], c[0]).toBe(was.get(c[0])); } }
  expect(kept).toBeGreaterThan(50);
  expect((await page.screenshot()).length).toBeGreaterThan(5000); expect(errs).toEqual([]);
});

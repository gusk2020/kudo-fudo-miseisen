/** Stage 38 (D): open-ocean islands (Kurils, Ogasawara, the Ryukyus ...) are marked by a ring on a small-scale map; the rings fade out as the islands' own outlines grow, and the Inland Sea gets none. */
import { expect, test } from "@playwright/test";
test("open-ocean island rings: many on the nationwide view, none on the Inland Sea, none once zoomed far in", async ({ page }) => {
  test.setTimeout(200000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const at = (lon: number, lat: number, z: number) => page.evaluate(([lo, la, zz]) => { const a = (window as any).__kfm, p = (window as any).__lakes.toReal(lo, la); a.r.setView({ cx: p[0], cy: p[1], zoom: zz }, true); a.r.rebuild(); return a.r.outerMarkersInView as number; }, [lon, lat, z]);
  const national = await page.evaluate(() => (window as any).__kfm.r.outerMarkersInView as number); expect(national).toBeGreaterThanOrEqual(15);
  expect(await at(133.0, 34.2, 0.9)).toBe(0);                    // the Seto Inland Sea: no ring on its islands
  const wide = await at(127.5, 26.5, 0.5), close = await at(127.7, 26.3, 2.5), tight = await at(127.68, 26.21, 12);
  expect(wide).toBeGreaterThan(close); expect(close).toBeGreaterThanOrEqual(0); expect(tight).toBe(0);   // rings give way to the real shapes
  expect(await at(142.2, 27.1, 0.8)).toBeGreaterThan(0);          // Ogasawara at a small scale
  expect(errs).toEqual([]);
});

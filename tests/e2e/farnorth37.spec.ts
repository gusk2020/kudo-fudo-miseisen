/** Stage 37 (A2): 樺太 and the northern Kurils are drawn on the nationwide view of a Pixel 7a-sized screen. */
import { expect, test } from "@playwright/test";
test("the nationwide view shows 南樺太 and the northern Kurils, inside the screen", async ({ page }) => {
  test.setTimeout(200000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const a = (window as any).__kfm, v = a.r.view, { w, h } = a.r.size, K = a.world.cities.find((c: any) => c.island === "karafuto") ?? a.world.cities.find((c: any) => c.name === "豊原");
    const scr = (p: number[]) => [w / 2 + (p[0] - v.cx) * v.zoom, h / 2 - (p[1] - v.cy) * v.zoom]; const k = scr(K.pos);
    return { far: a.r.farLandDrawn, k, w, h };
  });
  expect(r.far).toBeGreaterThanOrEqual(5);   // 南樺太 + at least four northern Kuril outlines
  expect(r.k[0]).toBeGreaterThan(0); expect(r.k[0]).toBeLessThan(r.w); expect(r.k[1]).toBeGreaterThan(60); expect(r.k[1]).toBeLessThan(r.h);
  expect(errs).toEqual([]);
});

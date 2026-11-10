/** Stage 39 (A): the northern Kuril islands (outside 地球地図日本's coast polygons) are land-coloured inside their outline on both base maps, at a detail zoom on a Pixel 7a-size screen. */
import { expect, test } from "@playwright/test";
test("得撫島・占守島など、輪郭だけでなく内部も陸の色(地形図と道路地図)", async ({ page }) => {
  test.setTimeout(300000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  const targets = await page.evaluate(() => ((window as any).__kfm.r.islets as any[]).filter((o) => o.shape).map((o) => ({ name: o.name, pos: o.pos, len: o.len })));
  expect(targets.length).toBeGreaterThanOrEqual(6);
  const picks = targets.filter((t) => ["得撫島", "占守島", "幌筵島", "新知島"].includes(t.name)); expect(picks.length).toBeGreaterThanOrEqual(3);
  for (const bg of ["terrain", "roadmap"]) {
    await page.evaluate((b) => { const a = (window as any).__kfm; a.bg = b; a.r.setBg(b); a.render(); }, bg);
    for (const t of picks) {
      const z = Math.min(4, 280 / Math.max(t.len, 20)); await page.evaluate(([p, zz]) => { const a = (window as any).__kfm; a.r.setView({ cx: (p as number[])[0], cy: (p as number[])[1], zoom: zz as number }, true); a.r.rebuild(); }, [t.pos, z]); await page.waitForTimeout(900);
      const px = await page.evaluate(async () => { const cv = document.querySelector("canvas") as HTMLCanvasElement; void cv; return null; });
      void px; const shot = (await page.screenshot()).toString("base64");
      const c = await page.evaluate(async ({ b64, w, h }) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const k = img.width / w; const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; const g = cv.getContext("2d")!; g.drawImage(img, 0, 0); const d = g.getImageData(Math.round(w / 2 * k) - 2, Math.round(h / 2 * k) - 2, 5, 5).data; let r = 0, gg = 0, bl = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bl += d[i + 2]; } const n = d.length / 4; return { r: r / n, g: gg / n, b: bl / n }; }, { b64: shot, w: 412, h: 915 });
      expect(c.g, `${bg} ${t.name} ${JSON.stringify(c)}`).toBeGreaterThan(c.b);   // land is green/beige, the sea blue
    }
  }
  expect(errs).toEqual([]);
});

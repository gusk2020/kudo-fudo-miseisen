/** Stage 38 (B): 南樺太 is filled (land colour, relief), not only outlined, on the terrain map and the road map. */
import { expect, test } from "@playwright/test";
test("南樺太's inside is land-coloured on both base maps (Pixel 7a-size screen)", async ({ page }) => {
  test.setTimeout(200000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  for (const bg of ["terrain", "roadmap"]) {
    await page.evaluate((b) => { const a = (window as any).__kfm; a.bg = b; a.r.setBg(b); a.render(); }, bg); await page.waitForTimeout(2500);
    const spot = await page.evaluate(() => { const a = (window as any).__kfm, v = a.r.view, { w, h } = a.r.size, c = a.world.cities.find((x: any) => x.island === 10);
      // a land cell of 樺太 well inside the island (no sea within 15 km), as a screen point
      let best: number[] | null = null; for (let k = 0; k < a.world.N; k++) if (a.world.t.land[k] === 1 && a.world.t.island[k] === 10) { const p = a.world.cellPos(k), d = Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1]); if (d < 80) { const i = k % a.world.nx, j = (k / a.world.nx) | 0; let inside = true; for (let dj = -3; dj <= 3 && inside; dj++) for (let di = -3; di <= 3; di++) if (a.world.t.land[(j + dj) * a.world.nx + i + di] !== 1) { inside = false; break; } if (inside) { best = p; break; } } }
      const p = best ?? c.pos; return { x: w / 2 + (p[0] - v.cx) * v.zoom, y: h / 2 - (p[1] - v.cy) * v.zoom }; });
    const shot = (await page.screenshot()).toString("base64");
    const px = await page.evaluate(async ({ b64, x, y }) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const k = (window.devicePixelRatio || 1); const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; const g = cv.getContext("2d")!; g.drawImage(img, 0, 0); const d = g.getImageData(Math.round(x * k) - 2, Math.round(y * k) - 2, 5, 5).data; let r = 0, gg = 0, bl = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bl += d[i + 2]; } const n = d.length / 4; return { r: r / n, g: gg / n, b: bl / n }; }, { b64: shot, x: spot.x, y: spot.y });
    expect(px.g, `${bg} ${JSON.stringify(px)}`).toBeGreaterThan(px.b);   // land is green/beige (G > B); the sea is blue (B > G)
  }
  expect(errs).toEqual([]);
});

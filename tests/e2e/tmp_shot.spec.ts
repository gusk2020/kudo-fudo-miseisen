import { test } from "@playwright/test";
const OUT = "/tmp/claude-0/-home-user/109baf63-fe83-5bb5-8529-ffea0ae6bce3/scratchpad/shots29/";
test("shots", async ({ page }) => {
  test.setTimeout(200000); await page.setViewportSize({ width: 412, height: 800 });
  await page.goto("/"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  const views: [string, string, number][] = [["sendai", "仙台市", 5], ["biwa", "大津市", 5], ["tokyo", "東京", 3.5], ["niigata", "新潟市", 4]];
  for (const bg of ["terrain", "roadmap"]) {
    await page.evaluate((b) => { const a = (window as any).__kfm; a.bg = b; a.r.setBg(b); a.render(); }, bg);
    for (const [nm, city, z] of views) {
      await page.evaluate(([c, zz]) => { const a = (window as any).__kfm, p = a.world.cities.find((x: any) => x.name === c).pos; a.r.setView({ cx: p[0], cy: p[1], zoom: zz }, true); a.r.rebuild(); }, [city, z] as any);
      await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}${nm}-${bg}.png` });
    }
  }
});

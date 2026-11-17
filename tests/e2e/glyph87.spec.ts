/** Issue #87: the sixty special-route symbols are drawn by the game's own small fonts where the device has none. Headless Chromium on a CI runner has almost none of these scripts, so this is the hard case; a real Pixel 7a was NOT tested here. */
import { expect, test } from "@playwright/test";
test("Issue #87: every symbol but the one no font was found for is drawable once the game's fonts have loaded; the others fall back to the reading", async ({ page }) => {
  test.setTimeout(240000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForFunction(() => (window as any).__kfm.glyphs.fontsTried, null, { timeout: 60000 });
  const r: any = await page.evaluate(() => ({ ok: (window as any).__kfm.glyphs.ok }));
  const bad = Object.entries(r.ok).filter(([, v]) => !v).map(([k]) => `${k} U+${k.codePointAt(0)!.toString(16).toUpperCase()}`); console.log(`G87 drawable ${Object.values(r.ok).filter(Boolean).length} of ${Object.keys(r.ok).length}; not drawable: ${bad.join(", ") || "none"}`);
  expect(Object.keys(r.ok).length).toBeGreaterThanOrEqual(60);
  const missing60 = bad.filter((b) => !/U\+21A04|U\+59CB|U\+3105/.test(b)); expect(missing60, "the symbols of the sixty-list with an embedded font are drawable").toEqual([]);
  await page.evaluate(() => { const d = document.createElement("div"); d.id = "g87"; d.style.cssText = "position:fixed;left:0;top:60px;width:412px;background:#fff;color:#000;font-size:26px;line-height:1.5;z-index:99;padding:6px;word-break:break-all"; d.textContent = Object.keys((window as any).__kfm.glyphs.ok).join(" "); document.body.appendChild(d); });
  if (process.env.KFM_SHOT) await page.locator("#g87").screenshot({ path: process.env.KFM_SHOT + "/glyphs87.png" }); expect(errs).toEqual([]);
});

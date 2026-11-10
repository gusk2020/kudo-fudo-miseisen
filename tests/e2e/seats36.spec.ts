/** Playtest feedback (Pixel 7a): seats put on the map. Real touch events on a Pixel 7-sized screen (emulator, not the phone). */
import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 20000 });
const app = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const errsOf = (page: Page) => { const e: string[] = []; page.on("pageerror", (x) => e.push(String(x))); return e; };
async function tap(page: Page, sel: string) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const b = (await el.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
const screenOf = (page: Page, p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
const lonlat = (page: Page, lon: number, lat: number) => page.evaluate(([a, b]) => { const m = (window as any).__kfm; return m.lonLatToReal ? m.lonLatToReal(a, b) : null; }, [lon, lat]);
async function start(page: Page) {
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  await page.evaluate(() => (window as any).__kfm.wizGo(2));
}
/** the real flow for one seat: tab -> 地図で選ぶ -> touch the map at world point w -> (shows the candidate) */
async function pickOnMap(page: Page, which: string, w: [number, number]) {
  await tap(page, "#setup-tab-" + which); await tap(page, "#pref-map");
  await page.evaluate((q) => (window as any).__kfm.r.setView({ cx: q[0], cy: q[1], zoom: 2 }, true), w);
  const [sx, sy] = await screenOf(page, w); await page.touchscreen.tap(sx, sy);
  await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 10000 });
}
const realOf = (page: Page, lon: number, lat: number) => page.evaluate(([a, b]) => (window as any).__lonLatToReal?.(a, b), [lon, lat]);

test("distinct capital / sub-capital / palace points: the palace stays where it was put and the 決定 button works by touch", async ({ page }) => {
  test.setTimeout(240000); const errs = errsOf(page); await start(page);
  const city = (n: string) => page.evaluate((x) => (window as any).__kfm.world.cities.find((c: any) => c.name === x).pos, n) as Promise<[number, number]>;
  const nagoya = await city("名古屋市"), hiroshima = await city("広島市"), sendai = await city("仙台市");
  // capital: Nagoya (JP-23), sub-capital: Hiroshima (JP-34), palace: Sendai (JP-04): three different prefectures, three different points
  await pickOnMap(page, "capital", nagoya); await tap(page, "#seat-confirm");
  await pickOnMap(page, "sub", hiroshima); await tap(page, "#seat-confirm");
  await pickOnMap(page, "palace", sendai);
  const cand = await app(page, "a => ({ pref: a.seatPick.pref, w: a.seatPick.w, tab: a.setupTab })") as { pref: string; w: [number, number]; tab: string };
  expect(cand.tab).toBe("palace"); expect(cand.pref).toBe("JP-04");
  await tap(page, "#seat-confirm");
  const s = await app(page, "a => ({ cap: [a.s.capital, a.s.capitalPos], sub: [a.s.subCapital, a.s.subPos], pal: [a.s.palace, a.s.palacePos] })") as { cap: [string, number[]]; sub: [string, number[]]; pal: [string, number[]] };
  expect(s.cap[0]).toBe("JP-23"); expect(s.sub[0]).toBe("JP-34"); expect(s.pal[0]).toBe("JP-04");
  expect(Math.hypot(s.pal[1][0] - sendai[0], s.pal[1][1] - sendai[1])).toBeLessThan(10);   // the palace point is near Sendai, not at the capital's or the sub-capital's point
  expect(Math.hypot(s.pal[1][0] - s.cap[1][0], s.pal[1][1] - s.cap[1][1])).toBeGreaterThan(100); expect(Math.hypot(s.pal[1][0] - s.sub[1][0], s.pal[1][1] - s.sub[1][1])).toBeGreaterThan(100);
  expect(errs).toEqual([]);
});

test("palace in the SAME prefecture as the capital, at a different point: what is stored and what the game gets", async ({ page }) => {
  test.setTimeout(240000); const errs = errsOf(page); await start(page);
  const nagoya = await page.evaluate(() => (window as any).__kfm.world.cities.find((c: any) => c.name === "名古屋市").pos) as [number, number];
  const other: [number, number] = [nagoya[0] + 25, nagoya[1] + 5];   // ~25 km east, same prefecture
  await pickOnMap(page, "capital", nagoya); await tap(page, "#seat-confirm");
  await pickOnMap(page, "palace", other); await tap(page, "#seat-confirm");
  const s = await app(page, "a => ({ cap: [a.s.capital, a.s.capitalPos], pal: [a.s.palace, a.s.palacePos], moves: a.movesWanted ? a.movesWanted() : null })") as any;
  console.log("SAME-PREF", JSON.stringify(s), "nagoya", nagoya, "other", other);
  expect(s.pal[0]).toBe(s.cap[0]);
  expect(Math.hypot(s.pal[1][0] - other[0], s.pal[1][1] - other[1])).toBeLessThan(10);
  expect(errs).toEqual([]);
});

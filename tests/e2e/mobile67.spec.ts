/**
 * Issue #67 work A: the phone-size screen with promoted cities. Chromium emulating a Pixel 7 (412x915, touch): NOT a Pixel 7a and not its GPU/CPU -- this proves layout and the touch flow, never how the device feels or performs.
 * A new 1800 game is played to 2000 (by then old municipalities have been promoted by the game's own rules). Then, on the real canvas and DOM:
 *  - the city-name labels at several zoom levels over the densest region and over promoted cities: how many are drawn, how many overlap each other, how many are cut by the screen edge, the smallest text height in CSS px;
 *  - every visible button on the map screen and in each sheet: on screen, not covered by another element (elementFromPoint), and its size;
 *  - a real two-finger pinch and a one-finger drag with touch events change the zoom and the centre; a promoted city can be centred; save with the real slot button, reload, load, and the same game comes back.
 * The ratchets below are what was measured on this build (see docs/MOBILE_PERF67.md); they stop a regression, they do not claim the screen is good enough for a hand.
 */
import { expect, test, type CDPSession, type Page } from "@playwright/test";

test.use({ actionTimeout: 20000 });
const kfm = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
async function newGame(page: Page) {
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const pos = (n: string) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p: any) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = (window as any).__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A: any = await scr(await pos("東京")), B: any = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
}
/** labels of the map: text, rect in CSS px, anchor inside the screen? */
const LABELS = `a => { const r = a.r, res = 1 /* Pixi's getBounds is already in CSS px (checked: screen 412 wide) */, names = new Set(a.world.cities.map((c) => c.name)), vw = innerWidth, vh = innerHeight, out = [];
  for (const t of r.labels.children) { if (!t.visible || t.text === undefined) continue; const b = t.getBounds().rectangle; const x = b.x / res, y = b.y / res, w = b.width / res, h = b.height / res; if (w < 1 || h < 1) continue; out.push({ text: String(t.text), city: names.has(String(t.text)), x, y, w, h }); }
  return { vw, vh, out }; }`;
async function labelStats(page: Page, label: string) {
  const L: any = await kfm(page, LABELS), inView = L.out.filter((l: any) => l.x + l.w > 0 && l.x < L.vw && l.y + l.h > 0 && l.y < L.vh), cities = inView.filter((l: any) => l.city);
  let overlaps = 0; for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) { const p = cities[i], q = cities[j], ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x), oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y); if (ox > 1 && oy > 1) overlaps++; }
  const cut = cities.filter((l: any) => l.x < -1 || l.x + l.w > L.vw + 1).length, minH = cities.length ? Math.min(...cities.map((l: any) => l.h)) : 0;
  console.log(`M67 labels ${label}: drawn ${inView.length}, city names ${cities.length}, overlapping name pairs ${overlaps}, names cut by the side edges ${cut}, smallest name height ${minH.toFixed(1)} CSS px`);
  return { n: cities.length, overlaps, cut, minH };
}
/** every visible control: on screen, not covered, size */
async function targets(page: Page, label: string) {
  const R: any = await page.evaluate(() => { const vw = innerWidth, vh = innerHeight, bad: string[] = [], rows: number[] = []; let n = 0;
    for (const e of Array.from(document.querySelectorAll<HTMLElement>("button, input, select, [role=button], a[href]"))) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.hidden || e.closest("[hidden]")) continue; if ((e.getAttribute("title") || "").includes("accessibility")) continue;   /* (Pixi's invisible accessibility shim at -1000px, not a control) */ const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue; n++;
      const id = (e.id || e.className || e.tagName) + ":" + (e.textContent || "").trim().slice(0, 8); rows.push(Math.min(b.width, b.height));
      if (b.right <= 0 || b.left >= vw || b.bottom <= 0 || b.top >= vh) { bad.push("offscreen " + id); continue; } if (b.left < -1 || b.right > vw + 1) bad.push("cut-x " + id);
      const cx = Math.min(vw - 1, Math.max(0, b.left + b.width / 2)), cy = Math.min(vh - 1, Math.max(0, b.top + b.height / 2)), top = document.elementFromPoint(cx, cy); if (top && top !== e && !e.contains(top) && !top.contains(e)) bad.push("covered " + id + " by " + ((top as HTMLElement).id || top.tagName)); }
    return { n, bad, minSide: Math.round(Math.min(...rows)), small: rows.filter((x) => x < 28).length }; });
  console.log(`M67 targets ${label}: ${R.n} controls, smallest side ${R.minSide}px, under 28px: ${R.small}, problems: ${JSON.stringify(R.bad)}`); return R;
}
async function pinch(cdp: CDPSession, cx: number, cy: number, d0: number, d1: number, steps = 8) {
  const pts = (d: number) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }]; await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + ((d1 - d0) * i) / steps) }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function drag(cdp: CDPSession, a: [number, number], b: [number, number], steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a[0], y: a[1] }] });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a[0] + ((b[0] - a[0]) * i) / steps, y: a[1] + ((b[1] - a[1]) * i) / steps }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const view = (page: Page) => kfm(page, "a => ({ cx: a.r.view.cx, cy: a.r.view.cy, zoom: a.r.view.zoom })") as Promise<{ cx: number; cy: number; zoom: number }>;
const show = (page: Page, cx: number, cy: number, zoom: number) => kfm(page, `a => { a.r.setView({ cx: ${cx}, cy: ${cy}, zoom: ${zoom} }, true); a.sheet = null; a.render(); a.renderRoads(); return 1; }`);

test("Issue #67 A: promoted cities on a phone-size screen (Pixel 7 emulation): labels, tap targets, touch pinch/drag, save and load", async ({ page }) => {
  test.setTimeout(3000000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  const cdp = await page.context().newCDPSession(page);
  await newGame(page); await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(200); return 1; }");
  const info: any = await kfm(page, "a => ({ year: 1800 + Math.floor(a.sim.month / 12), n: (a.sim.oldCities40 || []).length, ids: (a.sim.oldCities40 || []).map((d) => d.id), shown: (a.sim.oldCities40 || []).filter((d) => a.sim.pot17 && a.sim.pot17.shown[d.id] > 0).map((d) => d.id) })");
  console.log("M67 game", JSON.stringify({ year: info.year, promoted: info.n, shownOnMap: info.shown.length })); expect(info.n, "old municipalities were promoted by the game's own rules").toBeGreaterThan(0);
  // ---- labels: the densest region (Tokyo) at four zooms, and over each promoted city that is drawn (two zooms) ----
  const tokyo: any = await kfm(page, "a => a.world.cities.find((c) => c.name === '東京').pos"), worst = { overlaps: 0, cut: 0, minH: 99 };
  for (const z of [1.2, 2.5, 5, 10]) { await show(page, tokyo[0], tokyo[1], z); await page.waitForTimeout(500); const s = await labelStats(page, `Tokyo zoom ${z}`); worst.overlaps = Math.max(worst.overlaps, s.overlaps); worst.cut = Math.max(worst.cut, s.cut); if (s.n) worst.minH = Math.min(worst.minH, s.minH); if (z === 2.5) await page.screenshot({ path: "test-results/m67-tokyo-z2.5.png" }); }
  for (const id of info.shown.slice(0, 4)) for (const z of [2.5, 6, 10]) { await kfm(page, `a => { const c = a.world.cityById.get('${id}'); a.r.setView({ cx: c.pos[0], cy: c.pos[1], zoom: ${z} }, true); a.sheet = null; a.render(); a.renderRoads(); return 1; }`); await page.waitForTimeout(400);
    const s = await labelStats(page, `${id} zoom ${z}`); worst.overlaps = Math.max(worst.overlaps, s.overlaps); worst.cut = Math.max(worst.cut, s.cut); if (s.n) worst.minH = Math.min(worst.minH, s.minH);
    const nm = (await kfm(page, `a => a.world.cityById.get('${id}').name`)) as string; const L: any = await kfm(page, LABELS); const mine = L.out.find((l: any) => l.text === nm); console.log(`M67 name of ${nm} (${id}) drawn at zoom ${z}: ${!!mine}`);   // (Stage 23 rule, roads.ts: with the tiers on, only seats, 政令指定都市 and 政令特区 are NAMED; every other city keeps its circle only. So most promoted cities show a circle and no name -- by the existing design, not by this feature; recorded in docs/MOBILE_PERF67.md)
    if (mine) { expect(mine.x + mine.w, `${nm} is not cut by the left edge`).toBeGreaterThan(0); }
  }
  console.log("M67 worst label values", JSON.stringify(worst));
  expect(worst.overlaps, "city-name labels do not overlap each other (measured 0 on this build)").toBe(0); expect(worst.minH, "the smallest city name box is at least 12 CSS px high (measured ~15)").toBeGreaterThanOrEqual(12);
  // ---- tap targets: the map screen, then each sheet ----
  await show(page, tokyo[0], tokyo[1], 2.5); const tMap = await targets(page, "map screen"); expect(tMap.bad, "no control is off screen or covered (map screen)").toEqual([]);
  for (const sh of ["menu", "roads", "history", "issues", "legend"]) { await kfm(page, `a => { a.sheet = null; a.openSheet('${sh}'); return 1; }`); await page.waitForTimeout(500); await page.screenshot({ path: `test-results/m67-sheet-${sh}.png` }); const t = await targets(page, `sheet ${sh}`); expect(t.bad, `no control is off screen or covered (${sh})`).toEqual([]); }
  await kfm(page, "a => { a.sheet = null; a.render(); return 1; }");
  // ---- touch: pinch zoom, drag pan ----
  await show(page, tokyo[0], tokyo[1], 2.5); const v0 = await view(page); await pinch(cdp, 206, 450, 80, 220); const v1 = await view(page); console.log("M67 pinch zoom", v0.zoom.toFixed(2), "->", v1.zoom.toFixed(2)); expect(v1.zoom, "two-finger spread zooms in").toBeGreaterThan(v0.zoom * 1.3);
  await pinch(cdp, 206, 450, 220, 80); const v2 = await view(page); expect(v2.zoom, "two-finger pinch zooms out").toBeLessThan(v1.zoom * 0.8);
  const v3 = await view(page); await drag(cdp, [300, 600], [120, 400]); const v4 = await view(page); expect(Math.hypot(v4.cx - v3.cx, v4.cy - v3.cy), "a one-finger drag moves the map").toBeGreaterThan(0);
  // ---- save with the real slot button, reload, load, the same game ----
  const SIG = `a => JSON.stringify([Object.keys(a.sim.cities).sort().map((k) => [k, a.sim.cities[k].pop]), Object.keys(a.sim.routes).length, Object.keys(a.sim.projects).length, Object.keys(a.sim.edges).length, a.sim.rngState, (a.sim.oldCities40 || []).map((d) => d.id)])`;
  const before = (await kfm(page, SIG)) as string; await kfm(page, "a => { a.sheet = null; a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-1 .slot-save"); await page.click("#slot-1 .slot-save"); await page.waitForTimeout(3000);
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await kfm(page, "a => { a.sheet = null; a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-1 .slot-load"); await page.click("#slot-1 .slot-load");
  await page.waitForFunction(() => !!(window as any).__kfm.sim, null, { timeout: 90000 }); await page.waitForTimeout(1500); expect((await kfm(page, SIG)) as string, "the loaded game is the game that was saved").toBe(before);
  const tAfter = await targets(page, "after load"); expect(tAfter.bad).toEqual([]); expect(errs, "no page errors").toEqual([]);
});

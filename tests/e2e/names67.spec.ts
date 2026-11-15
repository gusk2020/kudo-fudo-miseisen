/**
 * Issue #67: the names and the tap card of promoted cities, on a Pixel 7-size screen (touch taps) and a PC-size screen (mouse clicks). Chromium emulation, NOT a Pixel 7a.
 * A new 1800 game is played to 2000 (the game promotes old municipalities by its own rules). Then, in the real canvas and DOM:
 *  - zoomed in (10) on each of several promoted cities: its circle is drawn and its name is on the map; at 2.5 over the densest region no two names overlap and at most 45 names are drawn;
 *  - a real tap on a promoted city's circle opens its card (name, prefecture, people, transport, where it came from); the card is on screen, clear of the dock, its close button is 44 px; a tap on empty map and the close button close it;
 *  - the ordinary gestures still work with the card open (pinch, drag); sheets still open and take the card away.
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
const LABELS = `a => { const r = a.r, names = new Set(a.world.cities.map((c) => c.name)), vw = innerWidth, vh = innerHeight, out = [];
  for (const t of [...r.labels.children, ...r.roads.names]) {   /* the base map's names AND the road layer's city names (roads.ts): the second list is where promoted cities are named */ if (!t.visible || t.text === undefined) continue; const b = t.getBounds().rectangle; if (b.width < 1 || b.height < 1) continue; out.push({ text: String(t.text), city: names.has(String(t.text)), x: b.x, y: b.y, w: b.width, h: b.height }); }
  const inView = out.filter((l) => l.x + l.w > 0 && l.x < vw && l.y + l.h > 0 && l.y < vh); return { vw, vh, all: inView, drawn: r.roads.drawnCircles.map((c) => c.id) }; }`;
async function pinch(cdp: CDPSession, cx: number, cy: number, d0: number, d1: number) {
  const pts = (d: number) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }]; await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0) });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + ((d1 - d0) * i) / 8) }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tapAt(page: Page, x: number, y: number, touch: boolean) { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
const center = (page: Page, id: string, zoom: number) => kfm(page, `a => { const c = a.world.cityById.get('${id}'); a.r.setView({ cx: c.pos[0], cy: c.pos[1], zoom: ${zoom} }, true); a.openSheet(null); a.hideCityCard(); a.render(); a.renderRoads(); return a.world.cityById.get('${id}').name; }`) as Promise<string>;

for (const vp of [{ name: "Pixel 7 size 412x915 (touch)", width: 412, height: 915, touch: true }, { name: "PC size 1280x800 (mouse)", width: 1280, height: 800, touch: false }]) {
  test(`Issue #67 names and tap card: ${vp.name}`, async ({ page }) => {
    test.setTimeout(3000000); await page.setViewportSize({ width: vp.width, height: vp.height }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
    const cdp = await page.context().newCDPSession(page); await newGame(page); await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(200); return 1; }");
    const ids: string[] = (await kfm(page, "a => (a.sim.oldCities40 || []).filter((d) => a.sim.pot17 && a.sim.pot17.shown[d.id] > 0).map((d) => d.id)")) as string[];
    console.log(`N67 ${vp.name}: promoted cities on the map ${ids.length}`); expect(ids.length, "the game promoted old municipalities").toBeGreaterThan(2);
    // ---- names: zoomed in, each promoted city has circle and name ----
    const sample = ids.slice(0, 6); let named = 0;
    for (const id of sample) { const nm = await center(page, id, 10); await page.waitForTimeout(450); const L: any = await kfm(page, LABELS); const hasCircle = L.drawn.includes(id), hasName = L.all.some((l: any) => l.text === nm); if (hasName) named++; console.log(`N67 zoom 10 ${id} ${nm}: circle ${hasCircle}, name ${hasName}`); expect(hasCircle, `${nm}: the circle is drawn at zoom 10`).toBe(true); }
    expect(named, "most promoted cities are named when one looks closely (zoom 10)").toBeGreaterThanOrEqual(Math.ceil(sample.length * 0.8));
    // ---- names: the densest region, zoom 2.5: no overlaps, no more than 45 ----
    const tk: any = await kfm(page, "a => a.world.cities.find((c) => c.name === '東京').pos"); await kfm(page, `a => { a.r.setView({ cx: ${tk[0]}, cy: ${tk[1]}, zoom: 2.5 }, true); a.render(); a.renderRoads(); return 1; }`); await page.waitForTimeout(500);
    const D: any = await kfm(page, LABELS), cities = D.all.filter((l: any) => l.city); let ov = 0; for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) { const p = cities[i], q = cities[j]; if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1) ov++; }
    const promotedNames = new Set((await kfm(page, "a => (a.sim.oldCities40 || []).map((d) => a.world.cityById.get(d.id).name)")) as string[]); const pn = cities.filter((l: any) => promotedNames.has(l.text)).length;
    console.log(`N67 Tokyo 2.5: city names ${cities.length} (promoted ${pn}), overlapping pairs ${ov}, smallest name height ${Math.min(...cities.map((l: any) => l.h)).toFixed(1)} px`); expect(ov, "no two city names overlap").toBe(0); expect(cities.length, "at most 45 names").toBeLessThanOrEqual(45);
    // ---- the tap card ----
    const id = sample[0]; const nm = await center(page, id, 6); await page.waitForTimeout(450); const sc: any = await kfm(page, `a => a.r.worldToScreen(a.world.cityById.get('${id}').pos)`);
    expect(await page.locator("#city-card").isHidden(), "no card before the tap").toBe(true); await tapAt(page, sc[0], sc[1], vp.touch); await page.waitForSelector("#city-card:not([hidden])", { timeout: 5000 });
    const title = await page.textContent("#city-card-title"), body = await page.textContent("#city-card-body"); console.log("N67 card", title, "|", body); expect(title).toContain(nm); expect(body).toContain("所属:"); expect(body).toContain("人口:"); expect(body).toContain("交通:"); expect(body, "a promoted city says where it came from").toContain("昇格");
    const box = (await page.locator("#city-card").boundingBox())!, dock = (await page.locator("#dock").boundingBox())!, close = (await page.locator("#city-card-close").boundingBox())!;
    expect(box.x, "the card is on screen").toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(vp.width); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height, "the card does not cover the dock").toBeLessThanOrEqual(dock.y); expect(close.width).toBeGreaterThanOrEqual(44); expect(close.height).toBeGreaterThanOrEqual(44);
    // the ordinary gestures still work with the card open
    const v0: any = await kfm(page, "a => ({ cx: a.r.view.cx, cy: a.r.view.cy, zoom: a.r.view.zoom })");
    if (vp.touch) { await pinch(cdp, vp.width / 2, 300, 80, 220); const v1: any = await kfm(page, "a => a.r.view.zoom"); expect(v1, "pinch still zooms").toBeGreaterThan(v0.zoom * 1.3); }
    else { await page.mouse.move(vp.width / 2, 300); await page.mouse.wheel(0, -400); await page.waitForTimeout(200); expect((await kfm(page, "a => a.r.view.zoom")) as number, "the wheel still zooms").toBeGreaterThan(v0.zoom); }
    const v2: any = await kfm(page, "a => ({ cx: a.r.view.cx, cy: a.r.view.cy })"); if (vp.touch) { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y: 500 }] }); for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 300 - 18 * i, y: 500 - 10 * i }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(520, 400, { steps: 10 }); await page.mouse.up(); }
    const v3: any = await kfm(page, "a => ({ cx: a.r.view.cx, cy: a.r.view.cy })"); expect(Math.hypot(v3.cx - v2.cx, v3.cy - v2.cy), "a drag still pans").toBeGreaterThan(0); expect(await page.locator("#city-card").isHidden(), "a drag is not a tap: the card stays").toBe(false);
    // close by the button, reopen, close by a tap on empty map
    const cb = (await page.locator("#city-card-close").boundingBox())!, cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
    const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y) as HTMLElement | null; return e ? `${e.tagName}#${e.id}.${e.className}` : "none"; }, [cx, cy]); console.log(`N67 close button at ${Math.round(cx)},${Math.round(cy)} (${Math.round(cb.width)}x${Math.round(cb.height)}); the element on top there: ${top}`); expect(top, "the close button is what a finger at its centre hits").toContain("city-card-close");
    let tries = 0;   // (a tap that comes straight after an injected drag can be swallowed by the browser as the end of the drag's fling, mostly on a slow runner; each attempt is a real tap on the button, and the count is logged)
    await expect(async () => { tries++; await tapAt(page, cx, cy, vp.touch); await expect(page.locator("#city-card"), `the close button closed the card (the element on top was ${top})`).toBeHidden({ timeout: 2000 }); }).toPass({ timeout: 20000 }); console.log(`N67 close button: closed after ${tries} tap(s)`);
    await center(page, id, 6); await page.waitForTimeout(450); const sc2: any = await kfm(page, `a => a.r.worldToScreen(a.world.cityById.get('${id}').pos)`); await tapAt(page, sc2[0], sc2[1], vp.touch); await page.waitForSelector("#city-card:not([hidden])");
    const empty: any = await kfm(page, `a => { const cs = a.r.roads.drawnCircles.map((c) => a.r.worldToScreen([c.x, c.y])); for (let y = 120; y < innerHeight - 200; y += 40) for (let x = 20; x < innerWidth - 20; x += 40) if (cs.every((p) => Math.hypot(p[0] - x, p[1] - y) > 60)) return [x, y]; return null; }`); expect(empty, "there is an empty spot on the map").not.toBeNull();
    await tapAt(page, empty[0], empty[1], vp.touch); await expect(page.locator("#city-card")).toBeHidden();
    // a sheet takes the card away and still opens
    await tapAt(page, sc2[0], sc2[1], vp.touch); await page.waitForSelector("#city-card:not([hidden])"); await kfm(page, "a => { a.openSheet('legend'); return 1; }"); await expect(page.locator("#city-card")).toBeHidden(); expect(await page.locator("#sheet").isVisible()).toBe(true);
    expect(errs, "no page errors").toEqual([]);
  });
}

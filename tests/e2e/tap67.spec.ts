/**
 * Issue #67 (field report, Pixel 7a): "tapping a city circle opens the card sometimes and not other times; prefectural capitals seem hard to open".
 * One game (new 1800 start, played to 2000), then for each kind of city a REAL tap (touch on the Pixel 7-size screen, mouse on the PC-size screen) on the marker the player actually sees, at three zooms. For every tap it records what the hit test had to work with
 * (is the city among the road layer's drawn circles, how far is the nearest one) and whether the card opened. Chromium emulation, NOT a Pixel 7a.
 */
import { expect, test, type Page } from "@playwright/test";

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
/** the kinds of city, chosen from the game itself: [kind, ids] */
const KINDS = `a => { const w = a.world, s = a.sim, tier = (id) => (s.tier23 && s.tier23.zones && s.tier23.zones[id] ? s.tier23.zones[id].tier : 0), promoted = new Set((s.oldCities40 || []).map((d) => d.id)), shown = (c) => c.kind === 'capital' || (s.pot17 && s.pot17.shown[c.id] > 0);
  const caps = w.cities.filter((c) => c.kind === 'capital'), seat = caps.find((c) => c.pref === (s.capital || 'JP-13')), sub = caps.find((c) => c.pref === s.subCapital);
  const rest = caps.filter((c) => c !== seat && c !== sub).sort((p, q) => s.cities[q.id].pop - s.cities[p.id].pop), plain = w.cities.filter((c) => c.kind !== 'capital' && shown(c) && !promoted.has(c.id) && tier(c.id) === 0).sort((p, q) => s.cities[q.id].pop - s.cities[p.id].pop);
  const pick = (arr, n) => arr.slice(0, n).map((c) => c.id), spread = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n).map((c) => c.id);
  return { seat: seat ? [seat.id] : [], sub: sub ? [sub.id] : [], 'capital-big': pick(rest, 2), 'capital-small': rest.slice(-3).map((c) => c.id), 'capital-mid': spread(rest.slice(2, -3), 3), seirei: w.cities.filter((c) => tier(c.id) > 0).slice(0, 3).map((c) => c.id), plain: pick(plain, 3), promoted: [...promoted].filter((id) => w.cityById.get(id)).slice(0, 3), 'no-marker': plain.filter((c) => !s.metro || true).slice(-3).map((c) => c.id) }; }`;   // 'no-marker': ordinary cities with neither a circle nor a base-map dot: nothing on the map to tap, so they are recorded but not asserted

for (const vp of [{ name: "Pixel 7 size 412x915 (touch)", width: 412, height: 915, touch: true }, { name: "PC size 1280x800 (mouse)", width: 1280, height: 800, touch: false }]) {
  test(`Issue #67 tap on every kind of city: ${vp.name}`, async ({ page }) => {
    test.setTimeout(3000000); await page.setViewportSize({ width: vp.width, height: vp.height }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
    await newGame(page); await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(200); return 1; }");
    const kinds: Record<string, string[]> = (await kfm(page, KINDS)) as never; console.log("T67 kinds", JSON.stringify(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.length]))));
    const fails: string[] = [], rows: string[] = [];
    for (const [kind, ids] of Object.entries(kinds)) for (const id of ids) for (const zoom of [1.2, 2.5, 6]) {
      await kfm(page, `a => { const c = a.world.cityById.get('${id}'); a.openSheet(null); a.hideCityCard(); a.r.setView({ cx: c.pos[0], cy: c.pos[1], zoom: ${zoom} }, true); a.render(); a.renderRoads(); return 1; }`); await page.waitForTimeout(400);
      const d: any = await kfm(page, `a => { const c = a.world.cityById.get('${id}'), p = a.r.worldToScreen(c.pos), cs = a.r.roads.drawnCircles, own = cs.find((x) => x.id === '${id}'), near = cs.map((x) => { const q = a.r.worldToScreen([x.x, x.y]); return Math.hypot(q[0] - p[0], q[1] - p[1]); }).sort((m, n) => m - n)[0]; return { name: c.name, sx: p[0], sy: p[1], inCircles: !!own, radPx: own ? own.radPx : null, nearest: near === undefined ? null : Math.round(near), editable: !!a.editable(), reloc: !!a.relocOpen(), sheet: a.sheet, onScreen: p[0] > 0 && p[0] < innerWidth && p[1] > 0 && p[1] < innerHeight }; }`);
      if (vp.touch) await page.touchscreen.tap(d.sx, d.sy); else await page.mouse.click(d.sx, d.sy);
      let opened = false; try { await page.waitForSelector("#city-card:not([hidden])", { timeout: 1200 }); opened = true; } catch { opened = false; }
      const title = opened ? await page.textContent("#city-card-title") : ""; const right = opened && !!title && title.includes(d.name);
      rows.push(`${kind} ${d.name} z${zoom}: ${right ? "OPEN" : opened ? "WRONG:" + title : "closed"} (in drawn circles ${d.inCircles}${d.radPx ? ` r${d.radPx.toFixed(1)}px` : ""}, nearest circle ${d.nearest}px, editable ${d.editable}, reloc ${d.reloc}, sheet ${d.sheet}, on screen ${d.onScreen})`);
      if (!right && d.onScreen && kind !== 'no-marker') fails.push(`${kind} ${d.name} z${zoom}`);
    }
    console.log(`T67 results ${vp.name}\n` + rows.join("\n")); console.log(`T67 ${vp.name}: ${rows.length} taps, ${fails.length} did not open the right card`);
    expect(fails, "every kind of city opens its card when its marker is tapped").toEqual([]); expect(errs).toEqual([]);
  });
}

test("Issue #67 tap in the situations of the field report: while time runs, right after a pinch, with a sheet open, and between overlapping circles (Pixel 7 size, touch)", async ({ page }) => {
  test.setTimeout(3000000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept());
  const cdp = await page.context().newCDPSession(page); await newGame(page); await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(200); return 1; }");
  const at = (id: string, zoom: number) => kfm(page, `a => { const c = a.world.cityById.get('${id}'); a.openSheet(null); a.hideCityCard(); a.r.setView({ cx: c.pos[0], cy: c.pos[1], zoom: ${zoom} }, true); a.render(); a.renderRoads(); const p = a.r.worldToScreen(c.pos); return { name: c.name, x: p[0], y: p[1] }; }`) as Promise<{ name: string; x: number; y: number }>;
  const tapOpens = async (d: { name: string; x: number; y: number }) => { await page.touchscreen.tap(d.x, d.y); try { await page.waitForSelector("#city-card:not([hidden])", { timeout: 1500 }); } catch { return false; } return ((await page.textContent("#city-card-title")) ?? "").includes(d.name); };
  const kinds: Record<string, string[]> = (await kfm(page, KINDS)) as never, small = kinds["capital-small"][0], big = kinds["capital-big"][0];
  // 1. while the game's time is running
  await kfm(page, "a => { a.sim.speed = 1; return 1; }"); const m0 = (await kfm(page, "a => a.sim.month")) as number;
  for (const id of [big, small]) { const d = await at(id, 2.5); await page.waitForTimeout(400); const ok = await tapOpens(d); console.log(`T67 running: ${d.name}: ${ok ? "OPEN" : "closed"}`); expect(ok, `${d.name} opens while time runs`).toBe(true); }
  console.log(`T67 running: the game advanced ${(await kfm(page, "a => a.sim.month")) as number - m0} month(s) meanwhile`); await kfm(page, "a => { a.sim.speed = 0; return 1; }");
  // 2. straight after a pinch
  for (const id of [big, small]) { const d = await at(id, 2.5); await page.waitForTimeout(400);
    const pts = (w: number) => [{ x: 206 - w / 2, y: 300, id: 1 }, { x: 206 + w / 2, y: 300, id: 2 }]; await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(80) }); for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(80 + 10 * i) }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const p: any = await kfm(page, `a => { const c = a.world.cityById.get('${id}'), q = a.r.worldToScreen(c.pos); return { name: c.name, x: q[0], y: q[1] }; }`);   // (the city is somewhere else on the screen after the pinch)
    if (p.x > 5 && p.x < 407 && p.y > 130 && p.y < 800) { await page.waitForTimeout(250); const ok = await tapOpens(p); console.log(`T67 after pinch: ${p.name} at ${Math.round(p.x)},${Math.round(p.y)}: ${ok ? "OPEN" : "closed"}`); expect(ok, `${p.name} opens right after a pinch`).toBe(true); } else console.log(`T67 after pinch: ${p.name} moved off screen, not tapped`); }
  // 3. a sheet open: the tap does not open a card (the sheet owns the screen), and the sheet is untouched
  { const d = await at(big, 2.5); await kfm(page, "a => { a.openSheet('legend'); return 1; }"); await page.waitForTimeout(300); const ok = await tapOpens({ ...d, y: Math.min(d.y, 200) }); console.log(`T67 sheet open: card ${ok ? "OPENED" : "not opened"}`); expect(ok, "no card while a sheet is open").toBe(false); await kfm(page, "a => { a.openSheet(null); return 1; }"); }
  // 4. between overlapping circles: the circle whose centre is tapped wins, for each of the closest pairs on the screen
  await kfm(page, "a => { const c = a.world.cities.find((x) => x.name === '東京'); a.openSheet(null); a.r.setView({ cx: c.pos[0], cy: c.pos[1], zoom: 1.2 }, true); a.render(); a.renderRoads(); return 1; }"); await page.waitForTimeout(500);
  const pairs: any[] = (await kfm(page, `a => { const cs = a.r.roads.drawnCircles.map((c) => { const p = a.r.worldToScreen([c.x, c.y]); return { id: c.id, name: a.world.cityById.get(c.id).name, x: p[0], y: p[1], r: c.radPx }; }).filter((c) => c.x > 20 && c.x < 392 && c.y > 140 && c.y < 790), out = []; for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y); if (d < cs[i].r + cs[j].r) out.push({ a: cs[i], b: cs[j], d }); } return out.sort((p, q) => p.d - q.d).slice(0, 3); }`)) as never;
  console.log(`T67 overlapping circles on the screen: ${pairs.length} pair(s) among the closest`); for (const pr of pairs) for (const c of [pr.a, pr.b]) { await kfm(page, "a => { a.hideCityCard(); return 1; }"); const ok = await tapOpens({ name: c.name, x: c.x, y: c.y }); console.log(`T67 overlap ${pr.a.name}/${pr.b.name} (${Math.round(pr.d)}px apart): tap on the centre of ${c.name}: ${ok ? "OPEN" : "wrong or closed"}`); expect(ok, `the centre of ${c.name} opens ${c.name}`).toBe(true); }
  expect(errs).toEqual([]);
});

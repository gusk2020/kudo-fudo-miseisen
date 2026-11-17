/** Issue #88 (field report, Pixel 7a): in 札幌県 the sub-capital and the palace were put at two different points on the map, and both ended up at the point given last. Chromium emulation of a Pixel 7-size screen with touch -- not the phone itself. */
import { expect, test, type Page } from "@playwright/test";
test.use({ actionTimeout: 20000 });
const app = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
async function tapEl(page: Page, sel: string) { const el = page.locator(sel).first(); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); const b = (await el.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
async function pickOnMap(page: Page, which: string, world: [number, number]) {
  await page.evaluate((k) => (window as any).__kfm.wizGo(k), 2); if ((await page.getAttribute("#setup-tab-" + which, "aria-selected")) !== "true") await tapEl(page, "#setup-tab-" + which); await page.waitForSelector("#seat-sel-" + which); await tapEl(page, "#pref-map");
  await page.evaluate((p) => (window as any).__kfm.r.setView({ cx: p[0], cy: p[1], zoom: 3 }, true), world); await page.waitForTimeout(400);
  const sc = (await page.evaluate((p) => (window as any).__kfm.r.worldToScreen(p), world)) as [number, number]; await page.touchscreen.tap(sc[0], sc[1]); await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 5000 });
  const picked = (await app(page, "a => a.seatPick.w")) as [number, number]; await tapEl(page, "#seat-confirm"); return picked;
}
const markers = (page: Page) => app(page, "a => { a.render(); return a.r.seatMarkers ?? null; }") as Promise<{ capital: number[] | null; sub: number[] | null; palace: number[] | null } | null>;
const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
test("Issue #88: sub-capital and palace at two different map points of 札幌県 stay two points (screen, game, save, reload)", async ({ page }) => {
  test.setTimeout(600000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (x) => void x.accept());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const sap = (await app(page, "a => a.world.cities.find((c) => c.name === '札幌市').pos")) as [number, number], A: [number, number] = [sap[0] + 60, sap[1] + 40], B: [number, number] = [sap[0] - 30, sap[1] - 45];
  for (const order of [["sub", "palace"], ["palace", "sub"]] as const) {
    const pa = await pickOnMap(page, order[0], A), pb = await pickOnMap(page, order[1], B);
    const st: any = await app(page, "a => ({ sub: a.s.subCapital, palace: a.s.palace, subPos: a.s.subPos ?? null, palacePos: a.s.palacePos ?? null })"); console.log(`S88 ${order.join(" then ")}:`, JSON.stringify(st), JSON.stringify(await markers(page)));
    const first = order[0] === "sub" ? st.subPos : st.palacePos, second = order[0] === "sub" ? st.palacePos : st.subPos;
    expect(st.sub).toBe("HK-SAP"); expect(st.palace).toBe("HK-SAP"); expect(first, `${order[0]} keeps the point it was given`).toEqual(pa); expect(second).toEqual(pb); expect(d(first, second), "two different points").toBeGreaterThan(40);
    const m = (await markers(page))!; expect(d(m.sub!, st.subPos), "the sub-capital marker is drawn at its own point").toBeLessThan(0.01); expect(d(m.palace!, st.palacePos), "the palace marker is drawn at its own point").toBeLessThan(0.01);
  }
  // the same with ONE of them chosen from the list (no point of its own): it must not jump to the other's point
  await page.evaluate(() => (window as any).__kfm.resetSeatPos("sub")); const st2: any = await app(page, "a => ({ subPos: a.s.subPos ?? null, palacePos: a.s.palacePos })"); expect(st2.subPos).toBeNull(); const m2 = (await markers(page))!; console.log("S88 sub from the list, palace on the map:", JSON.stringify(m2));
  expect(d(m2.sub!, m2.palace!), "a sub-capital chosen from the list is not drawn on the palace's point").toBeGreaterThan(20);
  expect(errs).toEqual([]);
});

test("Issue #88: at a RELOCATION, sub-capital and palace tapped at two points of 札幌県 stay two points on the map, in the game and after a reload", async ({ page }) => {
  test.setTimeout(900000); await page.setViewportSize({ width: 412, height: 915 }); const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (x) => void x.accept());
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  const pos = (n: string) => app(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`) as Promise<[number, number]>, scr = (p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
  await page.evaluate(() => (window as any).__kfm.wizGo(3)); await page.click("#tool-cer-kokudo1"); { const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up(); }
  await app(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  await app(page, "a => { const s = a.sim; a.runner.settle(); s.policy.pending = null; s.kaigen.pending = null; s.kaigen.next = 1940; s.policy.mode = 'priority'; s.month = 1200; s.speed = 20; return 1; }");
  await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "pending", null, { timeout: 120000 }); await page.waitForSelector("#e22-box"); await tapEl(page, "#e22-era-1"); await tapEl(page, "#e22-next");
  const sap = await pos("札幌市"), A: [number, number] = [sap[0] + 60, sap[1] + 40], B: [number, number] = [sap[0] - 30, sap[1] - 45], picked: Record<string, [number, number]> = {};
  for (const [role, pt] of [["sub", A], ["palace", B]] as const) {
    await app(page, `a => { a.startE22Map('${role}'); return 1; }`); await page.evaluate((p) => (window as any).__kfm.r.setView({ cx: p[0], cy: p[1], zoom: 3 }, true), pt); await page.waitForTimeout(400);
    const sc = await scr(pt); await page.touchscreen.tap(sc[0], sc[1]); await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 5000 }); picked[role] = (await app(page, "a => a.seatPick.w")) as [number, number]; await tapEl(page, "#seat-confirm"); await page.waitForSelector("#e22-box");
  }
  await tapEl(page, "#e22-decide"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "road0", null, { timeout: 60000 });
  const check = async (when: string) => { const g: any = await app(page, "a => ({ sub: a.sim.subCapital, subPos: a.sim.subPos ?? null, palace: a.sim.palace, m: (a.render(), a.r.seatMarkers) })"); console.log(`S88 relocation ${when}:`, JSON.stringify(g));
    expect(g.sub).toBe("HK-SAP"); expect(g.palace.pref).toBe("HK-SAP"); expect(g.subPos, "the sub-capital keeps the tapped point").toEqual(picked.sub); expect(g.palace.pos, "the palace keeps the tapped point").toEqual(picked.palace);
    expect(d(g.m.sub, picked.sub), "sub-capital marker at its own point").toBeLessThan(0.01); expect(d(g.m.palace, picked.palace), "palace marker at its own point").toBeLessThan(0.01); expect(d(g.m.sub, g.m.palace)).toBeGreaterThan(40); };
  await check("after 決める"); await tapEl(page, "#road0-skip"); await tapEl(page, "#rw-confirm"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "done", null, { timeout: 60000 }); await check("after the event closed");
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 120000 }); await check("after a reload"); expect(errs).toEqual([]);
});

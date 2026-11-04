/** Stage 31-35 audit: the whole way through on a Pixel 7a-sized screen with TOUCH input only (taps and one-finger drags via CDP touch events).
 *  This is an emulator (Chromium + swiftshader), not the physical phone: it proves the flow works at that screen size with touch, never how it feels or performs on the device. */
import { expect, test, type CDPSession, type Page } from "@playwright/test";

test.use({ actionTimeout: 20000 });   // an action that cannot find its element fails at that line instead of waiting for the whole test timeout
const app = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
function watchErrors(page: Page) { const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); return errs; }
/** a real touch tap on the middle of an element */
async function tap(page: Page, sel: string) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const b = (await el.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
const screenOf = (page: Page, p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
async function touchDrag(cdp: CDPSession, pts: [number, number][]) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (const p of pts.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p[0], y: p[1] }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const lerp = (a: [number, number], b: [number, number], n: number) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as [number, number]);
const cityPos = (page: Page, name: string) => page.evaluate((n) => (window as any).__kfm.world.cities.find((c: any) => c.name === n).pos, name) as Promise<[number, number]>;
const jump = (page: Page, y: number, mode: string) => page.evaluate(([yy, md]) => { const a = (window as any).__kfm, s = a.sim; a.runner.settle(); s.month = ((yy as number) - s.startYear) * 12; s.kaigen.next = (yy as number) + 40; s.kaigen.pending = null; s.policy.pending = null; s.policy.mode = md; s.speed = 20; }, [y, mode] as const);

test("Pixel 7a-size touch: intro -> terrain -> era -> seats on the map -> 国道1号 -> ceremony -> time -> save and reload", async ({ page }) => {
  test.setTimeout(420000); const errs = watchErrors(page); const vp = page.viewportSize()!; expect(vp.width).toBeLessThanOrEqual(420);
  await page.goto("/");
  // 1. the startup window is shown once and closes with a tap
  await page.waitForSelector("#intro-modal"); expect(await page.isVisible("#intro-ok")).toBe(true); await tap(page, "#intro-ok"); await page.waitForSelector("#intro-modal", { state: "detached" });
  await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  // 2. terrain stage: the editor opens, the controls fit the screen width, and 決定 moves on
  await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  expect(await app(page, "a => a.wizStage")).toBe(0); expect(await page.isVisible("#edit-create")).toBe(true);
  for (const id of ["#wiz-back", "#wiz-ok"]) { const b = (await page.locator(id).boundingBox())!; expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(vp.width); expect(b.height).toBeGreaterThanOrEqual(28); }
  await tap(page, "#wiz-ok"); expect(await app(page, "a => a.wizStage")).toBe(1);
  // 3. era stage -> seats stage
  await tap(page, "#wiz-ok"); expect(await app(page, "a => a.wizStage")).toBe(2);
  // 4. the capital is put on the map by touch: tab -> prefecture -> 地図で選ぶ -> tap the map -> confirm
  await tap(page, "#setup-tab-capital"); await page.selectOption("#seat-sel-capital", "JP-23"); await tap(page, "#pref-map");
  const nagoya = await cityPos(page, "名古屋市"); await page.evaluate((q) => (window as any).__kfm.r.setView({ cx: q[0], cy: q[1], zoom: 1 }, true), nagoya);
  const [sx, sy] = await screenOf(page, [nagoya[0] + 12, nagoya[1] + 4]); await page.touchscreen.tap(sx, sy);
  await page.waitForFunction(() => !!(window as any).__kfm.seatPick, null, { timeout: 10000 }); expect(await page.isVisible("#seat-confirm")).toBe(true); await tap(page, "#seat-confirm");
  expect(await app(page, "a => a.s.capital")).toBe("JP-23"); expect(await app(page, "a => !!a.s.capitalPos")).toBe(true);
  await tap(page, "#wiz-ok"); expect(await app(page, "a => a.wizStage")).toBe(3);
  // 5. 国道1号: a one-finger drag from the capital to the sub-capital
  await app(page, "a => { a.r.fit(a.s); return 1; }"); await tap(page, "#tool-cer-kokudo1");
  const from = await app(page, "a => { const w = a.world, c = w.cities.find((x) => x.pref === a.s.capital && x.kind === 'capital'); return c.pos; }") as [number, number], to = await cityPos(page, "大阪市");
  const A = await screenOf(page, from), B = await screenOf(page, to); const cdp = await page.context().newCDPSession(page);
  await touchDrag(cdp, lerp(A, B, 16)); await page.waitForFunction(() => (window as any).__kfm.cerDraft.kokudo1?.prev?.ok, null, { timeout: 20000 });
  await tap(page, "#wiz-ok"); expect(await app(page, "a => a.wizStage")).toBe(4); await page.waitForSelector("#wiz-review");
  // 6. the ceremony, then time moves at x20 and the map keeps working
  expect(await page.isEnabled("#cer-go")).toBe(true); await tap(page, "#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  await tap(page, "#speed-20"); const m0 = (await app(page, "a => a.sim.month")) as number; await page.waitForFunction((m) => (window as any).__kfm.sim.month > (m as number) + 6, m0, { timeout: 120000 });
  // 7. save, reload, and the same game is back (seats, month, the road)
  await page.evaluate(() => { (window as any).__kfm.sim.speed = 0; }); const before = await app(page, "a => [a.sim.capital, !!a.sim.capitalPos, a.sim.month, Object.keys(a.sim.routes).length]") as [string, boolean, number, number];
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForSelector("#intro-modal"); await tap(page, "#intro-ok"); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  const after = await app(page, "a => [a.sim.capital, !!a.sim.capitalPos, a.sim.month, Object.keys(a.sim.routes).length]") as [string, boolean, number, number];
  expect(after[0]).toBe(before[0]); expect(after[1]).toBe(before[1]); expect(after[3]).toBe(before[3]); expect(Math.abs(after[2] - before[2])).toBeLessThanOrEqual(1);
  expect(errs).toEqual([]);
});

/** A started game on the phone-sized screen, set up the quick way (the full path is the test above). */
async function startQuick(page: Page) {
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  await page.evaluate(() => (window as any).__kfm.wizGo(3)); await tap(page, "#tool-cer-kokudo1");
  const A = await screenOf(page, await cityPos(page, "東京")), B = await screenOf(page, await cityPos(page, "大阪市")), cdp = await page.context().newCDPSession(page);
  await touchDrag(cdp, lerp(A, B, 16)); await page.waitForFunction(() => (window as any).__kfm.cerDraft.kokudo1?.prev?.ok, null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__kfm.wizGo(0)); await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  for (let k = 0; k < 4; k++) await tap(page, "#wiz-ok");   /* every stage is confirmed with the real button, the way the player does it */
  await page.waitForSelector("#wiz-review"); await tap(page, "#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
}

test("Pixel 7a-size touch: the relocation wizard (back, snapshot, mid-wizard reload), the fully automatic skip, and the return to manual", async ({ page }) => {
  test.setTimeout(480000); const errs = watchErrors(page); await startQuick(page);
  const origin = (await app(page, "a => [a.sim.startYear, a.sim.relocFirst]")) as number[]; expect(origin).toEqual([1950, 2100]);
  // manual: the event opens at the first boundary and the clock stops
  await jump(page, 2100, "priority"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "pending", null, { timeout: 90000 }); await page.waitForSelector("#e22-box");
  const m0 = (await app(page, "a => a.sim.month")) as number; await page.waitForTimeout(1500); expect(await app(page, "a => a.sim.month")).toBe(m0);
  { const b = (await page.locator("#sheet").boundingBox())!; expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1); }
  // reload in the first stage: the event is still open, the clock still stopped, the wizard starts again from its first stage
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 }); await page.waitForSelector("#e22-box");
  expect(await app(page, "a => [a.sim.e2200.state, a.rwStage]")).toEqual(["pending", 0]);
  await tap(page, "#e22-era-1"); await tap(page, "#e22-next"); await page.selectOption("#e22-sel-sub", "JP-40"); await page.selectOption("#e22-sel-capital", "JP-27"); await page.selectOption("#e22-sel-sub", "JP-13"); await tap(page, "#e22-decide");   /* (a prefecture already taken by the other seat is refused by the list itself, so the swap goes through a third one) */
  expect(await app(page, "a => [a.sim.e2200.state, a.sim.capital, a.rwStage]")).toEqual(["road0", "JP-27", 2]);
  // back from the road: the game is restored from the snapshot, the choices are still on the sheet
  await tap(page, "#rw-back"); await page.waitForSelector("#e22-box"); expect(await app(page, "a => [a.sim.e2200.state, a.rwStage]")).toEqual(["pending", 1]); expect(await page.locator("#e22-sel-capital").inputValue()).toBe("JP-27");
  await tap(page, "#e22-decide"); expect(await app(page, "a => a.sim.e2200.state")).toBe("road0");
  // back WITHOUT a snapshot (the stored copy is deleted and the memory copy is lost): it says so, stays on the road stage, and nothing is half-applied
  { const key = (await app(page, "a => a.saveKey")) as string;
    await page.evaluate((k) => new Promise<void>(async (res, rej) => { const name = (await indexedDB.databases()).map((d) => d.name!).find((n) => n.startsWith("kfm-stage1"))!;   /* (a namespaced playtest build names its database kfm-stage1-<ns>) */ const r = indexedDB.open(name, 1); r.onsuccess = () => { const db = r.result, t = db.transaction("saves", "readwrite"); t.objectStore("saves").delete(k + ":relocsnap"); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }; r.onerror = () => rej(r.error); }), key);
    await page.evaluate(() => { (window as any).__kfm.rwSnap = null; });
    await tap(page, "#rw-back"); await page.waitForTimeout(500);
    expect(await app(page, "a => [a.sim.e2200.state, a.sim.capital, a.rwStage]")).toEqual(["road0", "JP-27", 2]); expect(await page.isVisible("#toast")).toBe(true); expect(await page.textContent("#toast")).toContain("選び直し"); }
  // the road stage -> review -> back to the road stage (that part needs no snapshot)
  await tap(page, "#road0-skip"); expect(await page.isVisible("#rw-confirm")).toBe(true); await tap(page, "#rw-back"); expect(await app(page, "a => a.rwStage")).toBe(2);
  await tap(page, "#road0-skip"); await tap(page, "#rw-confirm"); await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "done", null, { timeout: 60000 });
  expect(await app(page, "a => a.sim.capital")).toBe("JP-27");
  // fully automatic: the next boundary (2250) is skipped whole and the clock does not stop
  const eras = JSON.stringify(await app(page, "a => a.sim.kaigen.eras")); await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.sim.policy.pending = null; if (a.sheet === "policy") { a.sheet = null; a.buildSheet(); } });
  await jump(page, 2250, "auto"); await page.waitForFunction(() => ((window as any).__kfm.sim.relocSkipped ?? []).length === 1, null, { timeout: 90000 });
  expect(await app(page, "a => a.sim.relocSkipped")).toEqual([2250]); expect(await app(page, "a => a.relocOpen()")).toBe(false); expect(JSON.stringify(await app(page, "a => a.sim.kaigen.eras"))).toBe(eras); expect(await app(page, "a => a.sim.capital")).toBe("JP-27");
  const m1 = (await app(page, "a => a.sim.month")) as number; await page.waitForFunction((m) => (window as any).__kfm.sim.month > (m as number) + 3, m1, { timeout: 90000 });
  // back to manual: nothing is made up, the next boundary is 2400 (start 1950 + 150 x 3)
  await page.evaluate(() => { const s = (window as any).__kfm.sim; s.policy.mode = "priority"; s.speed = 0; });
  expect(await app(page, "a => a.sim.e2200.state")).toBe("done"); expect(await app(page, "a => { const d = a.sim; return [d.relocFirst, d.relocSkipped.length, d.e2200.n]; }")).toEqual([2100, 1, 0]);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => [a.sim.relocFirst, a.sim.relocSkipped, a.sim.e2200.state]")).toEqual([2100, [2250], "done"]);   // the skipped boundary survives the reload and does not fire again
  expect(errs).toEqual([]);
});

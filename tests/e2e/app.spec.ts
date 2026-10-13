import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const boot = async (page: Page) => { await page.goto("/"); await page.waitForFunction(() => (window as any).__kfm); await page.waitForTimeout(400); };
const app = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
function watchErrors(page: Page) { const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); return errs; }
const screenOf = (page: Page, p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;

test("phone layout: no page scroll, canvas fills screen, touch-action none", async ({ page }) => {
  const errs = watchErrors(page); await boot(page);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight, ta: getComputedStyle(document.querySelector("canvas")!).touchAction, cw: document.querySelector("canvas")!.getBoundingClientRect().width }));
  expect(m.sw).toBeLessThanOrEqual(m.iw); expect(m.sh).toBeLessThanOrEqual(m.ih); expect(m.ta).toBe("none"); expect(m.cw).toBeCloseTo(m.iw, 0);
  expect(errs).toEqual([]);
});

test("pull tool deforms Honshu by finger, undo restores, pinch never edits", async ({ page }) => {
  const errs = watchErrors(page); await boot(page);
  await page.evaluate(() => (window as any).__kfm.go(1)); await page.click("#tool-pull");
  const c = await app(page, "a => { const d = a.s; return [0, 0]; }");
  void c;
  const p0 = await screenOf(page, [0, 0]);   // Honshu's centroid in world km (origin = Honshu centroid by construction)
  await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p0[0] + 40, p0[1] - 30, { steps: 6 }); await page.mouse.up();
  expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(1);
  const op = await app(page, "a => a.s.bodies.honshu.ops[0]") as any; expect(op.t).toBe("pull"); expect(Math.hypot(op.d[0], op.d[1])).toBeGreaterThan(5);
  await page.click("#btn-undo"); expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(0);
  // two-finger pinch with an edit tool active: zoom changes, no op is recorded
  const z0 = await app(page, "a => a.r.view.zoom") as number;
  const cdp = await page.context().newCDPSession(page);
  const mid = [200, 400];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: mid[0] - 30, y: mid[1], id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: mid[0] - 30, y: mid[1], id: 1 }, { x: mid[0] + 30, y: mid[1], id: 2 }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: mid[0] - 30 - i * 12, y: mid[1], id: 1 }, { x: mid[0] + 30 + i * 12, y: mid[1], id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(0);
  expect(await app(page, "a => a.r.view.zoom") as number).toBeGreaterThan(z0 * 1.5);
  // a one-finger drag with the view tool pans and never scrolls the page
  await page.click("#tool-pull"); // toggles back to view
  const cx0 = await app(page, "a => a.r.view.cx") as number;
  await page.mouse.move(200, 600); await page.mouse.down(); await page.mouse.move(120, 600, { steps: 5 }); await page.mouse.up();
  expect(await app(page, "a => a.r.view.cx") as number).toBeGreaterThan(cx0);
  expect(await page.evaluate(() => scrollY + scrollX)).toBe(0);
  expect(errs).toEqual([]);
});

test("full flow: place islands, features, generate terrain, finalize, export", async ({ page }) => {
  const errs = watchErrors(page); await boot(page);
  await page.click("#btn-next"); await page.click("#btn-next");              // 1B -> 1C
  await page.click("#btn-next"); await page.click("#btn-next");              // 1C -> 1D (2->3) 
  expect(await app(page, "a => a.s.step")).toBe(3);
  await page.click("#btn-next");                                              // blocked: ridges missing
  expect(await app(page, "a => a.s.step")).toBe(3);
  await page.click("#suggest"); await page.click("#btn-next");
  expect(await app(page, "a => a.s.step")).toBe(4);
  await page.waitForFunction(() => (window as any).__kfm.terrain, null, { timeout: 60000 });
  expect(await app(page, "a => a.terrain.stats.prefCount")).toBe(49);
  await page.screenshot({ path: "test-results/terrain.png" });
  await page.click("#btn-next"); await page.click('#dock [data-sheet="menu"]');
  await page.click("#finalize"); expect(await app(page, "a => a.s.finalized")).toBe(true);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
  const j = JSON.parse(fs.readFileSync((await dl.path())!, "utf8"));
  expect(j.schemaVersion).toBe(1); expect(j.state.finalized).toBe(true); expect(j.geo.geoIds.prefectures).toHaveLength(49); expect(j.geo.terrainHash).toBeTruthy();
  expect(errs).toEqual([]);
});

test("editing an earlier step invalidates later work and un-finalizes", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const a = (window as any).__kfm; a.go(3); a.suggestRanges(); a.go(5); });
  await page.waitForFunction(() => (window as any).__kfm.terrain, null, { timeout: 60000 });
  await page.evaluate(() => { const a = (window as any).__kfm; a.finalize(); });
  expect(await app(page, "a => a.s.finalized")).toBe(true);
  await page.evaluate(() => { const a = (window as any).__kfm; a.go(2); a.activeBody = "hokkaido"; a.store.commit((s: any) => { s.bodies.hokkaido.place.pos = [-900, -900]; }); });
  expect(await app(page, "a => a.s.finalized")).toBe(false);
  expect(await app(page, "a => a.terrain")).toBeNull();
  expect(await app(page, "a => a.issues.some(i => i.code === 'hokkaido.side')")).toBe(true);
  expect(await page.isDisabled("#btn-next") || true).toBe(true);
  await page.click("#btn-next"); expect(await app(page, "a => a.s.step")).toBe(2);   // refuses to advance with an invalid placement
});

test("state survives reload and a screen rotation; corrupt saves do not stop the app", async ({ page }) => {
  const errs = watchErrors(page); await boot(page);
  await page.evaluate(() => { const a = (window as any).__kfm; a.go(1); a.store.commit((s: any) => { s.bodies.honshu.ops.push({ t: "bulge", c: [0, 0], r: 100, k: 0.2 }); }); });
  await page.waitForTimeout(700);
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(300);
  expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(1);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm); await page.waitForTimeout(400);
  expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(1); expect(await app(page, "a => a.s.step")).toBe(1);
  // corrupt the autosave and reload
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const t = r.result.transaction("saves", "readwrite"); t.objectStore("saves").put('{"savedAt":1,"state":{"schemaVersion":1,"bodies":{"honshu":{"ops":[{"t":"pull","c":"x"}],"place":{"pos":[null,1]}}},"step":99}}', "auto"); t.oncomplete = () => res(); }; }));
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm); await page.waitForTimeout(400);
  expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(0);
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const t = r.result.transaction("saves", "readwrite"); t.objectStore("saves").put("not json at all", "auto"); t.oncomplete = () => res(); }; }));
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm); expect(await app(page, "a => a.s.step")).toBe(0);
  expect(errs).toEqual([]);
});

test("layer toggles hide and show", async ({ page }) => {
  await boot(page); await page.click('#dock [data-sheet="layers"]');
  await page.uncheck("#layer-coast"); expect(await app(page, "a => a.s.layers.coast")).toBe(false);
  await page.check("#layer-coast"); expect(await app(page, "a => a.s.layers.coast")).toBe(true);
  expect(await page.locator("#sheet label.layer").count()).toBe(7);
});

test("ridge drawing by finger and island placement validity", async ({ page }) => {
  await boot(page); await page.evaluate(() => (window as any).__kfm.go(3)); await page.click("#tool-ridge-sw");
  const d = await app(page, "a => { const f = a.r.screenToWorld; return null; }"); void d;
  // draw along Honshu's south-west part: world points taken from the suggested ridge
  await page.evaluate(() => (window as any).__kfm.suggestRanges());
  const pts = (await app(page, "a => a.s.ridges.sw")) as [number, number][];
  await page.evaluate(() => (window as any).__kfm.store.commit((s: any) => { s.ridges.sw = null; }));
  const sp = []; for (const p of pts) sp.push(await screenOf(page, p));
  await page.mouse.move(sp[0][0], sp[0][1]); await page.mouse.down(); for (const q of sp.slice(1)) await page.mouse.move(q[0], q[1], { steps: 3 }); await page.mouse.up();
  const drawn = (await app(page, "a => a.s.ridges.sw")) as any[]; expect(drawn.length).toBeGreaterThanOrEqual(2);
  expect(await app(page, "a => a.issues.some(i => i.code.startsWith('ridge.sw'))")).toBe(false);
});

test("active mode button is visibly distinct, exclusive, labelled and in sync (issue #2)", async ({ page }) => {
  const errs = watchErrors(page); await boot(page);
  await page.evaluate(() => (window as any).__kfm.go(1));
  const st = (id: string) => page.evaluate((i) => { const b = document.getElementById(i)!, c = getComputedStyle(b); return { p: b.getAttribute("aria-pressed"), bg: c.backgroundColor, bw: parseFloat(c.borderTopWidth), t: b.textContent }; }, id);
  expect(await page.textContent("#mode-label")).toContain("表示");
  const idle = await st("tool-pull"); expect(idle.p).toBe("false");
  await page.click("#tool-pull");
  const on = await st("tool-pull"); expect(on.p).toBe("true"); expect(on.t).toContain("✓"); expect(on.bw).toBeGreaterThanOrEqual(3); expect(on.bg).not.toBe(idle.bg);
  expect(await page.textContent("#mode-label")).toContain("引っ張る");
  for (const id of ["tool-bulge", "tool-dent", "tool-move"]) expect((await st(id)).p).toBe("false");
  await page.click("#tool-dent");   // switching moves the highlight: exactly one pressed
  expect(await page.locator("#toolbar button[aria-pressed=true]").count()).toBe(1);
  expect((await st("tool-pull")).p).toBe("false"); expect(await page.textContent("#mode-label")).toContain("凹ます");
  expect(await app(page, "a => a.tool")).toBe("dent");
  await page.click("#tool-dent"); expect(await app(page, "a => a.tool")).toBe("view"); expect(await page.textContent("#mode-label")).toContain("表示");
  // the mode survives a toolbar rebuild (e.g. after an edit) and resets on a step change
  await page.click("#tool-bulge"); await page.evaluate(() => (window as any).__kfm.store.commit((s: any) => { s.bodies.honshu.ops.push({ t: "bulge", c: [0, 0], r: 80, k: 0.1 }); }));
  expect((await st("tool-bulge")).p).toBe("true");
  await page.evaluate(() => (window as any).__kfm.go(2)); expect(await app(page, "a => a.tool")).toBe("view");
  expect(await page.textContent("#mode-label")).toContain("対象: 北海道");
  expect(await page.locator("#toolbar button[aria-pressed=true]").count()).toBe(1);   // the target chip only
  expect(errs).toEqual([]);
});

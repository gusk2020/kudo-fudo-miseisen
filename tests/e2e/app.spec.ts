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
  expect(j.schemaVersion).toBe(2); expect(j.map.schemaVersion).toBe(1); expect(j.map.finalized).toBe(true); expect(j.sim).toBeNull(); expect(j.mapHash).toBeTruthy(); expect(j.geo.geoIds.prefectures).toHaveLength(49); expect(j.geo.terrainHash).toBeTruthy();
  expect(errs).toEqual([]);
});

test("a finalised map is locked: edits are refused until explicitly unlocked", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const a = (window as any).__kfm; a.go(3); a.suggestRanges(); a.go(5); });
  await page.waitForFunction(() => (window as any).__kfm.terrain, null, { timeout: 60000 });
  await page.evaluate(() => (window as any).__kfm.finalize());
  expect(await app(page, "a => a.s.finalized")).toBe(true);
  expect(await app(page, "a => a.store.commit(s => { s.bodies.hokkaido.place.pos = [-900, -900]; })")).toBe(false);
  expect(await app(page, "a => a.s.bodies.hokkaido.place.pos[0] !== -900")).toBe(true); expect(await app(page, "a => a.s.finalized")).toBe(true);
  await page.evaluate(() => (window as any).__kfm.go(2)); expect(await page.isVisible("#lock-banner")).toBe(true); expect(await page.locator("#tool-pull, #tool-move").count()).toBe(0);
  await page.click("#unlock-map"); expect(await app(page, "a => a.s.finalized")).toBe(false);
  await page.evaluate(() => { const a = (window as any).__kfm; a.activeBody = "hokkaido"; a.store.commit((s: any) => { s.bodies.hokkaido.place.pos = [-900, -900]; }); });
  expect(await app(page, "a => a.terrain")).toBeNull();
  expect(await app(page, "a => a.issues.some(i => i.code === 'hokkaido.side')")).toBe(true);
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

// ---------------- Stage 2 ----------------
async function toRoads(page: Page) {
  await boot(page);
  await page.evaluate(() => { const a = (window as any).__kfm; a.go(3); a.suggestRanges(); a.go(5); });
  await page.waitForFunction(() => (window as any).__kfm.terrain, null, { timeout: 60000 });
  await page.evaluate(() => (window as any).__kfm.finalize());
  await page.click("#btn-next"); expect(await app(page, "a => a.s.step")).toBe(6);
}
/** Draw a curve on screen between two world points (straight line of mouse moves). */
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenOf(page, from), b = await screenOf(page, to);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 14 }); await page.mouse.up();
}
const cityPos = (page: Page, name: string) => page.evaluate((n) => (window as any).__kfm.world.cities.find((c: any) => c.name === n).pos, name) as Promise<[number, number]>;

test("開通の儀: invalid line is refused with a reason, valid lines start the clock", async ({ page }) => {
  const errs = watchErrors(page); await toRoads(page);
  expect(await page.textContent("#era-note")).toContain("光文"); expect(await page.isDisabled("#cer-go")).toBe(true);
  const tokyo = await cityPos(page, "東京"), nagoya = await cityPos(page, "名古屋市"), osaka = await cityPos(page, "大阪市");
  await page.click("#tool-cer-kokudo1"); expect(await page.getAttribute("#tool-cer-kokudo1", "aria-pressed")).toBe("true"); expect(await page.textContent("#mode-label")).toContain("国道1号を描く");
  await draw(page, osaka, nagoya);   // does not start in Tokyo
  expect(await page.textContent("#cer-status-kokudo1")).toContain("東京府"); expect(await page.isDisabled("#cer-go")).toBe(true);
  await draw(page, tokyo, nagoya);
  expect(await page.textContent("#cer-status-kokudo1")).toContain("✓");
  await page.click("#tool-cer-fudo1");
  const inTokyo = await page.evaluate(() => { const a = (window as any).__kfm, w = a.world; const t = w.cities.find((c: any) => c.name === "東京"); let best: any = null, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-13") { const p = w.cellPos(k), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; best = p; } } return best; });
  await draw(page, tokyo, inTokyo);
  expect(await page.textContent("#cer-status-fudo1")).toContain("✓"); expect(await page.isDisabled("#cer-go")).toBe(false);
  await page.click("#cer-go");
  expect(await app(page, "a => !!a.sim && a.sim.ceremonyDone && a.sim.speed")).toBe(1);
  expect(await app(page, "a => Object.values(a.sim.routes).filter(r => (r.grade === 'national' && r.number === 1 && r.scope === 'JP') || (r.grade === 'fu' && r.number === 1 && r.scope === 'JP-13')).length")).toBe(2);
  expect(await app(page, "a => Object.values(a.sim.routes).some(r => /酷道|腐道|険道/.test(r.name))")).toBe(false);
  expect(await page.textContent("#status")).toContain("光文6年(1950)1月");
  expect(errs).toEqual([]);
});

test("time controls, road layer updates without rebuilding terrain, status HUD", async ({ page }) => {
  const errs = watchErrors(page); await toRoads(page);
  await page.evaluate(() => { const a = (window as any).__kfm, w = a.world, t = w.cities.find((c: any) => c.name === "東京"), n = w.cities.find((c: any) => c.name === "名古屋市"); const pv = (k: string, pts: any) => ({ pts, prev: null }); void pv; a.cerDraft.kokudo1 = null; a.__pts = [t.pos, n.pos]; });
  const tokyo = await cityPos(page, "東京"), nagoya = await cityPos(page, "名古屋市");
  await page.click("#tool-cer-kokudo1"); await draw(page, tokyo, nagoya); await page.click("#tool-cer-fudo1");
  const far = await page.evaluate(() => { const w = (window as any).__kfm.world, t = w.cities.find((c: any) => c.name === "東京"); let best: any = null, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-13") { const p = w.cellPos(k), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; best = p; } } return best; });
  await draw(page, tokyo, far); await page.click("#cer-go");
  const sprite0 = await app(page, "a => a.r.base.children.length");
  await page.click("#speed-20"); expect(await page.getAttribute("#speed-20", "aria-pressed")).toBe("true"); expect(await page.getAttribute("#speed-1", "aria-pressed")).toBe("false");
  await page.waitForFunction(() => (window as any).__kfm.sim.month >= 40, null, { timeout: 30000 });
  expect(await app(page, "a => a.r.base.children.length")).toBe(sprite0);   // terrain layers untouched by ticks
  await page.click("#speed-0"); const m = await app(page, "a => a.sim.month") as number; await page.waitForTimeout(800); expect(await app(page, "a => a.sim.month")).toBe(m);
  const hud = await page.textContent("#status"); expect(hud).toContain("停止中"); expect(hud).toContain("路線"); expect(hud).toContain("建設中"); expect(hud).toContain("状態");
  await page.click("#btn-history"); expect(await page.locator("#sheet .issue").count()).toBeGreaterThan(0); expect(await page.textContent("#sheet")).toContain("原因"); await page.click("#sheet-close");
  await page.click("#tool-pick"); const spot = await screenOf(page, tokyo); await page.mouse.click(spot[0], spot[1]);
  expect(JSON.parse((await page.textContent("#scenery-json"))!).schema).toBe("kfm.scenery.v1");
  expect(errs).toEqual([]);
});

test("roads survive reload; mismatching map quarantines roads instead of misplacing them", async ({ page }) => {
  const errs = watchErrors(page); await toRoads(page);
  await page.evaluate(() => { const a = (window as any).__kfm, w = a.world, t = w.cities.find((c: any) => c.name === "東京"), n = w.cities.find((c: any) => c.name === "名古屋市"); a.setCer = null; return [t.pos, n.pos]; });
  const tokyo = await cityPos(page, "東京"), nagoya = await cityPos(page, "名古屋市");
  await page.click("#tool-cer-kokudo1"); await draw(page, tokyo, nagoya); await page.click("#tool-cer-fudo1");
  const far = await page.evaluate(() => { const w = (window as any).__kfm.world, t = w.cities.find((c: any) => c.name === "東京"); let best: any = null, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-13") { const p = w.cellPos(k), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; best = p; } } return best; });
  await draw(page, tokyo, far); await page.click("#cer-go");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.persist(); }); const before = await app(page, "a => JSON.stringify(Object.keys(a.sim.edges))");
  await page.waitForTimeout(500); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 60000 });
  expect(await app(page, "a => JSON.stringify(Object.keys(a.sim.edges))")).toBe(before); expect(await app(page, "a => a.s.step")).toBe(6);
  // tamper with the saved map (as if edited elsewhere) and reload: roads must not load onto it
  await page.evaluate(() => { (window as any).__kfm.persist = () => Promise.resolve(true); });   // stop the page's own pagehide save from overwriting the tampered copy
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const db = r.result, g = db.transaction("saves").objectStore("saves").get("auto"); g.onsuccess = () => { const j = JSON.parse(g.result); j.save.map.bodies.honshu.place.rot = 0.2; const t = db.transaction("saves", "readwrite"); t.objectStore("saves").put(JSON.stringify(j), "auto"); t.oncomplete = () => res(); }; }; }));
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm); await page.waitForTimeout(1500);
  expect(await app(page, "a => a.sim")).toBeNull();
  const q = await page.evaluate(() => new Promise<any>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const g = r.result.transaction("saves").objectStore("saves").get("auto:quarantine"); g.onsuccess = () => res(g.result ? JSON.parse(g.result) : null); }; }));
  expect(q).not.toBeNull(); expect(Object.keys(q.quarantine.edges).length).toBeGreaterThan(0);
  expect(errs).toEqual([]);
});

test("v1 save in IndexedDB still opens (migrated), without losing the map", async ({ page }) => {
  const errs = watchErrors(page); await page.goto("/"); await page.waitForFunction(() => (window as any).__kfm);
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const s = { schemaVersion: 1, seed: 99, step: 3, bodies: { honshu: { ops: [{ t: "bulge", c: [0, 0], r: 100, k: 0.2 }], place: { pos: [0, 0], rot: 0, scale: 1 } } }, features: {}, ridges: {}, finalized: false, layers: {} }; const t = r.result.transaction("saves", "readwrite"); t.objectStore("saves").put(JSON.stringify({ savedAt: 1, state: s }), "auto"); t.oncomplete = () => res(); }; }));
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm); await page.waitForTimeout(500);
  expect(await app(page, "a => a.s.seed")).toBe(99); expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(1); expect(await app(page, "a => a.s.step")).toBe(3); expect(await app(page, "a => a.sim")).toBeNull();
  expect(errs).toEqual([]);
});

async function startGame(page: Page) {
  await toRoads(page);
  const tokyo = await cityPos(page, "東京"), nagoya = await cityPos(page, "名古屋市");
  await page.click("#tool-cer-kokudo1"); await draw(page, tokyo, nagoya); await page.click("#tool-cer-fudo1");
  const far = await page.evaluate(() => { const w = (window as any).__kfm.world, t = w.cities.find((c: any) => c.name === "東京"); let best: any = null, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-13") { const p = w.cellPos(k), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; best = p; } } return best; });
  await draw(page, tokyo, far); await page.click("#cer-go");
}
test("long absence: catch-up is capped, reported, and never freezes the page", async ({ page }) => {
  const errs = watchErrors(page); await startGame(page);
  // persist() stamps 'now' synchronously but the stored copy is serialised later, so backdate right after calling it
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 20; const p = a.persist.bind(a); p(); a.sim.lastWallMs = Date.now() - 7 * 24 * 3600 * 1000; a.persist = () => Promise.resolve(true); });
  await page.waitForTimeout(400); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 60000 });
  // the page stays responsive while catching up
  const t0 = Date.now(); await page.evaluate(() => 1); expect(Date.now() - t0).toBeLessThan(3000);
  await page.waitForFunction(() => !(window as any).__kfm.catching && (window as any).__kfm.sim.skippedMonths > 0, null, { timeout: 60000 });
  const r = await page.evaluate(() => { const s = (window as any).__kfm.sim; return { month: s.month, skipped: s.skippedMonths, ev: s.events.some((e: any) => e.kind === "skip") }; });
  expect(r.month).toBeGreaterThanOrEqual(360); expect(r.month).toBeLessThan(420); expect(r.skipped).toBeGreaterThan(0); expect(r.ev).toBe(true);
  expect(await page.textContent("#status")).toContain("省略"); expect(errs).toEqual([]);
});

test("step 6 phone layout: toolbar fits, HUD readable, no page scroll", async ({ page }) => {
  await startGame(page); await page.waitForTimeout(500);
  const m = await page.evaluate(() => { const tb = document.getElementById("toolbar")!.getBoundingClientRect(), st = document.getElementById("status")!.getBoundingClientRect(); return { tbTop: tb.top, tbH: tb.height, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, stBottom: st.bottom }; });
  expect(m.sw).toBeLessThanOrEqual(m.iw); expect(m.tbH).toBeLessThan(m.ih * 0.43); expect(m.stBottom).toBeLessThan(m.tbTop);
  await page.screenshot({ path: "test-results/stage2-hud.png" });
});

test("decline you can see: legend, comparison with 1950, and tap-for-why", async ({ page }) => {
  const errs = watchErrors(page); await startGame(page);
  await page.click("#speed-0"); await page.evaluate(() => (window as any).__kfm.ffYears(60));
  expect(await app(page, "a => a.sim.month")).toBeGreaterThanOrEqual(720);
  // legend: every class is spelled out in words, not colour alone
  await page.click("#btn-legend"); const legend = await page.textContent("#sheet");
  for (const w of ["良", "荒廃", "休止", "閉鎖", "廃道", "旧道", "バイパス", "国道", "県道", "府道", "市町村道", "工事中", "未成線", "通称"]) expect(legend, w).toContain(w);
  await page.click("#sheet-close");
  // comparison with 1950 switches on and is announced in the button itself
  await page.click("#btn-compare"); await page.click("#cmp-1950");
  expect(await app(page, "a => a.compareYear")).toBe(1950); await page.click("#sheet-close"); expect(await page.getAttribute("#btn-compare", "aria-pressed")).toBe("true"); expect(await page.textContent("#btn-compare")).toContain("1950");
  // tap a road that has a history: the sheet explains designation, state, demand and the history
  const spot = await page.evaluate(() => { const a = (window as any).__kfm, s = a.sim, w = a.world; const e = Object.values<any>(s.edges).filter((x) => x.hist.length >= 2 && x.state !== "lost").sort((p: any, q: any) => q.hist.length - p.hist.length)[0]; const k = e.cells[Math.floor(e.cells.length / 2)]; return { id: e.id, pos: w.cellPos(k) }; });
  await page.click("#tool-why"); expect(await page.getAttribute("#tool-why", "aria-pressed")).toBe("true");
  const sp = await screenOf(page, spot.pos); await page.mouse.click(sp[0], sp[1]);
  expect(await page.isVisible("#why-designation")).toBe(true); const why = await page.textContent("#sheet"); expect(why).toContain("行政指定"); expect(why).toContain("需要"); expect(why).toContain("履歴");
  expect(await app(page, "a => a.selEdge")).not.toBeNull();
  await page.screenshot({ path: "test-results/stage2-why.png" }); expect(errs).toEqual([]);
});

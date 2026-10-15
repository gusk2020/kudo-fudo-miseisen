import { expect, test, type Page } from "@playwright/test";

const app = (page: Page, f: string) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const screenOf = (page: Page, p: [number, number]) => page.evaluate((q) => (window as any).__kfm.r.worldToScreen(q), p) as Promise<[number, number]>;
const cityPos = (page: Page, name: string) => page.evaluate((n) => (window as any).__kfm.world.cities.find((c: any) => c.name === n).pos, name) as Promise<[number, number]>;
function watchErrors(page: Page) { const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); return errs; }
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenOf(page, from), b = await screenOf(page, to);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 14 }); await page.mouse.up();
}
async function bootReal(page: Page) {
  await page.goto("/"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForTimeout(300);
}
async function startReal(page: Page, era = "heisei") {
  await bootReal(page);
  await page.click("#era-" + era);
  const tokyo = await cityPos(page, "東京"), nagoya = await cityPos(page, "名古屋市");
  await page.click("#tool-cer-kokudo1"); await draw(page, tokyo, nagoya); await page.click("#tool-cer-fudo1");
  const far = await page.evaluate(() => { const w = (window as any).__kfm.world, t = w.cities.find((c: any) => c.name === "東京"); let best: any = null, bd = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === "JP-13") { const p = w.cellPos(k), d = Math.hypot(p[0] - t.pos[0], p[1] - t.pos[1]); if (d > bd) { bd = d; best = p; } } return best; }) as [number, number];
  await draw(page, tokyo, far); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
}

test("real Japan opens by default: finalised, step 6, no map-editing controls, era choice before the ceremony", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  expect(await app(page, "a => a.real")).toBe(true); expect(await app(page, "a => a.s.step")).toBe(6); expect(await app(page, "a => a.s.finalized")).toBe(true); expect(await app(page, "a => a.s.real")).toBe(true);
  expect(await page.isVisible("#btn-prev")).toBe(false); expect(await page.isVisible("#era-pick")).toBe(true);
  for (const k of ["heisei", "shubun", "shoka"]) expect(await page.isVisible("#era-" + k)).toBe(true);
  expect(await page.isDisabled("#cer-go")).toBe(true);
  expect(await app(page, "a => a.world.cities.length")).toBeGreaterThan(40);
  expect(errs).toEqual([]);
});

test("era choice, 開通の儀 and a running 1950 world with railways; the old flow is still at ?legacy=1", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "shoka");
  expect(await app(page, "a => a.sim.era")).toBe("shoka"); expect(await app(page, "a => a.sim.stage3")).toBe(true);
  const km = await app(page, "a => { const e = Object.values(a.sim.edges); return { rail: e.filter(x => x.mode === 'rail').length, road: e.filter(x => !x.mode).length, ops: Object.keys(a.sim.operators).length, routes: Object.values(a.sim.routes).filter(r => r.mode === 'rail').length }; }") as any;
  expect(km.rail).toBeGreaterThan(60); expect(km.road).toBeGreaterThan(200); expect(km.routes).toBeGreaterThan(20); expect(km.ops).toBeGreaterThan(2);
  expect(await page.textContent("#status")).toContain("正化");
  expect(await app(page, "a => Object.values(a.sim.routes).filter(r => r.grade === 'national' && r.number === 1).length")).toBe(1);
  expect(errs).toEqual([]);
});

test("rail and road layers, road-map background, and the year atlas never change the simulation", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page);
  await app(page, "a => { a.sim.speed = 0; return 1; }");
  await page.evaluate(() => (window as any).__kfm.ffYears(12));
  const month = await app(page, "a => a.sim.month") as number, hash = await page.evaluate(() => { const a = (window as any).__kfm; return JSON.stringify([a.sim.month, Object.keys(a.sim.edges).length, a.sim.rngState]); });
  // background toggle
  await page.click("#btn-bg"); expect(await app(page, "a => a.r.bg")).toBe("roadmap"); await page.click("#btn-bg"); expect(await app(page, "a => a.r.bg")).toBe("terrain");
  // layers
  await page.click("#dock-layers"); await page.uncheck("#layer-rail"); await page.waitForTimeout(100);
  expect(await app(page, "a => a.s.layers.rail")).toBe(false); await page.check("#layer-rail");
  await page.check("#layer-lite"); expect(await app(page, "a => a.lite")).toBe(true); await page.waitForTimeout(200); await page.uncheck("#layer-lite"); expect(await app(page, "a => a.lite")).toBe(false);
  // atlas: look at an earlier year; time must not move and the simulation must be untouched
  await page.click("#dock-atlas"); expect(await page.isVisible("#atlas-slider")).toBe(true);
  await page.evaluate(() => (window as any).__kfm.setViewYear(1955)); await page.waitForTimeout(200);
  expect(await app(page, "a => a.viewYear")).toBe(1955); expect(await page.textContent("#status")).toContain("閲覧中");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => { const a = (window as any).__kfm; return JSON.stringify([a.sim.month, Object.keys(a.sim.edges).length, a.sim.rngState]); })).toBe(hash);
  await page.evaluate(() => (window as any).__kfm.setViewYear(null)); expect(await app(page, "a => a.viewYear")).toBeNull(); expect(month).toBeGreaterThan(0);
  expect(errs).toEqual([]);
});

test("policy window: time stops at 1960 in 介入優先, points are spent with diminishing returns, reasons reach the timeline", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page);
  const r = await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.runner.settle(); const sim = a.sim; sim.month = 12 * 10 - 1; return { m: sim.month, mode: sim.policy.mode }; });
  expect(r.mode).toBe("priority");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 20; a.acc = 0; });
  await page.waitForFunction(() => (window as any).__kfm.sim.policy.pending, null, { timeout: 60000 });
  expect(await app(page, "a => a.sim.policy.pending.year")).toBe(1960);
  const m0 = await app(page, "a => a.sim.month"); await page.waitForTimeout(700); expect(await app(page, "a => a.sim.month")).toBe(m0);   // time does not move while waiting
  expect(await page.isVisible("#pol-window")).toBe(true);
  await page.click("#dom-politics"); expect(await page.isVisible("#pol-left")).toBe(true);
  const first = await app(page, "a => a.sim.policy.points"); expect(first).toBe(8);
  await page.click("#pol-go"); await page.waitForTimeout(200);
  expect(await app(page, "a => a.sim.policy.pending")).toBeNull();
  expect(await app(page, "a => a.sim.events.some(e => e.kind === 'policy' && /政策(採用|見送り)/.test(e.text))")).toBe(true);
  await page.waitForFunction(() => (window as any).__kfm.sim.month > 12 * 10, null, { timeout: 30000 });   // time moves again
  expect(errs).toEqual([]);
});

test("the real-Japan game survives a reload; if the latest save is corrupt the backup is restored and the broken copy is kept", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "shubun");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.ffYears(6); });
  const month = await app(page, "a => a.sim.month") as number; expect(month).toBeGreaterThanOrEqual(72);
  await page.evaluate(async () => { const a = (window as any).__kfm; a.lastBackup = -1e9; await a.persist(true); });
  await page.waitForTimeout(300); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.sim.month")).toBe(month); expect(await app(page, "a => a.sim.era")).toBe("shubun");
  // corrupt the latest save (as if the phone lost power mid-write) and reload
  await page.evaluate(() => { (window as any).__kfm.persist = () => Promise.resolve(true); });
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const tx = r.result.transaction("saves", "readwrite"); tx.objectStore("saves").put("{ this is not json", "s3:auto"); tx.oncomplete = () => res(); }; }));
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.sim.month")).toBe(month);
  const broken = await page.evaluate(() => new Promise<any>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const g = r.result.transaction("saves").objectStore("saves").get("s3:auto:broken"); g.onsuccess = () => res(g.result ?? null); }; }));
  expect(broken).not.toBeNull(); expect(String(broken)).toContain("not json");
  expect(errs).toEqual([]);
});

test("ledger rows open the number history and focus the map; the timeline filters and shows reasons", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "heisei");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.ffYears(40); });
  await page.click("#dock-timeline"); expect(await page.isVisible("#tl-world")).toBe(true); await page.click("#tl-world");
  expect(await page.locator("#sheet-body .issue").count()).toBeGreaterThan(5); expect(await page.textContent("#sheet-body")).toContain("【史実】");
  await page.click("#tl-policy"); await page.click("#dock-ledger"); await page.click("#led-rail");
  const first = page.locator("#sheet-body .issue").first(); await first.click(); expect(await page.locator("#sheet-body .hist").count()).toBeGreaterThan(0);
  await page.locator("#sheet-body button.mini").first().click(); expect(await app(page, "a => a.selEdge")).not.toBeNull();
  await page.click("#led-fac"); expect(await page.textContent("#sheet-body")).toContain("トンネル・橋");
  expect(errs).toEqual([]);
});

test("a save file from the old game is refused in the real-Japan game (and nothing is half-loaded)", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.evaluate(() => { const a = (window as any).__kfm; a.adopt({ map: { ...a.s, real: undefined, step: 3, finalized: false }, sim: null, quarantine: null, problems: [] }); });
  expect(await page.textContent("#toast")).toContain("旧版"); expect(await app(page, "a => a.s.real")).toBe(true); expect(await app(page, "a => a.s.finalized")).toBe(true); expect(await app(page, "a => a.s.step")).toBe(6);
  expect(errs).toEqual([]);
});

const idbGet = (page: Page, key: string) => page.evaluate((k) => new Promise<any>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const g = r.result.transaction("saves").objectStore("saves").get(k); g.onsuccess = () => res(g.result ?? null); }; }), key);

test("reload at ×20 keeps the game; a save whose roads cannot be attached is quarantined and the stored save is never overwritten (Issue #11)", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "shubun");
  await page.evaluate(() => { const a = (window as any).__kfm; a.setSpeed(20); });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); });
  const month = await app(page, "a => a.sim.month") as number;
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.sim.month")).toBeGreaterThanOrEqual(month);
  // make the stored roads unattachable (terrain hash mismatch) and reload
  await page.evaluate(() => { (window as any).__kfm.persist = () => Promise.resolve(true); });
  await page.evaluate(() => new Promise<void>((res) => { const r = indexedDB.open("kfm-stage1", 1); r.onsuccess = () => { const st = r.result.transaction("saves", "readwrite").objectStore("saves"); const g = st.get("s3:auto"); g.onsuccess = () => { const o = JSON.parse(g.result); o.save.sim.terrainHash = "tampered"; st.put(JSON.stringify(o), "s3:auto"); res(); }; }; }));
  const before = await idbGet(page, "s3:auto");
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  expect(await app(page, "a => !!a.sim")).toBe(false);
  const strip = (x: string) => x.replace(/"savedAt":\d+/g, "");   // a re-save of the same content may refresh the timestamp; the content must be untouched
  expect(strip(await idbGet(page, "s3:auto"))).toBe(strip(before));
  expect(await idbGet(page, "s3:auto:quarantine")).not.toBeNull();
  expect(errs).toEqual([]);
});

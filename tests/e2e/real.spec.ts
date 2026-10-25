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
/** The first era is chosen from the 14 candidates of 1926; index 0/1/2 carry the balanced / road / rail stance. */
/** Issue #20: the era and the seats live in their own sheet (⚙ 元号・首都), not in the terrain menu. */
/** Stage 7: the terrain editor takes the whole toolbar while it is open, so it is closed first (the settings button lives outside it). */
async function editor(page: Page, open: boolean) { const on = (await page.getAttribute("#terrain-edit-toggle", "aria-pressed")) === "true"; if (on !== open) await page.click("#terrain-edit-toggle"); }
async function openTab(page: Page, tab: string) { if (await page.isVisible("#rw-close")) await page.click("#rw-close"); if (!(await page.isVisible("#setup-tab-" + tab))) await editor(page, false); if ((await page.getAttribute("#setup-tab-" + tab, "aria-selected")) !== "true") await page.click("#setup-tab-" + tab); }
async function openSetup(page: Page) { await openTab(page, "era"); if (!(await page.isVisible("#era-list"))) await page.click("#era-open"); await page.waitForSelector("#era-list"); }
async function openSeat(page: Page, which: string) { await openTab(page, which); await page.waitForSelector("#seat-sel-" + which); }
async function openMapPick(page: Page, which: string) { await openSeat(page, which); await page.click("#pref-map"); }
async function seatSelect(page: Page, which: string, val: string) { await openSeat(page, which); await page.selectOption("#seat-sel-" + which, val); }
async function closeSheet(page: Page) { if (await page.isVisible("#sheet-close")) await page.click("#sheet-close"); }
async function closeSetup(page: Page) { if (await page.isVisible("#rw-close")) await page.click("#rw-close"); if (await page.isVisible("#setup-close")) await page.click("#setup-close"); }
async function clickEra(page: Page, i: number) { await page.click("#era-opt-" + i); }
async function pickEra(page: Page, stance: string) { await openSetup(page); await clickEra(page, { heisei: 0, shubun: 1, shoka: 2 }[stance as "heisei"]); await closeSetup(page); }
async function startReal(page: Page, era = "heisei") {
  await bootReal(page);
  await pickEra(page, era);
  // Issue #15: the player draws one road only, from the capital (Tokyo by default) to the sub-capital (Osaka by default)
  const tokyo = await cityPos(page, "東京"), osaka = await cityPos(page, "大阪市");
  await page.click("#tool-cer-kokudo1"); await draw(page, tokyo, osaka);
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
}

test("real Japan opens by default: finalised, step 6, no map-editing controls, era choice before the ceremony", async ({ page }) => {
  await bootReal(page); expect(await app(page, "a => ['X-SADO','X-AWAJI','X-TSUSHIMA','X-IKI','X-OKI'].every((id) => a.world.cityById.has(id))")).toBe(true);
  const errs = watchErrors(page); await bootReal(page);
  expect(await app(page, "a => a.real")).toBe(true); expect(await app(page, "a => a.s.step")).toBe(6); expect(await app(page, "a => a.s.finalized")).toBe(true); expect(await app(page, "a => a.s.real")).toBe(true);
  expect(await page.isVisible("#btn-prev")).toBe(false); expect(await page.isVisible("#setup-tabs")).toBe(true);
  // Stage 19: four small tabs that fit the phone width; every panel is closed until a tab is pressed, and pressing another tab closes the first
  { const vw = page.viewportSize()!.width, boxes = await page.evaluate(() => ["era", "capital", "sub", "palace"].map((k) => { const r = document.getElementById("setup-tab-" + k)!.getBoundingClientRect(); return [r.left, r.right, r.height]; }));
    for (const [l, r, h] of boxes) { expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(vw); expect(h).toBeGreaterThanOrEqual(30); } expect(await page.locator("#setup-panel").count()).toBe(0);
    await page.click("#setup-tab-capital"); expect(await page.isVisible("#seat-sel-capital")).toBe(true); expect(await page.isVisible("#pref-map")).toBe(true);   // Stage 23: the tab shows the early picker (a select grouped by block) at once
    await page.click("#setup-tab-sub"); await page.selectOption("#seat-sel-sub", "JP-27"); expect(await page.locator("#setup-panel").count()).toBe(1); expect(await page.getAttribute("#setup-tab-capital", "aria-selected")).toBe("false"); await page.click("#setup-close"); expect(await page.locator("#setup-panel").count()).toBe(0); }
  await openSetup(page); expect(await page.locator("#era-current").count()).toBe(0);
  { const heads = await page.locator("#era-list .rw-head").evaluateAll((es) => es.map((e) => e.firstChild!.textContent)); expect(heads).toEqual(["道路重視", "鉄道・公共交通重視", "海路重視", "空路重視", "均衡"]); expect(await page.locator("#era-list .rw-item").count()).toBe(14); expect(await page.locator("#era-list .rw-item.on").count()).toBe(1);
    const rows = await page.locator("#era-list .rw-item").allTextContents(); for (const r of rows) { expect(r).not.toMatch(/道路重視|鉄道|海路重視|空路重視|均衡/); }   // the group says the policy once; a row carries only its own conditions
    expect(await page.locator("#era-list .rw-item.on .rw-dot").textContent()).toBe("●"); await page.click("#rw-close"); }
  await closeSheet(page); expect(await page.isDisabled("#cer-go")).toBe(true);
  expect(await app(page, "a => a.world.cities.length")).toBeGreaterThan(40);
  expect(errs).toEqual([]);
});

test("era choice, 開通の儀 and a running 1950 world with railways; the old flow is still at ?legacy=1", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "shoka");
  expect(await app(page, "a => a.sim.era")).toBe("shoka"); expect(await app(page, "a => a.sim.stage3")).toBe(true);
  const km = await app(page, "a => { const e = Object.values(a.sim.edges); return { rail: e.filter(x => x.mode === 'rail').length, road: e.filter(x => !x.mode).length, ops: Object.keys(a.sim.operators).length, routes: Object.values(a.sim.routes).filter(r => r.mode === 'rail').length }; }") as any;
  expect(km.rail).toBeGreaterThan(60); expect(km.road).toBeGreaterThan(200); expect(km.routes).toBeGreaterThan(20); expect(km.ops).toBeGreaterThan(2);
  expect(await page.textContent("#status")).toContain("神和");
  expect(await app(page, "a => Object.values(a.sim.routes).filter(r => r.grade === 'national' && r.number === 1).length")).toBe(1);
  // Stage 17: a new game starts from the 49 prefectural capitals, with a development order of the 49 prefectures
  expect(await app(page, "a => a.sim.pot17.order.length === 49 && Object.values(a.sim.pot17.shown).length === 49")).toBe(true);
  // Stage 16: a new game runs on the world with the provincial towns of its two seats' prefectures, and the sim says which
  expect(await app(page, "a => a.sim.towns16 && a.sim.towns16.length")).toBeGreaterThan(10);
  // Stage 18: the base map names the 49 capitals and nothing else at the start (no Kawasaki, Saitama-area towns ... from the first day)
  expect(await app(page, "a => a.r.capitalsOnly")).toBe(true); expect(await app(page, "a => { const caps = new Set(a.world.cities.filter((c) => c.kind === 'capital').map((c) => c.name)), t = a.r.labels.children.map((x) => x.text).filter((x) => x && !/首都|皇居/.test(x)); return t.length <= 49 && t.every((x) => caps.has(x)); }")).toBe(true);
  expect(await app(page, "a => a.world.townIds.join() === a.sim.towns16.join() && a.world.cities.filter(c => c.kind === 'town').length === a.sim.towns16.length")).toBe(true);
  expect(errs).toEqual([]);
});

test("rail and road layers, road-map background, and the year atlas never change the simulation", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page);
  await app(page, "a => { a.sim.speed = 0; return 1; }");
  await page.evaluate(() => (window as any).__kfm.ffYears(12));
  const month = await app(page, "a => a.sim.month") as number, hash = await page.evaluate(() => { const a = (window as any).__kfm; return JSON.stringify([a.sim.month, Object.keys(a.sim.edges).length, a.sim.rngState]); });
  // background toggle
  await page.click("#btn-bg"); expect(await app(page, "a => a.r.bg")).toBe("terrain"); await page.click("#btn-bg"); expect(await app(page, "a => a.r.bg")).toBe("roadmap");
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
  // Stage 16: the loaded game gets the same towns it was made with (a save never meets a different world)
  expect(await app(page, "a => a.sim.towns16.length > 10 && a.world.townIds.join() === a.sim.towns16.join()")).toBe(true);
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
  // make the stored roads unattachable (terrain hash mismatch) and reload. First stop the clock and let the last save land: a save still in flight at x20 on a slow runner could otherwise overwrite the tampered copy and make the check below compare the app's own re-save with it
  await page.evaluate(async () => { const a = (window as any).__kfm; a.setSpeed(0); await a.persist(true); });
  await page.waitForTimeout(1500);
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

test("defaults to the road map with route-name text hidden; legend toggles filter the display, never the simulation, and survive a reload", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "shubun");
  expect(await app(page, "a => a.bg")).toBe("roadmap"); expect(await app(page, "a => a.names")).toBe(false);
  const hashOf = () => app(page, "a => JSON.stringify([a.sim.month, Object.keys(a.sim.edges).length, a.sim.rngState])");
  await page.evaluate(() => { (window as any).__kfm.sim.speed = 0; });
  const before = await hashOf();
  await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = "legend"; a.buildSheet(); });
  await expect(page.locator("#legend-ops")).toBeVisible();
  await page.locator("#lg-s-lost").uncheck(); await page.locator("#lg-k-hwy").uncheck(); await page.locator("#lg-names").check();
  expect(await app(page, "a => [...a.hide].sort().join()")).toContain("k:hwy"); expect(await app(page, "a => a.names")).toBe(true);
  await page.locator("#lg-k-rail").uncheck(); expect(await app(page, "a => a.hide.has('k:rail')")).toBe(true);
  expect(await hashOf()).toBe(before);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); });
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.hide.has('st:lost') && a.hide.has('st:closed') && a.hide.has('k:hwy') && a.names && a.hide.has('k:rail')")).toBe(true);
  expect(errs).toEqual([]);
});

test("開通の儀 takes several strokes, undo/redo/restart work per kind, and a half-drawn ceremony survives a reload", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await pickEra(page, "heisei");
  const tokyo = await cityPos(page, "東京"), nagoya = await cityPos(page, "大阪市"), mid: [number, number] = [(tokyo[0] + nagoya[0]) / 2, (tokyo[1] + nagoya[1]) / 2];
  await page.click("#tool-cer-kokudo1");
  await draw(page, tokyo, mid); await draw(page, mid, nagoya);
  expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  await page.click("#cer-undo"); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(1);
  await page.click("#cer-redo"); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true);
  // a tap is not a stroke
  await page.mouse.click(mid[0], mid[1]); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  await page.waitForTimeout(600); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.waitForFunction(() => (window as any).__kfm.cerDraft.kokudo1, null, { timeout: 30000 });
  expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  await page.click("#tool-cer-kokudo1"); await page.click("#cer-restart"); expect(await app(page, "a => !a.cerDraft.kokudo1")).toBe(true);
  expect(errs).toEqual([]);
});

test("改元: time stops at 1989, the sheet opens by itself, the choice is kept through a reload, and the era names follow", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "heisei");
  expect(await app(page, "a => a.sim.kaigen.eras[0].name")).toBe("神化");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.sim.policy.mode = "priority"; a.ffYears(5); });
  // jump to the end of 1988 with the policy windows answered automatically, then let the clock reach the era change
  await page.evaluate(() => { const a = (window as any).__kfm, w = a.world; let g = 0; while (a.sim.month < 12 * 39 && g++ < 12 * 60) { (window as any).__adv(a.sim, w, 1); } a.sim.policy.pending = null; });
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.policy.mode = "priority"; a.sim.speed = 20; });
  await page.waitForFunction(() => (window as any).__kfm.sim.kaigen.pending, null, { timeout: 60000 });
  expect(await app(page, "a => !!a.sim.kaigen.pending")).toBe(true);
  {
    await page.evaluate(() => { (window as any).__kfm.tickClock(); });
    await expect(page.locator("#kaigen-window")).toBeVisible();
    expect(await page.locator("[id^=kaigen-pick-]").count()).toBe(3);
    const month = await app(page, "a => a.sim.month") as number; await page.waitForTimeout(400); expect(await app(page, "a => a.sim.month")).toBe(month);
    await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
    expect(await app(page, "a => a.sim.kaigen.pending && a.sim.kaigen.pending.year")).toBe(1989);
    await page.evaluate(() => { (window as any).__kfm.sheet = "kaigen"; (window as any).__kfm.buildSheet(); });
    // Stage 18: the candidates are in two tabs (道路系 / 鉄道系); the pick buttons are large enough for a thumb
    // Stage 19: the candidates are one list with a heading per transport group and one line per candidate (large enough for a thumb)
    expect(await page.textContent("#kaigen-current")).toContain("現在の元号"); expect(await page.locator(".era-head").count()).toBeGreaterThanOrEqual(2); expect(await page.locator("#kaigen-group-balanced").isVisible()).toBe(true);
    expect((await page.locator("#kaigen-pick-1").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.click("#kaigen-pick-1");
    expect(await app(page, "a => a.sim.kaigen.eras.map((e) => e.name).join()")).toBe("神化,修文");
    expect(await app(page, "a => a.sim.kaigen.pending")).toBeNull();
  }
  expect(errs).toEqual([]);
});

test("限定の地形編集: capital, Alps and Fuji can be set before the first road, undo/redo work, edits survive a reload, and the ceremony locks them", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle"); await page.click("#edit-more"); await expect(page.locator("#terrain-edit-note")).toContainText("海岸線");
  const hash0 = await app(page, "a => a.terrain.hash") as string;
  await page.click("#alps-real"); expect(await app(page, "a => !!a.s.ridges.ne && !!a.s.ridges.sw")).toBe(true);
  await page.waitForFunction((h) => (window as any).__kfm.terrain?.hash && (window as any).__kfm.terrain.hash !== h, hash0, { timeout: 60000 });
  await page.click("#edit-undo"); expect(await app(page, "a => a.s.ridges.ne === null")).toBe(true); await page.click("#edit-redo"); expect(await app(page, "a => !!a.s.ridges.ne")).toBe(true);
  await seatSelect(page, "capital", "JP-47"); expect(await app(page, "a => a.s.capital")).toBe("JP-47");   // Okinawa
  await seatSelect(page, "sub", "HK-SAP"); expect(await app(page, "a => a.s.subCapital")).toBe("HK-SAP");   // Sapporo
  await seatSelect(page, "palace", "JP-26"); expect(await app(page, "a => a.s.palace")).toBe("JP-26");
  await openSeat(page, "capital"); expect(await page.locator("#seat-sel-capital option").count()).toBe(49); await openSeat(page, "sub"); expect(await page.locator("#seat-sel-sub option[value=JP-47]").evaluate((o: HTMLOptionElement) => o.disabled)).toBe(true);   // the capital cannot be chosen again as the sub-capital
  await closeSheet(page); expect(await page.textContent("#tool-cer-kokudo1")).toContain("那覇");
  expect(await app(page, "a => a.s.finalized")).toBe(true); expect(await app(page, "a => a.s.bodies.honshu.ops.length")).toBe(0);   // the outline is never touched
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => a.s.capital === 'JP-47' && a.s.subCapital === 'HK-SAP' && a.s.palace === 'JP-26' && !!a.s.ridges.ne")).toBe(true); expect(await app(page, "a => a.s.islands")).toBe(true);
  // first road laid -> locked
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim = { fake: true }; });
  expect(await app(page, "a => a.commitEdit((s) => { s.capital = 'x'; })")).toBe(false); await page.evaluate(() => { (window as any).__kfm.sim = null; });
  expect(errs).toEqual([]);
});

test("政策介入: 「点を使わず決定」が最初から並び、「この選択にする」は分野の直下、持ち点は繰り越される", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "heisei");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.sim.policy.mode = "priority"; a.sim.speed = 20; });
  await page.waitForFunction(() => (window as any).__kfm.sim.policy.pending, null, { timeout: 60000 });
  await page.evaluate(() => { (window as any).__kfm.tickClock(); });
  await expect(page.locator("#pol-window")).toBeVisible(); await expect(page.locator("#pol-none")).toBeVisible();      // visible before any domain is chosen
  const rowTop = (await page.locator("#dom-politics").boundingBox())!, noneBox = (await page.locator("#pol-none").boundingBox())!; expect(Math.abs(noneBox.y - rowTop.y)).toBeLessThan(80);   // beside the three domains (same row, or wrapped one line below)
  expect(await page.locator("#pol-go").count()).toBe(0);
  await page.click("#dom-economy");
  const dom = (await page.locator("#dom-economy").boundingBox())!, go = (await page.locator("#pol-go").boundingBox())!, firstPolicy = (await page.locator("[id^='pol-p-'], [id^='pol-e-'], [id^='pol-o-']").first().boundingBox())!;
  expect(go.y).toBeGreaterThan(dom.y); expect(go.y).toBeLessThan(firstPolicy.y); expect(go.y - dom.y).toBeLessThan(140);   // right under the domain row, above the lists
  expect(await page.textContent("#pol-go")).toBe("この選択にする");
  const pointsBefore = await app(page, "a => a.sim.policy.points") as number, histBefore = await app(page, "a => a.sim.policy.history.length") as number;
  await page.click("#pol-none");
  expect(await app(page, "a => a.sim.policy.pending")).toBeNull(); expect(await app(page, "a => a.sim.policy.points")).toBe(pointsBefore);   // the points stay in the pool
  expect(await app(page, "a => a.sim.policy.history.length")).toBe(histBefore + 1); expect(await app(page, "a => a.sim.policy.history[a.sim.policy.history.length - 1].none")).toBe(true);
  expect(await app(page, "a => a.sim.mods.filter((m) => m.kind === 'policy' && m.from === a.sim.policy.lastWindow).length")).toBe(0);   // nothing was adopted
  await page.evaluate(() => { (window as any).__kfm.sim.speed = 20; }); await page.waitForFunction((n) => (window as any).__kfm.sim.policy.pending || (window as any).__kfm.sim.policy.points > n, pointsBefore, { timeout: 90000 });   // time runs again
  expect(errs).toEqual([]);
});

test("沖縄を首都、札幌を副首都にしても国道1号が成立し、海は船でつながり、保存・再読み込みで残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle");
  await seatSelect(page, "capital", "JP-47"); await seatSelect(page, "sub", "HK-SAP"); await closeSheet(page); await closeSetup(page);
  await editor(page, false);   // fold the panel so it does not cover the map
  expect(await page.textContent("#tool-cer-kokudo1")).toContain("那覇"); expect(await page.locator("#tool-cer-fudo1").count()).toBe(0);   // no 府道1号 to draw any more
  await page.click("#tool-cer-kokudo1");   // (the toolbar settles before the view is fitted to what is left of the screen)
  // fit the seven cities into the part of the screen above the toolbar
  const pts = await page.evaluate(() => {
    const a = (window as any).__kfm, w = a.world, c = (n: string) => w.cities.find((x: any) => x.name === n).pos, names = ["那覇市", "鹿児島市", "福岡市", "大阪市", "東京", "青森市", "札幌市"], P = names.map(c) as [number, number][];
    const x0 = Math.min(...P.map((p) => p[0])), x1 = Math.max(...P.map((p) => p[0])), y0 = Math.min(...P.map((p) => p[1])), y1 = Math.max(...P.map((p) => p[1])), W = window.innerWidth, H = window.innerHeight;
    const zoom = Math.min((W - 80) / (x1 - x0), (H * 0.5) / (y1 - y0)), cx = (x0 + x1) / 2, wyc = (y0 + y1) / 2; a.r.setView({ cx, cy: wyc + (Math.min(300, H * 0.37) - H / 2) / zoom, zoom }, true);
    return P.map((p) => a.r.worldToScreen(p)) as [number, number][];
  });
  for (const [x, y] of pts) { const hit = await page.evaluate(([px, py]) => (document.elementFromPoint(px, py) as HTMLElement)?.tagName ?? "", [x, y]); expect(hit, `(${x},${y}) is on the map`).toBe("CANVAS"); }
  for (let i = 0; i + 1 < pts.length; i++) { await page.mouse.move(pts[i][0], pts[i][1]); await page.mouse.down(); await page.mouse.move(pts[i + 1][0], pts[i + 1][1], { steps: 8 }); await page.mouse.up(); }
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true); expect(await app(page, "a => a.cerDraft.kokudo1.prev.ferries.length")).toBeGreaterThanOrEqual(3);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.segments.filter((s) => s.ferry).every((s) => s.cells.length === 2)")).toBe(true);
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 120000 });
  expect(await app(page, "a => { const r = Object.values(a.sim.routes).find((x) => x.grade === 'national' && x.number === 1); return r.edges.filter((e) => a.sim.edges[e.edgeId].facility === 'ferry').length; }")).toBeGreaterThanOrEqual(3);
  expect(await app(page, "a => a.sim.capital === 'JP-47' && a.sim.subCapital === 'HK-SAP'")).toBe(true);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.s.capital === 'JP-47' && a.s.subCapital === 'HK-SAP' && a.sim.capital === 'JP-47'")).toBe(true);
  expect(await app(page, "a => Object.values(a.sim.edges).filter((e) => e.facility === 'ferry').length")).toBeGreaterThanOrEqual(10);
  expect(errs).toEqual([]);
});

test("皇居: 49府県から選べ、首都と同じ府県でもよく、地図の点で位置を決めて保存される。琵琶湖・富士山の拡大縮小はUndo/Redoできる", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle");
  expect(await app(page, "a => a.s.palace")).toBeUndefined();   // the default (Tokyo) is not stored until chosen
  await seatSelect(page, "palace", "JP-13"); expect(await app(page, "a => a.s.palace")).toBe("JP-13");   // same prefecture as the capital is fine
  await seatSelect(page, "palace", "JP-26");
  // Stage 19: choose the palace on the map (anywhere on land, in any prefecture): the tap only proposes a point; 決定 keeps it, 取り消し drops it, the sea is refused
  await openMapPick(page, "palace"); expect(await app(page, "a => a.tool")).toBe("seatpick");
  const k = await app(page, "a => a.world.cellPos(a.world.cities.find((c) => c.pref === 'JP-26' && c.kind === 'capital').cell)") as [number, number];
  expect(await app(page, "a => a.tapSeat([0, -9999])")).toBe(false); expect(await app(page, "a => a.s.palacePos")).toBeUndefined();
  await page.evaluate((p) => { (window as any).__kfm.tapSeat([p[0] + 5, p[1] + 5]); }, k); expect(await app(page, "a => a.seatPick && a.seatPick.pref")).toBe("JP-26"); expect(await app(page, "a => a.s.palacePos")).toBeUndefined();
  await page.click("#seat-cancel"); expect(await app(page, "a => a.seatPick")).toBeNull();
  await page.evaluate((p) => { (window as any).__kfm.tapSeat([p[0] + 5, p[1] + 5]); }, k); await page.click("#seat-confirm");
  const pp = await app(page, "a => a.s.palacePos") as [number, number]; expect(pp).toBeTruthy(); expect(Math.abs(pp[0] - k[0] - 5)).toBeLessThan(0.01); expect(await app(page, "a => a.s.palace")).toBe("JP-26");
  await closeSheet(page); await editor(page, true); await page.click("#sel-biwa"); await page.click("#biwa-bigger"); await page.click("#biwa-bigger"); expect(await app(page, "a => a.s.features.biwa.scale")).toBeGreaterThan(1.2);
  await page.click("#sel-fuji"); await page.click("#fuji-higher"); expect(await app(page, "a => a.s.features.fuji.height")).toBeGreaterThan(1); await page.click("#fuji-narrower"); expect(await app(page, "a => a.s.features.fuji.scale")).toBeLessThan(1);
  await page.click("#edit-undo"); expect(await app(page, "a => a.s.features.fuji.scale")).toBeUndefined(); await page.click("#edit-redo"); expect(await app(page, "a => a.s.features.fuji.scale")).toBeLessThan(1);
  for (let i = 0; i < 12; i++) await page.click("#fuji-wider");   // widening is refused once the mountain would touch the coast: the map stays valid
  expect(await app(page, "a => a.issues.filter((i) => i.severity === 'error' && i.step === 'features').length")).toBe(0); expect(await app(page, "a => a.s.features.fuji.scale ?? 1")).toBeLessThanOrEqual(2);
  await page.click("#sel-biwa"); await page.click("#biwa-smaller"); await page.click("#biwa-smaller"); await page.click("#biwa-smaller"); expect(await app(page, "a => a.s.features.biwa.scale")).toBeLessThan(1);
  await page.waitForFunction(() => !(window as any).__kfm.generating && (window as any).__kfm.terrain, null, { timeout: 60000 });
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => a.s.palace === 'JP-26' && !!a.s.palacePos && !!a.s.features.fuji.height && !!a.s.features.biwa.scale")).toBe(true);
  expect(errs).toEqual([]);
});

test("凡例の「路線名」は国道だけでなく、鉄道と途中で自動生成された路線にも効き、番号標識とは別に保たれる", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "heisei");
  // Stage 10: number signs start OFF after the ceremony; the player switches them on in the layer sheet
  expect(await app(page, "a => a.s.layers.signs")).toBe(false); await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = "layers"; a.buildSheet(); }); await page.locator("#layer-signs").check();
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.ffYears(40); a.r.setView({ zoom: 1.4 }, true); a.renderRoads(); });
  const stat = () => page.evaluate(() => { const L = (window as any).__kfm.r.roads, vis = L.signs.filter((s: any) => s.c.visible); return { signs: vis.length, names: vis.filter((s: any) => s.nk.visible).length, texts: vis.map((s: any) => s.t.text), nameTexts: vis.filter((s: any) => s.nk.visible).map((s: any) => s.nk.text) }; });
  const off = await stat(); expect(off.signs).toBeGreaterThan(3); expect(off.names).toBe(0); expect(off.texts.every((x: string) => /^\d+$/.test(x))).toBe(true);   // number-only signs, no name text anywhere
  await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = "legend"; a.buildSheet(); }); await page.locator("#lg-names").check();
  const on = await stat(); expect(on.names).toBe(on.signs); expect(on.nameTexts.some((x: string) => x.includes("鉄道") || x.includes("線"))).toBe(true); expect(on.nameTexts.some((x: string) => x.includes("道"))).toBe(true);
  // zoom, the year slider and a reload keep the setting
  await page.evaluate(() => { const a = (window as any).__kfm; a.r.setView({ zoom: 2.2 }, true); a.renderRoads(); }); const z = await stat(); expect(z.names).toBe(z.signs);
  await page.evaluate(() => { const a = (window as any).__kfm; a.setViewYear(1975); }); const y = await stat(); expect(y.names).toBe(y.signs); await page.evaluate(() => { (window as any).__kfm.setViewYear(null); });
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  await page.evaluate(() => { const a = (window as any).__kfm; a.r.setView({ zoom: 1.4 }, true); a.renderRoads(); }); const back = await stat(); expect(back.names).toBe(back.signs);
  await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = "legend"; a.buildSheet(); }); await page.locator("#lg-names").uncheck(); const off2 = await stat(); expect(off2.names).toBe(0);
  expect(errs).toEqual([]);
});

/** Multi-touch through the browser's own input pipeline (CDP touch events) -- the closest the test can get to a finger on the Pixel 7a. */
async function touch(page: Page, steps: { type: "touchStart" | "touchMove" | "touchEnd"; pts: { x: number; y: number; id: number }[] }[]) {
  const cdp = await page.context().newCDPSession(page);
  for (const s of steps) { await cdp.send("Input.dispatchTouchEvent", { type: s.type, touchPoints: s.pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) }); await page.waitForTimeout(30); }
}
test("琵琶湖・富士山のタッチ操作: 1本指で移動、2本指で拡大縮小と回転、置けない所では元に戻り、Undo/Redo・保存で残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle"); await page.click("#sel-biwa");
  const lake = await app(page, "a => { let sx = 0, sy = 0, n = 0; for (let k = 0; k < a.world.N; k++) if (a.world.t.land[k] === 2) { const p = a.world.cellPos(k); sx += p[0]; sy += p[1]; n++; } return [sx / n, sy / n]; }") as [number, number];
  const box = await page.locator("#app canvas, canvas").first().boundingBox(); const off = { x: box?.x ?? 0, y: box?.y ?? 0 };
  const c = await screenOf(page, lake), P = (dx: number, dy: number, id: number) => ({ x: off.x + c[0] + dx, y: off.y + c[1] + dy, id });
  // one finger: a small drag moves the lake (a valid spot), and it stays a valid map
  await touch(page, [{ type: "touchStart", pts: [P(0, 0, 1)] }, { type: "touchMove", pts: [P(-1, 0, 1)] }, { type: "touchMove", pts: [P(-2, -1, 1)] }, { type: "touchEnd", pts: [] }]);
  const pos1 = await app(page, "a => a.s.features.biwa.pos") as [number, number] | null; expect(pos1).toBeTruthy();
  expect(await app(page, "a => a.issues.filter((i) => i.severity === 'error' && i.step === 'features').length")).toBe(0);
  // two fingers: pinch in (smaller) and twist -> scale and rotation change in ONE undo step
  const rot0 = await app(page, "a => a.s.features.biwa.rot") as number, n0 = await app(page, "a => a.store.undoStack.length") as number;
  const q = await screenOf(page, await app(page, "a => a.s.features.biwa.pos") as [number, number]), Q = (dx: number, dy: number, id: number) => ({ x: off.x + q[0] + dx, y: off.y + q[1] + dy, id });
  const ang = 0.4, r0 = 60, r1 = 42;
  await touch(page, [
    { type: "touchStart", pts: [Q(-r0, 0, 1), Q(r0, 0, 2)] },
    { type: "touchMove", pts: [Q(-r0 * 0.9, -5, 1), Q(r0 * 0.9, 5, 2)] },
    { type: "touchMove", pts: [Q(-r1 * Math.cos(ang), -r1 * Math.sin(ang), 1), Q(r1 * Math.cos(ang), r1 * Math.sin(ang), 2)] },
    { type: "touchEnd", pts: [] }]);
  const sc = await app(page, "a => a.s.features.biwa.scale") as number, rot1 = await app(page, "a => a.s.features.biwa.rot") as number;
  expect(sc).toBeLessThan(0.9); expect(sc).toBeGreaterThan(0.5);
  expect(rot1 - rot0).toBeLessThan(-0.1); expect(rot1 - rot0).toBeGreaterThan(-0.6);   // a clockwise twist on screen is a negative turn in the map's y-up frame
  expect(await app(page, "a => a.store.undoStack.length") as number).toBe(n0 + 1);
  await page.click("#edit-undo"); expect(await app(page, "a => a.s.features.biwa.scale")).toBeUndefined(); await page.click("#edit-redo"); expect(await app(page, "a => a.s.features.biwa.scale")).toBe(sc);
  // a pose that would put the lake in the sea is refused: nothing changes
  const before = await app(page, "a => JSON.stringify(a.s.features.biwa)") as string;
  expect(await app(page, "a => a.applyFeaturePose('biwa', { pos: [9000, 9000], rot: 0, scale: 1 })")).toBe(false); expect(await app(page, "a => JSON.stringify(a.s.features.biwa)")).toBe(before);
  // Fuji: its summit follows its size at half the proportion once the size is changed by hand (auto link), and a manual height stays off the link
  await page.click("#sel-fuji"); expect(await app(page, "a => a.applyFeaturePose('fuji', { pos: a.s.features.fuji.pos ?? a.world.cellPos(a.world.t.stats.fujiTopCell), rot: 0, scale: 0.8 })")).toBe(true);
  expect(await app(page, "a => a.s.features.fuji.auto")).toBe(true); expect(await page.textContent("#fuji-size")).toContain("高さ×0.9");
  await page.waitForFunction(() => !(window as any).__kfm.generating && (window as any).__kfm.terrain, null, { timeout: 60000 });
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => a.s.features.biwa.scale === " + sc + " && a.s.features.fuji.auto === true")).toBe(true);
  expect(errs).toEqual([]);
});

test("Issue #20: 置けない所で指を離しても止まらない(直前の状態に戻り、地形生成中のまま残らない)。ツールは再度押すと解除。府県は北から南", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  const healthy = async () => { await page.waitForFunction(() => { const a = (window as any).__kfm; return !!a.terrain && !a.generating; }, null, { timeout: 60000 }); expect(await app(page, "a => a.issues.filter((i) => i.severity === 'error').length")).toBe(0); expect(await page.textContent("#status")).not.toContain("不正"); };
  await page.click("#terrain-edit-toggle"); await page.click("#sel-biwa"); expect(await app(page, "a => a.tool")).toBe("feature");
  const box = await page.locator("canvas").first().boundingBox(); const off = { x: box?.x ?? 0, y: box?.y ?? 0 };
  const lakeAt = async () => screenOf(page, await app(page, "a => { let sx = 0, sy = 0, n = 0; for (let k = 0; k < a.world.N; k++) if (a.world.t.land[k] === 2) { const p = a.world.cellPos(k); sx += p[0]; sy += p[1]; n++; } return [sx / n, sy / n]; }") as [number, number]);
  // 1) one finger: drag the lake far out to sea and let go -> refused, put back, nothing stuck
  const before = await app(page, "a => JSON.stringify(a.s.features)") as string, undo0 = await app(page, "a => a.store.canUndo");
  let c = await lakeAt(); await touch(page, [{ type: "touchStart", pts: [{ x: off.x + c[0], y: off.y + c[1], id: 1 }] }, { type: "touchMove", pts: [{ x: off.x + c[0] + 60, y: off.y + c[1] + 60, id: 1 }] }, { type: "touchMove", pts: [{ x: off.x + c[0] + 160, y: off.y + c[1] + 140, id: 1 }] }, { type: "touchEnd", pts: [] }]);
  expect(await app(page, "a => JSON.stringify(a.s.features)")).toBe(before); expect(await app(page, "a => a.store.canUndo")).toBe(undo0); await healthy();
  // 2) two fingers: a huge spread and twist ending off the coast -> refused the same way
  c = await lakeAt(); await touch(page, [{ type: "touchStart", pts: [{ x: off.x + c[0] - 20, y: off.y + c[1], id: 1 }, { x: off.x + c[0] + 20, y: off.y + c[1], id: 2 }] }, { type: "touchMove", pts: [{ x: off.x + c[0] - 120, y: off.y + c[1] - 80, id: 1 }, { x: off.x + c[0] + 120, y: off.y + c[1] + 80, id: 2 }] }, { type: "touchEnd", pts: [] }]);
  expect(await app(page, "a => JSON.stringify(a.s.features)")).toBe(before); await healthy();
  // 5) a valid move still works afterwards, and survives a reload
  c = await lakeAt(); await touch(page, [{ type: "touchStart", pts: [{ x: off.x + c[0], y: off.y + c[1], id: 1 }] }, { type: "touchMove", pts: [{ x: off.x + c[0] - 1, y: off.y + c[1], id: 1 }] }, { type: "touchMove", pts: [{ x: off.x + c[0] - 2, y: off.y + c[1] - 1, id: 1 }] }, { type: "touchEnd", pts: [] }]);
  const moved = await app(page, "a => JSON.stringify(a.s.features.biwa.pos)") as string; expect(moved).not.toBe("null"); await healthy();
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => JSON.stringify(a.s.features.biwa.pos)")).toBe(moved); await healthy();
  await page.click("#terrain-edit-toggle"); await page.click("#sel-biwa");
  // 3) the rotation buttons, many times in a row on a big lake: each press is either a valid map or refused; never a stuck map
  for (let i = 0; i < 6; i++) await page.click("#biwa-bigger");
  for (let i = 0; i < 18; i++) await page.click("#rot-l");
  await healthy();
  // 4) a save written in an invalid state (before this fix) is put right by itself
  await page.evaluate(() => { (window as any).__kfm.store.set((s: any) => { s.features.fuji.pos = [9000, 9000]; }); });
  expect(await app(page, "a => a.s.features.fuji.pos")).toBeNull(); await healthy();
  // 6) toggles: pressing the active tool again turns it off and the map pans again; one-shot buttons stay one-shot
  if (await app(page, "a => a.tool") !== "view") await page.click("#sel-biwa");
  await page.click("#edit-more");   // Stage 7: the three ridge tools sit in the 山脈 group
  for (const id of ["#sel-biwa", "#sel-fuji", "#tool-ridge-ne", "#tool-ridge-sw", "#tool-ridge-edit"]) {
    await page.click(id); expect(await app(page, "a => a.tool"), id).not.toBe("view"); await page.click(id); expect(await app(page, "a => a.tool"), id).toBe("view");
  }
  await page.click("#sel-biwa"); await page.click("#sel-fuji"); expect(await app(page, "a => a.tool + ':' + a.selFeature")).toBe("feature:fuji");   // switching target, not off
  await page.click("#sel-fuji"); expect(await app(page, "a => a.tool")).toBe("view");
  const lake0 = await app(page, "a => JSON.stringify(a.s.features.biwa)"), cx0 = await app(page, "a => a.r.view.cx") as number; c = await lakeAt();
  await touch(page, [{ type: "touchStart", pts: [{ x: off.x + c[0], y: off.y + c[1], id: 1 }] }, { type: "touchMove", pts: [{ x: off.x + c[0] + 40, y: off.y + c[1], id: 1 }] }, { type: "touchEnd", pts: [] }]);
  expect(await app(page, "a => a.r.view.cx")).not.toBe(cx0); expect(await app(page, "a => JSON.stringify(a.s.features.biwa)")).toBe(lake0);   // panned, not edited
  await page.click("#terrain-edit-toggle"); await page.click("#terrain-edit-toggle"); await page.click("#sel-biwa"); await page.click("#sel-biwa"); expect(await app(page, "a => a.tool")).toBe("view");
  // 7) the compact terrain menu holds no era / seat controls; the seats are listed north to south (Hokkaido's three first, Okinawa last)
  expect(await page.locator("#toolbar #setup-tabs").count()).toBe(0);
  const tbH = await page.evaluate(() => document.getElementById("toolbar")!.getBoundingClientRect().height), vh = await page.evaluate(() => innerHeight); expect(tbH).toBeLessThan(vh * 0.45);
  await openSeat(page, "capital"); const ids = await page.locator("#seat-sel-capital option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(ids).toHaveLength(49); expect(ids.slice(0, 3).every((x) => x.startsWith("HK-"))).toBe(true); expect(ids[ids.length - 1]).toBe("JP-47");
  expect(errs).toEqual([]);
});

test("Stage 7: 地形編集は1行の小さなメニュー(対象を選んだ時だけ2行目)。地図の見える範囲が広い", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  const tbH = () => page.evaluate(() => Math.round(document.getElementById("toolbar")!.getBoundingClientRect().height));
  const closed = await tbH(); await page.click("#terrain-edit-toggle"); const open = await tbH(); const rows = await page.evaluate(() => new Set([...document.querySelectorAll("#toolbar button")].map((b) => Math.round(b.getBoundingClientRect().y))).size);
  await page.click("#sel-biwa"); const biwa = await tbH(); await page.click("#sel-fuji"); const fuji = await tbH(); await page.click("#edit-more"); const more = await tbH();
  console.log("toolbar heights", JSON.stringify({ closed, open, rows, biwa, fuji, more }));
  expect(rows).toBe(1); expect(open).toBeLessThan(closed * 0.5); expect(fuji).toBeLessThan(100); expect(more).toBeLessThan(140);
  expect(await page.locator("#toolbar #setup-tabs, #toolbar #tool-cer-kokudo1, #toolbar #cer-go").count()).toBe(0);   // nothing but the editor while it is open
  // the editor still does everything: undo / redo, rotate, size, close returns the ceremony controls
  await page.click("#rot-l"); expect(await app(page, "a => a.s.features.fuji.rot")).not.toBe(0); await page.click("#edit-undo"); expect(await app(page, "a => a.s.features.fuji.rot")).toBe(0); await page.click("#edit-redo"); expect(await app(page, "a => a.s.features.fuji.rot")).not.toBe(0);
  await page.click("#terrain-edit-toggle"); expect(await app(page, "a => a.tool")).toBe("view"); expect(await page.isVisible("#tool-cer-kokudo1")).toBe(true);
  expect(errs).toEqual([]);
});

test("Stage 7: 地図帳に交通の移り変わり(道路・鉄道の延長と鉄道の分担のグラフ、最近の転機)が出る", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "shubun");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.sim.policy.mode = "auto"; a.ffYears(40); });
  await page.click("#dock-atlas");
  await expect(page.locator("#trends")).toBeVisible();
  expect(await page.locator("#trend-km polyline").count()).toBe(2); expect(await page.locator("#trend-share polyline").count()).toBe(3);
  const pts = await page.locator("#trend-km polyline").first().getAttribute("points"); expect((pts ?? "").split(" ").length).toBeGreaterThan(30);
  expect(await app(page, "a => a.sim.stats.filter((s) => s.paxRail !== undefined).length")).toBeGreaterThan(30);
  expect(await app(page, "a => a.sim.stats[a.sim.stats.length - 1].paxRail < 0.5")).toBe(true);   // the road-minded line: the railway carries a minority of passenger-km by 1990
  expect(errs).toEqual([]);
});

test("Stage 8: 国道1号を琵琶湖の上に引くと湖岸で止まり湖上フェリーで渡る。Undo/Redo・保存で残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page); await pickEra(page, "heisei");
  const pts = await page.evaluate(() => {
    const a = (window as any).__kfm, w = a.world; let x = 0, y = 0, n = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 2) { const p = w.cellPos(k); x += p[0]; y += p[1]; n++; }
    const c = [x / n, y / n], t = w.cities.find((q: any) => q.name === "東京").pos, o = w.cities.find((q: any) => q.name === "大阪市").pos, P = [t, [c[0] + 30, c[1]], [c[0] - 30, c[1]], o] as [number, number][];
    const x0 = Math.min(...P.map((p) => p[0])), x1 = Math.max(...P.map((p) => p[0])), y0 = Math.min(...P.map((p) => p[1])), y1 = Math.max(...P.map((p) => p[1])), W = window.innerWidth, H = window.innerHeight;
    const zoom = Math.min((W - 80) / (x1 - x0), (H * 0.45) / (y1 - y0)); a.r.setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + (Math.min(300, H * 0.37) - H / 2) / zoom, zoom }, true);
    return P.map((p) => a.r.worldToScreen(p)) as [number, number][];
  });
  await page.click("#tool-cer-kokudo1");
  for (let i = 0; i + 1 < pts.length; i++) { await page.mouse.move(pts[i][0], pts[i][1]); await page.mouse.down(); await page.mouse.move(pts[i + 1][0], pts[i + 1][1], { steps: 10 }); await page.mouse.up(); }
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true);
  expect(await app(page, "a => (a.cerDraft.kokudo1.prev.lakes || []).length")).toBe(1);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.lakes[0].kind")).toBe("ferry");
  expect(await page.textContent("#cer-status-kokudo1")).toContain("湖上フェリー");
  await page.click("#cer-undo"); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  await page.click("#cer-redo"); expect(await app(page, "a => (a.cerDraft.kokudo1.prev.lakes || []).length")).toBe(1);
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  const lakeOnR1 = "a => { const r = Object.values(a.sim.routes).find((x) => x.grade === 'national' && x.number === 1); return r.edges.some((e) => (a.sim.edges[e.edgeId].facilityName || '').includes('【湖】')); }";
  expect(await app(page, lakeOnR1)).toBe(true);
  // no road cell of 国道1号 lies on the lake
  expect(await app(page, "a => { const r = Object.values(a.sim.routes).find((x) => x.grade === 'national' && x.number === 1); return r.edges.map((e) => a.sim.edges[e.edgeId]).filter((e) => !e.facility).every((e) => e.cells.every((k) => a.world.t.land[k] === 1)); }")).toBe(true);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, lakeOnR1)).toBe(true);
  expect(errs).toEqual([]);
});

test("Stage 8: 港湾・空港・航路がレイヤーで切り替わり(シミュレーションは不変)、地図帳と年表に開設・拡張が載り、過去の年の網も見られる", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "heisei");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.sim.policy.mode = "auto"; a.ffYears(35); });
  expect(await app(page, "a => Object.values(a.sim.hubs.airports).some((x) => x.kind === 'hub')")).toBe(true);
  expect(await app(page, "a => a.sim.hubs.routes.filter((r) => r.state === 'open').length")).toBeGreaterThan(10);
  const h0 = await app(page, "a => JSON.stringify(a.sim.hubs).length + ':' + a.sim.month");
  await page.click("#dock-layers"); for (const k of ["ports", "airports", "lanes"]) { await page.uncheck("#layer-" + k); expect(await app(page, `a => a.s.layers.${k}`)).toBe(false); }
  for (const k of ["ports", "airports", "lanes"]) await page.check("#layer-" + k);
  expect(await app(page, "a => JSON.stringify(a.sim.hubs).length + ':' + a.sim.month")).toBe(h0);
  await closeSheet(page);
  await page.click("#dock-atlas"); await expect(page.locator("#hubs")).toBeVisible(); await expect(page.locator("#hub-summary")).toContainText("国際ハブ");
  expect(await page.locator("#trend-hubs polyline").count()).toBe(3);
  await page.click("#hub-airports summary"); await expect(page.locator("#hub-airports")).toContainText("国際ハブ空港");
  // a past year: fewer airports than now, and the atlas says which year it shows
  await page.evaluate(() => (window as any).__kfm.setViewYear(1960)); await page.waitForTimeout(200); if (!(await page.isVisible("#hubs"))) await page.click("#dock-atlas");
  await expect(page.locator("#hubs")).toContainText("1960年");
  expect(await app(page, "a => a.viewYear")).toBe(1960);
  await page.evaluate(() => (window as any).__kfm.setViewYear(null));
  await page.click("#dock-timeline"); await page.click("#tl-hub");
  await expect(page.locator("#sheet-body .issue").filter({ hasText: /空港|港|便|航路/ }).first()).toBeVisible();
  expect(errs).toEqual([]);
});

/** Stage 9: fit the given world points into the map area above the toolbar and return their screen positions. */
async function fitPts(page: Page, names: string[]): Promise<[number, number][]> {
  return page.evaluate((ns) => {
    const a = (window as any).__kfm, w = a.world, P = ns.map((n: string) => w.cities.find((x: any) => x.name === n).pos) as [number, number][];
    const x0 = Math.min(...P.map((p) => p[0])), x1 = Math.max(...P.map((p) => p[0])), y0 = Math.min(...P.map((p) => p[1])), y1 = Math.max(...P.map((p) => p[1])), W = window.innerWidth, H = window.innerHeight;
    const zoom = Math.min((W - 80) / (x1 - x0), (H * 0.42) / (y1 - y0)); a.r.setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + (Math.min(300, H * 0.37) - H / 2) / zoom, zoom }, true);
    return P.map((p) => a.r.worldToScreen(p));
  }, names);
}
async function stroke(page: Page, pts: [number, number][]) { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i][0], pts[i][1], { steps: 8 }); await page.mouse.up(); }

test("Stage 9: 四国を通る国道1号は四国経由のまま。制御点を動かせ、区間を選んで消す・描き直すと前後につながり、Undo/Redo・再読み込みで残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page); await pickEra(page, "heisei");
  const P = await fitPts(page, ["東京", "名古屋市", "大阪市", "徳島市", "高松市", "松山市", "広島市", "岡山市", "大阪市"]);
  await page.click("#tool-cer-kokudo1");
  await stroke(page, P.slice(0, 4)); await stroke(page, P.slice(3, 7)); await stroke(page, P.slice(6));
  expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(3);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true);
  const shikoku = "a => { const w = a.world, lm = w.lm[w.cities.find((c) => c.name === '高松市').cell]; return a.cerDraft.kokudo1.prev.cells.some((k) => w.lm[k] === lm); }";
  expect(await app(page, shikoku)).toBe(true);
  // move a control point: the draft changes, one Undo step
  await page.click("#cer-mode-move"); const n0 = await app(page, "a => a.cerDraft.kokudo1.past.length") as number;
  const cp = await page.evaluate(() => { const a = (window as any).__kfm, q = a.cerDraft.kokudo1.strokes[1][1]; return [a.r.worldToScreen(q), q]; }) as [[number, number], [number, number]];
  await page.mouse.move(cp[0][0], cp[0][1]); await page.mouse.down(); await page.mouse.move(cp[0][0] + 12, cp[0][1] + 10, { steps: 5 }); await page.mouse.up();
  expect(await app(page, "a => a.cerDraft.kokudo1.past.length")).toBe(n0 + 1);
  expect(await app(page, `a => { const q = a.cerDraft.kokudo1.strokes[1][1]; return q[0] !== ${cp[1][0]} || q[1] !== ${cp[1][1]}; }`)).toBe(true);
  expect(await app(page, shikoku)).toBe(true);
  // pick the middle stroke, delete it, undo; then redraw it: its ends join the neighbours
  await page.click("#cer-mode-pick");
  const mid = await page.evaluate(() => { const a = (window as any).__kfm, st = a.cerDraft.kokudo1.strokes[1]; return a.r.worldToScreen(st[Math.floor(st.length / 2)]); }) as [number, number];
  await page.mouse.click(mid[0], mid[1]); expect(await app(page, "a => a.cerSel")).toBe(1);
  await page.click("#cer-del"); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  await page.click("#cer-undo"); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(3);
  await page.click("#cer-redo"); expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(2);
  await page.click("#cer-undo");
  await page.mouse.click(mid[0], mid[1]); await page.click("#cer-redraw"); expect(await app(page, "a => a.cerMode")).toBe("draw");
  await stroke(page, [P[3], P[4], P[5]].map((p) => [p[0] + 4, p[1] + 4] as [number, number]));
  expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(3);
  expect(await app(page, "a => { const s = a.cerDraft.kokudo1.strokes; return s[1][0][0] === s[0][s[0].length - 1][0] && s[1][s[1].length - 1][0] === s[2][0][0]; }")).toBe(true);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true); expect(await app(page, shikoku)).toBe(true);
  await page.waitForTimeout(500); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.cerDraft?.kokudo1, null, { timeout: 90000 });
  expect(await app(page, "a => a.cerDraft.kokudo1.strokes.length")).toBe(3); expect(await app(page, shikoku)).toBe(true); expect(await app(page, "a => a.cerDraft.kokudo1.past.length")).toBeGreaterThan(0);
  await page.click("#tool-cer-kokudo1"); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  expect(await app(page, "a => { const w = a.world, lm = w.lm[w.cities.find((c) => c.name === '高松市').cell], r = Object.values(a.sim.routes).find((x) => x.grade === 'national' && x.number === 1); return r.edges.some((e) => a.sim.edges[e.edgeId].cells.some((k) => w.lm[k] === lm)); }")).toBe(true);
  expect(errs).toEqual([]);
});

test("Stage 9: 山脈は何本でも継ぎ足せて、点を動かせる。Undo/Redo・再読み込みで残り、地形に反映される。首都・副首都・皇居は1行ずつ", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle"); await page.click("#edit-more");
  const P = await fitPts(page, ["名古屋市", "静岡市", "長野市", "甲府市"]);
  const hash0 = await app(page, "a => a.terrain.hash") as string;
  await page.click("#tool-ridge-ne"); await stroke(page, [P[0], P[2]]);
  await page.waitForFunction((h) => { const t = (window as any).__kfm.terrain; return !!t && t.hash !== h; }, hash0, { timeout: 60000 });
  expect(await app(page, "a => (a.s.ridges.ne || []).length")).toBeGreaterThan(1);
  const hash1 = await app(page, "a => a.terrain.hash") as string;
  await stroke(page, [P[1], P[3]]);   // a second, separate stroke of the same range
  expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(1);
  await page.waitForFunction((h) => { const t = (window as any).__kfm.terrain; return !!t && t.hash !== h; }, hash1, { timeout: 60000 });
  await page.click("#edit-undo"); expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(0);
  await page.click("#edit-redo"); expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(1);
  // move a point of the added stroke
  await page.click("#tool-ridge-edit"); const q = await page.evaluate(() => { const a = (window as any).__kfm, p = a.s.ridgeExtra.ne[0][0]; return [a.r.worldToScreen(p), p]; }) as [[number, number], [number, number]];
  await page.mouse.move(q[0][0], q[0][1]); await page.mouse.down(); await page.mouse.move(q[0][0] + 10, q[0][1] - 8, { steps: 4 }); await page.mouse.up();
  expect(await app(page, `a => a.s.ridgeExtra.ne[0][0][0] !== ${q[1][0]}`)).toBe(true);
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(1);
  expect(errs).toEqual([]);
});

test("Stage 19: 首都を地図の任意の陸地でタップして選べる。誤タップは決定まで何も変えず、取り消せ、海は拒否され、保存・再読み込みで位置が残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await openMapPick(page, "capital"); expect(await app(page, "a => a.tool")).toBe("seatpick");
  const nagoya = await cityPos(page, "名古屋市"), spot: [number, number] = [nagoya[0] + 12, nagoya[1] + 9];   // a land point near Nagoya, not the 県庁所在地 itself
  await page.evaluate((p) => { const a = (window as any).__kfm, H = window.innerHeight; a.r.setView({ cx: p[0], cy: p[1] + (200 - H / 2) / 3, zoom: 3 }, true); }, spot);
  const [sx, sy] = await screenOf(page, spot);
  await page.mouse.click(sx, sy); expect(await app(page, "a => a.seatPick && a.seatPick.pref")).toBe("JP-23"); expect(await app(page, "a => a.s.capital")).toBeUndefined();   // proposed only
  expect(await page.isVisible("#seat-confirm")).toBe(true); expect(await page.textContent("#seat-map-hint")).toContain("愛知県");
  await page.click("#seat-cancel"); expect(await app(page, "a => a.seatPick")).toBeNull(); expect(await app(page, "a => a.s.capital")).toBeUndefined();
  expect(await app(page, "a => a.tapSeat([0, -9999])")).toBe(false);   // the sea (or anywhere off the land) is refused safely
  expect(await app(page, "a => a.tapSeat(a.world.cellPos(a.world.cities.find((c) => c.pref === 'JP-27' && c.kind === 'capital').cell))")).toBe(false);   // Osaka's prefecture is the sub-capital's: refused for the capital
  await page.mouse.click(sx, sy); await page.click("#seat-confirm");
  expect(await app(page, "a => a.s.capital")).toBe("JP-23"); const cp = await app(page, "a => a.s.capitalPos") as [number, number]; expect(Math.abs(cp[0] - spot[0])).toBeLessThan(2); expect(await app(page, "a => a.s.subCapital")).toBeUndefined();
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.waitForTimeout(300); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 }); await page.waitForTimeout(500);
  expect(await app(page, "a => a.s.capital")).toBe("JP-23"); expect(await app(page, "a => a.s.capitalPos")).toEqual(cp);   // the exact point came back
  await openTab(page, "capital"); expect(await page.textContent("#seat-current")).toContain("地図で指定");
  await page.click("#seat-reset"); expect(await app(page, "a => a.s.capitalPos")).toBeUndefined(); expect(await app(page, "a => a.s.capital")).toBe("JP-23");   // back to the 県庁所在地 of the same prefecture
  expect(errs).toEqual([]);
});

test("Stage 9 (実機指摘): 山脈は地形の再生成を待たずに続けて描き足せる。端点から描くと続き、別の場所なら新しい線、点は指で掴める", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle"); await page.click("#edit-more");
  const P = await fitPts(page, ["名古屋市", "静岡市", "長野市", "甲府市", "岐阜市"]);
  for (const key of ["ne", "sw"] as const) {
    await page.click(`#tool-ridge-${key}`);
    const base = key === "ne" ? [P[0], P[2]] : [P[4], P[1]];
    await stroke(page, base);                                   // 1st stroke: the range itself
    // immediately (terrain is regenerating): continue from its end, then a separate stroke elsewhere
    const end = await page.evaluate((k) => { const a = (window as any).__kfm, l = a.s.ridges[k]; return a.r.worldToScreen(l[l.length - 1]); }, key) as [number, number];
    await page.waitForFunction(() => (window as any).__kfm.generating, null, { timeout: 10000 });   // the map is being remade (several seconds on a phone): drawing must still work
    await stroke(page, [[end[0] + 3, end[1] + 3], [end[0] + 40, end[1] - 30]]);
    expect(await app(page, `a => (a.s.ridgeExtra?.${key} || []).length`)).toBe(0);   // a continuation: still one stroke, longer
    const n1 = await app(page, `a => a.s.ridges.${key}.length`) as number; expect(n1).toBeGreaterThan(2);
    await stroke(page, key === "ne" ? [P[1], P[3]] : [[P[4][0] - 30, P[4][1] + 30], [P[4][0] - 60, P[4][1] + 60]]);
    expect(await app(page, `a => (a.s.ridgeExtra?.${key} || []).length`)).toBe(1);   // a new, separate stroke
    await page.click(`#tool-ridge-${key}`);   // tool off
  }
  // points can be grabbed with a finger-sized miss (about 30 px off) while the terrain is still being made
  await page.click("#tool-ridge-edit"); const q = await page.evaluate(() => { const a = (window as any).__kfm, p = a.s.ridgeExtra.ne[0][1]; return [a.r.worldToScreen(p), p]; }) as [[number, number], [number, number]];
  await page.mouse.move(q[0][0] + 22, q[0][1] + 18); await page.mouse.down(); await page.mouse.move(q[0][0] + 40, q[0][1] - 10, { steps: 4 }); await page.mouse.up();
  expect(await app(page, `a => a.s.ridgeExtra.ne[0][1][0] !== ${q[1][0]}`)).toBe(true);
  // undo walks back each edit; the terrain is made for the final map
  const pastNe = await app(page, "a => JSON.stringify(a.s.ridgeExtra.ne)");
  await page.click("#edit-undo"); expect(await app(page, "a => JSON.stringify(a.s.ridgeExtra.ne)")).not.toBe(pastNe); await page.click("#edit-redo"); expect(await app(page, "a => JSON.stringify(a.s.ridgeExtra.ne)")).toBe(pastNe);
  await page.waitForFunction(() => { const a = (window as any).__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 });
  expect(await app(page, "a => { let n = 0; for (let k = 0; k < a.terrain.ridge.length; k++) if (a.terrain.ridge[k] > 0.5) n++; return n; }")).toBeGreaterThan(30);
  expect(errs).toEqual([]);
});

test("Stage 10: 府県は地方ブロックごと(北→南)、元号に復興方針、北/南で元のアルプスを除去(Undo/Redo・保存)、開通の儀のあと番号標識は初期OFFでユーザー設定は保持", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  // the seat pickers: nine blocks north to south, all 49, Niigata in 中部 (not mixed by latitude), Hokkaido's three
  await openSeat(page, "capital");
  const groups = await page.evaluate(() => [...document.querySelectorAll("#seat-sel-capital optgroup")].map((g) => ({ l: g.getAttribute("label")!, ids: [...g.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value) })));
  expect(groups.map((g) => g.l)).toEqual(["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州", "沖縄"]);
  expect(groups.flatMap((g) => g.ids)).toHaveLength(49); expect([...groups[0].ids].sort()).toEqual(["HK-HAK", "HK-NEM", "HK-SAP"]); expect(groups[3].ids).toContain("JP-15"); expect(groups[5].ids).toContain("JP-31");
  await openSetup(page); expect(await page.locator("#era-list .rw-item").first().textContent()).toMatch(/神化|元化|神和|同和|継明|順明|明保|寛安|元安|立成|定業|光文|章明|協中/); expect(await page.textContent("#era-desc")).toMatch(/復興方針/);
  await seatSelect(page, "capital", "HK-NEM"); expect(await app(page, "a => a.s.capital")).toBe("HK-NEM"); await seatSelect(page, "capital", "JP-13");
  await closeSheet(page);
  // 北 removes the real Hida range, and only that; one Undo brings it back
  await page.click("#terrain-edit-toggle"); await page.click("#edit-more");
  const h0 = await app(page, "a => a.terrain.hash") as string;
  await page.click("#tool-ridge-ne"); expect(await app(page, "a => JSON.stringify(a.s.alpsRemoved)")).toBe('{"ne":true}');
  await page.waitForFunction((h) => { const a = (window as any).__kfm; return !!a.terrain && !a.generating && a.terrain.hash !== h; }, h0, { timeout: 60000 });
  await page.click("#tool-ridge-ne"); await page.click("#tool-ridge-ne"); expect(await app(page, "a => JSON.stringify(a.s.alpsRemoved)")).toBe('{"ne":true}');   // choosing it again changes nothing
  await page.click("#edit-undo"); expect(await app(page, "a => a.s.alpsRemoved?.ne")).toBeFalsy();
  await page.click("#edit-redo"); expect(await app(page, "a => a.s.alpsRemoved?.ne")).toBe(true);
  if (await app(page, "a => a.tool") !== "view") await page.click(`#tool-${await app(page, "a => a.tool")}`);
  await page.click("#tool-ridge-sw"); expect(await app(page, "a => JSON.stringify(a.s.alpsRemoved)")).toBe('{"ne":true,"sw":true}');
  await page.waitForFunction(() => { const a = (window as any).__kfm; return !!a.terrain && !a.generating; }, null, { timeout: 60000 });
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => JSON.stringify(a.s.alpsRemoved)")).toBe('{"ne":true,"sw":true}');
  // the ceremony: signs start OFF; switched on by hand they stay on through a reload
  expect(await app(page, "a => a.s.layers.signs")).toBe(true);
  await editor(page, false);
  const tokyo = await cityPos(page, "東京"), osaka = await cityPos(page, "大阪市");
  await page.click("#tool-cer-kokudo1"); await draw(page, tokyo, osaka); await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.s.layers.signs")).toBe(false); expect(await app(page, "a => !!a.sim.roles && !!a.sim.kaigen.recon")).toBe(true);
  await page.evaluate(() => { const a = (window as any).__kfm; a.openSheet("layers"); }); await page.click("#layer-signs");
  expect(await app(page, "a => a.s.layers.signs")).toBe(true); expect(await app(page, "a => a.s.layersSet")).toContain("signs");
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.s.layers.signs")).toBe(true);
  expect(errs).toEqual([]);
});

test("Stage 11: 道路図/地形図を最初に選べて保存される。道路図では山脈の線を出さず、山脈の編集中だけ地形図になる。区間を選んで消す・描き直す・Undo/Redoができる", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  const drawn = () => app(page, "a => a.r.ridgeStrokesDrawn") as Promise<number>;
  // the settings sheet offers the two maps; the road map is the default, and the choice is kept through a reload
  await openSetup(page); await page.click("#rw-close"); expect(await page.isVisible("#bg-roadmap")).toBe(true); expect(await page.getAttribute("#bg-roadmap", "aria-pressed")).toBe("true");
  await page.click("#bg-terrain"); expect(await app(page, "a => a.bg")).toBe("terrain"); expect(await app(page, "a => a.s.bg")).toBe("terrain"); await closeSheet(page);
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(await app(page, "a => a.bg")).toBe("terrain");
  await openSetup(page); await page.click("#rw-close"); await page.click("#bg-roadmap"); await closeSheet(page); expect(await app(page, "a => a.bg")).toBe("roadmap");
  // draw two ranges: on the road map the lines are not drawn, while the range tools are on the terrain map is shown, and afterwards the road map returns
  await page.click("#terrain-edit-toggle"); await page.click("#edit-more");
  const P = await fitPts(page, ["名古屋市", "静岡市", "長野市", "甲府市", "岐阜市"]);
  await page.click("#tool-ridge-ne"); expect(await app(page, "a => a.bg")).toBe("terrain");
  await stroke(page, [P[0], P[2]]); await stroke(page, [P[1], P[3]]);
  expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(1); expect(await drawn()).toBe(2);
  // 区間を選ぶ: tap a stroke, delete it, undo, redo; then redraw it
  await page.click("#tool-ridge-pick");
  const mid = await page.evaluate(() => { const a = (window as any).__kfm, l = a.s.ridgeExtra.ne[0]; return a.r.worldToScreen(l[Math.floor(l.length / 2)]); }) as [number, number];
  await page.mouse.click(mid[0], mid[1]); expect(await app(page, "a => JSON.stringify(a.ridgeSel)")).toBe('{"key":"ne","si":1}');
  await page.click("#ridge-del"); expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(0); expect(await drawn()).toBe(1);
  await page.click("#edit-undo"); expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(1);
  await page.click("#edit-redo"); expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(0); await page.click("#edit-undo");
  await page.mouse.click(mid[0], mid[1]); await page.click("#ridge-redraw"); expect(await app(page, "a => a.tool")).toBe("ridge-ne");
  const before = await app(page, "a => JSON.stringify(a.s.ridgeExtra.ne[0])") as string;
  await stroke(page, [[P[1][0] + 4, P[1][1] + 4], [P[4][0], P[4][1]], [P[3][0] + 4, P[3][1] + 4]]);
  expect(await app(page, "a => (a.s.ridgeExtra?.ne || []).length")).toBe(1); expect(await app(page, "a => JSON.stringify(a.s.ridgeExtra.ne[0])")).not.toBe(before);
  // leave the range tools: back to the road map, ranges hidden, the constructions barrier unchanged in the terrain
  await page.click("#tool-ridge-ne"); await page.click("#edit-more").catch(() => {}); await editor(page, false);
  expect(await app(page, "a => a.bg")).toBe("roadmap"); expect(await drawn()).toBe(0);
  expect(errs).toEqual([]);
});

test("Stage 11: 琵琶湖・富士山の縦と横を別々に伸ばせる(各最大5倍・回転を保つ)。富士山の高さは面積相当の倍率に連動し、保存・Undo/Redoで残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await page.click("#terrain-edit-toggle"); await page.click("#sel-fuji");
  const size = () => app(page, "a => JSON.stringify([a.s.features.fuji.scale ?? 1, a.s.features.fuji.scaleY ?? a.s.features.fuji.scale ?? 1])") as Promise<string>;
  await page.click("#rot-l"); const rot = await app(page, "a => a.s.features.fuji.rot") as number; expect(rot).not.toBe(0);
  await page.click("#fuji-size");   // tapping the size opens the 縦横 row (the closed toolbar stays one short row)
  await page.click("#fuji-x-more"); await page.click("#fuji-x-more");
  const [sx, sy] = JSON.parse(await size()) as [number, number]; expect(sx).toBeGreaterThan(1.2); expect(sy).toBe(1);
  expect(await page.textContent("#fuji-size")).toContain("横×"); expect(await page.textContent("#fuji-size")).toContain("縦×1");
  const hgt = await app(page, "a => a.s.features.fuji.auto === true"); expect(hgt).toBe(true);
  await page.click("#fuji-y-less"); const [sx2, sy2] = JSON.parse(await size()) as [number, number]; expect(sx2).toBe(sx); expect(sy2).toBeLessThan(1);
  expect(await app(page, "a => a.s.features.fuji.rot")).toBe(rot);                       // the rotation is kept
  await page.click("#edit-undo"); expect(JSON.parse(await size())[1]).toBe(1); await page.click("#edit-redo"); expect(JSON.parse(await size())[1]).toBe(sy2);
  await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  expect(JSON.parse(await size())).toEqual([sx, sy2]);
  // the lake: its own two axes, each stops at 5x (the map check may stop it sooner: the lake must stay off the coast)
  await page.click("#terrain-edit-toggle").catch(() => {}); if (!(await page.isVisible("#sel-biwa"))) await page.click("#terrain-edit-toggle");
  await page.click("#sel-biwa"); if (!(await page.isVisible("#biwa-y-more"))) await page.click("#biwa-size"); await page.click("#biwa-y-more"); await page.click("#biwa-y-more");
  const lake = await app(page, "a => JSON.stringify([a.s.features.biwa.scale ?? 1, a.s.features.biwa.scaleY ?? a.s.features.biwa.scale ?? 1])") as string; const [lx, ly] = JSON.parse(lake) as [number, number];
  expect(ly).toBeGreaterThan(lx); expect(Math.max(lx, ly)).toBeLessThanOrEqual(5); expect(await app(page, "a => a.issues.filter((i) => i.severity === 'error').length")).toBe(0);
  expect(errs).toEqual([]);
});

test("Stage 12: 地図帳に都市の栄枯盛衰(伸びた・縮んだ都市と原因)が出て、都市を選ぶと推移グラフと追い風・逆風の内訳が見える。地図の規模表示はレイヤーで切り替わり、シミュレーションは不変", async ({ page }) => {
  const errs = watchErrors(page); await startReal(page, "heisei");
  await page.evaluate(() => { const a = (window as any).__kfm; a.sim.speed = 0; a.sim.policy.mode = "auto"; a.ffYears(30); });
  expect(await app(page, "a => a.sim.econ === true && Object.keys(a.sim.city12).length > 40")).toBe(true);
  const h0 = await app(page, "a => a.sim.month + ':' + JSON.stringify(a.sim.city12).length");
  await page.click("#dock-layers"); await await expect(page.locator("label.layer:has(#layer-econ)")).toContainText("都市圏"); await page.uncheck("#layer-econ"); expect(await app(page, "a => a.s.layers.econ")).toBe(false); await page.check("#layer-econ"); expect(await app(page, "a => a.s.layers.econ")).toBe(true);
  expect(await app(page, "a => a.sim.month + ':' + JSON.stringify(a.sim.city12).length")).toBe(h0); await closeSheet(page);
  await page.click("#dock-atlas"); await expect(page.locator("#city-eco")).toBeVisible();
  expect(await page.locator("#eco-up .issue").count()).toBe(5); expect(await page.locator("#eco-down .issue").count()).toBe(5);
  await expect(page.locator("#eco-up")).toContainText("▲"); await expect(page.locator("#eco-down")).toContainText("▼");
  // Stage 13: the metropolitan areas (one count per person, area and radius in km, the prefectures they cross) are in the atlas; the legend names them
  expect(await app(page, "a => !!a.sim.metro && a.sim.metro.list.length > 10")).toBe(true);
  // Stage 14: the seats head the city order (one artificial rule, stated in the atlas), and the circles are drawn on top
  await expect(page.locator("#eco-seats")).toContainText("人為的な規則"); expect(await page.locator("#eco-seats .issue").count()).toBe(2); await expect(page.locator("#eco-seats")).toContainText("全国1位"); await expect(page.locator("#eco-seats")).toContainText("全国2位");
  expect(await app(page, "a => !!a.sim.seats14")).toBe(true);
  expect(await page.locator("#eco-metro .issue").count()).toBeGreaterThanOrEqual(5); await expect(page.locator("#eco-metro")).toContainText("km²"); await expect(page.locator("#eco-metro")).toContainText("府県にまたがり");
  await page.click("#eco-detail summary"); await expect(page.locator("#eco-chart")).toBeVisible(); await expect(page.locator("#eco-out")).toContainText("集積");
  await page.selectOption("#eco-city", { index: 3 }); expect(await page.locator("#eco-chart polyline").count()).toBe(1);
  expect(errs).toEqual([]);
});

test("Stage 20: 離島(硫黄島)を地図で首都に選べる。最寄りの地名+市、旧東京は残り、国道1号が島まで届き、保存・再読み込みで残る", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await openMapPick(page, "capital");
  const spot = await app(page, "a => a.world.islets.find((s) => s.islet.name === '硫黄島').pos") as [number, number];
  await page.evaluate((p) => { const a = (window as any).__kfm, H = window.innerHeight; a.r.setView({ cx: p[0], cy: p[1] + (200 - H / 2) / 0.6, zoom: 0.6 }, true); }, spot);
  const [sx, sy] = await screenOf(page, [spot[0] + 4, spot[1] - 3]);   // a little off the island: the finger-wide hit area still picks it
  await page.mouse.click(sx, sy); expect(await app(page, "a => a.seatPick && a.seatPick.islet")).toBe("硫黄島"); expect(await app(page, "a => a.seatPick.pref")).toBe("JP-13");
  expect(await page.textContent("#seat-map-hint")).toContain("硫黄島市"); expect(await app(page, "a => a.s.capital")).toBeUndefined();   // proposed only
  await page.click("#seat-confirm"); expect(await app(page, "a => a.s.capital")).toBe("JP-13");
  expect(await app(page, "a => a.world.cities.filter((c) => c.pref === 'JP-13' && c.kind === 'capital').map((c) => c.name)")).toEqual(["硫黄島市"]);   // one 県庁所在地
  expect(await app(page, "a => { const c = a.world.cityById.get('C-JP-13'); return c.kind + ':' + !!c.former; }")).toBe("city:true");   // the old one stays an ordinary city
  await closeSetup(page); await editor(page, false);
  expect(await page.textContent("#tool-cer-kokudo1")).toContain("硫黄島");
  await page.click("#tool-cer-kokudo1");
  const pts = await fitPts(page, ["硫黄島市", "東京", "大阪市"]);
  for (const [x, y] of pts) { const hit = await page.evaluate(([px, py]) => (document.elementFromPoint(px, py) as HTMLElement)?.tagName ?? "", [x, y]); expect(hit, `(${x},${y}) is on the map`).toBe("CANVAS"); }
  await stroke(page, pts);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true);
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 120000 });
  expect(await app(page, "a => a.sim.isl20 === true && a.sim.moves20.length === 1 && a.sim.moves20[0].pref === 'JP-13'")).toBe(true);
  expect(await app(page, "a => { const c = a.world.cities.find((x) => x.name === '硫黄島市'); return a.sim.cities[c.id].pop <= c.capPop && a.sim.cities['C-JP-13'].pop > 100000; }")).toBe(true);   // the island city holds only what the island can; Tokyo still has its people
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => a.sim.moves20[0].pref === 'JP-13' && a.world.cities.some((c) => c.name === '硫黄島市' && c.kind === 'capital')")).toBe(true);
  expect(errs).toEqual([]);
});

test("Stage 20: 尖閣・竹島・北方四島・硫黄島はどれも地図で選べ、領有の事実が表示され、島は表示される", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await openMapPick(page, "palace");
  expect(await app(page, "a => a.r.islets.length")).toBeGreaterThan(80);
  for (const [name, pref, claim] of [["魚釣島", "JP-47", "中国"], ["竹島", "JP-32", "韓国"], ["択捉島", "HK-NEM", "ロシア"], ["色丹島", "HK-NEM", "ロシア"], ["硫黄島", "JP-13", ""]] as const) {
    const p = await app(page, `a => a.world.islets.find((s) => s.islet.name === '${name}').pos`) as [number, number];
    await page.evaluate((q) => { const a = (window as any).__kfm, H = window.innerHeight; a.r.setView({ cx: q[0], cy: q[1] + (200 - H / 2) / 1.5, zoom: 1.5 }, true); }, p);
    const [x, y] = await screenOf(page, p); await page.mouse.click(x, y);
    expect(await app(page, "a => a.seatPick && a.seatPick.islet"), name).toBe(name); expect(await app(page, "a => a.seatPick.pref"), name).toBe(pref);
    if (claim) expect(await page.textContent("#seat-map-hint"), name).toContain(claim);
    await page.click("#seat-cancel");
  }
  expect(errs).toEqual([]);
});

test("Stage 21: 国道1号は副首都側から描いても開通し、近くの県庁所在地は道路網につながる", async ({ page }) => {
  const errs = watchErrors(page); await bootReal(page);
  await closeSetup(page); await editor(page, false);
  await page.click("#tool-cer-kokudo1");
  const pts = await fitPts(page, ["大阪市", "名古屋市", "東京"]);   // Osaka -> Nagoya -> Tokyo: the sub-capital end first
  await stroke(page, pts);
  expect(await app(page, "a => a.cerDraft.kokudo1.prev.ok")).toBe(true); expect(await app(page, "a => a.cerDraft.kokudo1.prev.reversed === true")).toBe(true);
  expect(await page.textContent("#cer-status-kokudo1")).toContain("向き直し");
  await page.click("#cer-go"); await page.waitForFunction(() => (window as any).__kfm.sim, null, { timeout: 120000 });
  expect(await app(page, "a => { const r = Object.values(a.sim.routes).find((x) => x.grade === 'national' && x.number === 1); return !!r && r.edges.length > 3; }")).toBe(true);
  expect(await app(page, "a => { const ids = ['名古屋市', '横浜市', '岐阜市']; return ids.every((n) => { const c = a.world.cities.find((x) => x.name === n); return Object.values(a.sim.edges).some((e) => e.state === 'open' && (e.mode ?? 'road') === 'road' && e.cells.includes(c.cell)); }); }")).toBe(true);
  expect(errs).toEqual([]);
});

test("Stage 23: 府県は初期の選択式(地方ブロック別・北から南)。360px幅で押せ、選んでも設定欄が残り、地図選択と往復できる。元号は○/●の一覧", async ({ page }) => {
  const errs = watchErrors(page); await page.setViewportSize({ width: 360, height: 740 }); await bootReal(page);
  await page.click("#setup-tab-capital"); const sel = page.locator("#seat-sel-capital"); expect(await sel.isVisible()).toBe(true);
  { const b = await sel.boundingBox(); expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.x + b!.width).toBeLessThanOrEqual(360); expect(b!.y + b!.height).toBeLessThanOrEqual(740 - 40); }
  const groups = await sel.evaluate((e) => [...e.querySelectorAll("optgroup")].map((g) => [g.getAttribute("label"), g.querySelectorAll("option").length] as [string, number]));
  expect(groups.map((g) => g[0])).toEqual(["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州", "沖縄"]); expect(groups.reduce((n, g) => n + g[1], 0)).toBe(49);
  const vals = await sel.evaluate((e) => [...e.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)); expect(vals[0].startsWith("HK-")).toBe(true); expect(vals[vals.length - 1]).toBe("JP-47"); expect(await sel.inputValue()).toBe("JP-13");
  await sel.selectOption("JP-47"); expect(await app(page, "a => a.s.capital")).toBe("JP-47"); expect(await page.locator("#setup-panel").count()).toBe(1); expect(await sel.inputValue()).toBe("JP-47");   // the panel stays after choosing
  expect(await page.locator("#seat-sel-capital option[value=JP-27]").count()).toBe(1);
  await page.click("#setup-tab-sub"); expect(await page.locator("#seat-sel-sub option[value=JP-47]").evaluate((o: HTMLOptionElement) => o.disabled)).toBe(true);   // the capital's prefecture cannot be the sub-capital
  await page.click("#setup-tab-capital"); await sel.selectOption("JP-13");
  // 地図で選ぶ -> 戻る comes back to the select; 取り消し changes nothing; 決定 moves the 県庁所在地
  await page.click("#pref-map"); expect(await app(page, "a => a.tool")).toBe("seatpick");
  const nagoya = await cityPos(page, "名古屋市"), spot: [number, number] = [nagoya[0] + 12, nagoya[1] + 9];
  await page.evaluate((p) => { const a = (window as any).__kfm, H = window.innerHeight; a.r.setView({ cx: p[0], cy: p[1] + (200 - H / 2) / 3, zoom: 3 }, true); }, spot);
  { const [x, y] = await screenOf(page, spot); await page.mouse.click(x, y); } await page.click("#seat-cancel"); expect(await app(page, "a => a.s.capital")).toBe("JP-13");
  await page.click("#setup-tab-capital").catch(() => {}); if (!(await page.isVisible("#pref-map"))) await page.click("#setup-tab-capital");
  await page.click("#pref-map"); { const [x, y] = await screenOf(page, spot); await page.mouse.click(x, y); } await page.click("#seat-back"); expect(await page.isVisible("#seat-sel-capital")).toBe(true); expect(await app(page, "a => a.s.capitalPos")).toBeUndefined();
  await page.click("#pref-map"); { const [x, y] = await screenOf(page, spot); await page.mouse.click(x, y); } await page.click("#seat-confirm");
  expect(await app(page, "a => a.s.capital")).toBe("JP-23"); expect(await app(page, "a => a.world.cities.filter((c) => c.pref === 'JP-23' && c.kind === 'capital').length")).toBe(1);
  // the era list: the same window; each name with its own policy under it; choosing keeps it open
  await page.click("#setup-tab-era"); expect(await page.isVisible("#era-list")).toBe(true);
  const items = await page.locator("#era-list .rw-item").count(); expect(items).toBe(14);
  await page.locator("#era-opt-3").click(); expect(await app(page, "a => a.firstEra")).toBe(3); expect(await page.isVisible("#era-list")).toBe(true); expect(await page.locator("#era-opt-3 .rw-dot").textContent()).toBe("●");
  expect(await page.locator("#era-list .rw-desc").count()).toBeGreaterThan(5);
  await page.click("#rw-close"); expect(await page.locator("#era-list").count()).toBe(0);
  expect(errs).toEqual([]);
});

test("Stage 22: 2200年の遷都・改元・復興方針を選び、国道0号を逆向きに描いて開通。保存しても再発火しない", async ({ page }) => {
  test.setTimeout(240000);
  const errs = watchErrors(page); await startReal(page);
  // jump the clock to the eve of 2200 (the event fires at the first year boundary on or after it)
  await page.evaluate(() => { const a = (window as any).__kfm, s = a.sim; a.runner.settle(); s.month = (2200 - s.startYear) * 12; s.kaigen.next = 2230; s.kaigen.pending = null; s.policy.pending = null; s.policy.mode = "priority"; s.speed = 20; });
  await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "pending", null, { timeout: 60000 });
  await page.waitForSelector("#e22-box", { timeout: 20000 });
  expect(await page.locator("[id^=e22-era-]").count()).toBe(5);
  await page.selectOption("#e22-sel-capital", "JP-40"); await page.selectOption("#e22-sel-sub", "JP-13");
  await page.click("#e22-era-1"); await page.click("#e22-stance-kairo"); await page.click("#e22-coast-neutral"); await page.click("#e22-focus-disperse");
  expect(await page.locator("#e22-stance-kairo .rw-dot").textContent()).toBe("●");
  await page.click("#e22-decide");
  expect(await app(page, "a => [a.sim.e2200.state, a.sim.capital, a.sim.subCapital, a.sim.kaigen.eras[a.sim.kaigen.eras.length - 1].name, a.sim.kaigen.recon.coast]")).toEqual(["road0", "JP-40", "JP-13", "興化", "neutral"]);
  await page.evaluate(() => { (window as any).__kfm.sim.speed = 0; });
  // 国道0号: drawn from the new sub-capital (Tokyo) to the new capital (Fukuoka) -- the other way round
  await page.click("#tool-cer-kokudo0");
  const pts = await fitPts(page, ["東京", "大阪市", "福岡市"]); await stroke(page, pts);
  expect(await app(page, "a => a.cerDraft.kokudo0.prev.ok")).toBe(true); expect(await app(page, "a => a.cerDraft.kokudo0.prev.reversed === true")).toBe(true);
  await page.click("#road0-go");
  expect(await app(page, "a => { const r = Object.values(a.sim.routes).find((x) => x.grade === 'national' && x.number === 0); return !!r && a.sim.e2200.state === 'done' && a.sim.e2200.road0.reusedKm > a.sim.e2200.road0.newKm; }")).toBe(true);
  expect(await app(page, "a => Object.values(a.sim.routes).some((x) => x.grade === 'national' && x.number === 1 && x.active)")).toBe(true);
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  expect(await app(page, "a => [a.sim.e2200.state, a.sim.kaigen.eras.filter((e) => e.name === '興化').length]")).toEqual(["done", 1]);
  expect(errs).toEqual([]);
});

test("Stage 23: 完全自動でも2200年で必ず止まり、選ぶまで進まない。現状維持は明示のボタン。保存スロットは1行で、保存した首都・副首都・西暦が出る", async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 360, height: 740 });
  const errs = watchErrors(page); await startReal(page);
  await page.evaluate(() => { const a = (window as any).__kfm, s = a.sim; a.runner.settle(); s.month = (2200 - s.startYear) * 12; s.kaigen.next = 2230; s.kaigen.pending = null; s.policy.pending = null; s.policy.mode = "auto"; s.speed = 20; });
  await page.waitForFunction(() => (window as any).__kfm.sim.e2200?.state === "pending", null, { timeout: 60000 });
  await page.waitForSelector("#e22-box", { timeout: 20000 });
  const m = await app(page, "a => a.sim.month"); await page.waitForTimeout(2500); expect(await app(page, "a => a.sim.month")).toBe(m); expect(await app(page, "a => a.sim.e2200.state")).toBe("pending");   // ×20 and 完全自動: still waiting
  await page.evaluate(async () => { await (window as any).__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.sim, null, { timeout: 90000 });
  await page.waitForSelector("#e22-box", { timeout: 20000 }); expect(await app(page, "a => a.sim.e2200.state")).toBe("pending");   // a save keeps the event open
  await page.click("#e22-keep"); expect(await app(page, "a => [a.sim.e2200.state, a.sim.e2200.kept === true, a.sim.e2200.auto === undefined]")).toEqual(["done", true, true]);
  // save slots: one line each
  await page.evaluate(() => { const a = (window as any).__kfm; a.sheet = null; a.openSheet("menu"); }); await page.waitForSelector("#slot-1");
  await page.locator("#slot-2 .slot-save").click(); await page.waitForFunction(() => /\d{4}年/.test(document.getElementById("slot-2")!.textContent ?? ""), null, { timeout: 15000 });
  const row = await page.evaluate(() => { const r = document.getElementById("slot-2")!, b = r.getBoundingClientRect(), t = r.querySelector(".slot-text") as HTMLElement; return { h: b.height, w: b.width, text: r.textContent, load: !!r.querySelector(".slot-load"), save: !!r.querySelector(".slot-save"), right: b.right }; });
  expect(row.h).toBeLessThan(48); expect(row.right).toBeLessThanOrEqual(360); expect(row.load && row.save).toBe(true); expect(row.text).toMatch(/②.*東京府.*大阪府.*2200年/);
  expect(await page.locator("#slot-5").textContent()).toContain("(空)");
  expect(errs).toEqual([]);
});

test("Stage 23: 台帳から路線を選ぶと地図で強調され台帳が小さくなる。再タップ・別路線・別タブで解除。路線番号一覧から選んでも同じ強調", async ({ page }) => {
  test.setTimeout(240000);
  const errs = watchErrors(page); await startReal(page);
  await page.evaluate(() => { const a = (window as any).__kfm; a.runner.settle(); a.sim.speed = 0; a.ffYears(8); a.openSheet("ledger"); });
  await page.waitForSelector("#led-modes");
  const first = await page.locator("#sheet .issue[id^=led-]").first(); const rid = (await first.getAttribute("id"))!.slice(4);
  await first.click(); expect(await app(page, "a => a.hl && a.hl.id")).toBe("r:" + rid); expect(await app(page, "a => a.ledgerMini")).toBe(true);
  expect(await page.isVisible("#led-mini")).toBe(true); { const h = await page.evaluate(() => document.getElementById("sheet")!.getBoundingClientRect().height / innerHeight); expect(h).toBeLessThan(0.34); }
  expect(await app(page, "a => a.hl.edges.length")).toBeGreaterThan(0);
  const before = await app(page, "a => JSON.stringify([a.sim.month, Object.keys(a.sim.edges).length, a.sim.rngState, Object.values(a.sim.routes).filter((r) => r.active).length])");
  await page.click("#hl-next"); expect(await app(page, "a => a.hl.id")).not.toBe("r:" + rid); await page.click("#hl-prev"); expect(await app(page, "a => a.hl.id")).toBe("r:" + rid);
  await page.click("#hl-full"); expect(await app(page, "a => a.ledgerMini")).toBe(false); await page.locator("#led-r\\." + rid.slice(2)).click().catch(async () => { await page.locator("#sheet .issue.hl").click(); });
  expect(await app(page, "a => a.hl")).toBeNull();   // the same line again: released
  await page.locator("#sheet .issue[id^=led-]").nth(1).click(); expect(await app(page, "a => !!a.hl")).toBe(true);
  await page.click("#hl-clear"); expect(await app(page, "a => a.hl")).toBeNull();
  // numbers: the same highlight from the number list
  await page.click("#led-mode-numbers"); await page.click("#num-road-1"); expect(await app(page, "a => !!a.hl && a.hl.edges.length > 0")).toBe(true); const idA = await app(page, "a => a.hl.id");
  await page.click("#hl-full"); await page.click("#num-road-1"); expect(await app(page, "a => a.hl")).toBeNull();
  await page.click("#num-road-2"); expect(await app(page, "a => a.hl.id")).not.toBe(idA); await page.click("#hl-full");
  await page.click("#num-cls-rail"); expect(await app(page, "a => a.hl")).toBeNull();   // another tab lets go
  await page.click("#num-rail-1"); expect(await app(page, "a => !!a.hl")).toBe(true); await page.click("#hl-full"); await page.click("#led-mode-normal"); expect(await app(page, "a => a.hl")).toBeNull();
  await page.click("#led-mode-numbers"); await page.click("#num-cls-sea"); await page.click("#num-sea-1"); expect(await app(page, "a => !!a.hl")).toBe(true);   // (a sea lane)
  await page.evaluate(() => (window as any).__kfm.openSheet("history")); expect(await app(page, "a => a.hl")).toBeNull();
  expect(await app(page, "a => JSON.stringify([a.sim.month, Object.keys(a.sim.edges).length, a.sim.rngState, Object.values(a.sim.routes).filter((r) => r.active).length])")).toBe(before);   // choosing changed nothing in the game
  expect(errs).toEqual([]);
});

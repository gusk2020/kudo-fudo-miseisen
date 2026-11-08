#!/usr/bin/env node
/** Save compatibility check across two built versions of the game, in a real (emulated) browser, on ONE origin like the real site.
 *  usage: node tools/compat-check.mjs <OLD_DIST> <NEW_DIST> [--base /kudo-fudo-miseisen/] [--port 4190]
 *  1. the OLD build starts a game, plays a few years, saves (autosave + manual slot 2); its browser storage (IndexedDB + localStorage) is captured;
 *  2. the NEW build opens THAT storage: the game must come back (same month, capital, routes, cities) and keep playing and saving; the older save text is kept under `:pre-s35`;
 *  3. the OLD build opens what the NEW build wrote: it must either load it or put it aside without touching the stored game (the way back).
 *  Exit code 0 only if every check passed. Needs a Chromium (CHROMIUM_PATH) and Playwright from the repository. */
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const [OLD, NEW] = process.argv.slice(2, 4).map((p) => path.resolve(p)), arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "/kudo-fudo-miseisen/"), PORT = Number(arg("--port", "4190")), types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let root = OLD;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); if (!u.pathname.startsWith(BASE)) { if (u.pathname === "/") { res.writeHead(302, { Location: BASE + u.search }); return res.end(); } res.writeHead(404); return res.end(); }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length)); if (!rel || rel.endsWith("/")) rel += "index.html"; const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": types[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(PORT);
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); };
const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const kfm = (page, f) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const ready = (page) => page.waitForFunction(() => window.__kfm?.world, null, { timeout: 120000 });
const summary = (page) => kfm(page, "a => ({ month: a.sim.month, capital: a.sim.capital ?? 'default', routes: Object.keys(a.sim.routes).length, cities: Object.keys(a.sim.cities).length, pop: Math.round(Object.values(a.sim.cities).reduce((s, c) => s + c.pop, 0)), startYear: a.sim.startYear, relocFirst: a.sim.relocFirst ?? null })");
const rawKeys = (page) => page.evaluate(() => new Promise((res) => { indexedDB.databases().then(async (dbs) => { const out = {}; for (const d of dbs) { await new Promise((r2) => { const q = indexedDB.open(d.name); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains("saves")) { db.close(); return r2(); } const st = db.transaction("saves").objectStore("saves"); const k = st.getAllKeys(); k.onsuccess = () => { const v = st.getAll(); v.onsuccess = () => { k.result.forEach((key, i) => { out[d.name + "/" + String(key)] = String(v.result[i]).length; }); db.close(); r2(); }; }; }; q.onerror = () => r2(); }); } res(out); }); }));

const b = await launch();
try {
  // ---- 1. OLD build writes a game
  root = OLD; let ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true }); let page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page);
  const pos = (n) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p) => page.evaluate((q) => window.__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = window.__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = window.__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 90000 });
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(6); return 1; }"); await page.evaluate(async () => { await window.__kfm.persist(true); });
  await kfm(page, "a => { a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-2 .slot-save"); await page.click("#slot-2 .slot-save"); await page.waitForTimeout(800);
  const before = await summary(page), keys0 = await rawKeys(page); console.log("OLD wrote", JSON.stringify(before), JSON.stringify(keys0));
  check("old build: no page errors while writing the save", errs.length === 0, errs[0] ?? ""); check("old save is a live-version game (not a 1800 game)", await kfm(page, "a => !a.sim.rules1800"));
  const state1 = await ctx.storageState({ indexedDB: true }); const oldAuto = await page.evaluate(() => new Promise((res) => { indexedDB.databases().then((dbs) => { const q = indexedDB.open(dbs.find((d) => d.name.startsWith("kfm-stage1")).name); q.onsuccess = () => { const g = q.result.transaction("saves").objectStore("saves").get("s3:auto"); g.onsuccess = () => res(g.result); }; }); }));
  { const j = JSON.parse(oldAuto); const sv = j.save ?? j; console.log("old stored save: keys", Object.keys(j).join(","), "| sim.stage3", sv.sim?.stage3, "| sim.rec34", !!sv.sim?.rec34); }
  const rd = (page, k) => page.evaluate((k) => new Promise((res) => { indexedDB.databases().then((dbs) => { const q = indexedDB.open(dbs.find((d) => d.name.startsWith("kfm-stage1")).name); q.onsuccess = () => { const g = q.result.transaction("saves").objectStore("saves").get(k); g.onsuccess = () => res(g.result ?? null); }; }); }), k);
  const slot2Orig = await rd(page, "s3:slot2");
  await ctx.close();

  // ---- 2. NEW (1800) build opens that storage
  root = NEW; ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, storageState: state1 }); page = await ctx.newPage(); const errs2 = []; page.on("pageerror", (e) => errs2.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page); await page.waitForTimeout(6000);
  check("new build: the old game is NOT loaded as a running game", !(await kfm(page, "a => !!a.sim && !a.sim.rules1800")));
  check("new build: the old road data is put aside under ':quarantine' (not deleted)", (await rd(page, "s3:auto:quarantine")) !== null);
  const autoAfterLoad = await rd(page, "s3:auto"); console.log("auto after load: same text as before =", autoAfterLoad === oldAuto, "| bytes", autoAfterLoad?.length, "vs", oldAuto.length);
  // an attempt to overwrite: the lock refuses, and even with the lock forced open the original text is kept first
  await kfm(page, "a => { a.persist(true); return 1; }"); await page.waitForTimeout(600);
  check("new build: a save attempt on the locked game changes nothing", (await rd(page, "s3:auto")) === autoAfterLoad);
  const state2a = await ctx.storageState({ indexedDB: true });
  await kfm(page, "a => { a.saveLocked = false; a.pendingSim = null; a.persist(true); return 1; }"); await page.waitForTimeout(800);
  const pre = await rd(page, "s3:auto:pre-1800"); check("new build: the original save text is kept for good under ':pre-1800', byte-identical", pre === oldAuto);
  check("new build: manual slot 2 is untouched", (await rd(page, "s3:slot2")) === slot2Orig);
  await kfm(page, "a => { a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-2");
  check("new build: slot 2 is still listed", (await page.textContent("#slot-2")).includes("年"));
  check("new build: no page errors", errs2.length === 0, errs2[0] ?? "");
  const state2 = await ctx.storageState({ indexedDB: true }); await ctx.close();
  // ---- 3a. the way back, realistic: the new build was opened and the player did NOT start a new game
  root = OLD; { const c = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, storageState: state2a }); const p = await c.newPage(); const e = []; p.on("pageerror", (x) => e.push(String(x)));
    await p.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(p); await p.waitForFunction(() => window.__kfm.sim, null, { timeout: 120000 }).catch(() => {});
    const r = await kfm(p, "a => a.sim ? { routes: Object.keys(a.sim.routes).length, cities: Object.keys(a.sim.cities).length } : null");
    check("rollback (realistic): the old build comes back with the original game on its own", !!r && r.routes === before.routes && r.cities === before.cities, JSON.stringify(r)); check("rollback (realistic): no page errors", e.length === 0, e[0] ?? ""); await c.close(); }
  // ---- 3b. worst case: the player started a new game on the new build (the save was overwritten); the original is still in storage: the OLD build opens the same storage
  root = OLD; ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, storageState: process.env.CONTROL ? state1 : state2 }); page = await ctx.newPage(); const errs3 = []; page.on("pageerror", (e) => errs3.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page); await page.waitForTimeout(4000);
  check("rollback: the old build opens without a page error", errs3.length === 0, errs3[0] ?? "");
  check("rollback: slot 2 is byte-identical and still in storage", (await rd(page, "s3:slot2")) === slot2Orig);
  check("rollback: ':pre-1800' and ':quarantine' are still in storage", (await rd(page, "s3:auto:pre-1800")) === oldAuto && (await rd(page, "s3:auto:quarantine")) !== null);
  console.log("worst case: the originals are intact in storage; the old build has no screen to restore :pre-1800, so slot 2 is the way back -- see the report");
  await ctx.close();
} finally { await b.close(); server.close(); }
const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} checks passed`); process.exit(bad.length ? 1 : 0);
